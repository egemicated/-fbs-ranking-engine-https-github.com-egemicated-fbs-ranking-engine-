import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basketballPlayerStats } from '../basketball/player-stats.js';
import { basketballTeamStats } from '../basketball/team-stats.js';
import { planBasketballSeason } from '../basketball/data-refresh.js';

const source = { asOf: '2026-11-21T12:00:00.000Z' };
const teamA = { id: 'ncaam-d1:1', providerId: 1 };
const teamB = { id: 'ncaam-d1:2', providerId: 2 };
const boxA = { fieldGoalsMade: 25, fieldGoalsAttempted: 60, threePointsMade: 8, threePointsAttempted: 24,
  freeThrowsMade: 12, freeThrowsAttempted: 16, offensiveRebounds: 9, defensiveRebounds: 27,
  turnovers: 11, possessions: 70, fouls: 17 };
const boxB = { fieldGoalsMade: 24, fieldGoalsAttempted: 55, threePointsMade: 7, threePointsAttempted: 16,
  freeThrowsMade: 10, freeThrowsAttempted: 11, offensiveRebounds: 8, defensiveRebounds: 22, turnovers: 17 };
const first = {
  id: 'ncaam-d1:99', providerId: 99, home: teamA.id, away: teamB.id, startDate: '2026-11-12T00:00:00.000Z',
  completed: true, divisionOne: true, conferenceGame: true, homePoints: 70, awayPoints: 65,
  neutral: false, overtimeMinutes: 5, box: { home: boxA, away: boxB },
};
const future = { ...first, id: 'ncaam-d1:101', providerId: 101, completed: false, startDate: '2026-12-01T01:00:00.000Z' };
const nonDi = { ...first, id: 'ncaam-d1:100', providerId: 100, startDate: '2026-11-14T01:00:00.000Z',
  away: 'ncaam-d1:4', divisionOne: false, conferenceGame: false, neutral: true };
const player = {
  athleteId: 42, name: 'Fixture Player', position: 'G', minutes: 28, points: 20, assists: 3,
  rebounds: { total: 5 }, fieldGoals: { made: 5, attempted: 11 }, threePointFieldGoals: { made: 0, attempted: 0 },
  freeThrows: { made: 10, attempted: 10 },
};

function playerSide(game, teamId, opponentId, players) {
  return { gameId: game.providerId, startDate: game.startDate, season: 2027, teamId, opponentId,
    isHome: game.home === 'ncaam-d1:' + teamId, players };
}

test('player appearances are attributed by game and team and exclude future, DNP and invalid rows', () => {
  const validSide = playerSide(first, 1, 2, [player, { athleteId: 15, name: 'DNP', minutes: 0 }]);
  const otherSide = playerSide(first, 2, 1, [{ ...player, athleteId: 16 }]);
  const recentSide = playerSide(nonDi, 1, 4, [{ ...player, points: 12, assists: null }]);
  const invalid = { ...playerSide(nonDi, 2, 1, [{ ...player, athleteId: 17 }]), season: 2026 };
  const { playerStats, coverage } = basketballPlayerStats({ season: 2027, teams: [teamA, teamB],
    games: [first, nonDi, future], playerRows: [
      validSide, validSide, otherSide, invalid, recentSide, playerSide(future, 1, 2, [player]),
    ] });
  const [leader] = playerStats[teamA.id];
  assert.equal(playerStats[teamA.id].length, 1);
  assert.equal(leader.games, 2);
  assert.equal(leader.points, 16);
  assert.equal(leader.assists, null);
  assert.equal(leader.threePct, null);
  assert.equal(leader.threeMade, 0);
  assert.equal(leader.recent[0].gameId, nonDi.id);
  assert.equal(coverage.divisionOneFinalsWithBothPlayerBoxes, 1);
  assert.equal(coverage.rejectedPlayerBoxSides, 1);
});

test('team stats keep venue splits and use paired D-I box coverage for rate calculations', () => {
  const stats = basketballTeamStats({ games: [first, nonDi, future], source }, teamA.id,
    { adjustedOffense: 112, adjustedDefense: 99, opponentColley: 0.54 });
  assert.deepEqual(stats.record.overall, { wins: 2, losses: 0 });
  assert.deepEqual(stats.record.conference, { wins: 1, losses: 0 });
  assert.equal(stats.record.venue.home.wins, 1);
  assert.equal(stats.record.venue.neutral.wins, 1);
  assert.equal(stats.scoring.margin, 10);
  assert.equal(stats.divisionOne.boxGames, 1);
  assert.equal(stats.divisionOne.team.ratios.defensiveReboundPct.value, 27 / 35);
  assert.equal(stats.divisionOne.team.ratios.effectiveFieldGoalPct.value, 29 / 60);
  assert.equal(stats.divisionOne.opponent.totals.fouls.total, null);
  assert.equal(stats.possessions.estimatedGames, 1);
  assert.equal(stats.tempo.value, stats.possessions.value * 40 / 45);
  assert.equal(stats.adjustedNet, 13);
});

test('rolling acquisitions retain a bounded window and plan a full first player pass', () => {
  const now = new Date(source.asOf);
  const base = { season: 2027, previous: { source: { ...source, fullSchedule: true }, games: [first, future, nonDi] },
    now, players: true, rolling: true };
  const plan = planBasketballSeason(base);
  assert.equal(plan.mode, 'rolling');
  assert.equal(plan.fetchTeams, false);
  assert.deepEqual(plan.schedule, [['2026-11-07T12:00:00.000Z', '2026-12-05T12:00:00.000Z']]);
  assert.equal(plan.playerSince, '2026-07-01T00:00:00.000Z');
  assert.equal(planBasketballSeason({ ...base, refreshTeams: true }).estimatedCalls, plan.estimatedCalls + 1);
  base.previous.source.playerAsOf = source.asOf;
  base.previous.source.playerWindowVersion = 1;
  assert.equal(planBasketballSeason(base).playerSince, plan.schedule[0][0]);
});
