const marginCap = 28;
const marginWeight = 0.2;
const priorGames = 8;

export const CONFERENCE_QUALITY = Object.freeze({
  marginCap,
  marginWeight,
  priorGames,
  smallSampleBelow: priorGames,
  formula: `For each FBS game, p = 1 / (1 + exp(−(mean FBS predictive rating − opponent rating + venue adjustment) / scale)). Game quality = (outcome − p) × (${1 - marginWeight} + ${marginWeight} × min(|margin|, ${marginCap}) / ${marginCap}), with outcome 1 for a win, 0 for a loss and 0.5 for a tie. Conference score = 50 + 50 × sum(game quality) / (rated games + ${priorGames}).`,
  interpretation: `The reference averages the available FBS Predictive Strength ratings. The venue adjustment is the published home advantage at home, its negative away, and zero on a neutral field. The scale is the published Predictive Strength win-probability scale. ${priorGames} neutral games pull small samples toward 50. Opponent ratings come from the latest available checkpoint for the selected season, so this is a retrospective comparison.`,
});

const isPoll = method => method === 'ap' || method === 'cfp';
const isScore = value => Number.isSafeInteger(value) && value >= 0;
const isRank = value => Number.isSafeInteger(value) && value > 0;
const average = values => values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;

function comparisonGames(dataset) {
  const seen = new Set();
  const asOf = Date.parse(dataset.asOf);
  return dataset.games.filter(game => {
    const home = dataset.teams[game.home];
    const away = dataset.teams[game.away];
    const kickoff = Date.parse(game.startDate);
    if (!home || !away || game.home === game.away || !game.id || seen.has(game.id) ||
        !isScore(game.homePoints) || !isScore(game.awayPoints) || !Number.isFinite(kickoff) ||
        !Number.isFinite(asOf) || kickoff > asOf || game.completed === false || (game.status && game.status !== 'final')) {
      return false;
    }
    const fbsGame = home.division === 'fbs' && away.division === 'fbs';
    const crossDivision = (home.division === 'fbs' && away.division === 'fcs') ||
      (home.division === 'fcs' && away.division === 'fbs');
    if (!crossDivision && (!fbsGame || !home.conference || !away.conference || home.conference === away.conference)) return false;
    seen.add(game.id);
    return true;
  });
}

function rankContext(dataset, game, team, side, method) {
  const currentValue = team.ranks?.[method];
  const previousRanks = game.pregame?.[method];
  const pregameValue = previousRanks?.[side];
  const currentAvailable = team.division === 'fbs' && dataset.rankings?.[method]?.available === true &&
    (isRank(currentValue) || (isPoll(method) && currentValue === null));
  const pregameAvailable = team.division === 'fbs' && Array.isArray(previousRanks) &&
    (isRank(pregameValue) || (isPoll(method) && pregameValue === null));
  return {
    current: currentAvailable && isRank(currentValue) ? currentValue : null,
    pregame: pregameAvailable && isRank(pregameValue) ? pregameValue : null,
    currentAvailable,
    pregameAvailable,
    pregameAsOf: pregameAvailable ? game.pregameAsOf?.[method] ?? null : null,
    pregameStatus: team.division !== 'fbs' ? 'not-applicable' : game.pregameStatus?.[method]?.[side] ??
      (pregameAvailable ? isRank(pregameValue) ? 'ranked' : 'unranked' : 'missing'),
  };
}

function gameQuality(dataset, opponent, meanStrength, margin, venue) {
  const scale = dataset.probabilityScale;
  const advantage = dataset.homeAdvantage;
  if (opponent.division !== 'fbs' || !Number.isFinite(opponent.strength) || !Number.isFinite(meanStrength) ||
      !Number.isFinite(scale) || scale <= 0 || (venue !== 'neutral' && !Number.isFinite(advantage))) return null;
  const adjustment = venue === 'neutral' ? 0 : venue === 'home' ? advantage : -advantage;
  const probability = 1 / (1 + Math.exp(-(meanStrength - opponent.strength + adjustment) / scale));
  const outcome = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  const marginMultiplier = 1 - marginWeight + marginWeight * Math.min(Math.abs(margin), marginCap) / marginCap;
  return (outcome - probability) * marginMultiplier;
}

function gameSide(dataset, game, homeSide) {
  const team = dataset.teams[homeSide ? game.home : game.away];
  const opponent = dataset.teams[homeSide ? game.away : game.home];
  const teamPoints = homeSide ? game.homePoints : game.awayPoints;
  const opponentPoints = homeSide ? game.awayPoints : game.homePoints;
  const margin = teamPoints - opponentPoints;
  return {
    id: game.id, startDate: game.startDate, neutral: game.neutral, week: game.week, seasonType: game.seasonType,
    team, opponent, teamPoints, opponentPoints, margin,
    result: margin > 0 ? 'win' : margin < 0 ? 'loss' : 'tie',
    venue: game.neutral ? 'neutral' : homeSide ? 'home' : 'away',
  };
}

const rankValueForSort = (row, rankScope) => (rankScope === 'pregame' ? row.opponentRank.pregame : row.opponentRank.current) ?? Infinity;
const strengthValueForSort = row => Number.isFinite(row.opponent.strength) ? row.opponent.strength : -Infinity;
const newestFirst = (a, b) => Date.parse(b.startDate) - Date.parse(a.startDate) || String(a.id).localeCompare(String(b.id));
const isTop = (rank, threshold) => isRank(rank) && rank <= threshold;

export function conferenceGames(dataset, {
  conferenceA, conferenceB, opponents = 'all', method = 'sor', rankScope = 'all', result = 'all', sort = 'date',
} = {}) {
  if (!conferenceA || conferenceA === conferenceB) return [];
  const groups = new Map(dataset.conferences.map(({ id, group }) => [id, group]));
  const fcs = opponents === 'fcs' || conferenceB === 'fcs';
  const strengthRatings = Object.values(dataset.teams)
    .filter(team => team.division === 'fbs' && Number.isFinite(team.strength)).map(team => team.strength);
  const meanStrength = average(strengthRatings);
  const rows = [];

  for (const game of comparisonGames(dataset)) {
    const home = dataset.teams[game.home];
    const homeSide = home.division === 'fbs' && home.conference === conferenceA;
    const row = gameSide(dataset, game, homeSide);
    if (row.team.division !== 'fbs' || row.team.conference !== conferenceA) continue;
    if (fcs ? row.opponent.division !== 'fcs' : row.opponent.division !== 'fbs') continue;
    if (!fcs && conferenceB && row.opponent.conference !== conferenceB) continue;
    if (opponents === 'power-four' && groups.get(row.opponent.conference) !== 'power-four') continue;
    if ((result === 'wins' && row.result !== 'win') || (result === 'losses' && row.result !== 'loss')) continue;
    const rank = rankContext(dataset, game, row.team, homeSide ? 0 : 1, method);
    const opponentRank = rankContext(dataset, game, row.opponent, homeSide ? 1 : 0, method);
    if ((rankScope === 'current' && !isTop(opponentRank.current, 25)) ||
        (rankScope === 'pregame' && !isTop(opponentRank.pregame, 25))) continue;
    rows.push({
      ...row, method, rank, opponentRank, pregameEdition:game.pregameEdition?.[method] ?? null,
      qualityScore: gameQuality(dataset, row.opponent, meanStrength, row.margin, row.venue),
    });
  }

  return rows.sort((a, b) => {
    if (sort === 'oldest') return Date.parse(a.startDate) - Date.parse(b.startDate) || String(a.id).localeCompare(String(b.id));
    if (sort === 'margin') return Math.abs(b.margin) - Math.abs(a.margin) || newestFirst(a, b);
    if (sort === 'opponent-rank') return rankValueForSort(a, rankScope) - rankValueForSort(b, rankScope) || newestFirst(a, b);
    if (sort === 'opponent-strength') return strengthValueForSort(b) - strengthValueForSort(a) || newestFirst(a, b);
    return newestFirst(a, b);
  });
}

function record(rows) {
  const wins = rows.filter(row => row.result === 'win');
  const losses = rows.filter(row => row.result === 'loss');
  const ties = rows.length - wins.length - losses.length;
  return {
    wins: wins.length, losses: losses.length, ties, games: rows.length,
    winningPercentage: ratio(wins.length + ties / 2, rows.length),
    averageVictoryMargin: average(wins.map(row => row.margin)),
    averageDefeatMargin: average(losses.map(row => -row.margin)),
  };
}

function completeRecord(team) {
  return isScore(team.wins) && isScore(team.losses) && isScore(team.ties);
}

function coveredWins(rows, threshold, coverage, getRank) {
  return coverage ? rows.filter(row => row.result === 'win' && isTop(getRank(row), threshold)).length : null;
}

export function conferenceSummary(dataset, conference, rows = conferenceGames(dataset, { conferenceA: conference })) {
  const method = rows[0]?.method ?? 'sor';
  const currentRankCoverage = rows.filter(row => row.opponentRank.currentAvailable).length;
  const pregameRankCoverage = rows.filter(row => row.opponentRank.pregameAvailable).length;
  const pregameNoPollYet = rows.filter(row => row.opponentRank.pregameStatus === 'no-poll-yet').length;
  const pregameBeforeArchive = rows.filter(row => row.opponentRank.pregameStatus === 'before-archive').length;
  const pregamePublicationTimeUncertain = rows.filter(row => row.opponentRank.pregameStatus === 'publication-time-uncertain').length;
  const pregameMissing = rows.filter(row => row.opponentRank.pregameStatus === 'missing').length;
  const predictiveRankCoverage = dataset.rankings?.predictive?.available
    ? rows.filter(row => row.opponent.division === 'fbs' && isRank(row.opponent.ranks?.predictive)).length : 0;
  const rated = rows.filter(row => Number.isFinite(row.qualityScore));
  const opponentRecords = rows.filter(row => completeRecord(row.opponent));
  const wins = rows.filter(row => row.result === 'win');
  const opponentWins = opponentRecords.reduce((total, row) => total + row.opponent.wins, 0);
  const opponentLosses = opponentRecords.reduce((total, row) => total + row.opponent.losses, 0);
  const opponentTies = opponentRecords.reduce((total, row) => total + row.opponent.ties, 0);
  const strengthRatings = rows.filter(row => row.opponent.division === 'fbs' && Number.isFinite(row.opponent.strength));
  const totalQuality = rated.reduce((total, row) => total + row.qualityScore, 0);
  return {
    ...record(rows),
    currentRankCoverage, pregameRankCoverage, predictiveRankCoverage,
    pregameNoPollYet, pregameBeforeArchive, pregamePublicationTimeUncertain, pregameMissing,
    currentTop10Wins: coveredWins(rows, 10, currentRankCoverage, row => row.opponentRank.current),
    currentTop25Wins: coveredWins(rows, 25, currentRankCoverage, row => row.opponentRank.current),
    pregameTop10Wins: coveredWins(rows, 10, pregameRankCoverage, row => row.opponentRank.pregame),
    pregameTop25Wins: coveredWins(rows, 25, pregameRankCoverage, row => row.opponentRank.pregame),
    predictiveTop25Wins: coveredWins(rows, 25, predictiveRankCoverage, row => row.opponent.ranks?.predictive),
    predictiveTop50Wins: coveredWins(rows, 50, predictiveRankCoverage, row => row.opponent.ranks?.predictive),
    opponentStrengthCoverage: strengthRatings.length,
    averageOpponentPredictiveRating: average(strengthRatings.map(row => row.opponent.strength)),
    averageOpponentRank: dataset.rankings?.[method]?.fullField === true
      ? average(rows.map(row => row.opponentRank.current).filter(isRank)) : null,
    opponentRecordCoverage: opponentRecords.length,
    opponentWins: opponentRecords.length ? opponentWins : null,
    opponentLosses: opponentRecords.length ? opponentLosses : null,
    opponentTies: opponentRecords.length ? opponentTies : null,
    opponentWinningPercentage: ratio(opponentWins + opponentTies / 2, opponentWins + opponentLosses + opponentTies),
    winningRecordWins: opponentRecords.length ? opponentRecords.filter(row => row.result === 'win' && row.opponent.wins > row.opponent.losses).length : null,
    losingRecordWins: opponentRecords.length ? opponentRecords.filter(row => row.result === 'win' && row.opponent.wins < row.opponent.losses).length : null,
    evenRecordWins: wins.filter(row => completeRecord(row.opponent) && row.opponent.wins === row.opponent.losses).length,
    missingRecordWins: wins.filter(row => !completeRecord(row.opponent)).length,
    averageWinQuality: average(rated.filter(row => row.result === 'win').map(row => row.qualityScore)),
    averageLossQuality: average(rated.filter(row => row.result === 'loss').map(row => row.qualityScore)),
    experimentalScore: rated.length ? 50 + 50 * totalQuality / (rated.length + priorGames) : null,
    ratedGames: rated.length,
    smallSample: rated.length > 0 && rated.length < priorGames,
  };
}

// Rank availability is measured before the Top 25 restriction. An uncovered
// opponent must never become evidence that no ranked opponent was played.
export function conferenceFilterCoverage(dataset, options = {}) {
  const conferences = options.conferenceA ? [options.conferenceA] : dataset.conferences.map(row => row.id);
  const byGame = new Map();
  for (const conferenceA of conferences) {
    for (const row of conferenceGames(dataset, { ...options, conferenceA, rankScope: 'all' })) {
      const coverage = byGame.get(row.id) ?? { current: false, pregame: false, statuses: new Set() };
      coverage.current ||= row.opponentRank.currentAvailable;
      coverage.pregame ||= row.opponentRank.pregameAvailable;
      coverage.statuses.add(row.opponentRank.pregameStatus);
      byGame.set(row.id, coverage);
    }
  }
  const games = [...byGame.values()];
  return {
    games: games.length,
    current: games.filter(row => row.current).length,
    pregame: games.filter(row => row.pregame).length,
    noPollYet: games.filter(row => !row.pregame && row.statuses.has('no-poll-yet')).length,
    beforeArchive: games.filter(row => !row.pregame && row.statuses.has('before-archive')).length,
    missing: games.filter(row => !row.pregame && row.statuses.has('missing')).length,
    publicationTimeUncertain: games.filter(row => !row.pregame && row.statuses.has('publication-time-uncertain')).length,
    notApplicable: games.filter(row => !row.pregame && row.statuses.has('not-applicable')).length,
  };
}

export function conferenceRecords(dataset) {
  const games = comparisonGames(dataset);
  const groups = new Map(dataset.conferences.map(({ id, group }) => [id, group]));
  const conferenceIds = [...groups.keys()];
  const conferenceRows = new Map(conferenceIds.map(id => [id, []]));
  const fcsRows = new Map(conferenceIds.map(id => [id, []]));
  const groupSixVsPowerFour = [];
  const groupFiveVsPowerFour = [];
  const vsIndependents = [];
  let powerFourVsPowerFour = 0;

  for (const game of games) {
    const home = gameSide(dataset, game, true);
    const away = gameSide(dataset, game, false);
    const homeGroup = groups.get(home.team.conference);
    const awayGroup = groups.get(away.team.conference);
    if (home.team.division === 'fbs' && away.team.division === 'fbs' &&
        homeGroup === 'power-four' && awayGroup === 'power-four') powerFourVsPowerFour++;
    for (const row of [home, away]) {
      const group = groups.get(row.team.conference);
      const opponentGroup = groups.get(row.opponent.conference);
      if (row.team.division !== 'fbs' || !group) continue;
      if (row.opponent.division === 'fcs') {
        fcsRows.get(row.team.conference).push(row);
        continue;
      }
      if (!opponentGroup) continue;
      conferenceRows.get(row.team.conference).push(row);
      if (group === 'group-of-six' && opponentGroup === 'power-four') groupSixVsPowerFour.push(row);
      if (group === 'group-of-five' && opponentGroup === 'power-four') groupFiveVsPowerFour.push(row);
      if (opponentGroup === 'independent') vsIndependents.push(row);
    }
  }

  return {
    summaries: Object.fromEntries(conferenceIds.map(id => {
      const rows = conferenceRows.get(id);
      return [id, {
        ...record(rows),
        powerFourGames: record(rows.filter(row => groups.get(row.opponent.conference) === 'power-four')),
        independentGames: record(rows.filter(row => groups.get(row.opponent.conference) === 'independent')),
      }];
    })),
    matrix: Object.fromEntries(conferenceIds.map(id => [id, Object.fromEntries(conferenceIds.map(opponent => [
      opponent, record(conferenceRows.get(id).filter(row => row.opponent.conference === opponent)),
    ]))])),
    groups: {
      powerFourVsPowerFour: { games: powerFourVsPowerFour },
      groupSixVsPowerFour: record(groupSixVsPowerFour),
      groupFiveVsPowerFour: record(groupFiveVsPowerFour),
      vsIndependents: record(vsIndependents),
    },
    fcs: Object.fromEntries(conferenceIds.map(id => [id, record(fcsRows.get(id))])),
  };
}
