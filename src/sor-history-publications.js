import { createHash } from 'node:crypto';

const instant = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const mountainDay = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Denver', year:'numeric', month:'2-digit', day:'2-digit' });
const repository = 'https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-';

// These are saved-file observations, not proof of an exact website deployment.
// Conservatively wait until the observation's whole Mountain calendar day has
// ended. Replays and the graph's older source cutoff cannot move this backward.
export function sorPublicationAvailability(value) {
  if (!instant(value)) throw Error('SOR observation requires an explicit timestamp');
  const observedDay = mountainDay.format(new Date(value));
  let bound = Math.floor(Date.parse(value) / 36e5) * 36e5;
  while (mountainDay.format(bound) === observedDay) bound += 36e5;
  return new Date(bound).toISOString();
}

export function compactSorPublication(edition, { recordedAt, source } = {}) {
  if (edition?.kind !== 'saved' || !instant(edition.asOf) || !instant(recordedAt) ||
      Date.parse(recordedAt) < Date.parse(edition.asOf) || !isHash(edition.snapshotHash) || !isHash(edition.publicationHash) ||
      !edition.modelId || !Array.isArray(edition.rows) || !edition.rows.length) throw Error('Only a recorded saved SOR publication can enter this archive');
  if (source?.basis !== 'pipeline-recorded snapshot' && source?.basis !== 'repository-recorded snapshot') throw Error('Missing saved SOR provenance');
  if (source.basis === 'repository-recorded snapshot' && (!/^[a-f0-9]{40}$/.test(source.commit ?? '') ||
      source.url !== `${repository}/blob/${source.commit}/published/latest.json` || !isHash(source.snapshotFileSha256) ||
      !isHash(source.scheduleFileSha256))) throw Error('Invalid repository SOR evidence');
  const rows = edition.rows.map(({ id, rank }) => ({ id, rank })).sort((a,b) => a.id.localeCompare(b.id));
  if (rows.some(row => typeof row.id !== 'string' || !row.id || !(row.rank === null || Number.isInteger(row.rank) && row.rank > 0)) ||
      new Set(rows.map(row => row.id)).size !== rows.length) throw Error('Invalid saved SOR identities');
  return { kind:'saved', modelId:edition.modelId, modelVersion:edition.modelVersion ?? null, asOf:edition.asOf,
    recordedAt, availableBefore:sorPublicationAvailability(recordedAt), snapshotHash:edition.snapshotHash,
    publicationHash:edition.publicationHash, rowsHash:digest(rows), source:structuredClone(source), rows };
}

export function validateSorPublication(value) {
  const compact = compactSorPublication(value, { recordedAt:value?.recordedAt, source:value?.source });
  if (value.rowsHash !== compact.rowsHash || value.availableBefore !== compact.availableBefore) throw Error('Saved SOR observation hash or availability differs');
  return compact;
}

export function validateSorPublications(publications = []) {
  if (!Array.isArray(publications)) throw Error('Invalid saved SOR observations');
  const rows = publications.map(validateSorPublication);
  if (new Set(rows.map(row=>row.publicationHash)).size !== rows.length) throw Error('Duplicate saved SOR observation');
  return rows;
}

export function addSorPublication(publications = [], publication) {
  const next = validateSorPublications(publications);
  const incoming = validateSorPublication(publication);
  const existing = next.find(row => row.publicationHash === incoming.publicationHash);
  if (existing) {
    if (existing.rowsHash !== incoming.rowsHash || existing.snapshotHash !== incoming.snapshotHash || existing.modelId !== incoming.modelId)
      throw Error('Conflicting saved SOR observation');
    // A repeated pull keeps the first retained observation and its provenance.
    return structuredClone(publications);
  }
  next.push(incoming);
  return next.sort((a,b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.publicationHash.localeCompare(b.publicationHash));
}
