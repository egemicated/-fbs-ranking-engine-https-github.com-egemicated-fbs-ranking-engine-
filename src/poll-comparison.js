import { readFile } from 'node:fs/promises';
import { atomicJson } from './ingest.js';

const fingerprint = rows => JSON.stringify(rows.map((row, index) => [row.team, row.rank ?? index + 1])
  .sort((a, b) => a[0].localeCompare(b[0])));

// Share the same verified AP field with the existing comparison page. Unknown
// games-through cutoffs stay null and cannot match an independent SOR snapshot.
export async function saveApComparisonEdition({ path, season, edition, week }) {
  if (!Number.isInteger(week) || week < -1 || !edition?.released || !Array.isArray(edition.rows)) throw Error('Invalid AP comparison identity');
  const archive = JSON.parse(await readFile(path, 'utf8'));
  if (archive.season !== season || !Array.isArray(archive.polls?.ap)) throw Error('AP comparison season mismatch');
  const existing = archive.polls.ap.find(row => row.released === edition.released || row.week === week);
  if (existing) {
    if (existing.released !== edition.released || fingerprint(existing.rows) !== fingerprint(edition.rows)) {
      throw Error(`Saved AP comparison ${edition.released} needs source-correction reconciliation`);
    }
    return false;
  }
  archive.polls.ap.push({ week, gamesThrough: edition.gamesThrough ?? null, released: edition.released,
    url: edition.url ?? edition.publication?.sourceUrl,
    kind: edition.kind, publication: edition.publication,
    ...(edition.observedAt ? { observedAt: edition.observedAt } : {}),
    rows: edition.rows.map(row => ({ id: row.id, team: row.team, rank: row.rank, ...(row.record ? { record: row.record } : {}) })) });
  archive.polls.ap.sort((a, b) => a.released.localeCompare(b.released));
  await atomicJson(path, archive);
  return true;
}
