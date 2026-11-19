import test from 'node:test';
import assert from 'node:assert/strict';
import { crossFeatures, crossProbability, fitCross, crossMetrics, selectCrossFamily, pairedCrossInterval } from './cross-division-calibration.mjs';

const fixture = [
  { homeMargin: 14, fbsSign: 1, outcome: 1, group: '2021:regular:1' },
  { homeMargin: 7, fbsSign: 1, outcome: 0, group: '2021:regular:1' },
  { homeMargin: -14, fbsSign: -1, outcome: 0, group: '2021:regular:2' },
  { homeMargin: -7, fbsSign: -1, outcome: 1, group: '2021:regular:2' }
];
const swapped = row => ({ ...row, homeMargin: -row.homeMargin, fbsSign: -row.fbsSign, outcome: 1 - row.outcome });

test('all finite candidate families preserve side-swap probability complementarity', () => {
  const models = [{ family: 'baseline', coefficients: [] }, { family: 'temperature', coefficients: [2] },
    { family: 'divisionOffset', coefficients: [1.5] }, { family: 'temperatureDivision', coefficients: [0.7, 1.5] }];
  for (const row of fixture) for (const model of models) assert.ok(Math.abs(crossProbability(row, model) + crossProbability(swapped(row), model) - 1) < 1e-14);
});

test('fixed margin coefficient is retained only in divisionOffset and is not a fitted feature', () => {
  const row = fixture[0];
  assert.deepEqual(crossFeatures(row, 'divisionOffset'), [1]);
  assert.ok(Math.abs(crossProbability(row, { family: 'divisionOffset', coefficients: [0] }) - crossProbability(row, null)) < 1e-15);
  assert.throws(() => crossFeatures({ ...row, fbsSign: 0 }, 'divisionOffset'), /source-verified/);
});

test('positive temperature never changes winner, signed division offset can', () => {
  const row = { ...fixture[0], homeMargin: -2 };
  assert.ok(crossProbability(row, { family: 'temperature', coefficients: [3] }) < 0.5);
  assert.ok(crossProbability(row, { family: 'divisionOffset', coefficients: [1] }) > 0.5);
  assert.equal(crossMetrics([row], { family: 'divisionOffset', coefficients: [1] }).winnerChanges, 1);
});

test('FBS-oriented reliability and proper scores are invariant to side labels', () => {
  const model = { family: 'temperatureDivision', coefficients: [2, 1] };
  const a = crossMetrics(fixture, model), b = crossMetrics(fixture.map(swapped), model);
  for (const key of ['brier', 'logLoss', 'accuracy', 'fbsWinRate', 'meanFbsWinProbability', 'fbsProbabilityBias', 'calibrationError10Bins']) assert.ok(Math.abs(a[key] - b[key]) < 1e-14);
  assert.equal(a.reliability.reduce((sum, bin) => sum + bin.games, 0), fixture.length);
});

test('empty evidence remains null, and exactly tied probabilities receive half accuracy credit', () => {
  assert.equal(crossMetrics([]).brier, null);
  const row = { ...fixture[0], homeMargin: 0 }, metrics = crossMetrics([row]);
  assert.equal(metrics.accuracy, 0.5); assert.equal(metrics.correct, 0); assert.equal(metrics.incorrect, 0); assert.equal(metrics.probabilityTies, 1);
});

test('finite converged logistic fits and fixed-coefficient objective use only provided rows', () => {
  for (const family of ['temperature', 'divisionOffset', 'temperatureDivision']) {
    const model = fitCross(fixture, family);
    assert.ok(model.coefficients.every(Number.isFinite)); assert.ok(model.projectedGradient < 1e-6);
    assert.equal(model.trainingGames, fixture.length);
    const repeat = fitCross(fixture.map(swapped), family);
    model.coefficients.forEach((coefficient, i) => assert.ok(Math.abs(coefficient - repeat.coefficients[i]) < 1e-10));
  }
});

test('nonpositive fitted slope is rejected instead of projected into an undeclared candidate', () => {
  const contradictory = Array.from({ length: 10 }, (_, i) => ({ homeMargin: 10 + i, fbsSign: 1, outcome: 0, group: 'x' }));
  assert.throws(() => fitCross(contradictory, 'temperature'), /slope must be positive/);
});

test('family selection uses selection cohort only and favors unfitted baseline on ties', () => {
  const models = { baseline: { family: 'baseline', coefficients: [] }, temperature: { family: 'temperature', coefficients: [1] },
    divisionOffset: { family: 'divisionOffset', coefficients: [0] }, temperatureDivision: { family: 'temperatureDivision', coefficients: [1, 0] } };
  assert.equal(selectCrossFamily(fixture, models).selectedFamily, 'baseline');
  assert.deepEqual(Object.keys(selectCrossFamily(fixture, models).scores), Object.keys(models));
});

test('near-tie selection compares every family to the global minimum before complexity tie-break', () => {
  const row = { ...fixture[0], homeMargin: 0 };
  const models = { baseline: { family: 'baseline', coefficients: [] }, temperature: { family: 'temperature', coefficients: [1] },
    divisionOffset: { family: 'divisionOffset', coefficients: [1.5e-6] }, temperatureDivision: { family: 'temperatureDivision', coefficients: [1, 3e-6] } };
  assert.equal(selectCrossFamily([row], models, { tolerance: 1e-6 }).selectedFamily, 'divisionOffset');
});

test('paired week-block intervals are deterministic and identity comparison is exactly zero', () => {
  const a = pairedCrossInterval(fixture, null, { replicates: 100 }), b = pairedCrossInterval(fixture, null, { replicates: 100 });
  assert.deepEqual(a, b); assert.equal(a.blocks, 2);
  assert.deepEqual(a.candidateMinusBaseline, { brier: [0, 0], logLoss: [0, 0], accuracy: [0, 0] });
});
