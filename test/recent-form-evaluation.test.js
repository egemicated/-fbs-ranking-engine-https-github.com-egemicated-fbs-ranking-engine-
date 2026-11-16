import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { recentFormObservationHash } from '../research/capture-recent-form-shadow.mjs';
import { evaluateRecentFormShadow } from '../research/evaluate-recent-form-shadow.mjs';

const protocol = {
  id: 'recent-form-shadow-v1', season: 2026, frozenAt: '2026-11-16T15:00:00.000Z', forecastHorizonDays: 7,
};
const protocolSha256 = createHash('sha256').update(JSON.stringify(protocol)).digest('hex');
const baselineTime = '2026-11-18T11:13:00.000Z';
const snapTime = '2026-11-18T11:12:00.000Z';
const kickoff = '2026-11-21T17:00:00.000Z';
const observedFinalsAt = '2026-11-22T07:08:00.000Z';

const pair = (gameId, changes = {}) => ({
  gameId, home: '252', away: '2305', neutral: false, seasonType: 'regular', week: 12, kickoff,
  baselineCapturedAt: baselineTime, baselineProbability: .6, challengerProbability: .3, ...changes,
});
const final = (id, changes = {}) => ({
  id, home: '252', away: '2305', neutral: false, seasonType: 'regular', week: 12,
  startDate: kickoff, startTimeTbd: false, completed: true, homePoints: 24, awayPoints: 10, ...changes,
});
const sign = input => ({ ...input, resultSha256: recentFormObservationHash(input) });
const observation = (rows, changes = {}) => sign({
  schemaVersion: 1, protocolId: protocol.id, protocolSha256, season: protocol.season,
  asOf: snapTime, sourceFetchedAt: '2026-11-18T11:11:00.000Z', weeklyPicksAsOf: baselineTime,
  snapshotHash: 'f'.repeat(64), sourceHash: 'e'.repeat(64), forecastCapturedAt: '2026-11-18T11:14:00.000Z',
  forecasts: rows, ...changes,
});
const fixture = (observations, games, changes = {}) => ({
  observations, protocol, asOf: observedFinalsAt, generatedAt: observedFinalsAt,
  season: { year: 2026, source: { provider: 'cfbd', sha256: 'd'.repeat(64), fetchedAt: observedFinalsAt },
    teams: [{ id: '252', division: 'fbs' }, { id: '2305', division: 'fbs' }], games },
  ...changes,
});

test('compares actual same-game winners, Brier score and log loss and handles 50% forecasts', () => {
  const saved = observation([pair('first'), pair('second', { baselineProbability: .5, challengerProbability: .8 })]);
  const report = evaluateRecentFormShadow(fixture([saved], [final('first'), final('second', { startDate: '2026-11-21T10:00:00-07:00' })]));
  assert.equal(report.status, 'collecting-evidence');
  assert.equal(report.scores.games, 2);
  assert.equal(report.scores.baseline.correct, 1);
  assert.equal(report.scores.baseline.even, 1);
  assert.equal(report.scores.baseline.accuracy, .75);
  assert.equal(report.scores.challenger.missed, 1);
  assert.equal(report.scores.changedFavorites, 2);
  assert.ok(Math.abs(report.scores.baseline.brier - .205) < 1e-12);
  assert.ok(Math.abs(report.scores.challenger.brier - .265) < 1e-12);
  assert.ok(Math.abs(report.scores.baseline.logLoss + (Math.log(.6) + Math.log(.5)) / 2) < 1e-12);
  assert.deepEqual(report.evaluated.map(row => [row.gameId, row.outcome]), [['first', 1], ['second', 1]]);
});

test('chooses the earliest capture before checking the corrected schedule', () => {
  const earlier = observation([pair('game')]);
  const later = observation([pair('game', { kickoff: '2026-11-21T18:00:00.000Z', challengerProbability: .8 })], {
    forecastCapturedAt: '2026-11-18T11:15:00.000Z',
  });
  const revised = final('game', { startDate: '2026-11-21T18:00:00.000Z' });
  for (const records of [[later, earlier], [earlier, later]]) {
    const report = evaluateRecentFormShadow(fixture(records, [revised]));
    assert.equal(report.duplicateCheckpoints, 1);
    assert.equal(report.evaluated.length, 0);
    assert.equal(report.excluded[0].reason, 'kickoff-changed');
    assert.equal(report.excluded[0].forecastKickoff, kickoff);
  }
});

test('an empty trial and new captures after the result cutoff are described as unscored', () => {
  const empty = evaluateRecentFormShadow(fixture([], []));
  assert.equal(empty.status, 'awaiting-first-scored-game');
  assert.equal(empty.selectedForecasts, 0);
  assert.equal(empty.scores.baseline.brier, null);
  assert.equal(empty.scores.challenger.accuracy, null);
  assert.equal(empty.scores.challengerMinusBaseline.logLoss, null);
  const input = fixture([observation([pair('game')])], [final('game', { completed: false })], { asOf: snapTime });
  input.season.source.fetchedAt = '2026-11-18T11:11:00.000Z';
  const fresh = evaluateRecentFormShadow(input);
  assert.equal(fresh.selectedForecasts, 1);
  assert.deepEqual(fresh.pending, [{ gameId: 'game', reason: 'awaiting-confirmed-final' }]);
  assert.equal(fresh.scores.games, 0);
});

test('missing, uncertain, changed, canceled and tied games are accounted for without scoring', () => {
  const gameIds = ['missing', 'unconfirmed', 'changed', 'canceled', 'tie'];
  const fixtures = [final('unconfirmed', { startTimeTbd: true }), final('changed', { neutral: true }),
    final('canceled', { completed: false }), final('tie', { awayPoints: 24 })];
  const input = fixture([observation(gameIds.map(gameId => pair(gameId)))], fixtures);
  input.season.source.audit = { confirmedCanceledRecords: [{ id: 'canceled' }] };
  const report = evaluateRecentFormShadow(input);
  assert.deepEqual(report.pending, [
    { gameId: 'missing', reason: 'missing-from-current-result-source' },
    { gameId: 'unconfirmed', reason: 'current-kickoff-unconfirmed' },
  ]);
  assert.deepEqual(report.excluded, [
    { gameId: 'canceled', reason: 'confirmed-canceled' },
    { gameId: 'changed', reason: 'matchup-or-competition-week-changed' },
    { gameId: 'tie', reason: 'no-decisive-winner' },
  ]);
  assert.equal(report.scores.games, 0);
});

test('rejects tampered, backdated, out-of-window and malformed evidence', () => {
  const bad = observation([pair('game')]);
  bad.forecasts[0].challengerProbability = .99;
  assert.throws(() => evaluateRecentFormShadow(fixture([bad], [final('game')])), /checksum/);
  const inputs = [
    [observation([pair('game')], { protocolSha256: '0'.repeat(64) }), /frozen protocol/],
    [observation([pair('game')], { sourceFetchedAt: '2026-11-15T17:00:00.000Z' }), /out of order/],
    [observation([pair('game', { baselineCapturedAt: snapTime })]), /baseline checkpoint/],
    [observation([pair('game')], { forecastCapturedAt: kickoff }), /pre-kickoff/],
    [observation([pair('game', { kickoff: '2026-11-26T17:00:00.000Z' })]), /pre-kickoff/],
    [observation([pair('game', { challengerProbability: 1.01 })]), /pre-kickoff/],
  ];
  for (const [row, expected] of inputs) {
    assert.throws(() => evaluateRecentFormShadow(fixture([row], [final('game')])), expected);
  }
  const good = observation([pair('game')]);
  assert.throws(() => evaluateRecentFormShadow(fixture([good], [final('game', { homePoints: -1 })])), /invalid completed scores/);
  assert.throws(() => evaluateRecentFormShadow(fixture([good], [final('game'), final('game')])), /Duplicate/);
});

test('conflicting pairs sharing a capture time fail regardless of order or an earlier pair', () => {
  const first = observation([pair('game')]);
  const timestamp = { forecastCapturedAt: '2026-11-18T11:15:00.000Z' };
  const later = observation([pair('game')], timestamp);
  const conflict = observation([pair('game', { challengerProbability: .9 })], timestamp);
  for (const records of [[first, later, conflict], [conflict, first, later]]) {
    assert.throws(() => evaluateRecentFormShadow(fixture(records, [final('game')])), /Conflicting/);
  }
});
