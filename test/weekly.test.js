import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklySnapshot, UPDATE_SCHEDULE } from '../src/weekly.js';
import { rankSeason } from '../src/engine.js';

const teams = ['a', 'b'].map(id => ({ id, name: id, division: 'fbs', conference: 'X' }));
const config = { ridge: 3, retention: 0.75 };
const prior = rankSeason({ year: 2025, teams, games: [] });
const game = { id: '1', home: 'a', away: 'b', homePoints: 21, awayPoints: 7, completed: true, neutral: true, seasonType: 'regular', week: 10, startDate: '2026-11-08T06:00:00Z' };
const season = { year: 2026, teams, games: [game], source: { provider: 'cfbd' } };

test('Sunday update counts confirmed late Saturday finals without the historical day buffer', () => {
  const snapshot = buildWeeklySnapshot(season, prior, config, new Date('2026-11-08T15:00:00Z'));
  assert.equal(snapshot.gamesUsed, 1);
  assert.equal(snapshot.rankings[0].wins, 1);
  assert.equal(snapshot.update.apiCallsThisUpdate, 2);
});
test('weekly snapshot excludes games in progress and future kickoff results', () => {
  const snapshot = buildWeeklySnapshot({ ...season, games: [game, { ...game, id: '2', completed: false }, { ...game, id: '3', startDate: '2026-11-09T06:00:00Z' }] }, prior, config, new Date('2026-11-08T15:00:00Z'));
  assert.equal(snapshot.gamesUsed, 1);
});
test('schedule means 12:01 AM Mountain in both daylight and standard time', () => {
  const localTime = new Intl.DateTimeFormat('en-US', { timeZone: UPDATE_SCHEDULE.timeZone, weekday: 'long',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  assert.equal(localTime.format(new Date('2026-10-25T06:01:00Z')), 'Sunday 00:01');
  assert.equal(localTime.format(new Date('2026-11-08T07:01:00Z')), 'Sunday 00:01');
  assert.equal(UPDATE_SCHEDULE.cron, '1 0 * * 0');
});
test('each achievement explanation exactly reconciles to its calculated score', () => {
  const snapshot = buildWeeklySnapshot(season, prior, config, new Date('2026-11-08T15:00:00Z'));
  for (const t of snapshot.rankings) {
    const x = t.explanation;
    assert.ok(Math.abs(x.baseline + x.record + x.opponents - t.achievement) < 1e-9);
    assert.ok(Math.abs(x.baseline + t.contributions.reduce((sum, g) => sum + g.achievementContribution, 0) - t.achievement) < 1e-9);
    assert.ok(t.contributions[0].opponentName);
  }
});
test('weekly updates reject a wrong prior season and an empty result feed', () => {
  assert.throws(() => buildWeeklySnapshot(season, { ...prior, season: 2024 }, config), /previous-season/);
  assert.throws(() => buildWeeklySnapshot({ ...season, games: [] }, prior, config), /no completed/);
});
