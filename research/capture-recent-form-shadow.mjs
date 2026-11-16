import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual as same } from 'node:util';
import { validWeeklyPick } from '../frontend/weekly-picks-score.js';
import { validateSeason } from '../src/engine.js';
import { matchupValidation, strengthWinProbability } from '../src/site-validation.js';
import { buildRecentFormForecasts, RECENT_FORM_SHADOW_MODEL } from './lib/recent-form-shadow.mjs';

export const RECENT_FORM_PROTOCOL_ID = RECENT_FORM_SHADOW_MODEL.id;
export const RECENT_FORM_OBSERVATIONS = 'research/recent-form-observations';

const archive = new URL('../', import.meta.url);
const day = 86_400_000;
const timestamp = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sameProbability = (first, second) => Number.isFinite(first) && Number.isFinite(second) && Math.abs(first - second) <= 1e-12;
const probability = value => Number.isFinite(value) && value >= 0 && value <= 1;
const sortText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const modelCoefficients = {
  graph: RECENT_FORM_SHADOW_MODEL.graphCoefficient,
  residual: RECENT_FORM_SHADOW_MODEL.residualCoefficient,
  ageHalfLife: RECENT_FORM_SHADOW_MODEL.graphHalfLifeDays,
  residualHalfLife: RECENT_FORM_SHADOW_MODEL.residualHalfLifeDays,
  residualPriorGames: RECENT_FORM_SHADOW_MODEL.residualPriorGames,
};

export function recentFormObservationHash({ resultSha256, ...observation }) {
  return sha256(JSON.stringify(observation));
}

function observationName(weeklyPicksAsOf, snapshotHash) {
  if (!Number.isFinite(timestamp(weeklyPicksAsOf)) || !isHash(snapshotHash)) throw Error('Invalid recent-form checkpoint identity');
  const key = new Date(timestamp(weeklyPicksAsOf)).toISOString().replace(/[^0-9]/g, '');
  return `${key}-${snapshotHash.slice(0, 12)}-${RECENT_FORM_PROTOCOL_ID}.json`;
}

function checkpoint({ season, snapshot, weeklyPicks, previous, protocol, inputSha256 }) {
  validateSeason(season);
  const { asOf, snapshotHash, modelVersion, config } = snapshot;
  const weeklyPicksAsOf = weeklyPicks.asOf;
  const sourceFetchedAt = season.source?.fetchedAt;
  const sourceHash = season.source?.sha256;
  const times = [protocol.frozenAt, sourceFetchedAt, asOf, weeklyPicksAsOf].map(timestamp);
  if (protocol.schemaVersion !== 1 || protocol.id !== RECENT_FORM_PROTOCOL_ID || protocol.season !== season.year ||
      !Number.isInteger(protocol.season) || protocol.forecastHorizonDays !== 7 ||
      !times.every(Number.isFinite) || times.some((time, i) => i > 0 && time < times[i - 1])) {
    throw Error('Recent-form research requires a fresh checkpoint after the protocol freeze');
  }
  if (!same(protocol.coefficients, modelCoefficients)) throw Error('Recent-form coefficients differ from the frozen model');
  if (snapshot.season !== season.year || previous.season !== season.year - 1 ||
      !isHash(previous.snapshotHash) || !isHash(snapshotHash) || !isHash(sourceHash) ||
      season.source?.provider !== 'cfbd' || snapshot.source?.provider !== 'cfbd' ||
      snapshot.source?.fetchedAt !== sourceFetchedAt || snapshot.source?.sha256 !== sourceHash ||
      !Array.isArray(previous.ratings) || !previous.ratings.length || !Array.isArray(snapshot.ratings)) {
    throw Error('Recent-form Strength snapshot does not match its normalized inputs or prior');
  }
  const source = weeklyPicks.source;
  const scale = matchupValidation(snapshot)?.winProbability?.scale;
  if (weeklyPicks.schemaVersion !== 1 || weeklyPicks.season !== season.year ||
      source?.provider !== 'cfbd' || source.matchupScope || source.calibrated !== true ||
      source.snapshotHash !== snapshotHash || source.scheduleAsOf !== sourceFetchedAt ||
      source.rankingAsOf !== asOf || source.modelVersion !== modelVersion ||
      source.probabilityScale !== scale || source.homeAdvantage !== config.homeAdvantage ||
      source.pickHorizonDays !== protocol.forecastHorizonDays ||
      !Number.isFinite(scale) || scale <= 0 || scale !== protocol.baseline?.probabilityScale ||
      modelVersion !== protocol.baseline?.modelVersion || !same(config, protocol.baseline?.strengthConfig) ||
      !Array.isArray(weeklyPicks.teams) || !Array.isArray(weeklyPicks.games)) {
    throw Error('Recent-form research requires the exact fresh calibrated FBS Weekly Picks checkpoint');
  }
  for (const key of ['normalizedSeason', 'snapshot', 'weeklyPicks', 'previous']) {
    if (!isHash(inputSha256?.[key])) throw Error('Missing recent-form input digest');
  }
  return {
    schemaVersion: 1, protocolId: protocol.id, protocolSha256: sha256(JSON.stringify(protocol)),
    season: season.year, sourceFetchedAt, asOf, weeklyPicksAsOf, sourceHash, snapshotHash,
    inputSha256: { ...inputSha256 },
  };
}

function matchNewTargets({ season, snapshot, weeklyPicks, protocol }, seen) {
  const sourceTeams = new Map(season.teams.map(team => [team.id, team]));
  const publishedTeams = new Map(weeklyPicks.teams.map(team => [team.id, team]));
  const games = new Map(season.games.map(game => [game.id, game]));
  const strengths = new Map(snapshot.ratings.map(team => [team.id, team.strength]));
  const weeklyCutoff = timestamp(weeklyPicks.asOf);
  if (publishedTeams.size !== weeklyPicks.teams.length || strengths.size !== snapshot.ratings.length ||
      new Set(weeklyPicks.games.map(game => game.id)).size !== weeklyPicks.games.length) {
    throw Error('Duplicate team or game in recent-form checkpoint');
  }
  return weeklyPicks.games.flatMap(game => {
    if (seen.has(game.id) || game.pick?.capturedAt !== weeklyPicks.asOf || game.status !== 'scheduled' ||
        game.startTimeTbd !== false || sourceTeams.get(game.home)?.division !== 'fbs' || sourceTeams.get(game.away)?.division !== 'fbs') return [];
    const kickoff = timestamp(game.startDate);
    const original = games.get(game.id);
    if (typeof game.id !== 'string' || game.home === game.away || game.startTimeTbd !== original?.startTimeTbd ||
        original.completed !== false || game.home !== original.home || game.away !== original.away ||
        game.neutral !== original.neutral || game.week !== original.week || game.seasonType !== original.seasonType ||
        kickoff !== timestamp(original.startDate) || !Number.isFinite(kickoff) ||
        kickoff <= weeklyCutoff || kickoff > weeklyCutoff + protocol.forecastHorizonDays * day ||
        !validWeeklyPick(game, game.pick, game.pick.capturedAt, weeklyPicks.asOf, publishedTeams)) {
      throw Error('Newly saved pick does not match its confirmed pregame fixture');
    }
    const expected = strengthWinProbability(strengths.get(game.home), strengths.get(game.away),
      game.neutral ? 0 : snapshot.config.homeAdvantage, weeklyPicks.source.probabilityScale);
    if (!sameProbability(expected, game.pick.homeWinProbability)) throw Error('Published pick is not the same-checkpoint Strength probability');
    return [{ original, game, kickoff }];
  }).sort((a, b) => a.kickoff - b.kickoff || sortText(a.game.id, b.game.id));
}

export function makeRecentFormObservation(input, { seen = new Set(), clock = Date.now } = {}) {
  const data = checkpoint(input);
  const { season, snapshot, weeklyPicks, previous } = input;
  const candidates = matchNewTargets(input, seen);
  if (!candidates.length) return null;
  const models = buildRecentFormForecasts({
    season, previous, config: snapshot.config, scale: weeklyPicks.source.probabilityScale,
    cutoff: snapshot.asOf, targets: candidates.map(candidate => candidate.original),
  });
  const actualCapture = clock();
  if (!Number.isFinite(actualCapture) || actualCapture < timestamp(weeklyPicks.asOf)) throw Error('Shadow capture time precedes the saved Weekly Picks');
  const forecastCapturedAt = new Date(actualCapture).toISOString();
  const forecasts = candidates.flatMap(({ game, kickoff }) => {
    if (kickoff <= actualCapture) return [];
    const result = models.get(game.id);
    if (!probability(result?.challengerProbability) ||
        !sameProbability(result?.baselineProbability, game.pick.homeWinProbability) ||
        result?.baselineSnapshotHash !== snapshot.snapshotHash) {
      throw Error('Rebuilt Strength graph or probability disagrees with the saved pick');
    }
    return [{
      gameId: game.id, home: game.home, away: game.away, neutral: game.neutral, seasonType: game.seasonType, week: game.week,
      kickoff: game.startDate, baselineCapturedAt: game.pick.capturedAt,
      baselineProbability: game.pick.homeWinProbability, challengerProbability: result.challengerProbability,
    }];
  });
  if (!forecasts.length) return null;
  const observation = { ...data, forecastCapturedAt, forecasts };
  return { ...observation, resultSha256: recentFormObservationHash(observation) };
}

const parseObservation = async file => {
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (data.protocolId !== RECENT_FORM_PROTOCOL_ID || !Array.isArray(data.forecasts) ||
      recentFormObservationHash(data) !== data.resultSha256) throw Error('Immutable recent-form observation checksum is invalid');
  return data;
};

export async function recordRecentFormObservation(input, { directory, clock = Date.now }) {
  const metadata = checkpoint(input);
  const file = join(directory, observationName(metadata.weeklyPicksAsOf, metadata.snapshotHash));
  const verifyExisting = async () => {
    const existing = await parseObservation(file);
    if (!Object.entries(metadata).every(([key, value]) => same(value, existing[key]))) {
      throw Error('Recent-form checkpoint changed; refusing to replace immutable observation');
    }
    return { path: file, observation: existing, created: false };
  };
  try { return await verifyExisting(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(directory, { recursive: true });
  const names = (await readdir(directory)).filter(name => name.endsWith(`-${RECENT_FORM_PROTOCOL_ID}.json`));
  const retained = await Promise.all(names.map(name => parseObservation(join(directory, name))));
  const seen = new Set(retained.filter(row => row.season === input.season.year &&
    row.protocolSha256 === metadata.protocolSha256).flatMap(row => row.forecasts.map(game => game.gameId)));

  // A near kickoff can pass between calculation and writing. Rebuild once with
  // the real later clock so only the still-upcoming games can be retained.
  for (let attempt = 0; attempt < 2; attempt++) {
    const observation = makeRecentFormObservation(input, { seen, clock });
    if (!observation) return { path: null, observation: null, created: false };
    const safeNow = () => {
      const time = clock();
      return Number.isFinite(time) && time >= timestamp(observation.forecastCapturedAt) &&
        observation.forecasts.every(game => time < timestamp(game.kickoff));
    };
    if (!safeNow()) continue;
    try { await writeFile(file, JSON.stringify(observation, null, 2) + '\n', { flag: 'wx' }); }
    catch (error) {
      if (error.code === 'EEXIST') return verifyExisting();
      throw error;
    }
    if (safeNow()) return { path: file, observation, created: true };
    await unlink(file);
  }
  return { path: null, observation: null, created: false };
}

async function main() {
  if (process.argv.length !== 2) throw Error('Usage: node research/capture-recent-form-shadow.mjs');
  const year = Number(process.env.RANKING_SEASON || 2026);
  if (!Number.isInteger(year) || year < 2004 || year > 2100) throw Error('Invalid RANKING_SEASON');
  const read = path => readFile(new URL(path, archive));
  const protocol = JSON.parse(await read('research/frozen-recent-form-shadow-v1.json'));
  const implementations = protocol.implementationSha256 ?? {};
  if (!['research/capture-recent-form-shadow.mjs', 'research/lib/recent-form-shadow.mjs', 'src/engine.js',
    'frontend/weekly-picks-score.js', 'scripts/publish-weekly-picks.js'].every(path => isHash(implementations[path]))) {
    throw Error('Required recent-form implementation pin is missing');
  }
  const implementation = Object.entries(implementations);
  await Promise.all(implementation.map(async ([path, expected]) => {
    if (!/^(?:data|frontend|research|scripts|src)\/[a-zA-Z0-9_./-]+$/.test(path) || path.split('/').includes('..') ||
        !isHash(expected) || sha256(await read(path)) !== expected) {
      throw Error(`Frozen recent-form implementation changed: ${path}`);
    }
  }));
  const raw = { normalizedSeason: `data/seasons/${year}.json`, snapshot: 'published/latest.json',
    weeklyPicks: 'published/weekly-picks.json', previous: `published/prior-${year - 1}.json` };
  const bytes = Object.fromEntries(await Promise.all(Object.entries(raw).map(async ([key, path]) => [key, await read(path)])));
  const { normalizedSeason: season, snapshot, weeklyPicks, previous } =
    Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, JSON.parse(value)]));
  const inputSha256 = Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, sha256(value)]));
  const saved = await recordRecentFormObservation({ season, snapshot, weeklyPicks, previous, protocol, inputSha256 },
    { directory: fileURLToPath(new URL(RECENT_FORM_OBSERVATIONS, archive)) });
  const count = saved.observation?.forecasts.length ?? 0;
  console.log(`Recent-form trial: ${count} ${saved.created ? 'new' : 'retained'} pregame pairs; no provider requests`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
