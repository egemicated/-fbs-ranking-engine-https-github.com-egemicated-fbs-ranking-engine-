import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { atomicJson } from '../src/ingest.js';
import { normalizePollEditions } from '../src/poll-history.js';
import { pathToFileURL } from 'node:url';
import { saveApComparisonEdition } from '../src/poll-comparison.js';

// One public request, no paid API or model input. ESPN distributes the AP poll.
// Its nominal midnight metadata is not treated as the publication instant.
// Future games may use the edition only after our verified observation time.
const url = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings';
export async function archiveApHistory({ text, snapshot, path = `published/poll-history/${snapshot.season}.json`, comparisonPath, observedAt = new Date().toISOString() }) {
const season = snapshot.season;
let data; try { data = JSON.parse(text); } catch { throw Error('AP distributor returned invalid JSON'); }
const poll = data.rankings?.find(item => item.name === 'AP Top 25' && item.season?.year === season);
const released = poll?.date?.slice(0, 10);
if (!released || released > observedAt.slice(0, 10) || poll.ranks?.length < 25) throw Error('No complete current AP edition');
const membership = snapshot.rankings.map(team => ({ ...team, division: 'fbs' }));
const ids = new Map(membership.map(team => [team.id, team]));
const edition = { released, observedAt, kind: poll.occurrence?.last === true ? 'final' : poll.occurrence?.number === 1 ? 'preseason' : 'weekly', url,
  publication: { precision: 'observed', sourceUrl: url, note: 'Verified distributor observation; original AP release instant is not asserted.' },
  rows: poll.ranks.map(row => ({ id: String(row.team.id), team: ids.get(String(row.team.id))?.name, rank: row.current,
    ...(typeof row.recordSummary === 'string' ? { record: row.recordSummary } : {}) })),
  provenance: { provider: 'ESPN AP Top 25 distributor', responseSha256: createHash('sha256').update(text).digest('hex'), fetchedAt: observedAt } };
if (normalizePollEditions([edition], membership).length !== 1) throw Error('AP distributor ranks or stable identities are incomplete');
let history;
try { history = JSON.parse(await readFile(path, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; history = { schemaVersion: 1, season, editions: { ap: [], cfp: [] }, releases: { ap: [], cfp: [] }, sourceHashes: [] }; }
if (history.schemaVersion !== 1 || history.season !== season) throw Error('AP history season mismatch');
const existing = history.editions.ap.find(item => item.released === released);
if (existing) {
  const fingerprint = value => JSON.stringify(value.rows.map(row => [row.id, row.rank]).sort());
  if (fingerprint(existing) !== fingerprint(edition)) throw Error(`Saved AP edition ${released} needs source-correction reconciliation`);
  if (comparisonPath) await saveApComparisonEdition({ path: comparisonPath, season, edition: existing,
    week: edition.kind === 'preseason' ? -1 : poll.occurrence?.number - 1 });
  return false;
} else {
  history.editions.ap.push(edition);
  history.releases.ap.push({ released, kind: edition.kind, observedAt, publication: edition.publication });
  history.editions.ap.sort((a, b) => a.released.localeCompare(b.released));
  history.releases.ap.sort((a, b) => a.released.localeCompare(b.released));
  history.sourceHashes.push({ provider: edition.provenance.provider, url, sha256: edition.provenance.responseSha256 });
  await atomicJson(path, history);
  if (comparisonPath) await saveApComparisonEdition({ path: comparisonPath, season, edition,
    week: edition.kind === 'preseason' ? -1 : poll.occurrence?.number - 1 });
  return true;
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const snapshot = JSON.parse(await readFile('published/latest.json', 'utf8'));
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw Error(`AP distributor returned HTTP ${response.status}`);
  const added = await archiveApHistory({ text: await response.text(), snapshot, comparisonPath: 'frontend/ranking-editions.json' });
  console.log(added ? 'Archived the current AP edition with verified observation time; zero CFBD calls' : 'AP edition already archived; original availability evidence preserved');
}
