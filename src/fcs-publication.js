import { solveGraph } from './engine.js';
import { outcomeDataset } from './publication.js';

const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const active = (row, field) => field === 'sor' ? row.sorGames > 0 : row.games > 0;

function rank(rows, field, rankField) {
  const ordered = [...rows].sort((a, b) => Number(active(b, field)) - Number(active(a, field)) ||
    b[field] - a[field] || compareId(a.id, b.id));
  let previous, place;
  ordered.forEach((row, index) => {
    if (!active(row, field)) {
      row[rankField] = null;
      return;
    }
    if (previous === undefined || Math.abs(row[field] - previous) > 1e-9) place = index + 1;
    row[rankField] = place;
    previous = row[field];
  });
  return ordered;
}

function winTail(probabilities, wins) {
  if (wins === 0) return 1;
  const distribution = new Float64Array(probabilities.length + 1);
  distribution[0] = 1;
  probabilities.forEach((probability, index) => {
    for (let count = index + 1; count >= 0; count--) {
      distribution[count] = distribution[count] * (1 - probability) +
        (count ? distribution[count - 1] * probability : 0);
    }
  });
  return Math.min(1, distribution.slice(wins).reduce((sum, probability) => sum + probability, 0));
}

function fcsScoreInputs(dataset, parameters) {
  const { slope, homeLogOdds, divisionLogOdds } = parameters;
  const teams = [...dataset.teams].sort((a, b) => compareId(a.id, b.id));
  const n = teams.length;
  const index = new Map(teams.map((team, i) => [team.id, i]));
  const referenceIndices = teams.flatMap((team, i) => team.division === 'fcs' ? [i] : []);
  const fcs = new Set(referenceIndices);
  const probabilities = new Map(referenceIndices.map(i => [teams[i].id, []]));
  const edges = [], scoredGames = [], neededColumns = new Set();
  const rhs = new Float64Array(n);
  for (const game of dataset.games) {
    const a = index.get(game.a), b = index.get(game.b);
    edges.push([a, b]);
    rhs[a] += game.outcome / 2;
    rhs[b] -= game.outcome / 2;
    if (game.outcome && (fcs.has(a) || fcs.has(b)) &&
        [a, b].every(i => teams[i].division === 'fbs' || teams[i].division === 'fcs')) {
      scoredGames.push({ ...game, a, b });
      neededColumns.add(a);
      neededColumns.add(b);
    }
  }
  const rating = solveGraph(n, edges, rhs, 2).map(value => 0.5 + value);
  const meanFcs = row => referenceIndices.reduce((sum, i) => sum + row[i], 0) / referenceIndices.length;
  const reference = meanFcs(rating);
  const columns = new Map();
  for (const i of [...neededColumns].sort((a, b) => a - b)) {
    const unit = new Float64Array(n);
    unit[i] = 1;
    const values = solveGraph(n, edges, unit, 2);
    columns.set(i, { values, reference: meanFcs(values) });
  }
  for (const { a, b, outcome, venue } of scoredGames) {
    const left = columns.get(a), right = columns.get(b);
    const aa = left.values[a], bb = right.values[b];
    const ab = (left.values[b] + right.values[a]) / 2;
    // Removing one game removes the same pair's edge and outcome from Colley.
    const denominator = 1 - aa - bb + 2 * ab;
    if (!(denominator > 1e-10)) throw new Error('FCS SOR excluded-game downdate is unstable');
    const factor = (rating[a] - rating[b] - outcome / 2) / denominator;
    const referenceWithoutGame = reference + (left.reference - right.reference) * factor;
    const aWithoutGame = rating[a] + (aa - ab) * factor;
    const bWithoutGame = rating[b] + (ab - bb) * factor;
    const winProbability = (opponent, opponentRating, location) => {
      const logOdds = slope * (referenceWithoutGame - opponentRating) + homeLogOdds * location -
        (teams[opponent].division === 'fbs' ? divisionLogOdds : 0);
      return 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, logOdds))));
    };
    if (fcs.has(a)) probabilities.get(teams[a].id).push({ won: outcome > 0, probability: winProbability(b, bWithoutGame, venue) });
    if (fcs.has(b)) probabilities.get(teams[b].id).push({ won: outcome < 0, probability: winProbability(a, aWithoutGame, -venue) });
  }
  return probabilities;
}

export function publishFcsSnapshot(snapshot, policy) {
  if (!snapshot.ratings?.some(row => row.division === 'fcs')) return snapshot;
  if (!['slope', 'homeLogOdds', 'divisionLogOdds'].every(key => Number.isFinite(policy?.parameters?.[key]))) {
    throw new Error('FCS publication requires finite SOR coefficients');
  }
  const dataset = outcomeDataset(snapshot);
  const scoreInputs = fcsScoreInputs(dataset, policy.parameters);
  const rankingMethod = {
    id: 'fcs-sor-reference-v1', name: 'FCS Strength of Record', status: 'experimental',
    reference: 'Mean source-classified FCS team',
    opponentNetwork: 'Full Colley outcomes graph with exact excluded-game reference and opponent ratings',
    gameScope: 'Decisive results against known FBS or FCS opponents',
    recordScope: 'All modeled results, including other subdivisions',
    score: '-log10(probability an average FCS reference team earns at least this many wins in scored games)',
    parameters: { ...policy.parameters },
    crossDivision: 'For a modeled FCS team facing FBS, subtract the FBS–FCS log-odds term',
    calibration: 'Uses the existing FBS SOR coefficients. FCS-specific calibration remains untested.',
    strength: 'Existing Predictive Strength rating ranked within FCS',
    sos: 'Mean Colley rating of all recorded opponents, ranked within FCS',
  };
  const rankings = snapshot.ratings.filter(row => row.division === 'fcs').map(row => {
    const list = scoreInputs.get(row.id);
    const sorWins = list.filter(game => game.won).length;
    const probabilities = list.map(game => game.probability);
    const tail = list.length ? winTail(probabilities, sorWins) : null;
    const sor = tail === null ? null : tail === 1 ? 0 : -Math.log10(Math.max(tail, 1e-300));
    return { ...row, sor,
      sorGames: list.length, sorWins, sorExcludedGames: row.games - list.length,
      sorTailProbability: tail, sorExpectedWins: list.length ? probabilities.reduce((sum, value) => sum + value, 0) : null };
  });
  rank(rankings, 'achievement', 'rank');
  for (const row of rankings) row.colleyRank = row.rank;
  rank(rankings, 'strength', 'strengthRank');
  rank(rankings, 'achievementScheduleStrength', 'sosRank');
  for (const conference of new Set(rankings.map(row => row.conference))) {
    const teams = rankings.filter(row => row.conference === conference);
    rank(teams, 'achievement', 'conferenceRank');
    rank(teams, 'sor', 'displayConferenceRank');
  }
  const fcsRankings = rank(rankings, 'sor', 'displayRank');
  for (const row of fcsRankings) row.sorRank = row.displayRank;
  return { ...snapshot, fcsRankings, fcsTeams: fcsRankings.length, fcsRankingMethod: rankingMethod };
}
