import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseCfpArchive } from '../src/cfp-poll.js';
import { atomicJson } from '../src/ingest.js';
import { normalizePollEditions } from '../src/poll-history.js';
import { pathToFileURL } from 'node:url';

// Reuses one public official archive response. No CFBD request or secret.
export async function archiveCfpHistory({ html, snapshot, path = `published/poll-history/${snapshot.season}.json`, now = new Date().toISOString() }) {
const season = snapshot.season;
const sha256 = createHash('sha256').update(html).digest('hex');
const parsed = parseCfpArchive(html, season, snapshot.rankings.map(team => team.name));
const membership = snapshot.rankings.map(team => ({ ...team, division: 'fbs' }));
const names = new Map(membership.map(team => [team.name, team.id]));
let history;
try { history = JSON.parse(await readFile(path, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; history = { schemaVersion: 1, season, editions: { ap: [], cfp: [] }, releases: { ap: [], cfp: [] }, sourceHashes: [] }; }
if (history.schemaVersion !== 1 || history.season !== season) throw Error('CFP history season mismatch');
let added = 0;
for (const edition of parsed) {
  // An official archive may list planned releases without publishing rows yet.
  if (edition.released > now.slice(0, 10)) continue;
  edition.rows = edition.rows.map(row => ({ ...row, id: names.get(row.team) }));
  const existing = history.editions.cfp.find(item => item.released === edition.released);
  if (existing) {
    const fingerprint = value => JSON.stringify(value.rows.map(row => [row.id, row.rank]).sort());
    if (fingerprint(existing) !== fingerprint(edition)) throw Error(`Saved CFP edition ${edition.released} needs source-correction reconciliation`);
    continue;
  }
  edition.provenance = { responseSha256: sha256, fetchedAt: now, provider: 'College Football Playoff' };
  if (normalizePollEditions([edition], membership).length !== 1) throw Error('Incomplete CFP history edition');
  history.editions.cfp.push(edition);
  if (!history.releases.cfp.some(item => item.released === edition.released)) {
    history.releases.cfp.push({ released: edition.released, publication: edition.publication });
  }
  added++;
}
if (added) {
  history.editions.cfp.sort((a, b) => a.released.localeCompare(b.released));
  history.releases.cfp.sort((a, b) => a.released.localeCompare(b.released));
  history.sourceHashes.push({ provider: 'College Football Playoff', url: 'https://collegefootballplayoff.com/rankings', sha256 });
  await atomicJson(path, history);
}
return added;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const snapshot = JSON.parse(await readFile('published/latest.json', 'utf8'));
  const response = await fetch('https://collegefootballplayoff.com/rankings', { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw Error(`CFP archive returned HTTP ${response.status}`);
  const added = await archiveCfpHistory({ html: await response.text(), snapshot });
  console.log(`Archived ${added} new CFP editions; existing editions preserved; zero CFBD calls`);
}
