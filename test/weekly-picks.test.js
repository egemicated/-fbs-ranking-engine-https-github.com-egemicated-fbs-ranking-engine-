import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeeklyPicks } from '../scripts/publish-weekly-picks.js';

const teams = ['home', 'away', 'other'].map(id => ({ id, name: id, division: 'fbs', conference: 'Example' }));
const config = { ridge: 3, retention: .75, marginCap: 28, homeAdvantage: 2.5, probabilityScale: 14 };
const kickoff = '2026-11-07T20:00:00Z';
const capture = '2026-11-01T15:00:00Z';
const later = '2026-11-08T15:00:00Z';
const previousWeek = { id: 'prior', week: 9, seasonType: 'regular', home: 'home', away: 'other',
  neutral: false, completed: true, homePoints: 24, awayPoints: 17, startDate: '2026-10-24T20:00:00Z' };
const game = { id: 'target', week: 10, seasonType: 'regular', home: 'home', away: 'away',
  neutral: false, completed: false, startDate: kickoff, startTimeTbd: false };
const season = (provider, time, games) => ({ year: 2026, teams, games,
  source: { provider, fetchedAt: time, sha256: 'a'.repeat(64) } });
const snapshot = (time, homeStrength) => ({ season: 2026, asOf: time, config,
  source: { provider: 'cfbd', fetchedAt: time, sha256: 'a'.repeat(64) }, snapshotHash: 'b'.repeat(64),
  rankings: teams.map(team => ({ ...team, strength: team.id === 'home' ? homeStrength : 0 })) });
const pickRow = report => report.games.find(row => row.id === game.id);

test('preview odds yield to Sunday picks and final scores preserve the original odds', () => {
  const archive = buildWeeklyPicks(season('sportsdataverse', capture, [previousWeek, game]), snapshot(capture, 5), { capturedAt: capture });
  assert.ok(pickRow(archive).estimate);
  assert.equal(pickRow(archive).pick, null);

  const saved = buildWeeklyPicks(season('cfbd', capture, [previousWeek, game]), snapshot(capture, -10),
    { capturedAt: capture, previous: archive });
  assert.equal(pickRow(saved).estimate, null);
  assert.equal(pickRow(saved).startTimeTbd, false);
  assert.equal(pickRow(saved).pick.favored, 'away');

  const final = { ...game, completed: true, homePoints: 31, awayPoints: 21 };
  const refreshed = buildWeeklyPicks(season('cfbd', later, [previousWeek, final]), snapshot(later, 25),
    { capturedAt: later, previous: saved });
  assert.equal(pickRow(refreshed).status, 'final');
  assert.equal(pickRow(refreshed).homePoints, 31);
  assert.deepEqual(pickRow(refreshed).pick, pickRow(saved).pick);
});

test('historical replay excludes current-week scores and stays outside the tracked record', () => {
  const prior = { season: 2025, snapshotHash: 'c'.repeat(64), ratings: snapshot(capture, 3).rankings };
  const run = (homePoints, awayPoints) => buildWeeklyPicks(season('sportsdataverse', later,
    [previousWeek, { ...game, completed: true, homePoints, awayPoints }]), snapshot(later, 25),
  { capturedAt: later, prior });
  const one = pickRow(run(51, 10)), two = pickRow(run(10, 51));
  assert.equal(one.pick, null);
  assert.ok(one.replay);
  assert.ok(Date.parse(one.replay.asOf) < Date.parse(kickoff));
  assert.deepEqual(one.replay, two.replay);
});
