import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeCrossShadow, observationHash } from './capture-cross-division-shadow.mjs';
import { evaluateCrossDivisionShadow, compareCrossShadowScores } from './evaluate-cross-division-shadow.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const captureTime = '2026-11-18T23:00:00.000Z', evaluatedAt = '2026-11-22T23:00:00.000Z';
function fixture({ final = true, margin = 12.5 } = {}) {
  const config = { homeAdvantage: 2.5, probabilityScale: 14 };
  const future = { id: 'g', home: 'a', away: 'b', neutral: false, startTimeTbd: false, startDate: '2026-11-21T18:00:00.000Z' };
  const snapshot = { season: 2026, config, modelVersion: 'test', snapshotHash: 'a'.repeat(64),
    source: { provider: 'cfbd', fetchedAt: '2026-11-18T12:00:00Z', sha256: 'b'.repeat(64), audit: { confirmedCanceledRecords: [] } },
    asOf: '2026-11-18T12:01:00Z', futureFixtures: [future],
    ratings: [{ id: 'a', name: 'A', division: 'fbs', strength: margin - 2.5 }, { id: 'b', name: 'B', division: 'fcs', strength: 0 }] };
  const weekly = { schemaVersion: 1, season: 2026, asOf: '2026-11-18T12:02:00Z',
    source: { snapshotHash: snapshot.snapshotHash, scheduleAsOf: snapshot.source.fetchedAt, rankingAsOf: snapshot.asOf,
      modelVersion: snapshot.modelVersion, crossDivisionProbabilityScale: 14 }, teams: structuredClone(snapshot.ratings),
    games: [{ ...future, status: 'scheduled', week: 12, seasonType: 'regular', homePoints: null, awayPoints: null,
      pick: { asOf: '2026-11-15T14:00:00Z', homeWinProbability: 0.51 } }] };
  const frozen = { id: 'cross-division-calibration-shadow-v1', frozenAt: '2026-11-18T22:00:00Z', horizonDays: 7,
    strengthConfig: config, modelVersion: 'test', model: { family: 'temperatureDivision', coefficients: [2, 1] } };
  const frozenSha256 = sha(JSON.stringify(frozen));
  const input = { snapshot, weekly, frozen, inputSha256: { snapshot: 'c'.repeat(64), weekly: 'd'.repeat(64), frozen: frozenSha256 } };
  const observation = makeCrossShadow(input, captureTime);
  if (final) {
    snapshot.source.fetchedAt = '2026-11-22T12:00:00Z'; snapshot.asOf = '2026-11-22T12:01:00Z'; weekly.asOf = '2026-11-22T12:02:00Z';
    weekly.source.scheduleAsOf = snapshot.source.fetchedAt; weekly.source.rankingAsOf = snapshot.asOf;
    weekly.games[0].status = 'final'; weekly.games[0].homePoints = 21; weekly.games[0].awayPoints = 7;
  }
  return { observations: [observation], snapshot, weekly, frozen, frozenSha256, evaluatedAt };
}
const rehash = observation => { observation.resultSha256 = observationHash(observation); return observation; };

test('new captures remain pending with null scores when the published source predates kickoff', () => {
  const input = fixture({ final: false }), before = JSON.stringify(input), report = evaluateCrossDivisionShadow(input);
  assert.equal(report.scores.games, 0); assert.equal(report.pending.length, 1); assert.equal(report.status, 'awaiting-first-scored-game');
  assert.equal(report.scores.baseline.accuracy, null); assert.equal(report.scores.candidate.brier, null); assert.equal(report.scores.candidateMinusBaseline.logLoss, null);
  assert.equal(JSON.stringify(input), before, 'No source, saved public pick or observation mutation');
});

test('only a confirmed decisive final grades the immutable same-checkpoint pair', () => {
  const input = fixture(), report = evaluateCrossDivisionShadow(input), pair = input.observations[0].forecasts[0];
  assert.equal(report.scores.games, 1); assert.equal(report.evaluated[0].outcome, 1);
  assert.equal(report.evaluated[0].baselineHomeProbability, pair.baselineHomeProbability);
  assert.notEqual(report.evaluated[0].baselineHomeProbability, input.weekly.games[0].pick.homeWinProbability);
  assert.ok(Math.abs(report.scores.baseline.brier - (pair.baselineHomeProbability - 1) ** 2) < 1e-15);
  assert.ok(Math.abs(report.scores.candidate.logLoss + Math.log(pair.candidateHomeProbability)) < 1e-15);
  assert.equal(report.evaluated[0].observationSha256, input.observations[0].resultSha256);
});

test('checksum, frozen manifest, coefficient identity and saved probability reconciliation fail closed', () => {
  for (const change of [
    o => { o.forecasts[0].homeTeam = 'Changed without checksum'; },
    o => { o.inputSha256.frozen = 'f'.repeat(64); rehash(o); },
    o => { o.model.coefficients[1] += 1; rehash(o); },
    o => { o.forecasts[0].candidateHomeProbability = 0.3; rehash(o); },
    o => { o.forecasts[0].baselineHomeProbability = 0.4; rehash(o); }
  ]) {
    const input = fixture(); change(input.observations[0]); assert.throws(() => evaluateCrossDivisionShadow(input));
  }
});

test('capture chronology rejects pre-freeze, post-kickoff, future and invalid-source captures', () => {
  for (const change of [
    o => { o.capturedAt = '2026-11-18T21:00:00Z'; },
    o => { o.capturedAt = o.forecasts[0].kickoff; },
    o => { o.capturedAt = '2026-11-23T00:00:00Z'; },
    o => { o.sourceAsOf = '2026-11-19T01:00:00Z'; }
  ]) {
    const input = fixture(); change(input.observations[0]); rehash(input.observations[0]); assert.throws(() => evaluateCrossDivisionShadow(input), /chronology|kickoff/);
  }
});

test('first valid capture wins regardless of input order, later probability or eventual winner', () => {
  const input = fixture(), later = structuredClone(input.observations[0]);
  later.capturedAt = '2026-11-19T01:00:00Z'; later.forecasts[0].homeMargin = 0;
  later.forecasts[0].baselineHomeProbability = 0.5; later.forecasts[0].candidateHomeProbability = 1 / (1 + Math.exp(-1)); rehash(later);
  input.observations.unshift(later);
  const report = evaluateCrossDivisionShadow(input);
  assert.equal(report.selectedForecasts, 1); assert.equal(report.duplicateCheckpoints, 1);
  assert.equal(report.evaluated[0].capturedAt, captureTime);
  assert.equal(report.evaluated[0].baselineHomeProbability, input.observations[1].forecasts[0].baselineHomeProbability);
});

test('conflicting forecasts at one capture timestamp are rejected, not selected by outcome', () => {
  const input = fixture(), duplicate = structuredClone(input.observations[0]);
  duplicate.forecasts[0].homeMargin = 0; duplicate.forecasts[0].baselineHomeProbability = 0.5;
  duplicate.forecasts[0].candidateHomeProbability = 1 / (1 + Math.exp(-1)); rehash(duplicate); input.observations.push(duplicate);
  assert.throws(() => evaluateCrossDivisionShadow(input), /Conflicting/);
});

test('corrected confirmed kickoff may grade only strictly after capture and within seven days', () => {
  const allowed = fixture(); allowed.weekly.games[0].startDate = '2026-11-21T20:00:00Z';
  const report = evaluateCrossDivisionShadow(allowed); assert.equal(report.scores.games, 1); assert.equal(report.evaluated[0].correctedKickoff, true);
  const earlier = fixture(); earlier.weekly.games[0].startDate = captureTime;
  assert.equal(evaluateCrossDivisionShadow(earlier).excluded[0].reason, 'corrected-kickoff-not-after-capture');
  const outside = fixture(); outside.weekly.games[0].startDate = '2026-11-26T23:00:00.001Z';
  assert.equal(evaluateCrossDivisionShadow(outside).excluded[0].reason, 'rescheduled-outside-seven-day-window');
});

test('unknown kickoff, missing fixture, postponed and unreported finals stay pending without imputed scores', () => {
  for (const [change, reason] of [
    [i => { i.weekly.games[0].startTimeTbd = true; }, 'current-kickoff-unconfirmed'],
    [i => { i.weekly.games = []; }, 'missing-from-current-result-source'],
    [i => { i.weekly.games[0].status = 'postponed'; }, 'postponed'],
    [i => { i.weekly.games[0].homePoints = null; }, 'final-scores-not-reported'],
    [i => { i.weekly.games[0].status = 'pending'; }, 'awaiting-confirmed-final']
  ]) {
    const input = fixture(); change(input); const report = evaluateCrossDivisionShadow(input);
    assert.equal(report.scores.games, 0); assert.equal(report.pending[0].reason, reason); assert.equal(report.scores.baseline.brier, null);
  }
});

test('changed participants, venue or explicit division cannot receive a result', () => {
  for (const change of [i => { i.weekly.games[0].away = 'c'; }, i => { i.weekly.games[0].neutral = true; },
    i => { i.snapshot.ratings[1].division = 'fbs'; i.weekly.teams[1].division = 'fbs'; }]) {
    const input = fixture(); change(input); const report = evaluateCrossDivisionShadow(input);
    assert.equal(report.scores.games, 0); assert.equal(report.excluded.length, 1);
  }
  const unknown = fixture(); unknown.snapshot.ratings[1].division = 'unknown';
  assert.equal(evaluateCrossDivisionShadow(unknown).pending[0].reason, 'current-subdivision-label-unavailable');
});

test('confirmed cancellations and tied final results are excluded instead of graded as losses', () => {
  const canceled = fixture(); canceled.snapshot.source.audit.confirmedCanceledRecords.push({ id: 'g' });
  assert.equal(evaluateCrossDivisionShadow(canceled).excluded[0].reason, 'confirmed-canceled');
  const tied = fixture(); tied.weekly.games[0].awayPoints = 21;
  assert.equal(evaluateCrossDivisionShadow(tied).excluded[0].reason, 'no-decisive-winner');
});

test('current result source must align with the published snapshot and be actually available', () => {
  const mismatch = fixture(); mismatch.weekly.source.snapshotHash = 'f'.repeat(64);
  assert.throws(() => evaluateCrossDivisionShadow(mismatch), /align/);
  const future = fixture(); future.weekly.asOf = '2026-11-23T00:00:00Z';
  assert.throws(() => evaluateCrossDivisionShadow(future), /chronology/);
  const impossible = fixture({ final: false }); impossible.weekly.games[0].status = 'final'; impossible.weekly.games[0].homePoints = 21; impossible.weekly.games[0].awayPoints = 7;
  assert.equal(evaluateCrossDivisionShadow(impossible).scores.games, 0);
});

test('exact 50 percent probabilities receive half accuracy credit and no fictitious decided winner', () => {
  const report = evaluateCrossDivisionShadow(fixture({ margin: 0 }));
  assert.equal(report.scores.baseline.probabilityTies, 1); assert.equal(report.scores.baseline.correct, 0);
  assert.equal(report.scores.baseline.incorrect, 0); assert.equal(report.scores.baseline.accuracy, 0.5);
  const candidateTie = evaluateCrossDivisionShadow(fixture({ margin: -7 }));
  assert.equal(candidateTie.scores.candidate.probabilityTies, 1); assert.equal(candidateTie.scores.candidate.accuracy, 0.5);
});

test('proper scoring is complementary and reliability remains FBS-oriented after a side swap', () => {
  const row = { outcome: 1, homeDivision: 'fbs', baselineHomeProbability: 0.8, candidateHomeProbability: 0.9 };
  const a = compareCrossShadowScores([row]), b = compareCrossShadowScores([{ outcome: 0, homeDivision: 'fcs', baselineHomeProbability: 0.2, candidateHomeProbability: 0.1 }]);
  for (const model of ['baseline', 'candidate']) for (const key of ['accuracy', 'brier', 'logLoss', 'meanFbsWinProbability', 'observedFbsWinRate']) assert.ok(Math.abs(a[model][key] - b[model][key]) < 1e-14);
});

test('malformed final scores fail instead of manufacturing zero scores', () => {
  for (const points of [-1, 1.5, '21', NaN]) { const input = fixture(); input.weekly.games[0].homePoints = points; assert.throws(() => evaluateCrossDivisionShadow(input), /Invalid final score/); }
});
