import { createHash } from 'node:crypto';
import { solveGraph } from '../src/engine.js';
import {
  BASKETBALL_DAY, BASKETBALL_MODEL_VERSION, basketballLogistic, basketballVenue, weightedFeatures,
} from './model-forecast.js';
import modelSettings from './model-settings.json' with { type: 'json' };

const MARGIN_RIDGE = 5;
const EFFICIENCY_RIDGE = 8;
const COLLEY_RIDGE = 2;
const COURT_RIDGE = 80;
const PERFORMANCE_MIN_BOXES = 2;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const compareId = (a, b) => a.id.localeCompare(b.id);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hasFinal = game => game.completed === true && (!game.status || game.status === 'final') &&
  Number.isInteger(game.homePoints) && Number.isInteger(game.awayPoints) &&
  game.homePoints >= 0 && game.awayPoints >= 0 && game.homePoints !== game.awayPoints;

export function basketballResultAvailableAt(game, retrospective = true) {
  const start = Date.parse(game.startDate);
  if (!Number.isFinite(start) || game.startTimeTbd === true && game.completed !== true) return Infinity;
  const observed = Date.parse(game.availableAt);
  if (Number.isFinite(observed) && observed > start) return observed;
  // Historical feeds generally expose current finals, not original publication
  // times. Wait 24 hours after the listed tipoff for replay training.
  return retrospective ? start + (game.startTimeTbd === true ? 2 : 1) * BASKETBALL_DAY : start + 1;
}

export function basketballSeasonRows(dataset) {
  if (dataset?.competition !== 'ncaam-d1' || !Number.isInteger(dataset.season) ||
      !Array.isArray(dataset.teams) || !Array.isArray(dataset.games)) throw new Error('Expected a normalized NCAA men’s basketball season.');
  const teams = dataset.teams.filter(team => team.eligible !== false).sort(compareId);
  if (!teams.length) throw new Error('No eligible Division I teams.');
  const teamIds = new Set(teams.map(team => team.id));
  if (teamIds.size !== teams.length || teams.some(team => typeof team.id !== 'string' || !team.id || !team.name)) {
    throw new Error('Invalid or duplicate basketball team.');
  }
  const gameIds = new Set();
  for (const game of dataset.games) {
    if (!game.id || gameIds.has(game.id) || !game.home || !game.away || game.home === game.away ||
        (game.completed === true && (!hasFinal(game) || !Number.isFinite(Date.parse(game.startDate))))) {
      throw new Error('Invalid, tied final or duplicate basketball game.');
    }
    gameIds.add(game.id);
  }
  return { teams, games: dataset.games, teamIds };
}

export function eligibleBasketballFinal(game, teamIds) {
  return hasFinal(game) && game.seasonType !== 'preseason' && game.divisionOne !== false &&
    teamIds.has(game.home) && teamIds.has(game.away);
}

export function basketballPossessions(box) {
  if (Number.isFinite(box?.possessions) && box.possessions > 0) return box.possessions;
  if (!box) return null;
  const fields = [box.fieldGoalsAttempted, box.offensiveRebounds, box.turnovers, box.freeThrowsAttempted];
  if (!fields.every(value => Number.isFinite(value) && value >= 0)) return null;
  const possessions = fields[0] - fields[1] + fields[2] + 0.475 * fields[3];
  return possessions > 0 ? possessions : null;
}

function gamePossessions(game) {
  const home = basketballPossessions(game.box?.home), away = basketballPossessions(game.box?.away);
  return home !== null && away !== null ? (home + away) / 2 : null;
}

function accumulateFactors(aggregate, scoring, defending, possessions) {
  const numeric = (...values) => values.every(value => Number.isFinite(value) && value >= 0);
  const factors = {
    effectiveFieldGoalRate: numeric(scoring.fieldGoalsMade, scoring.fieldGoalsAttempted, scoring.threePointsMade) &&
      [scoring.fieldGoalsMade + 0.5 * scoring.threePointsMade, scoring.fieldGoalsAttempted],
    turnoverRate: numeric(scoring.turnovers) && [scoring.turnovers, possessions],
    offensiveReboundRate: numeric(scoring.offensiveRebounds, defending.defensiveRebounds) &&
      [scoring.offensiveRebounds, scoring.offensiveRebounds + defending.defensiveRebounds],
    freeThrowRate: numeric(scoring.freeThrowsAttempted, scoring.fieldGoalsAttempted) &&
      [scoring.freeThrowsAttempted, scoring.fieldGoalsAttempted],
  };
  for (const [metric, parts] of Object.entries(factors)) {
    if (!parts || parts[1] <= 0) continue;
    const tally = aggregate[metric] ?? { events: 0, opportunities: 0, games: 0 };
    tally.events += parts[0]; tally.opportunities += parts[1]; tally.games++;
    aggregate[metric] = tally;
  }
}

function scoringMinutes(game) {
  return 40 + (Number.isFinite(game.overtimeMinutes) && game.overtimeMinutes >= 0 ? game.overtimeMinutes : 0);
}

function ridgeWithVenue(size, rows, ridge) {
  const result = new Float64Array(size), court = new Float64Array(size);
  let courtSquare = COURT_RIDGE, courtTarget = 0;
  const edges = [];
  for (const { home, away, target, venue } of rows) {
    edges.push([home, away]);
    result[home] += target;
    result[away] -= target;
    court[home] += venue;
    court[away] -= venue;
    courtSquare += venue * venue;
    courtTarget += venue * target;
  }
  const state = solveGraph(size, edges, result, ridge);
  const response = solveGraph(size, edges, court, ridge);
  const dot = vector => court.reduce((sum, value, i) => sum + value * vector[i], 0);
  const coefficient = (courtTarget - dot(state)) / (courtSquare - dot(response));
  return { ratings: state.map((value, i) => value - coefficient * response[i]), venue: coefficient };
}

function efficiencyEvidence(size, pairings, details) {
  const stat = Array.from({ length: size }, () => ({ games: 0, tempo: 0, offenseFactors: {}, defenseFactors: {} }));
  const observations = [];
  for (const { game, home, away, venue } of pairings) {
    const possessions = gamePossessions(game);
    if (possessions === null) continue;
    // Overtime changes pace units, not points per possession.
    const tempo = possessions * 40 / scoringMinutes(game);
    stat[home].tempo += tempo; stat[home].games++;
    stat[away].tempo += tempo; stat[away].games++;
    if (details) {
      accumulateFactors(stat[home].offenseFactors, game.box.home, game.box.away, possessions);
      accumulateFactors(stat[home].defenseFactors, game.box.away, game.box.home, possessions);
      accumulateFactors(stat[away].offenseFactors, game.box.away, game.box.home, possessions);
      accumulateFactors(stat[away].defenseFactors, game.box.home, game.box.away, possessions);
    }
    observations.push({ home, away: size + away, score: 100 * game.homePoints / possessions, venue: venue / 2 });
    observations.push({ home: away, away: size + home, score: 100 * game.awayPoints / possessions, venue: -venue / 2 });
  }
  const leagueEfficiency = mean(observations.map(row => row.score));
  const regression = ridgeWithVenue(size * 2, observations.map(row => ({ ...row, target: row.score - leagueEfficiency })), EFFICIENCY_RIDGE);
  const rates = metrics => Object.fromEntries(Object.entries(metrics).map(([key, { events, opportunities, games }]) =>
    [key, { rate: events / opportunities, games }]));
  const rows = stat.map((row, i) => ({
    boxGames: row.games,
    tempo: row.games ? row.tempo / row.games : null,
    adjustedOffense: row.games >= PERFORMANCE_MIN_BOXES ? leagueEfficiency + regression.ratings[i] : null,
    adjustedDefense: row.games >= PERFORMANCE_MIN_BOXES ? leagueEfficiency - regression.ratings[size + i] : null,
    fourFactors: { offense: rates(row.offenseFactors), defense: rates(row.defenseFactors) },
  }));
  return { rows, leagueEfficiency, meanTempo: mean(rows.map(row => row.tempo).filter(Number.isFinite)), courtPer100: regression.venue };
}

export function basketballModelEvidence(teams, finals, { details = true } = {}) {
  const ids = new Map(teams.map((team, i) => [team.id, i])), size = teams.length;
  const record = teams.map(() => ({
    wins: 0, losses: 0, diWins: 0, diLosses: 0, nonDiWins: 0, nonDiLosses: 0,
    conferenceWins: 0, conferenceLosses: 0, lastGameAt: null, recent: [],
  }));
  const pairings = [], edges = [], rhs = new Float64Array(size);
  const elo = new Float64Array(size);
  const parent = teams.map((_, i) => i);
  const root = i => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  for (const game of finals) {
    const home = ids.get(game.home), away = ids.get(game.away);
    const divisionOne = home !== undefined && away !== undefined && game.divisionOne !== false;
    const outcome = Math.sign(game.homePoints - game.awayPoints);
    for (const [i, side] of [[home, outcome], [away, -outcome]]) {
      if (i === undefined) continue;
      const stats = record[i];
      stats[side > 0 ? 'wins' : 'losses']++;
      stats[divisionOne ? side > 0 ? 'diWins' : 'diLosses' : side > 0 ? 'nonDiWins' : 'nonDiLosses']++;
      if (divisionOne && game.conferenceGame === true) stats[side > 0 ? 'conferenceWins' : 'conferenceLosses']++;
      if (!stats.lastGameAt || Date.parse(game.startDate) > Date.parse(stats.lastGameAt)) stats.lastGameAt = game.startDate;
    }
    if (!divisionOne) continue;
    const venue = basketballVenue(game);
    const target = (game.homePoints - game.awayPoints) * 40 / scoringMinutes(game);
    const pair = { game, home, away, venue, target, outcome };
    pairings.push(pair);
    record[home].recent.push(pair); record[away].recent.push(pair);
    edges.push([home, away]);
    rhs[home] += outcome / 2;
    rhs[away] -= outcome / 2;
    parent[root(home)] = root(away);
    // The Elo baseline is re-trained separately. These update constants define only
    // the sequential rating input. Reported forecasts calibrate it on held-over past games.
    const p = basketballLogistic(Math.log(10) * (elo[home] - elo[away] + 55 * venue) / 400);
    const change = 24 * (Number(outcome > 0) - p);
    elo[home] += change; elo[away] -= change;
  }
  const network = new Map();
  for (let i = 0; i < size; i++) network.set(root(i), (network.get(root(i)) ?? 0) + 1);
  const colley = solveGraph(size, edges, rhs, COLLEY_RIDGE);
  const margin = ridgeWithVenue(size, pairings, MARGIN_RIDGE);
  const efficiency = efficiencyEvidence(size, pairings, details);
  const rows = teams.map((team, i) => {
    const { recent, ...stats } = record[i];
    const recentResidual = recent.sort((a, b) => Date.parse(a.game.startDate) - Date.parse(b.game.startDate)).slice(-5).map(game => {
      const residual = game.target - (margin.ratings[game.home] - margin.ratings[game.away] + margin.venue * game.venue);
      return game.home === i ? residual : -residual;
    });
    const boxes = efficiency.rows[i];
    return {
      ...team, ...stats, ...boxes, games: stats.diWins + stats.diLosses, totalGames: stats.wins + stats.losses,
      colley: 0.5 + colley[i], marginRating: margin.ratings[i], elo: elo[i],
      performanceScore: boxes.adjustedOffense === null ? null : boxes.adjustedOffense - boxes.adjustedDefense,
      recentForm: recentResidual.reduce((sum, value) => sum + value, 0) / (recentResidual.length + 3),
      connectedTeams: network.get(root(i)),
    };
  });
  return { teams: rows, pairings, edges, colley, ...efficiency, homeCourtPoints: margin.venue };
}

export function poissonBinomialWinTail(probabilities, target) {
  if (!Number.isInteger(target) || probabilities.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error('Invalid basketball win distribution.');
  }
  if (target <= 0) return 1;
  if (target > probabilities.length) return 0;
  const counts = new Float64Array(probabilities.length + 1);
  counts[0] = 1;
  for (const [i, p] of probabilities.entries()) {
    for (let wins = i + 1; wins > 0; wins--) counts[wins] = counts[wins] * (1 - p) + counts[wins - 1] * p;
    counts[0] *= 1 - p;
  }
  return Math.max(0, Math.min(1, counts.subarray(target).reduce((sum, value) => sum + value, 0)));
}

function basketballPairEvidence(model) {
  const size = model.colley.length;
  const columns = new Map();
  const column = i => {
    if (!columns.has(i)) {
      const response = new Float64Array(size);
      response[i] = 1;
      columns.set(i, solveGraph(size, model.edges, response, COLLEY_RIDGE));
    }
    return columns.get(i);
  };
  return model.pairings.map(pair => {
    const { home, away, outcome } = pair;
    const a = column(home);
    const b = column(away);
    const x = a[home] - b[home], y = a[away] - b[away];
    // Sherman–Morrison is exactly the Colley re-solve with this game removed.
    // A schedule entry therefore never contributes to its own difficulty evidence.
    const shift = (model.colley[home] - model.colley[away] - outcome / 2) / (1 - x + y);
    return { ...pair, homeColley: 0.5 + model.colley[home] + x * shift, awayColley: 0.5 + model.colley[away] + y * shift };
  });
}

function attachRanks(rows, scoreKey, rankKey) {
  const ranked = rows.filter(row => Number.isFinite(row[scoreKey])).sort((a, b) => b[scoreKey] - a[scoreKey] || compareId(a, b));
  for (const row of rows) row[rankKey] = null;
  let rank, previous;
  for (const [i, row] of ranked.entries()) {
    if (previous === undefined || Math.abs(previous - row[scoreKey]) >= 1e-10) {
      rank = i + 1;
      previous = row[scoreKey];
    }
    row[rankKey] = rank;
  }
}

export function basketballSorProfiles(model, sor, reference, pairEvidence = basketballPairEvidence(model)) {
  const schedules = model.teams.map(() => []);
  for (const { home, away, homeColley, awayColley, venue, outcome, game } of pairEvidence) {
    for (const [i, j, opponentColley, location, result] of [[home, away, awayColley, venue, outcome],
      [away, home, homeColley, -venue, -outcome]]) {
      schedules[i].push({
        gameId: game.id,
        opponentId: model.teams[j].id,
        venue: location > 0 ? 'Home' : location < 0 ? 'Away' : game.neutral === true ? 'Neutral' : 'Unconfirmed',
        result: result > 0 ? 'W' : 'L',
        opponentRating: opponentColley,
        referenceWinProbability: basketballLogistic(sor.colley * (reference - opponentColley) + sor.venue * location),
      });
    }
  }
  const rows = model.teams.map((team, i) => {
    const schedule = schedules[i];
    const probabilities = schedule.map(game => game.referenceWinProbability);
    const chance = schedule.length ? poissonBinomialWinTail(probabilities, team.diWins) : null;
    const sorScore = chance === null ? null : Math.max(0, -Math.log10(Math.max(Number.MIN_VALUE, chance)));
    return {
      ...team, schedule, sorScore, sorOpponentWinProbability: chance,
      scheduleStrength: mean(schedule.map(game => game.opponentRating)),
      expectedWins: schedule.length ? probabilities.reduce((sum, p) => sum + p, 0) : null,
    };
  });
  attachRanks(rows, 'sorScore', 'sorRank');
  return rows;
}

export function basketballReferenceCandidates(model) {
  const rows = model.teams.filter(team => team.games > 0).sort((a, b) => b.colley - a.colley || compareId(a, b));
  return {
    average: 0.5,
    top25: rows.length >= 25 ? rows[24].colley : null,
    bubble: rows.length >= 50 ? rows[49].colley : null,
  };
}

function predictiveScore(team, weights) {
  if (!team.games) return null;
  return weightedFeatures({
    margin: team.marginRating, efficiency: team.performanceScore === null ? team.marginRating
      : team.performanceScore * (team.tempo ?? 65) / 100,
    colley: team.colley - 0.5, elo: team.elo / 100, recent: team.recentForm, venue: 0, rest: 0,
  }, weights);
}

export function buildBasketballSnapshot(dataset, { asOf = dataset?.source?.asOf, config = modelSettings.modelConfig,
  retrospective = false, compareReferences = false } = {}) {
  const date = new Date(asOf);
  if (asOf == null || !Number.isFinite(date.getTime()) || !config?.id || !config.probability || !config.sor ||
      !Object.values(config.probability).every(Number.isFinite) || !Object.values(config.sor).every(Number.isFinite)) {
    throw new Error('An explicit basketball snapshot cutoff and valid model configuration are required.');
  }
  const { teams, games } = basketballSeasonRows(dataset);
  const sourceTime = Date.parse(dataset.source?.asOf);
  const historical = retrospective || !Number.isFinite(sourceTime) || date.getTime() < sourceTime;
  const observed = games.filter(game => hasFinal(game) && game.seasonType !== 'preseason' &&
      basketballResultAvailableAt(game, historical) <= date.getTime())
    .sort((a, b) => basketballResultAvailableAt(a, historical) - basketballResultAvailableAt(b, historical) || compareId(a, b));
  const evidence = basketballModelEvidence(teams, observed);
  const pairs = basketballPairEvidence(evidence);
  const rows = basketballSorProfiles(evidence, config.sor, 0.5, pairs);
  for (const team of rows) {
    team.predictiveScore = predictiveScore(team, config.probability);
    team.provisional = team.games < 5 || team.connectedTeams < Math.ceil(teams.length * 0.9);
  }
  attachRanks(rows, 'predictiveScore', 'predictiveRank');
  attachRanks(rows, 'performanceScore', 'performanceRank');
  const alternatives = {};
  if (compareReferences) {
    for (const [key, reference] of Object.entries(basketballReferenceCandidates(evidence))) {
      if (key === 'average' || reference === null) continue;
      alternatives[key] = {
        reference,
        teams: basketballSorProfiles(evidence, config.sor, reference, pairs)
          .map(({ id, sorRank, sorScore }) => ({ id, sorRank, sorScore })),
      };
    }
  }
  const snapshotHash = hash({
    competition: dataset.competition,
    season: dataset.season,
    asOf: date.toISOString(),
    teams: teams.map(team => [team.id, team.conference]),
    games: observed,
    modelVersion: BASKETBALL_MODEL_VERSION,
    config,
  });
  return {
    competition: dataset.competition, season: dataset.season, asOf: date.toISOString(), modelVersion: BASKETBALL_MODEL_VERSION,
    source: dataset.source ?? null, modelConfig: config, snapshotHash, teams: rows,
    reference: { id: 'average-di', colley: 0.5, eligible: 'D-I games only', alternatives },
    leagueEfficiency: evidence.leagueEfficiency, meanTempo: evidence.meanTempo, homeCourtPoints: evidence.homeCourtPoints,
    gamesUsed: pairs.length, coverage: dataset.coverage ?? null,
  };
}
