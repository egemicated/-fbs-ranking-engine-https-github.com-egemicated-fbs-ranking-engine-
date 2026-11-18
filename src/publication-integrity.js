// A release is a coherent bundle. A valid ranking calculation must not silently
// publish alongside stale picks or a missing current conference dataset.
export function assertPublicationBundle(snapshot, { fbsPicks, fcsPicks, conferences } = {}) {
  if (!Number.isInteger(snapshot?.season) || typeof snapshot.snapshotHash !== 'string') throw Error('Invalid publication identity');
  for (const [label, picks] of [['FBS', fbsPicks], ...((snapshot.fcsRankings?.length ?? 0) ? [['FCS', fcsPicks]] : [])]) {
    if (picks?.season !== snapshot.season || picks.source?.snapshotHash !== snapshot.snapshotHash || !Array.isArray(picks.games)) {
      throw Error(`${label} picks do not match the ranking snapshot; publication stopped`);
    }
  }
  const current = conferences?.datasets?.filter(dataset => dataset.season === snapshot.season);
  if (current?.length !== 1 || current[0].source?.snapshotHash !== snapshot.snapshotHash ||
      !conferences.manifest?.seasons?.includes(snapshot.season)) {
    throw Error('Current conference evidence does not match the ranking snapshot; publication stopped');
  }
  return true;
}
