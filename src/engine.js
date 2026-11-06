import { createHash } from 'node:crypto';

export const VERSION = '0.1.0';
export const DEFAULT_CONFIG = Object.freeze({ ridge: 5, retention: 0.65, homeAdvantage: 2.5, marginCap: 28, probabilityScale: 14 });

// Conjugate gradient for (ridge * I + game-graph Laplacian). Positive ridge
// makes disconnected schedules and teams with no games well-defined.
export function solveGraph(size, edges, rhs, ridge) {
  const multiply = x => {
    const y = Float64Array.from(x, v => ridge * v);
    for (const [a, b] of edges) { const d = x[a] - x[b]; y[a] += d; y[b] -= d; }
    return y;
  };
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const x = new Float64Array(size);
  let r = Float64Array.from(rhs), p = Float64Array.from(r), rr = dot(r, r);
  const threshold = Math.max(1e-22, rr * 1e-22);
  for (let k = 0; k < size * 2 + 20 && rr > threshold; k++) {
    const ap = multiply(p), alpha = rr / dot(p, ap);
    for (let i = 0; i < size; i++) { x[i] += alpha * p[i]; r[i] -= alpha * ap[i]; }
    const next = dot(r, r), beta = next / rr;
    p = Float64Array.from(r, (v, i) => v + beta * p[i]); rr = next;
  }
  if (rr > threshold * 100) throw new Error('Rating solver did not converge');
  return Array.from(x);
}

function validateConfig(config) {
  for (const key of Object.keys(DEFAULT_CONFIG)) if (!Number.isFinite(config[key])) throw new Error(`Invalid ${key}`);
  if (config.ridge <= 0 || config.marginCap <= 0 || config.probabilityScale <= 0 || config.retention < 0 || config.retention > 1 || config.homeAdvantage < 0) throw new Error('Invalid model configuration');
}

export function validateSeason(season) {
  if (!Number.isInteger(season.year) || !Array.isArray(season.teams) || !season.teams.length || !Array.isArray(season.games)) throw new Error('Invalid season');
  const ids = new Set();
  for (const t of season.teams) {
    if (typeof t.id !== 'string' || !t.id || ids.has(t.id) || !t.name || !t.division) throw new Error('Invalid or duplicate team');
    ids.add(t.id);
  }
  const games = new Set();
  for (const g of season.games) {
    if (!g.id || games.has(g.id) || !ids.has(g.home) || !ids.has(g.away) || g.home === g.away || !Number.isFinite(Date.parse(g.startDate)) || typeof g.completed !== 'boolean' || typeof g.neutral !== 'boolean' || !Number.isInteger(g.week) || !['regular', 'postseason'].includes(g.seasonType)) throw new Error(`Invalid or duplicate game ${g.id}`);
    games.add(g.id);
    if (g.completed && (![g.homePoints, g.awayPoints].every(v => Number.isInteger(v) && v >= 0))) throw new Error(`Missing final score: ${g.id}`);
    if (g.regulationMargin != null && (!Number.isFinite(g.regulationMargin) || g.regulationMargin !== 0)) throw new Error(`Invalid overtime regulation margin: ${g.id}`);
  }
  return season;
}

export function rankSeason(input, { config = DEFAULT_CONFIG, previous = null, before = null, gameIds = null } = {}) {
  validateSeason(input); config = { ...DEFAULT_CONFIG, ...config }; validateConfig(config);
  if (previous && previous.season >= input.year) throw new Error('Historical prior must precede this season');
  if (before && !Number.isFinite(Date.parse(before))) throw new Error('Invalid cutoff');
  const teams = [...input.teams].sort((a, b) => a.id.localeCompare(b.id));
  const index = new Map(teams.map((t, i) => [t.id, i]));
  // A day buffer prevents a final score being used at its kickoff timestamp.
  // Exact historical publication times are unavailable in retrospective sources.
  const games = input.games.filter(g => g.completed && (!before || Date.parse(g.startDate) + 86400000 <= Date.parse(before)) && (!gameIds || gameIds.has(g.id))).sort((a, b) => a.id.localeCompare(b.id));
  const priorRows = new Map((previous?.ratings ?? []).map(t => [t.id, t]));
  const gap = previous ? input.year - previous.season : 0;
  const prior = teams.map(t => (priorRows.get(t.id)?.strength ?? 0) * config.retention ** gap);
  const n = teams.length, edges = [], resultRhs = new Float64Array(n), strengthRhs = Float64Array.from(prior, x => x * config.ridge);
  const stats = teams.map(() => ({ wins: 0, losses: 0, ties: 0, games: 0, opponents: [], details: [] }));
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (const g of games) {
    const a = index.get(g.home), b = index.get(g.away), margin = g.homePoints - g.awayPoints;
    const outcome = Math.sign(margin), location = g.neutral ? 0 : config.homeAdvantage;
    // When period scores confirm OT, use a one-point signal for the OT winner.
    const baseMargin = g.regulationMargin === 0 ? outcome : margin;
    const target = config.marginCap * Math.tanh(baseMargin / config.marginCap) - location;
    edges.push([a, b]); parent[find(a)] = find(b);
    resultRhs[a] += outcome / 2; resultRhs[b] -= outcome / 2;
    strengthRhs[a] += target; strengthRhs[b] -= target;
    for (const [i, j, side] of [[a, b, 1], [b, a, -1]]) {
      const s = stats[i]; s.games++; s.opponents.push(j);
      if (!outcome) s.ties++; else if (outcome * side > 0) s.wins++; else s.losses++;
      s.details.push({ gameId: g.id, opponentId: teams[j].id, result: outcome * side > 0 ? 'W' : outcome * side < 0 ? 'L' : 'T', finalMargin: margin * side, adjustedMargin: target * side });
    }
  }
  // Colley r = .5 + (2I + L)^-1 ((wins-losses)/2).
  const resume = solveGraph(n, edges, resultRhs, 2).map(v => v + 0.5);
  const strength = solveGraph(n, edges, strengthRhs, config.ridge);
  const componentSizes = new Map();
  for (let i = 0; i < n; i++) componentSizes.set(find(i), (componentSizes.get(find(i)) ?? 0) + 1);
  const ratings = teams.map((t, i) => {
    const s = stats[i];
    return { ...t, wins: s.wins, losses: s.losses, ties: s.ties, games: s.games,
      achievement: resume[i], strength: strength[i], preseasonStrength: prior[i],
      scheduleStrength: s.games ? s.opponents.reduce((sum, j) => sum + strength[j], 0) / s.games : null,
      achievementScheduleStrength: s.games ? s.opponents.reduce((sum, j) => sum + resume[j], 0) / s.games : null,
      priorWeight: config.ridge / (config.ridge + s.games),
      evidence: { provisional: s.games < 4, connectedTeams: componentSizes.get(find(i)), totalModeledTeams: n },
      contributions: s.details };
  });
  const fbs = ratings.filter(t => t.division === 'fbs').sort((a, b) => Number(b.games > 0) - Number(a.games > 0) || b.achievement - a.achievement || a.id.localeCompare(b.id));
  let last = null, rank = null;
  fbs.forEach((t, i) => {
    if (t.games && (last === null || Math.abs(t.achievement - last) > 1e-9)) rank = i + 1;
    t.rank = t.games ? rank : null; last = t.achievement;
  });
  for (const conference of new Set(fbs.map(t => t.conference))) {
    let lastScore = null, conferenceRank = null;
    fbs.filter(t => t.conference === conference).forEach((t, i) => {
      if (t.games && (lastScore === null || Math.abs(t.achievement - lastScore) > 1e-9)) conferenceRank = i + 1;
      t.conferenceRank = t.games ? conferenceRank : null; lastScore = t.achievement;
    });
  }
  const canonical = { year: input.year, teams, games, config, previousHash: previous?.snapshotHash ?? null, before };
  return { modelVersion: VERSION, season: input.year, before, config, status: 'experimental',
    source: input.source ?? null, gamesUsed: games.length, fbsTeams: fbs.length,
    previousSeason: previous?.season ?? null,
    snapshotHash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),
    rankings: fbs, ratings };
}

export function predict(snapshot, game) {
  const rows = new Map(snapshot.ratings.map(t => [t.id, t]));
  if (!rows.has(game.home) || !rows.has(game.away)) throw new Error('Unknown matchup team');
  const margin = rows.get(game.home).strength - rows.get(game.away).strength + (game.neutral ? 0 : snapshot.config.homeAdvantage);
  const probability = 1 / (1 + Math.exp(-margin / snapshot.config.probabilityScale));
  return { homeWinProbability: probability, homeMargin: margin, calibrated: false };
}
