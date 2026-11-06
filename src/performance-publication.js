import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The optional view must describe the exact same publication as the main table.
// A missing/stale experiment leaves the two existing models available.
export function performanceForSnapshot(candidate, snapshot) {
  if (!candidate || candidate.status !== 'experimental' || candidate.season !== snapshot.season ||
      !snapshot.snapshotHash || candidate.baseSnapshotHash !== snapshot.snapshotHash || candidate.asOf !== snapshot.asOf ||
      typeof candidate.method?.id !== 'string' || !Array.isArray(candidate.limitations) ||
      !Array.isArray(candidate.rankings) || !Array.isArray(snapshot.rankings)) return null;
  const expected = new Map(snapshot.rankings.map(team => [team.id, team]));
  if (expected.size !== snapshot.rankings.length || candidate.rankings.length !== expected.size ||
      candidate.coverage?.sourceFbsTeams !== expected.size ||
      !Number.isInteger(candidate.coverage.measuredFbsGames) || candidate.coverage.measuredFbsGames < 0 ||
      candidate.coverage.measuredFbsGames !== candidate.coverage.eligibleFbsGames) return null;
  const seen = new Set();
  for (const row of candidate.rankings) {
    const primary = expected.get(row.id);
    if (!primary || seen.has(row.id) || !Number.isInteger(row.measuredGames) || row.measuredGames < 0 ||
        !Number.isInteger(row.expectedGames) || row.expectedGames !== row.measuredGames ||
        (Number.isInteger(primary.games) && row.expectedGames !== primary.games)) return null;
    if (row.measuredGames > 0) {
      if (!Number.isInteger(row.rank) || row.rank < 1 || !Number.isFinite(row.score) || !row.explanation ||
          ![row.offensiveSuccessRate, row.defensiveSuccessRateAllowed].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return null;
    } else if (row.rank !== null || row.score !== null) return null;
    seen.add(row.id);
  }
  if (candidate.coverage.measuredFbsTeams !== candidate.rankings.filter(row => row.measuredGames > 0).length) return null;
  const allowed = ['schemaVersion', 'season', 'asOf', 'generatedAt', 'modelPublishedAt', 'baseSnapshotHash',
    'status', 'method', 'limitations', 'validation', 'coverage', 'source', 'reference', 'context',
    'reproducibility', 'publicationHash', 'rankings'];
  return Object.fromEntries(allowed.filter(key => key in candidate).map(key => [key, candidate[key]]));
}

export async function readPerformance(snapshotDirectory, snapshot) {
  try {
    return performanceForSnapshot(JSON.parse(await readFile(join(snapshotDirectory, 'performance-latest.json'), 'utf8')), snapshot);
  } catch { return null; }
}
