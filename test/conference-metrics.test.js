import assert from 'node:assert/strict';
import test from 'node:test';
import {
  conferenceGames, conferenceRecords, conferenceSummary, conferenceFilterCoverage, CONFERENCE_QUALITY,
} from '../frontend/conference-metrics.js';

const season = 2026;
const kickoff = '2026-11-14T18:00:00.000Z';
const asOf = '2026-11-18T12:30:14.250Z';

function team(id, conference, data = {}) {
  return { id, name: id, conference, division: 'fbs', wins: 7, losses: 3, ties: 0,
    strength: 4, ranks: { sor: 16, predictive: 20, cfp: null, ap: null }, ...data };
}

function game(id, home, away, homePoints, awayPoints, data = {}) {
  return { id, home, away, homePoints, awayPoints, startDate: kickoff, neutral: false, ...data };
}

function fixture(games = []) {
  return {
    season, asOf, probabilityScale: 6, homeAdvantage: 2,
    conferences: [
      { id: 'SEC', name: 'SEC', group: 'power-four' },
      { id: 'Big Ten', name: 'Big Ten', group: 'power-four' },
      { id: 'ACC', name: 'ACC', group: 'power-four' },
      { id: 'American', name: 'American', group: 'group-of-six' },
      { id: 'FBS Independents', name: 'FBS Independents', group: 'independent' },
    ],
    rankings: {
      sor: { available: true, fullField: true },
      predictive: { available: true, fullField: true },
      cfp: { available: true, fullField: false },
      ap: { available: false, fullField: false },
    },
    teams: {
      a: team('a', 'SEC'),
      b: team('b', 'SEC'),
      c: team('c', 'Big Ten', { strength: 16, ranks: { sor: 6, predictive: 8, cfp: 14, ap: null } }),
      d: team('d', 'ACC', { strength: -14, wins: 2, losses: 8, ranks: { sor: 99, predictive: 100, cfp: null, ap: null } }),
      e: team('e', 'American'),
      i: team('i', 'FBS Independents'),
      f: team('f', 'FCS League', { division: 'fcs', strength: null, ranks: {} }),
    },
    games,
  };
}

test('matrix reconciles unique finals and reverses records, margins, and venue', () => {
  const results = [
    game('sec-win', 'a', 'c', 31, 17),
    game('sec-loss', 'c', 'b', 21, 17, { neutral: true }),
    game('tie', 'b', 'c', 14, 14),
  ];
  const data = fixture([
    ...results, { ...results[0] }, game('conference-game', 'a', 'b', 10, 7),
    game('next-week', 'a', 'c', 21, 14, { startDate: '2026-11-20T00:00:00Z' }),
    game('pending', 'a', 'c', null, null),
    game('in-progress', 'a', 'c', 14, 7, { status: 'in-progress' }),
    game('lower-subdivision', 'f', 'a', 7, 24),
    game('g6', 'e', 'b', 24, 17),
    game('independent', 'a', 'i', 17, 14),
  ]);
  const { matrix, summaries, groups, fcs } = conferenceRecords(data);
  assert.deepEqual(matrix.SEC['Big Ten'], { wins: 1, losses: 1, ties: 1, games: 3,
    winningPercentage: 0.5, averageVictoryMargin: 14, averageDefeatMargin: 4 });
  assert.deepEqual(matrix['Big Ten'].SEC, { wins: 1, losses: 1, ties: 1, games: 3,
    winningPercentage: 0.5, averageVictoryMargin: 4, averageDefeatMargin: 14 });
  assert.equal(summaries.SEC.games, Object.values(matrix.SEC).reduce((total, record) => total + record.games, 0));
  assert.equal(summaries.SEC.powerFourGames.games, 3);
  assert.equal(summaries.SEC.independentGames.wins, 1);
  assert.equal(fcs.SEC.wins, 1);
  assert.equal(groups.powerFourVsPowerFour.games, 3);
  assert.equal(groups.groupSixVsPowerFour.wins, 1);
  assert.equal(groups.vsIndependents.wins, 1);
  const sec = conferenceGames(data, { conferenceA: 'SEC', conferenceB: 'Big Ten' });
  const bigTen = conferenceGames(data, { conferenceA: 'Big Ten', conferenceB: 'SEC' });
  assert.deepEqual(sec.map(row => row.id), bigTen.map(row => row.id));
  assert.deepEqual(sec.map(row => row.result), ['loss', 'win', 'tie']);
  assert.deepEqual(bigTen.map(row => row.result), ['win', 'loss', 'tie']);
  assert.equal(sec.find(row => row.id === 'sec-win').venue, 'home');
  assert.equal(bigTen.find(row => row.id === 'sec-win').venue, 'away');
  assert.equal(sec.find(row => row.id === 'sec-loss').venue, 'neutral');
  assert.equal(conferenceGames(data, { conferenceA: 'SEC', opponents: 'fcs' })[0].qualityScore, null);
});

test('rank methods, cutoff and filters preserve genuinely unranked and missing ranks', () => {
  const data = fixture([
    game('later-ranked', 'a', 'c', 27, 10, { pregame: { cfp: [null, null], sor: [20, 9] },
      pregameAsOf: { cfp: '2026-11-10', sor: '2026-11-08T14:00:00Z' } }),
    game('earlier-ranked', 'd', 'b', 13, 21, { pregame: { cfp: [21, null] }, pregameAsOf: { cfp: '2026-11-10' } }),
    game('no-checkpoint', 'a', 'i', 10, 9),
  ]);
  const cfpRows = conferenceGames(data, { conferenceA: 'SEC', method: 'cfp' });
  const missing = cfpRows.find(row => row.id === 'no-checkpoint');
  const unranked = cfpRows.find(row => row.id === 'later-ranked');
  assert.equal(unranked.opponentRank.current, 14);
  assert.deepEqual(unranked.opponentRank, { current: 14, pregame: null, currentAvailable: true, pregameAvailable: true,
    pregameAsOf: '2026-11-10', pregameStatus: 'unranked' });
  assert.deepEqual(missing.opponentRank, { current: null, pregame: null, currentAvailable: true, pregameAvailable: false,
    pregameAsOf: null, pregameStatus: 'missing' });
  assert.deepEqual(conferenceGames(data, { conferenceA: 'SEC', method: 'cfp', rankScope: 'current' }).map(row => row.id), ['later-ranked']);
  assert.deepEqual(conferenceGames(data, { conferenceA: 'SEC', method: 'cfp', rankScope: 'pregame' }).map(row => row.id), ['earlier-ranked']);
  const cfp = conferenceSummary(data, 'SEC', cfpRows);
  const sor = conferenceSummary(data, 'SEC', conferenceGames(data, { conferenceA: 'SEC', method: 'sor' }));
  const ap = conferenceSummary(data, 'SEC', conferenceGames(data, { conferenceA: 'SEC', method: 'ap' }));
  assert.equal(cfp.currentTop10Wins, 0);
  assert.equal(sor.currentTop10Wins, 1);
  assert.equal(cfp.currentTop25Wins, 1);
  assert.equal(sor.currentTop25Wins, 2);
  assert.equal(cfp.pregameTop25Wins, 1);
  assert.equal(cfp.pregameRankCoverage, 2);
  assert.equal(cfp.averageOpponentRank, null);
  assert.equal(sor.averageOpponentRank, (6 + 99 + 16) / 3);
  assert.equal(cfp.predictiveTop25Wins, 2);
  assert.equal(cfp.winningRecordWins, 2);
  assert.equal(cfp.losingRecordWins, 1);
  assert.equal(cfp.experimentalScore, sor.experimentalScore);
  assert.equal(ap.currentTop25Wins, null);
  assert.equal(ap.pregameTop25Wins, null);
});

test('experimental score rewards harder wins, penalizes worse losses and caps margin', () => {
  const data = fixture([
    game('strong-win', 'a', 'c', 29, 28),
    game('weak-win', 'a', 'd', 28, 0),
    game('large-weak-win', 'a', 'd', 56, 0),
    game('close-strong-loss', 'b', 'c', 23, 24),
    game('close-weak-loss', 'b', 'd', 23, 24),
    game('large-weak-loss', 'b', 'd', 0, 56),
    game('road-strong-win', 'c', 'a', 28, 29),
  ]);
  const rows = conferenceGames(data, { conferenceA: 'SEC' });
  const score = Object.fromEntries(rows.map(row => [row.id, row.qualityScore]));
  const mean = (4 + 4 + 16 - 14 + 4 + 4) / 6;
  const probability = 1 / (1 + Math.exp(-(mean - 16 + 2) / 6));
  assert.ok(Math.abs(score['strong-win'] - (1 - probability) * (0.8 + 0.2 / 28)) < 1e-12);
  assert.ok(score['strong-win'] > score['weak-win']);
  assert.ok(score['road-strong-win'] > score['strong-win']);
  assert.equal(score['weak-win'], score['large-weak-win']);
  assert.ok(score['close-strong-loss'] > score['close-weak-loss']);
  assert.ok(score['close-weak-loss'] > score['large-weak-loss']);
  const summary = conferenceSummary(data, 'SEC', rows);
  const expected = 50 + 50 * Object.values(score).reduce((sum, value) => sum + value, 0) / (rows.length + CONFERENCE_QUALITY.priorGames);
  assert.ok(Math.abs(summary.experimentalScore - expected) < 1e-12);
  assert.equal(summary.smallSample, true);
});

test('missing opponent metrics are unavailable rather than zero', () => {
  const data = fixture([game('coverage', 'a', 'c', 28, 27)]);
  data.teams.c = team('c', 'Big Ten', { wins: null, losses: null, ties: null, strength: null, ranks: { sor: null } });
  const [row] = conferenceGames(data, { conferenceA: 'SEC' });
  assert.equal(row.opponentRank.currentAvailable, false);
  assert.equal(row.opponentRank.current, null);
  assert.equal(row.qualityScore, null);
  const summary = conferenceSummary(data, 'SEC');
  assert.equal(summary.wins, 1);
  assert.equal(summary.currentTop10Wins, null);
  assert.equal(summary.opponentWins, null);
  assert.equal(summary.averageOpponentRank, null);
  assert.equal(summary.averageOpponentPredictiveRating, null);
  assert.equal(summary.experimentalScore, null);
  assert.equal(summary.ratedGames, 0);
});

test('win record categories reconcile and pregame coverage precedes Top 25 filtering', () => {
  const data = fixture([
    game('winning', 'a', 'c', 28, 7, { pregame: { cfp: [null, null] } }),
    game('losing', 'a', 'd', 28, 7),
    game('even', 'a', 'e', 28, 7),
    game('unknown', 'a', 'i', 28, 7),
  ]);
  data.teams.e.wins = 5; data.teams.e.losses = 5;
  data.teams.i.wins = null;
  const options = { conferenceA: 'SEC', method: 'cfp' };
  const summary = conferenceSummary(data, 'SEC', conferenceGames(data, options));
  assert.deepEqual([summary.winningRecordWins, summary.losingRecordWins, summary.evenRecordWins,
    summary.missingRecordWins], [1, 1, 1, 1]);
  assert.equal(summary.wins, summary.winningRecordWins + summary.losingRecordWins +
    summary.evenRecordWins + summary.missingRecordWins);
  assert.deepEqual(conferenceFilterCoverage(data, options), { games: 4, current: 4, pregame: 1,
    noPollYet: 0, missing: 3, publicationTimeUncertain: 0, notApplicable: 0 });
  assert.equal(conferenceGames(data, { ...options, rankScope: 'pregame' }).length, 0);
});

test('poll coverage deduplicates both conference perspectives and separates nonexistent, missing, and uncertain editions', () => {
  const data = fixture([
    game('not-yet', 'a', 'c', 28, 7, { pregameStatus: { cfp: ['no-poll-yet', 'no-poll-yet'] } }),
    game('uncertain', 'a', 'd', 28, 7, { pregameStatus: { cfp: ['publication-time-uncertain', 'publication-time-uncertain'] } }),
    game('missing', 'a', 'e', 28, 7),
    game('available', 'a', 'i', 28, 7, { pregame: { cfp: [1, null] }, pregameStatus: { cfp: ['ranked', 'unranked'] } }),
  ]);
  const coverage = conferenceFilterCoverage(data, { method: 'cfp' });
  assert.deepEqual(coverage, { games: 4, current: 4, pregame: 1, noPollYet: 1, missing: 1,
    publicationTimeUncertain: 1, notApplicable: 0 });
});
