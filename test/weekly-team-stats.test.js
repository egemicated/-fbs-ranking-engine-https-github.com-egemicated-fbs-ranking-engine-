import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeeklyTeamStats, renderWeeklyTeamStats } from '../frontend/weekly-team-stats.js';

const game = (id, week, home, away, startDate, fields = {}) => ({
  id, week, home, away, startDate, seasonType: 'regular', status: 'final', homePoints: 30, awayPoints: 10, ...fields,
});

test('team stats exclude later, same-week and unconfirmed scores from archived matchup cards', () => {
  const matchup = game('matchup', 2, 'a', 'b', '2026-09-05T22:00:00Z');
  const stats = buildWeeklyTeamStats({ schemaVersion: 1, season: 2026, asOf: '2026-09-13T17:00:00Z',
    teams: [{ id: 'a', division: 'fbs' }, { id: 'b', division: 'fbs' }, { id: 'c', division: 'fcs' }],
    games: [matchup, game('late', 1, 'a', 'c', '2026-09-06T19:00:00Z'),
      game('a-opener', 1, 'a', 'c', '2026-08-29T19:00:00Z'),
      game('b-opener', 1, 'c', 'b', '2026-08-29T21:00:00Z'),
      game('unconfirmed', 1, 'a', 'b', '2026-09-01T22:00:00Z', { status: 'pending' }),
      game('near-kickoff', 1, 'a', 'b', '2026-09-05T17:00:00Z')] });

  assert.deepEqual(stats.weeks['regular:2'].teams, {
    a: { wins: 1, losses: 0, ties: 0, games: 1, pointsFor: 30, pointsAgainst: 10 },
    b: { wins: 0, losses: 1, ties: 0, games: 1, pointsFor: 10, pointsAgainst: 30 },
  });
  assert.equal(stats.weeks['regular:2'].through, '2026-09-04T21:59:59.999Z');
  const markup = renderWeeklyTeamStats(stats, matchup, { awayName: 'Beta', homeName: '<Alpha>' });
  assert.match(markup, /Team stats entering Week 2/);
  assert.match(markup, /&lt;Alpha&gt;/);
  assert.match(markup, /Points scored per game<\/th><td>10\.0<\/td><td>30\.0<\/td>/);
  assert.match(markup, /Points allowed per game<\/th><td>30\.0<\/td><td>10\.0<\/td>/);
  assert.equal(renderWeeklyTeamStats(stats, { ...matchup, voidReason: 'Schedule changed' }, {}), '');
  assert.equal(renderWeeklyTeamStats(stats, { ...matchup, week: 1 }, {}), '');
});

test('future matchup stats stop at the dated source cutoff', () => {
  const stats = buildWeeklyTeamStats({ schemaVersion: 1, season: 2026, asOf: '2026-09-06T17:00:00Z',
    source: { scheduleAsOf: '2026-09-05T17:00:00Z' },
    teams: [{ id: 'a', division: 'fbs' }, { id: 'b', division: 'fbs' }],
    games: [game('opener', 1, 'a', 'b', '2026-08-29T19:00:00Z'),
      game('after-source', 2, 'a', 'b', '2026-09-05T22:00:00Z'),
      game('future', 3, 'a', 'b', '2026-09-12T22:00:00Z', { status: 'scheduled' })] });
  assert.equal(stats.weeks['regular:3'].through, '2026-09-05T17:00:00.000Z');
  assert.equal(stats.weeks['regular:3'].teams.a.games, 1);
});
