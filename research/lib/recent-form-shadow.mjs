import { rankSeason } from '../../src/engine.js';
import { strengthWinProbability } from '../../src/site-validation.js';

const dayMs = 86_400_000;

export const RECENT_FORM_SHADOW_MODEL = Object.freeze({
  id: 'recent-form-shadow-v1',
  graphHalfLifeDays: 35,
  residualHalfLifeDays: 21,
  residualPriorGames: 3,
  graphCoefficient: 0.2540683417149627,
  residualCoefficient: -0.010280561743755447,
});

function boundedMargin(game, config) {
  const margin = game.homePoints - game.awayPoints;
  return config.marginCap * Math.tanh((game.regulationMargin === 0 ? Math.sign(margin) : margin) / config.marginCap);
}

function weight(date, cutoff, halfLifeDays) {
  const age = Math.max(0, (cutoff - date) / dayMs - 1);
  return 2 ** (-age / halfLifeDays);
}

const strengthByTeam = snapshot => new Map(snapshot.ratings.map(({ id, strength }) => [id, strength]));
const venue = (game, config) => game.neutral ? 0 : config.homeAdvantage;

function weightedStrength({ snapshot, previous, games, cutoff }) {
  const { config, ratings } = snapshot;
  const index = new Map(ratings.map(({ id }, i) => [id, i]));
  const preseason = strengthByTeam(previous);
  const edges = games.map(game => ({ a: index.get(game.home), b: index.get(game.away),
    weight: weight(game.date, cutoff, RECENT_FORM_SHADOW_MODEL.graphHalfLifeDays),
    target: boundedMargin(game, config) - venue(game, config) }));
  // Keep total game weight equal to the production graph, so only the
  // distribution across games changes relative to the preseason prior.
  const normalizer = edges.length ? edges.length / edges.reduce((sum, edge) => sum + edge.weight, 0) : 1;
  const rhs = Float64Array.from(ratings, ({ id }) => (preseason.get(id) ?? 0) * config.retention * config.ridge);
  for (const edge of edges) {
    edge.weight *= normalizer;
    rhs[edge.a] += edge.weight * edge.target;
    rhs[edge.b] -= edge.weight * edge.target;
  }

  // This is the weighted form of the engine's ridge-Laplacian solver.
  const multiply = vector => {
    const product = Float64Array.from(vector, value => value * config.ridge);
    for (const { a, b, weight } of edges) {
      const effect = (vector[a] - vector[b]) * weight;
      product[a] += effect;
      product[b] -= effect;
    }
    return product;
  };
  const dot = (left, right) => left.reduce((sum, value, i) => sum + value * right[i], 0);
  const solution = new Float64Array(ratings.length);
  const residual = Float64Array.from(rhs);
  const direction = Float64Array.from(rhs);
  let squared = dot(residual, residual);
  const threshold = Math.max(1e-22, squared * 1e-22);
  for (let step = 0; step < ratings.length * 2 + 20 && squared > threshold; step++) {
    const product = multiply(direction);
    const alpha = squared / dot(direction, product);
    for (let i = 0; i < ratings.length; i++) {
      solution[i] += alpha * direction[i];
      residual[i] -= alpha * product[i];
    }
    const next = dot(residual, residual);
    const beta = next / squared;
    for (let i = 0; i < ratings.length; i++) direction[i] = residual[i] + beta * direction[i];
    squared = next;
  }
  if (!(squared <= threshold * 100)) throw new Error('Recent Strength solver did not converge');
  return new Map(ratings.map(({ id }, i) => [id, solution[i]]));
}

function teamResiduals({ season, previous, config, games, fbs, cutoff }) {
  // Historical final publication times are unavailable within this snapshot.
  // Reconstruct expectations only from completed earlier groups with a day
  // buffer, just as in the frozen retrospective used to fit this coefficient.
  const groups = [...Map.groupBy(games, game => `${game.seasonType}:${game.week}`).values()]
    .map(group => ({ games: group, cutoff: Math.min(...group.map(game => game.date)) }))
    .sort((a, b) => a.cutoff - b.cutoff);
  const priorGames = [];
  const surprises = new Map();
  for (const group of groups) {
    const comparable = group.games.filter(game => fbs.has(game.home) && fbs.has(game.away) && game.homePoints !== game.awayPoints);
    if (comparable.length) {
      const gameIds = new Set(priorGames.filter(game => game.date + dayMs <= group.cutoff).map(game => game.id));
      const pregame = strengthByTeam(rankSeason(season, { previous, config, gameIds }));
      for (const game of comparable) {
        const expectation = pregame.get(game.home) - pregame.get(game.away) + venue(game, config);
        surprises.set(game.id, boundedMargin(game, config) - expectation);
      }
    }
    priorGames.push(...group.games);
  }
  const totals = new Map();
  const add = (id, adjustment, w) => {
    const team = totals.get(id) ?? { adjustment: 0, weight: 0 };
    team.adjustment += adjustment * w;
    team.weight += w;
    totals.set(id, team);
  };
  for (const game of games) {
    if (!surprises.has(game.id)) continue;
    const error = surprises.get(game.id);
    const w = weight(game.date, cutoff, RECENT_FORM_SHADOW_MODEL.residualHalfLifeDays);
    add(game.home, error, w);
    add(game.away, -error, w);
  }
  return new Map([...totals].map(([id, team]) => [id,
    team.adjustment / (team.weight + RECENT_FORM_SHADOW_MODEL.residualPriorGames)]));
}

/** Pairs forecasts at a live source checkpoint. Future games must have a confirmed kickoff. */
export function buildRecentFormForecasts({ season, previous, config, scale, cutoff, targets }) {
  const capturedAt = typeof cutoff === 'number' ? cutoff : Date.parse(cutoff);
  if (!Number.isFinite(capturedAt) || !Number.isFinite(scale) || scale <= 0 || !Array.isArray(targets)) {
    throw new Error('Recent form requires a finite cutoff, calibrated scale, and target games');
  }
  if (!previous || previous.season !== season?.year - 1 || !Array.isArray(previous.ratings)) {
    throw new Error('Recent form requires the previous season Strength snapshot');
  }
  const fbs = new Set(season.teams.filter(team => team.division === 'fbs').map(team => team.id));
  const original = new Map(season.games.map(game => [game.id, game]));
  const matches = targets.filter(target => {
    if (target.startTimeTbd !== false || !(Date.parse(target.startDate) > capturedAt) ||
        !fbs.has(target.home) || !fbs.has(target.away)) return false;
    const game = original.get(target.id);
    if (!game || game.home !== target.home || game.away !== target.away || game.neutral !== target.neutral) {
      throw new Error('Recent form target does not match the normalized matchup');
    }
    return !game.completed && !target.completed;
  });
  if (new Set(matches.map(target => target.id)).size !== matches.length) throw new Error('Duplicate recent form target');
  if (!matches.length) return new Map();

  const games = season.games.filter(game => game.completed && Date.parse(game.startDate) <= capturedAt)
    .map(game => ({ ...game, date: Date.parse(game.startDate) }));
  const gameIds = new Set(games.map(game => game.id));
  const snapshot = rankSeason(season, { config, previous, gameIds });
  const baseline = strengthByTeam(snapshot);
  const recent = weightedStrength({ snapshot, previous, games, cutoff: capturedAt });
  const residuals = teamResiduals({ season, previous, config: snapshot.config, games, fbs, cutoff: capturedAt });
  return new Map(matches.map(game => {
    const advantage = venue(game, snapshot.config);
    const baselineMargin = baseline.get(game.home) - baseline.get(game.away) + advantage;
    const recentMargin = recent.get(game.home) - recent.get(game.away) + advantage;
    const residualMargin = (residuals.get(game.home) ?? 0) - (residuals.get(game.away) ?? 0);
    const logit = baselineMargin / scale +
      RECENT_FORM_SHADOW_MODEL.graphCoefficient * (recentMargin - baselineMargin) / scale +
      RECENT_FORM_SHADOW_MODEL.residualCoefficient * residualMargin / scale;
    const baselineProbability = strengthWinProbability(baseline.get(game.home), baseline.get(game.away), advantage, scale);
    const challengerProbability = logit >= 0 ? 1 / (1 + Math.exp(-logit)) : Math.exp(logit) / (1 + Math.exp(logit));
    return [game.id, { baselineProbability, challengerProbability, baselineMargin, recentMargin, residualMargin,
      baselineSnapshotHash: snapshot.snapshotHash, gamesUsed: games.length }];
  }));
}
