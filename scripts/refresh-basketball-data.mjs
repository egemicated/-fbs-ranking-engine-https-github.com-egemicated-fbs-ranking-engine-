import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { atomicJson } from '../src/ingest.js';
import {
  BASKETBALL_BUDGET, createBasketballClient, readBasketballLedger, withBasketballRefreshLock,
} from '../basketball/data-client.js';
import {
  acquireBasketballSeason, importBasketballExport, loadBasketballPrevious, planBasketballSeason,
} from '../basketball/data-refresh.js';

const artifactsDir = resolve('data/seasons/basketball');
const cacheDir = resolve('research/cache/basketball');
const ledgerPath = join(cacheDir, 'quota-ledger.json');
const lockPath = join(cacheDir, 'refresh.lock');
const safeJsonLog = value => console.log(JSON.stringify(value, null, 2));

async function main() {
  const { values } = parseArgs({
    options: {
      season: { type: 'string', multiple: true }, info: { type: 'boolean' }, 'dry-run': { type: 'boolean' },
      'max-calls': { type: 'string' }, 'no-boxes': { type: 'boolean' }, full: { type: 'boolean' },
      players: { type: 'boolean' }, rolling: { type: 'boolean' }, 'refresh-teams': { type: 'boolean' },
      'teams-csv': { type: 'string' }, 'games-csv': { type: 'string', multiple: true },
      'boxes-csv': { type: 'string', multiple: true },
    },
  });
  const now = new Date();
  const current = now.getUTCFullYear() + Number(now.getUTCMonth() >= 6);
  const seasons = [...new Set((values.season ?? [String(current)]).map(Number))];
  const maxCalls = Number(values['max-calls'] ?? BASKETBALL_BUDGET.maxCallsPerRun);
  if (!Number.isInteger(maxCalls) || maxCalls < 0 || maxCalls > BASKETBALL_BUDGET.maxCallsPerRun) {
    throw new Error('Basketball per-run cap is outside the approved range');
  }
  if (seasons.some(season => !Number.isSafeInteger(season) || season < 2003 || season > current)) {
    throw new Error('Use basketball ending years from 2003 through the current season');
  }
  const csv = values['teams-csv'] || values['games-csv'] || values['boxes-csv'];
  const token = process.env.CBBD_API_KEY || process.env.CFBD_API_KEY;
  const options = { full: values.full, boxes: !values['no-boxes'], players: values.players,
    rolling: values.rolling, refreshTeams: values['refresh-teams'] };
  if (csv) {
    if (!values['teams-csv'] || !values['games-csv']?.length || seasons.length !== 1 || values.info || values['dry-run']) {
      throw new Error('CSV import requires exactly one season, --teams-csv FILE and at least one --games-csv FILE');
    }
    safeJsonLog(await withBasketballRefreshLock(lockPath, () => importBasketballExport({
      season: seasons[0], now, artifactsDir, cacheDir,
      teamsPath: values['teams-csv'], gamesPaths: values['games-csv'], boxesPaths: values['boxes-csv'] ?? [],
    })));
    return;
  }

  const plans = await Promise.all(seasons.map(async season => {
    const { artifact, raw } = await loadBasketballPrevious(season, artifactsDir, cacheDir);
    return planBasketballSeason({ season, previous: raw ? artifact : null, now, ...options });
  }));
  if (values.info || values['dry-run']) {
    const ledger = await readBasketballLedger(ledgerPath);
    const quota = token ? await createBasketballClient({ token, ledger, maxCalls }).checkQuota() : null;
    if (values.info && !quota) throw new Error('Use a locally supplied CBBD_API_KEY or CFBD_API_KEY to read authentic shared /info');
    safeJsonLog({ quota, plans, estimatedCalls: plans.reduce((sum, plan) => sum + plan.estimatedCalls, 0), meteredCalls: 0 });
    return;
  }
  await withBasketballRefreshLock(lockPath, async () => {
    const ledger = await readBasketballLedger(ledgerPath);
    const client = createBasketballClient({
      token, ledger, maxCalls, rawDir: join(cacheDir, 'responses'),
      saveLedger: value => atomicJson(ledgerPath, value, { spacing: 0 }),
    });
    const startingQuota = await client.checkQuota();
    const estimated = plans.reduce((sum, plan) => sum + plan.estimatedCalls, 0);
    if (estimated > startingQuota.basketballAllowedForRun) {
      throw new Error(`Plan estimates ${estimated} calls but only ${startingQuota.basketballAllowedForRun} are available above the protected reserves. Select fewer seasons.`);
    }
    const results = [];
    for (const season of seasons) {
      const result = await acquireBasketballSeason({
        client, season, now, artifactsDir, cacheDir, ...options,
      });
      results.push(result);
      safeJsonLog(result);
    }
    const endingQuota = await client.checkQuota();
    safeJsonLog({ startingQuota, endingQuota, estimatedCalls: estimated, basketballAttempts: client.runAttempts,
      providerSharedDebitsDuringRun: endingQuota.resetAt === startingQuota.resetAt
        ? startingQuota.remainingCalls - endingQuota.remainingCalls : null, seasons: results.map(item => item.season) });
  });
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
