import { basketballPossessions } from './model-engine.js';

const fields = ['fieldGoalsMade', 'fieldGoalsAttempted', 'threePointsMade', 'threePointsAttempted',
  'freeThrowsMade', 'freeThrowsAttempted', 'offensiveRebounds', 'defensiveRebounds', 'totalRebounds',
  'assists', 'turnovers', 'steals', 'blocks', 'fouls'];
const numeric = (...values) => values.every(value => Number.isFinite(value) && value >= 0);
const ratio = (numerator, denominator) => denominator > 0 ? numerator / denominator : null;

function emptyRecord() {
  return { wins: 0, losses: 0 };
}

function boxSummary(samples) {
  const totals = Object.fromEntries(fields.map(field => {
    const values = samples.map(({ own }) => own[field]).filter(value => numeric(value));
    return [field, { total: values.length ? values.reduce((sum, value) => sum + value, 0) : null, games: values.length }];
  }));
  const rates = {};
  for (const { own, opponent, points, possessions } of samples) {
    const factors = {
      fieldGoalPct: [own.fieldGoalsMade, own.fieldGoalsAttempted],
      threePointPct: [own.threePointsMade, own.threePointsAttempted],
      freeThrowPct: [own.freeThrowsMade, own.freeThrowsAttempted],
      threePointAttemptRate: own.threePointsAttempted <= own.fieldGoalsAttempted
        ? [own.threePointsAttempted, own.fieldGoalsAttempted] : [],
      effectiveFieldGoalPct: numeric(own.fieldGoalsMade, own.threePointsMade)
        ? [own.fieldGoalsMade + 0.5 * own.threePointsMade, own.fieldGoalsAttempted] : [],
      trueShootingPct: numeric(own.fieldGoalsAttempted, own.freeThrowsAttempted)
        ? [points, 2 * (own.fieldGoalsAttempted + 0.44 * own.freeThrowsAttempted)] : [],
      turnoverPct: [own.turnovers, possessions],
      offensiveReboundPct: numeric(own.offensiveRebounds, opponent.defensiveRebounds)
        ? [own.offensiveRebounds, own.offensiveRebounds + opponent.defensiveRebounds] : [],
      defensiveReboundPct: numeric(own.defensiveRebounds, opponent.offensiveRebounds)
        ? [own.defensiveRebounds, own.defensiveRebounds + opponent.offensiveRebounds] : [],
      freeThrowRate: [own.freeThrowsAttempted, own.fieldGoalsAttempted],
      pointsPerPossession: [points, possessions],
    };
    for (const [name, [numerator, denominator]] of Object.entries(factors)) {
      if (!numeric(numerator, denominator) || !denominator) continue;
      rates[name] ??= { numerator: 0, denominator: 0, games: 0 };
      rates[name].numerator += numerator;
      rates[name].denominator += denominator;
      rates[name].games++;
    }
  }
  const ratios = Object.fromEntries(Object.entries(rates).map(([name, sample]) =>
    [name, { value: ratio(sample.numerator, sample.denominator), games: sample.games }]));
  return { totals, ratios };
}

export function basketballTeamStats(dataset, teamId, rating = null) {
  const asOf = dataset.source?.asOf;
  const games = dataset.games.filter(game => game.completed && game.startDate < asOf
    && (game.home === teamId || game.away === teamId));
  const venue = { home: emptyRecord(), road: emptyRecord(), neutral: emptyRecord(), unknown: emptyRecord() };
  const record = { overall: emptyRecord(), conference: emptyRecord(), venue };
  const teamSamples = [], opponentSamples = [], recent = [];
  let points = 0, pointsAllowed = 0;
  let possessions = 0, possessionGames = 0, estimatedPossessionGames = 0;
  let paceTotal = 0, paceGames = 0;
  for (const game of games) {
    const home = game.home === teamId;
    const scored = home ? game.homePoints : game.awayPoints;
    const allowed = home ? game.awayPoints : game.homePoints;
    const result = scored > allowed ? 'wins' : 'losses';
    const site = game.neutral === true ? 'neutral' : game.neutral !== false ? 'unknown' : home ? 'home' : 'road';
    record.overall[result]++;
    venue[site][result]++;
    if (game.conferenceGame === true) record.conference[result]++;
    points += scored;
    pointsAllowed += allowed;
    recent.push({ gameId: game.id, points: scored, pointsAllowed: allowed, site });
    if (!game.divisionOne || !game.box?.home || !game.box?.away) continue;
    const own = home ? game.box.home : game.box.away;
    const other = home ? game.box.away : game.box.home;
    const ownCount = basketballPossessions(own), otherCount = basketballPossessions(other);
    const shared = ownCount !== null && otherCount !== null ? (ownCount + otherCount) / 2 : null;
    if (shared !== null) {
      possessions += shared;
      possessionGames++;
      if (!(own.possessions > 0 && other.possessions > 0)) estimatedPossessionGames++;
      if (Number.isFinite(game.overtimeMinutes)) {
        paceTotal += shared * 40 / (40 + game.overtimeMinutes);
        paceGames++;
      }
    }
    teamSamples.push({ own, opponent: other, points: scored, possessions: shared });
    opponentSamples.push({ own: other, opponent: own, points: allowed, possessions: shared });
  }
  return {
    record, scoring: { games: games.length, points, pointsAllowed, margin: games.length ? points - pointsAllowed : null },
    divisionOne: { boxGames: teamSamples.length, team: boxSummary(teamSamples), opponent: boxSummary(opponentSamples) },
    possessions: { value: possessionGames ? possessions : null, games: possessionGames, estimatedGames: estimatedPossessionGames },
    tempo: { value: ratio(paceTotal, paceGames), games: paceGames },
    adjustedOffense: rating?.adjustedOffense ?? null,
    adjustedDefense: rating?.adjustedDefense ?? null,
    adjustedNet: Number.isFinite(rating?.adjustedOffense) && Number.isFinite(rating?.adjustedDefense)
      ? rating.adjustedOffense - rating.adjustedDefense : null,
    opponentColley: rating?.opponentColley ?? null,
    recent: recent.slice(-5).reverse(),
  };
}
