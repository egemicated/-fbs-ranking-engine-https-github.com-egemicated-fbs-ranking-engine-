import { outcomeDataset } from './publication.js';
import matchupEvidence from '../data/matchup-validation.json' with { type: 'json' };
import fcsMatchupEvidence from '../data/fcs-matchup-validation.json' with { type: 'json' };

export function matchupValidation(snapshot) {
  const { modelVersion, strengthConfig, winProbability, marginBand } = matchupEvidence;
  if (snapshot.modelVersion !== modelVersion || snapshot.season <= marginBand.evaluation.lastSeason ||
      !Object.entries(strengthConfig).every(([key, value]) => snapshot.config?.[key] === value)) return null;
  return { winProbability, marginBand };
}

export function fcsMatchupValidation(snapshot, evidence = fcsMatchupEvidence) {
  const expected = evidence?.strengthConfig;
  if (evidence?.approvedForWeeklyPicks !== true || evidence.population !== 'fcs-fcs' ||
      typeof evidence.modelVersion !== 'string' || evidence.modelVersion !== snapshot.modelVersion ||
      !Number.isFinite(evidence.scale) || evidence.scale <= 0 ||
      !Number.isInteger(evidence.evaluation?.lastSeason) || evidence.evaluation.lastSeason >= snapshot.season ||
      !expected || Object.keys(expected).length !== Object.keys(snapshot.config ?? {}).length ||
      !Object.entries(expected).every(([key, value]) => snapshot.config?.[key] === value)) return null;
  return evidence;
}

export function strengthWinProbability(homeStrength, awayStrength, homeAdvantage, scale) {
  const edge = homeStrength - awayStrength + homeAdvantage;
  return 1 / (1 + Math.exp(-edge / scale));
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
