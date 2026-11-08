import assert from 'node:assert/strict';
import test from 'node:test';
import { weeklyPicksScore } from '../frontend/weekly-picks-score.js';

const asOf = '2026-11-08T15:00:00Z';
const teams = [{ id: 'home', division: 'fbs' }, { id: 'away', division: 'fbs' }, { id: 'fcs', division: 'fcs' }];
const capturedAt = '2026-10-30T16:00:00Z';
const pick = (homeWinProbability = 0.75, favored = 'home') => ({ capturedAt, homeWinProbability, favored });
const replay = (homeWinProbability = 0.75, favored = 'home') => ({ asOf: capturedAt, homeWinProbability, favored });
const game = (id, fields = {}) => ({ id, home: 'home', away: 'away', seasonType: 'regular', week: 10,
  startDate: '2026-11-07T20:00:00Z', status: 'final', homePoints: 21, awayPoints: 14, pick: pick(), ...fields });
const score = (games, week = 'regular:10') => weeklyPicksScore({ asOf, teams, games }, week);

test('scores only valid saved picks, with different winner and probability denominators', () => {
  const result = score([
    game('right', { replay: replay(0.2, 'away') }),
    game('wrong', { homePoints: 7 }),
    game('even', { homePoints: 7, pick: pick(0.5, 'even') }),
    game('tie', { homePoints: 14 }),
    game('pending', { status: 'pending', homePoints: null, awayPoints: null }),
    game('late', { pick: { ...pick(), capturedAt: '2026-11-07T20:00:00Z' }, replay: replay() }),
    game('fcs', { away: 'fcs' }),
    game('replay', { pick: null, replay: replay(), homePoints: 7 }),
    game('estimate', { pick: null, estimate: replay() }),
    game('bad-favorite', { pick: pick(0.75, 'away') }),
    game('bad-probability', { pick: pick(1.01) }),
    game('future-capture', { startDate: '2026-11-10T20:00:00Z', status: 'scheduled', pick: { ...pick(), capturedAt: '2026-11-09T20:00:00Z' } }),
  ]);
  const saved = { availablePicks: 5, pendingPicks: 1, completedPicks: 3, decisivePicks: 2, correctPicks: 1,
    accuracy: 0.5, brier: (0.0625 + 0.5625 + 0.25) / 3 };
  assert.deepEqual(result.week, { key: 'regular:10', seasonType: 'regular', week: 10, ...saved });
  assert.deepEqual(result.season, saved);
  assert.equal(result.replay.week.completedPicks, 2);
  assert.equal(result.replay.week.correctPicks, 1);
  assert.equal(result.replay.week.brier, (0.0625 + 0.5625) / 2);
});

test('compares with the preceding listed group and keeps replay comparisons separate', () => {
  const last = game('last', { week: 1, seasonType: 'postseason' });
  const before = game('before', { week: 9, startDate: '2026-10-31T20:00:00Z', pick: null, replay: replay() });
  const earlier = game('earlier', { week: 7, startDate: '2026-10-30T20:00:00Z' });
  const onlyReplay = score([last, earlier, before], 'postseason:1');
  assert.equal(onlyReplay.previousWeek.key, 'regular:9');
  assert.equal(onlyReplay.comparison, null);
  assert.equal(onlyReplay.replay.comparison, null);
  assert.equal(onlyReplay.season.completedPicks, 2);

  const evenPrior = score([last, { ...before, pick: pick(0.5, 'even') }], 'postseason:1');
  assert.deepEqual(evenPrior.comparison, { accuracyDifference: null, brierDifference: 0.0625 - 0.25 });
  assert.equal(evenPrior.replay.previousWeek.availablePicks, 0);

  const replayOnly = score([before, { ...last, pick: null, replay: replay(), homePoints: 7 }], 'postseason:1');
  assert.equal(replayOnly.comparison, null);
  assert.deepEqual(replayOnly.replay.comparison, { accuracyDifference: -1, brierDifference: 0.5625 - 0.0625 });
});
