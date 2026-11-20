export const BASKETBALL_MODEL_VERSION = 'gd-ncaam-1.0-preview';
export const BASKETBALL_DAY = 86_400_000;

// A neutral preseason fallback is kept distinct from historically fitted probabilities.
export const PREVIEW_MODEL = Object.freeze({
  id: 'margin-preview',
  calibrated: false,
  probability: Object.freeze({ margin: 0.11, venue: 0.28 }),
  scoreMargin: Object.freeze({ margin: 1, venue: 3 }),
  sor: Object.freeze({ colley: 4, venue: 0.28 }),
});

export function basketballVenue(game) {
  if (game.venue === 'away') return -1;
  if (game.venue === 'home') return 1;
  if (game.venue === 'neutral') return 0;
  return game.neutral === false ? 1 : 0;
}

export function basketballLogistic(value) {
  const bounded = Math.max(-32, Math.min(32, value));
  return 1 / (1 + Math.exp(-bounded));
}

function daysOfRest(team, startTime) {
  const last = Date.parse(team.lastGameAt);
  return Number.isFinite(last) && Number.isFinite(startTime) && last < startTime
    ? Math.log(Math.max(1, Math.min(8, (startTime - last) / BASKETBALL_DAY))) : null;
}

export function matchupFeatures(home, away, game, leagueEfficiency, meanTempo) {
  const pace = Number.isFinite(home.tempo) && Number.isFinite(away.tempo)
    ? (home.tempo + away.tempo) / 2 : null;
  const hasBox = pace !== null && Number.isFinite(leagueEfficiency) &&
    [home.adjustedOffense, home.adjustedDefense, away.adjustedOffense, away.adjustedDefense].every(Number.isFinite);
  const start = Date.parse(game.startDate);
  const homeRest = daysOfRest(home, start), awayRest = daysOfRest(away, start);
  const margin = home.marginRating - away.marginRating;
  const efficiency = hasBox
    ? ((home.adjustedOffense - home.adjustedDefense) - (away.adjustedOffense - away.adjustedDefense)) *
      (pace ?? meanTempo) / 100 : margin;

  return {
    venue: basketballVenue(game),
    colley: home.colley - away.colley,
    elo: (home.elo - away.elo) / 100,
    margin,
    efficiency,
    recent: home.recentForm - away.recentForm,
    rest: homeRest !== null && awayRest !== null ? homeRest - awayRest : 0,
    hasBox,
    pace,
  };
}

export function weightedFeatures(features, weights) {
  return Object.entries(weights).reduce((sum, [name, weight]) => sum + weight * features[name], 0);
}

export function predictBasketball(snapshot, game) {
  if (!game || game.home === game.away) throw new Error('Choose two different basketball teams.');
  const home = snapshot.teams.find(team => team.id === game.home);
  const away = snapshot.teams.find(team => team.id === game.away);
  if (!home || !away) throw new Error('Both teams must be in the Division I season registry.');
  const config = snapshot.modelConfig;
  const f = matchupFeatures(home, away, game, snapshot.leagueEfficiency, snapshot.meanTempo);
  const homeWinProbability = basketballLogistic(weightedFeatures(f, config.probability));
  const homeMargin = config.scoreMargin ? weightedFeatures(f, config.scoreMargin) : null;
  // The lockable forecast is a point spread and win probability. Totals are withheld
  // until a totals model clears its own validation; an efficiency figure is not one.
  return {
    homeWinProbability,
    awayWinProbability: 1 - homeWinProbability,
    homeMargin,
    projectedHomePoints: null,
    projectedAwayPoints: null,
    estimatedPossessions: f.pace,
    modelId: config.id,
    modelVersion: snapshot.modelVersion,
    calibrated: config.calibrated === true,
    provisional: home.provisional === true || away.provisional === true || home.games < 5 || away.games < 5,
    asOf: snapshot.asOf,
    snapshotHash: snapshot.snapshotHash,
  };
}
