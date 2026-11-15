import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performanceForSnapshot } from './performance-publication.js';

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

export function publicPerformanceForSnapshot(candidate, snapshot) {
  const publication = performanceForSnapshot(candidate, snapshot);
  if (publication && validFcsRankings(candidate, snapshot)) publication.fcsRankings = candidate.fcsRankings;
  return publication;
}

export async function readPublicPerformance(snapshotDirectory, snapshot) {
  try {
    return publicPerformanceForSnapshot(JSON.parse(await readFile(join(snapshotDirectory, 'performance-latest.json'), 'utf8')), snapshot);
  } catch { return null; }
}
