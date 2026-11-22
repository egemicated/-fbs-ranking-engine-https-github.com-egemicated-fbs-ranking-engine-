import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { atomicJson } from '../src/ingest.js';
import { normalizePollEditions } from '../src/poll-history.js';
import { footballPollDay } from './football-poll-window.js';

const officialPoll = 'https://www.afca.com/polls/';
const readJson = path => readFile(path, 'utf8').then(JSON.parse);

export async function publishCoachesPoll({ snapshot, comparisonPath, historyPath, window, key, fetcher = fetch,
  clock = () => new Date() }) {
  const result = (status, checkedAt, details = {}) => ({ poll: 'coaches', status, checkedAt, ...details });
  const startedAt = clock().toISOString();
  if (!window) return result('no-due', startedAt);
  const { week, expectedAfter, open } = window;
  const [comparison, storedHistory] = await Promise.all([readJson(comparisonPath), readJson(historyPath).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  })]);
  const season = snapshot.season;
  if (comparison.season !== season || !Array.isArray(comparison.polls?.coaches) ||
      storedHistory && (storedHistory.season !== season || storedHistory.schemaVersion !== 1)) {
    throw Error('Coaches publication season mismatch');
  }
  const existing = comparison.polls.coaches.find(edition => edition.week === week);
  if (existing) return result('current', startedAt, { week, ...(existing.observedAt
    ? { observedAt: existing.observedAt } : { released: existing.released }) });
  if (!open) return result('not-yet-released', startedAt, { week, expectedAfter });
  if (!key) return result('source-unavailable', startedAt, { week, reason: 'CFBD credentials unavailable' });

  // CFBD numbers weekly polls at the start of the following schedule week.
  // This query narrows retrieval to one week; the source has no release date.
  const providerWeek = week + 1;
  const provider = new URL('https://api.collegefootballdata.com/rankings');
  provider.search = new URLSearchParams({ year: String(season), seasonType: 'regular', week: String(providerWeek) });
  const response = await fetcher(provider, { headers: { Authorization: `Bearer ${key}` },
    redirect: 'error', signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw Error(`CFBD Coaches lookup returned HTTP ${response.status}`);
  const text = await response.text();
  const checkedAt = clock().toISOString();
  const returned = JSON.parse(text);
  if (!Array.isArray(returned) || returned.some(row => row.season !== season || row.seasonType !== 'regular' ||
      row.week !== providerWeek || !Array.isArray(row.polls))) throw Error('Unexpected CFBD poll week or season');
  const polls = returned.flatMap(row => row.polls.filter(poll => poll.poll === 'Coaches Poll'));
  if (polls.length === 0) return result('not-yet-released', checkedAt, { week, expectedAfter });
  if (polls.length !== 1 || !Array.isArray(polls[0].ranks)) throw Error('Ambiguous CFBD Coaches edition');

  const membership = snapshot.rankings.map(team => ({ ...team, id: String(team.id), division: 'fbs' }));
  const teams = new Map(membership.map(team => [team.id, team.name]));
  const rows = polls[0].ranks.filter(row => row.rank >= 1 && row.rank <= 25).map(row => {
    const id = String(row.teamId);
    return { id, team: teams.get(id), rank: row.rank };
  }).sort((a, b) => a.rank - b.rank);
  const observed = footballPollDay(new Date(checkedAt));
  const edition = {
    week, released: observed, releaseDateBasis: 'observed', gamesThrough: null, observedAt: checkedAt, kind: 'weekly', url: officialPoll,
    publication: { precision: 'observed', sourceUrl: provider.href },
    provenance: { provider: 'CollegeFootballData', providerWeek, providerSeasonType: 'regular',
      responseSha256: createHash('sha256').update(text).digest('hex') },
    rows,
  };
  if (normalizePollEditions([edition], membership).length !== 1) throw Error('Incomplete or invalid CFBD Coaches Top 25');

  const history = storedHistory ?? { schemaVersion: 1, season, editions: { ap: [], cfp: [] },
    releases: { ap: [], cfp: [] }, sourceHashes: [] };
  history.editions.coaches ??= [];
  history.releases.coaches ??= [];
  if (history.editions.coaches.some(saved => saved.week === week || saved.released === observed)) {
    throw Error('Coaches archives need reconciliation before publishing this edition');
  }
  const { provenance, ...display } = edition;
  comparison.polls.coaches.push(display);
  comparison.polls.coaches.sort((a, b) => a.week - b.week);
  history.editions.coaches.push(edition);
  history.releases.coaches.push({ released: observed, releaseDateBasis: 'observed', kind: edition.kind, week,
    observedAt: checkedAt, publication: edition.publication });
  history.sourceHashes.push({ provider: provenance.provider, url: provider.href, sha256: provenance.responseSha256 });
  await atomicJson(comparisonPath, comparison);
  await atomicJson(historyPath, history);
  return result('saved', checkedAt, { week, observedAt: checkedAt });
}
