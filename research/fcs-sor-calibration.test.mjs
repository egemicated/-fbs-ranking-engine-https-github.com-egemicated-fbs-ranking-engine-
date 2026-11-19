import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { fitFcs, probability, scoreFcs, selectFcs, pairedBlocks, rankImpact } from './fcs-sor-calibration.mjs';
import { rankSeason } from '../src/engine.js';
import { publishFcsSnapshot } from '../src/fcs-publication.js';

const transfer = { slope: 5.159563190867806, homeLogOdds: .3809700209732449, divisionLogOdds: 2.401314541603099 };
const baseline = fitFcs([{ x: [0, 0, 0], y: 0 }], 'transferred', transfer);
const row = (x, y, extra = {}) => ({ x, y, group: 'FCS-FCS', block: '2021:regular:1', ...extra });
const synthetic = [row([.4, 1, 0], 1), row([.2, 1, 0], 1), row([.1, 0, 0], 0), row([-.3, 1, 0], 0),
  row([-.4, 0, 0], 0), row([.1, 1, 1], 1), row([-.2, 1, -1], 0), row([.4, 0, -1], 1)];

test('FCS slope/home candidate retains division coefficient exactly, including large fixed coefficient', () => {
  const fixed = { ...transfer, divisionLogOdds: 20 };
  const fitted = fitFcs(synthetic, 'fcsSlopeHome', fixed);
  assert.equal(fitted.coefficients[2], 20);
  assert.equal(fitted.fittedCoefficients, 2);
  assert.ok(fitted.maxGradient < 1e-6);
});

test('penalty applies to fitted dimensions, and all-dimension fit converges deterministically', () => {
  const fit = fitFcs(synthetic, 'fcsAll', transfer);
  const reversed = fitFcs([...synthetic].reverse(), 'fcsAll', transfer);
  fit.coefficients.forEach((value, i) => assert.ok(Math.abs(value - reversed.coefficients[i]) < 1e-8));
  for (let i = 0; i < 3; i++) {
    const gradient = synthetic.reduce((sum, item) => sum + item.x[i] * (probability(item, fit) - item.y), .01 * fit.coefficients[i]);
    assert.ok(Math.abs(gradient) < 1e-6);
  }
});

test('positive-slope validity rejects an inversely associated fitted mapping', () => {
  const inverse = [row([1, 0, 0], 0), row([-1, 0, 0], 1)];
  assert.throws(() => fitFcs(inverse, 'fcsAll', transfer), /Invalid or unconverged/);
});

test('swapping sides and venue complements probabilities without changing game losses', () => {
  const one = row([.3, 1, 1], 0, { group: 'FBS-FCS', homeDivision: 'fbs' });
  const swapped = { ...one, x: one.x.map(value => -value), y: 1 - one.y, homeDivision: 'fcs' };
  assert.ok(Math.abs(probability(one, baseline) + probability(swapped, baseline) - 1) < 1e-14);
  const a = scoreFcs([one], baseline), b = scoreFcs([swapped], baseline);
  for (const key of ['brier', 'logLoss', 'accuracy', 'meanProbability', 'observedWinRate']) assert.ok(Math.abs(a[key] - b[key]) < 1e-12);
});

test('exact 50 percent gets half accuracy credit and unsupported slices remain missing', () => {
  assert.equal(scoreFcs([row([0, 0, 0], 0)], baseline).accuracy, .5);
  const empty = scoreFcs([], baseline);
  assert.equal(empty.games, 0); assert.equal(empty.brier, null); assert.equal(empty.accuracy, null);
});

test('selection uses supplied selection rows and favors the simpler family within tolerance', () => {
  const a = { family: 'transferred', coefficients: [2, 0, 0], fittedCoefficients: 0 };
  const b = { family: 'fcsAll', coefficients: [2 + 1e-10, 0, 0], fittedCoefficients: 3 };
  assert.equal(selectFcs([row([.1, 0, 0], 1)], [b, a]), 'transferred');
  assert.throws(() => selectFcs([], [a, b]));
});

test('paired week resampling is deterministic and identical candidates have exactly zero deltas', () => {
  const input = synthetic.map((r, i) => ({ ...r, block: `2021:regular:${i % 3}` }));
  const first = pairedBlocks(input, baseline, baseline, 200, 20261118);
  assert.deepEqual(first, pairedBlocks(input, baseline, baseline, 200, 20261118));
  assert.equal(first.blocks, 3);
  for (const bounds of Object.values(first.intervals)) assert.deepEqual(bounds, [0, 0]);
});

test('FCS rank comparison reproduces production scope and excludes lower-division scored games', () => {
  const teams = [{ id: 'a', name: 'A', division: 'fbs', conference: 'A' }, { id: 'b', name: 'B', division: 'fcs', conference: 'B' },
    { id: 'c', name: 'C', division: 'fcs', conference: 'B' }, { id: 'd', name: 'D', division: 'd2', conference: 'D' }];
  const game = (id, home, away, homePoints, awayPoints) => ({ id, home, away, homePoints, awayPoints,
    completed: true, neutral: false, startDate: '2025-09-01T00:00:00Z', week: 1, seasonType: 'regular' });
  const snapshot = rankSeason({ year: 2025, teams, games: [game('one', 'a', 'b', 20, 10), game('two', 'b', 'c', 24, 7), game('three', 'c', 'd', 42, 0)] });
  const published = publishFcsSnapshot(snapshot, { parameters: transfer });
  const result = rankImpact(published, baseline.coefficients, transfer);
  assert.equal(result.maxScoreReproductionError, 0); assert.equal(result.teams, 2);
  assert.ok(result.rows.every(r => r.rankChange === 0 && r.baselineSor === r.candidateSor));
  const c = result.rows.find(r => r.id === 'c'); assert.equal(c.record, '1-1'); assert.equal(c.scoredRecord, '0-1'); assert.equal(c.excludedGames, 1);
});

test('verified source fixture has unique known-division games and preweek buffers', async () => {
  const fixture = JSON.parse(gunzipSync(await readFile(new URL('results/division-calibration-v1/fcs-features.json.gz', import.meta.url))));
  for (const [context, rows] of Object.entries(fixture.contexts)) {
    assert.equal(rows.length, new Set(rows.map(r => `${r.season}:${r.gameId}`)).size);
    assert.ok(rows.every(r => ['fbs', 'fcs'].includes(r.homeDivision) && ['fbs', 'fcs'].includes(r.awayDivision) && [r.homeDivision, r.awayDivision].includes('fcs')));
    if (context === 'prior-week-only') assert.ok(rows.every(r => Date.parse(r.cutoff) <= Date.parse(r.startDate) &&
      (!r.latestTrainingKickoff || Date.parse(r.latestTrainingKickoff) + 86400000 <= Date.parse(r.cutoff))));
  }
});
