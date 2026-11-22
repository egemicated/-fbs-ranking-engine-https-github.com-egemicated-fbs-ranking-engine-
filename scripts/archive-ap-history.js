import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { atomicJson } from '../src/ingest.js';
import { normalizePollEditions } from '../src/poll-history.js';
import { pathToFileURL } from 'node:url';
import { saveApComparisonEdition } from '../src/poll-comparison.js';
import { footballPollDay } from './football-poll-window.js';

// One public request, no paid API or model input. ESPN distributes the AP poll.
// Its nominal midnight metadata is not treated as the publication instant.
// Future games may use the edition only after our verified observation time.
const url = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings';
function parseApEdition(text, snapshot, observedAt) {
  let data;
  try { data = JSON.parse(text); } catch { throw Error('AP distributor returned invalid JSON'); }
  const matches = data.rankings?.filter(item => item.name === 'AP Top 25' && item.season?.year === snapshot.season);
  if (matches?.length !== 1) throw Error('No unambiguous current AP edition');
  const [poll] = matches;
  const released = poll.date?.slice(0, 10);
  if (!released || released > footballPollDay(new Date(observedAt)) || !Array.isArray(poll.ranks) || poll.ranks.length < 25) {
    throw Error('No complete current AP edition');
  }
  const membership = snapshot.rankings.map(team => ({ ...team, division: 'fbs' }));
  const ids = new Map(membership.map(team => [team.id, team]));
  const edition = { released, observedAt,
    kind: poll.occurrence?.last === true ? 'final' : poll.occurrence?.number === 1 ? 'preseason' : 'weekly', url,
    publication: { precision: 'observed', sourceUrl: url, note: 'Verified distributor observation; original AP release instant is not asserted.' },
    rows: poll.ranks.map(row => ({ id: String(row.team.id), team: ids.get(String(row.team.id))?.name, rank: row.current,
      ...(typeof row.recordSummary === 'string' ? { record: row.recordSummary } : {}) })),
    provenance: { provider: 'ESPN AP Top 25 distributor', responseSha256: createHash('sha256').update(text).digest('hex'), fetchedAt: observedAt } };
  if (normalizePollEditions([edition], membership).length !== 1) throw Error('AP distributor ranks or stable identities are incomplete');
  return { edition, week: edition.kind === 'preseason' ? -1 : poll.occurrence?.number - 1 };
}

async function storeApEdition({ edition, week, season, path, comparisonPath }) {
  let history;
  try { history = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    history = { schemaVersion: 1, season, editions: { ap: [], cfp: [] }, releases: { ap: [], cfp: [] }, sourceHashes: [] };
  }
  if (history.schemaVersion !== 1 || history.season !== season) throw Error('AP history season mismatch');
  const { released, observedAt } = edition;
  const existing = history.editions.ap.find(item => item.released === released);
  if (existing) {
    const fingerprint = value => JSON.stringify(value.rows.map(row => [row.id, row.rank]).sort());
    if (fingerprint(existing) !== fingerprint(edition)) throw Error(`Saved AP edition ${released} needs source-correction reconciliation`);
    return comparisonPath ? saveApComparisonEdition({ path: comparisonPath, season, edition: existing, week }) : false;
  }
  if (comparisonPath) await saveApComparisonEdition({ path: comparisonPath, season, edition, week });
  history.editions.ap.push(edition);
  history.releases.ap.push({ released, kind: edition.kind, observedAt, publication: edition.publication });
  history.editions.ap.sort((a, b) => a.released.localeCompare(b.released));
  history.releases.ap.sort((a, b) => a.released.localeCompare(b.released));
  history.sourceHashes.push({ provider: edition.provenance.provider, url, sha256: edition.provenance.responseSha256 });
  await atomicJson(path, history);
  return true;
}

export async function archiveApHistory({ text, snapshot, path = `published/poll-history/${snapshot.season}.json`, comparisonPath, observedAt = new Date().toISOString() }) {
  return storeApEdition({ ...parseApEdition(text, snapshot, observedAt), season: snapshot.season, path, comparisonPath });
}

export async function publishApPoll({ snapshot, comparisonPath, historyPath, window, fetcher = fetch, clock = () => new Date() }) {
  if (window) {
    const comparison = JSON.parse(await readFile(comparisonPath, 'utf8'));
    const latest = comparison.polls.ap.at(-1);
    if (latest?.released >= window.expectedAfter) {
      return { poll: 'ap', status: 'current', checkedAt: clock().toISOString(), released: latest.released };
    }
    if (!window.open) return { poll: 'ap', status: 'not-yet-released', checkedAt: clock().toISOString(), expectedAfter: window.expectedAfter };
  }
  const response = await fetcher(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw Error(`AP distributor returned HTTP ${response.status}`);
  const text = await response.text();
  const checkedAt = clock().toISOString();
  const { edition, week } = parseApEdition(text, snapshot, checkedAt);
  if (window && edition.released < window.expectedAfter) {
    return { poll: 'ap', status: 'not-yet-released', checkedAt, released: edition.released, expectedAfter: window.expectedAfter };
  }
  const changed = await storeApEdition({ edition, week, season: snapshot.season, path: historyPath, comparisonPath });
  return { poll: 'ap', status: changed ? 'saved' : 'current', checkedAt, released: edition.released };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const snapshot = JSON.parse(await readFile('published/latest.json', 'utf8'));
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw Error(`AP distributor returned HTTP ${response.status}`);
  const added = await archiveApHistory({ text: await response.text(), snapshot, comparisonPath: 'frontend/ranking-editions.json' });
  console.log(added ? 'Archived the current AP edition with verified observation time; zero CFBD calls' : 'AP edition already archived; original availability evidence preserved');
}
