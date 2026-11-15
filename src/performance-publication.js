import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

function validFcsRankings(candidate, snapshot) {
  const rows = candidate.fcsRankings;
  const coverage = candidate.coverage;
  if (!Array.isArray(rows) || !Array.isArray(snapshot.ratings) || !rows.length) return false;
  const expected = new Map(snapshot.ratings.filter(team => team?.division === 'fcs').map(team => [team.id, team]));
  if (rows.length !== expected.size || coverage.sourceFcsTeams !== expected.size ||
      ![coverage.eligibleFcsGames, coverage.measuredFcsGames, coverage.eligibleFcsContextGames, coverage.measuredFcsContextGames]
        .every(value => Number.isInteger(value) && value >= 0) ||
      coverage.measuredFcsGames > coverage.eligibleFcsGames ||
      coverage.eligibleFcsContextGames > coverage.eligibleFcsGames ||
      coverage.measuredFcsContextGames > Math.min(coverage.eligibleFcsContextGames, coverage.measuredFcsGames)) return false;
  let measuredTeams = 0;
  for (const row of rows) {
    const primary = expected.get(row?.id);
    if (!primary || row.name !== primary.name || row.conference !== (primary.conference ?? null) ||
        !Number.isInteger(row.measuredGames) || row.measuredGames < 0 || !Number.isInteger(row.expectedGames) ||
        row.expectedGames < row.measuredGames || row.expectedGames > primary.games ||
        typeof row.provisional !== 'boolean' || ((row.measuredGames < 4 || row.measuredGames < row.expectedGames) && !row.provisional)) return false;
    expected.delete(row.id);
    if (row.measuredGames > 0) {
      measuredTeams++;
      if (!Number.isInteger(row.rank) || row.rank < 1 || !Number.isFinite(row.score) || !row.explanation ||
          ![row.offensiveSuccessRate, row.defensiveSuccessRateAllowed].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return false;
    } else if (row.rank !== null || row.score !== null || row.offensiveSuccessRate !== null ||
        row.defensiveSuccessRateAllowed !== null) return false;
  }
  return coverage.measuredFcsTeams === measuredTeams && (measuredTeams ? Number.isFinite(candidate.reference?.measuredFcsMean) :
    candidate.reference?.measuredFcsMean === null);
}

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
  const publication = Object.fromEntries(allowed.filter(key => key in candidate).map(key => [key, candidate[key]]));
  if (validFcsRankings(candidate, snapshot)) publication.fcsRankings = candidate.fcsRankings;
  return publication;
}

export async function readPerformance(snapshotDirectory, snapshot) {
  try {
    return performanceForSnapshot(JSON.parse(await readFile(join(snapshotDirectory, 'performance-latest.json'), 'utf8')), snapshot);
  } catch { return null; }
}
