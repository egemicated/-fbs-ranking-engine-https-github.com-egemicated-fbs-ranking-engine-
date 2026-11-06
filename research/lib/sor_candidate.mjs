// Pure research calculator. Inputs must already be cutoff-safe completed games.
// No poll inputs, historical priors, score margins, side effects, or model blend.
import { solveGraph } from '../../src/engine.js';

export const SOR_DEFAULT_PARAMETERS = Object.freeze({
  slope: 4.2967562253807925,
  homeLogOdds: 0.47455471946025424
});

const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const sigmoid = value => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, value))));

function validate(dataset, parameters) {
  if (!dataset || !Array.isArray(dataset.teams) || !dataset.teams.length || !Array.isArray(dataset.games)) {
    throw new Error('SOR requires teams and completed outcome games');
  }
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters) ||
      Object.keys(parameters).some(key => !Object.hasOwn(SOR_DEFAULT_PARAMETERS, key))) {
    throw new Error('Invalid SOR parameters');
  }
  const config = { ...SOR_DEFAULT_PARAMETERS, ...parameters };
  if (!finite(config.slope) || config.slope <= 0 || !finite(config.homeLogOdds) || config.homeLogOdds < 0) {
    throw new Error('Invalid SOR parameters');
  }
  const ids = new Set();
  for (const team of dataset.teams) {
    if (!team || typeof team.id !== 'string' || !team.id || ids.has(team.id) ||
        typeof team.name !== 'string' || !team.name || typeof team.division !== 'string' || !team.division) {
      throw new Error('Invalid or duplicate SOR team identity');
    }
    ids.add(team.id);
  }
  const fbsIds = new Set(dataset.teams.filter(team => team.division === 'fbs').map(team => team.id));
  if (!fbsIds.size) throw new Error('SOR requires an FBS reference population');
  const games = new Set();
  for (const game of dataset.games) {
    if (!game || typeof game.id !== 'string' || !game.id || games.has(game.id) ||
        !ids.has(game.a) || !ids.has(game.b) || game.a === game.b) {
      throw new Error('Invalid or duplicate SOR game identity');
    }
    if (game.outcome !== -1 && game.outcome !== 0 && game.outcome !== 1) throw new Error('Invalid SOR outcome');
    // Preserve zero-outcome lower-division context edges to reproduce the
    // existing opponent network. This is not certification of the source tie.
    // An FBS record needs a separately specified tie policy and is rejected.
    if (game.outcome === 0 && (fbsIds.has(game.a) || fbsIds.has(game.b))) {
      throw new Error('SOR requires a decisive FBS outcome; ties need a separate policy');
    }
    if (game.venue !== -1 && game.venue !== 0 && game.venue !== 1) throw new Error('Invalid SOR venue');
    games.add(game.id);
  }
  return config;
}

function poissonBinomialTail(probabilities, wins) {
  if (wins === 0) return 1;
  const distribution = new Float64Array(probabilities.length + 1);
  distribution[0] = 1;
  for (let i = 0; i < probabilities.length; i++) {
    const p = probabilities[i];
    for (let count = i + 1; count >= 0; count--) {
      distribution[count] = distribution[count] * (1 - p) + (count > 0 ? distribution[count - 1] * p : 0);
    }
  }
  let tail = 0;
  for (let count = wins; count < distribution.length; count++) tail += distribution[count];
  return Math.max(0, Math.min(1, tail));
}

function assignRanks(rows, field, rankField) {
  const active = rows.filter(row => row.games > 0).sort((a, b) => b[field] - a[field] || compareIds(a.id, b.id));
  let last = null, rank = null;
  active.forEach((row, position) => {
    if (last === null || Math.abs(row[field] - last) > 1e-9) rank = position + 1;
    row[rankField] = rank;
    last = row[field];
  });
}

export function calculateSor(dataset, parameters = SOR_DEFAULT_PARAMETERS) {
  const config = validate(dataset, parameters);
  // Canonical ordering makes repeat runs and input-order checks deterministic.
  const teams = [...dataset.teams].sort((a, b) => compareIds(a.id, b.id));
  const index = new Map(teams.map((team, i) => [team.id, i]));
  const fbs = teams.flatMap((team, i) => team.division === 'fbs' ? [i] : []);
  const isFbs = new Set(fbs);
  const games = [...dataset.games].sort((a, b) => compareIds(a.id, b.id));
  const edges = [], rhs = new Float64Array(teams.length), valuedGames = [], neededColumns = new Set();
  const stats = teams.map(() => ({ wins: 0, losses: 0, probabilities: [] }));
  for (const game of games) {
    const a = index.get(game.a), b = index.get(game.b);
    edges.push([a, b]);
    rhs[a] += game.outcome / 2;
    rhs[b] -= game.outcome / 2;
    for (const [i, outcome] of [[a, game.outcome], [b, -game.outcome]]) {
      if (outcome > 0) stats[i].wins++;
      else if (outcome < 0) stats[i].losses++;
    }
    if (isFbs.has(a) || isFbs.has(b)) {
      valuedGames.push({ ...game, a, b });
      neededColumns.add(a); neededColumns.add(b);
    }
  }
  const ratings = solveGraph(teams.length, edges, rhs, 2).map(value => .5 + value);
  const reference = fbs.reduce((sum, i) => sum + ratings[i], 0) / fbs.length;
  // Only endpoints of FBS-involving games need inverse columns. Every game in
  // the full opponent network still influences the base matrix and its inverse.
  const columns = new Map();
  for (const i of [...neededColumns].sort((a, b) => a - b)) {
    const unit = new Float64Array(teams.length); unit[i] = 1;
    const values = solveGraph(teams.length, edges, unit, 2);
    const meanFbs = fbs.reduce((sum, j) => sum + values[j], 0) / fbs.length;
    columns.set(i, { values, meanFbs });
  }
  for (const game of valuedGames) {
    const { a, b, outcome, venue } = game;
    const left = columns.get(a), right = columns.get(b);
    const aa = left.values[a], bb = right.values[b];
    // The exact inverse is symmetric. Average the two independently solved
    // cross entries to avoid choosing one numerical roundoff direction.
    const ab = (left.values[b] + right.values[a]) / 2;
    const denominator = 1 - aa - bb + 2 * ab;
    if (!(denominator > 1e-10)) throw new Error('SOR leave-one-game-out downdate is unstable');
    const factor = (ratings[a] - ratings[b] - outcome / 2) / denominator;
    const looReference = reference + (left.meanFbs - right.meanFbs) * factor;
    const looA = ratings[a] + (aa - ab) * factor;
    const looB = ratings[b] + (ab - bb) * factor;
    if (isFbs.has(a)) stats[a].probabilities.push(sigmoid(config.slope * (looReference - looB) + config.homeLogOdds * venue));
    if (isFbs.has(b)) stats[b].probabilities.push(sigmoid(config.slope * (looReference - looA) - config.homeLogOdds * venue));
  }
  const rows = fbs.map(i => {
    const team = teams[i], stat = stats[i];
    const tail = poissonBinomialTail(stat.probabilities, stat.wins);
    return { id: team.id, team: team.name, wins: stat.wins, losses: stat.losses,
      games: stat.wins + stat.losses, colley: ratings[i], colleyRank: null,
      sor: -Math.log10(Math.max(tail, 1e-300)), sorRank: null, tail,
      expectedWins: stat.probabilities.reduce((sum, p) => sum + p, 0) };
  });
  assignRanks(rows, 'colley', 'colleyRank');
  assignRanks(rows, 'sor', 'sorRank');
  rows.sort((a, b) => Number(b.games > 0) - Number(a.games > 0) || b.sor - a.sor || compareIds(a.id, b.id));
  return { rows, referenceFbsCount: fbs.length };
}
