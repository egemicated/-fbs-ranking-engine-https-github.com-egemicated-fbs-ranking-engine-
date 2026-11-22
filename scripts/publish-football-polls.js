import { appendFile, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { atomicJson } from '../src/ingest.js';
import { publishApPoll } from './archive-ap-history.js';
import { publishCfpPoll } from './publish-cfp-poll.js';
import { publishCoachesPoll } from './publish-coaches-poll.js';
import { footballPollSeason, footballWeekendPollWindow } from './football-poll-window.js';

const readJson = path => readFile(path, 'utf8').then(JSON.parse);
const scopes = { all: ['ap', 'coaches', 'cfp'], weekend: ['ap', 'coaches'], cfp: ['cfp'] };
const publishers = { ap: publishApPoll, coaches: publishCoachesPoll, cfp: publishCfpPoll };
const releaseSources = {
  ap: ['apnews.com', 'www.apnews.com', 'ap.org', 'www.ap.org'],
  coaches: ['afca.com', 'www.afca.com', 'usatoday.com', 'www.usatoday.com', 'sportsdata.usatoday.com'],
};

function weekendReleaseNotice(scope, poll, instant, evidence) {
  if (!poll && !instant && !evidence) return null;
  const url = URL.parse(evidence);
  const at = new Date(instant);
  const date = Date.parse(instant.slice(0, 10));
  if (scope !== 'weekend' || !Object.hasOwn(releaseSources, poll) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(instant) ||
      !Number.isFinite(at.getTime()) || !Number.isFinite(date) || !new Date(date).toISOString().startsWith(instant.slice(0, 10)) ||
      url?.protocol !== 'https:' || url.port || url.username || url.password ||
      !releaseSources[poll].includes(url.hostname)) throw Error('A weekend poll, time with zone, and first-party release notice are required');
  url.search = '';
  url.hash = '';
  return { poll, at, notice: url.href };
}

// Both publication files are shared by the poll readers. Stage each source
// independently so malformed or conflicting editions never leave a partial
// update available to a different successful source in the same run.
async function stagePoll(poll, { comparisonPath, historyPath, ...options }) {
  const directory = await mkdtemp(join(tmpdir(), 'football-poll-'));
  const candidate = { comparisonPath: join(directory, 'comparison.json'), historyPath: join(directory, 'history.json') };
  try {
    await copyFile(comparisonPath, candidate.comparisonPath);
    await copyFile(historyPath, candidate.historyPath).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    let result;
    try {
      result = await publishers[poll]({ ...options, ...candidate });
    } catch (error) {
      return { poll, status: 'failed', checkedAt: options.clock().toISOString(),
        reason: error instanceof SyntaxError ? 'Source or archive JSON is invalid' : String(error.message).replace(/\s+/g, ' ').slice(0, 150) };
    }
    if (result.status === 'saved') {
      const [nextComparison, nextHistory] = await Promise.all([readJson(candidate.comparisonPath), readJson(candidate.historyPath)]);
      await atomicJson(comparisonPath, nextComparison);
      await atomicJson(historyPath, nextHistory);
    }
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function publishFootballPolls({ scope = 'all', releaseDate = '', fetcher = fetch, clock = () => new Date(),
  weekendPoll = '', weekendReleaseAt = '', weekendSourceUrl = '', key, snapshot, slate, comparisonPath = 'frontend/ranking-editions.json',
  historyPath = `published/poll-history/${snapshot.season}.json` }) {
  if (!Object.hasOwn(scopes, scope) || releaseDate && !scopes[scope].includes('cfp')) throw Error('Invalid football poll scope');
  if (slate.season !== snapshot.season || !Array.isArray(slate.games)) throw Error('Football poll schedule season mismatch');

  const delayed = weekendReleaseNotice(scope, weekendPoll, weekendReleaseAt, weekendSourceUrl);
  const results = [];
  const now = clock();
  const currentSeason = footballPollSeason(now) === snapshot.season;
  const window = currentSeason ? footballWeekendPollWindow(now, slate, delayed?.at) : null;
  for (const poll of delayed ? [delayed.poll] : scopes[scope]) {
    if (!currentSeason && !(poll === 'cfp' && releaseDate) || scope === 'weekend' && !window) {
      results.push({ poll, status: 'no-due', checkedAt: now.toISOString() });
      continue;
    }
    const checked = await stagePoll(poll, { snapshot, comparisonPath, historyPath, window, releaseDate, now, clock, fetcher, key });
    results.push(delayed ? { ...checked, scheduledReleaseAt: delayed.at.toISOString(), releaseNotice: delayed.notice } : checked);
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { scope: { type: 'string' }, 'release-date': { type: 'string' },
    'weekend-poll': { type: 'string' }, 'weekend-release-at': { type: 'string' }, 'weekend-source-url': { type: 'string' } } });
  const [snapshot, slate] = await Promise.all([readJson('published/latest.json'), readJson('published/weekly-picks.json')]);
  const results = await publishFootballPolls({ scope: values.scope, releaseDate: values['release-date']?.trim(),
    weekendPoll: values['weekend-poll']?.trim(), weekendReleaseAt: values['weekend-release-at']?.trim(),
    weekendSourceUrl: values['weekend-source-url']?.trim(),
    key: process.env.CFBD_API_KEY, snapshot, slate });
  console.log(JSON.stringify({ schemaVersion: 1, results }));
  if (process.env.GITHUB_OUTPUT) {
    const saved = results.some(row => row.status === 'saved');
    const failed = results.some(row => ['failed', 'source-unavailable'].includes(row.status));
    const pending = results.some(row => row.status === 'not-yet-released');
    await appendFile(process.env.GITHUB_OUTPUT, `saved=${saved}\nfailed=${failed}\npending=${pending}\nresults=${JSON.stringify(results)}\n`);
  } else if (results.some(row => ['failed', 'source-unavailable'].includes(row.status))) {
    process.exitCode = 1;
  }
}
