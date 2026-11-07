import { outcomeDataset } from './publication.js';
import matchupEvidence from '../data/matchup-validation.json' with { type: 'json' };

export function matchupValidation(snapshot) {
  const { modelVersion, strengthConfig, winProbability, marginBand } = matchupEvidence;
  if (snapshot.modelVersion !== modelVersion || snapshot.season <= marginBand.evaluation.lastSeason ||
      !Object.entries(strengthConfig).every(([key, value]) => snapshot.config?.[key] === value)) return null;
  return { winProbability, marginBand };
}

// Count unique results from the same paired evidence used to publish SOR.
export function snapshotCoverage(snapshot) {
  const { teams, games } = outcomeDataset(snapshot);
  const divisions = new Map(teams.map(team => [team.id, team.division]));
  const coverage = {
    fbsVsFbs: 0,
    fbsVsFcs: 0,
    fcsVsFcs: 0,
    unknownDivisionTeams: teams.filter(team => team.division === 'unknown').length,
    gamesWithUnknownDivision: 0,
  };

  for (const game of games) {
    const a = divisions.get(game.a);
    const b = divisions.get(game.b);
    if (a === 'unknown' || b === 'unknown') coverage.gamesWithUnknownDivision++;
    if (a === 'fbs' && b === 'fbs') coverage.fbsVsFbs++;
    if ((a === 'fbs' && b === 'fcs') || (a === 'fcs' && b === 'fbs')) coverage.fbsVsFcs++;
    if (a === 'fcs' && b === 'fcs') coverage.fcsVsFcs++;
  }
  return coverage;
}
