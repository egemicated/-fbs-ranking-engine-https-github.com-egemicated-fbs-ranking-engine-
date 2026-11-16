import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecentFormForecasts, RECENT_FORM_SHADOW_MODEL } from '../research/lib/recent-form-shadow.mjs';
import { buildWeeklySnapshot } from '../src/weekly.js';
import { strengthWinProbability } from '../src/site-validation.js';

const day = 86_400_000;
const config = { ridge: 3, retention: 0.75, homeAdvantage: 2.5, marginCap: 28, probabilityScale: 14 };
const scale = 6.147406563247917;
const cutoff = '2026-10-08T04:00:00.000Z';
const previous = { season: 2025, snapshotHash: 'previous-strength', ratings: [{ id: 'a', strength: 8 }, { id: 'b', strength: 4 }] };
const teams = [
  { id: 'a', name: 'A', division: 'fbs' },
  { id: 'b', name: 'B', division: 'fbs' },
  { id: 'c', name: 'C', division: 'fcs' },
];
const game = (id, week, startDate, fields) => ({ id, week, startDate, startTimeTbd: false, seasonType: 'regular',
  home: 'a', away: 'b', neutral: false, completed: false, ...fields });
const first = game('101', 1, '2026-09-01T00:00:00.000Z', { completed: true, homePoints: 35, awayPoints: 14 });
const second = game('102', 6, '2026-10-08T02:00:00.000Z', {
  completed: true, homePoints: 17, awayPoints: 20, regulationMargin: 0,
});
const target = game('103', 6, '2026-10-10T02:00:00.000Z', {});
const sample = { year: 2026, teams, games: [first, second, target], source: { provider: 'cfbd' } };

function replay(season = sample, targets = [target]) {
  return buildRecentFormForecasts({ season, previous, config, scale, cutoff, targets });
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-11, `expected ${expected}, received ${actual}`);
}

test('recent and production predictions match analytic weighted margins at the same live cutoff', () => {
  const result = replay().get(target.id);
  const snapshot = buildWeeklySnapshot(sample, previous, config, new Date(cutoff));
  const [home, away] = snapshot.ratings.filter(row => row.id === 'a' || row.id === 'b');
  assert.equal(result.baselineSnapshotHash, snapshot.snapshotHash);
  assert.equal(result.gamesUsed, 2); // The second game was confirmed 2 hours before capture.
  assert.equal(result.baselineProbability, strengthWinProbability(home.strength, away.strength, config.homeAdvantage, scale));
  assert.equal(result.baselineMargin, home.strength - away.strength + config.homeAdvantage);

  const { graphHalfLifeDays, residualHalfLifeDays, residualPriorGames, graphCoefficient, residualCoefficient } = RECENT_FORM_SHADOW_MODEL;
  const age = Math.max(0, (Date.parse(cutoff) - Date.parse(first.startDate)) / day - 1);
  const oldGraphWeight = 2 ** (-age / graphHalfLifeDays);
  const oldResidualWeight = 2 ** (-age / residualHalfLifeDays);
  const boundedFirst = 28 * Math.tanh(21 / 28);
  const boundedSecond = 28 * Math.tanh(-1 / 28); // The three-point OT margin contributes a one-point signal.
  const priorGap = 3;
  const normalized = 2 / (oldGraphWeight + 1);
  const expectedRecentGap = (3 * priorGap + 2 * normalized *
    (oldGraphWeight * (boundedFirst - 2.5) + boundedSecond - 2.5)) / 7;
  const firstExpectation = priorGap + 2.5;
  const secondExpectation = (3 * priorGap + 2 * (boundedFirst - 2.5)) / 5 + 2.5;
  const expectedResidualGap = 2 * ((boundedFirst - firstExpectation) * oldResidualWeight + boundedSecond - secondExpectation) /
    (oldResidualWeight + 1 + residualPriorGames);
  close(result.recentMargin, expectedRecentGap + 2.5);
  close(result.residualMargin, expectedResidualGap);
  const logit = result.baselineMargin / scale + graphCoefficient * (result.recentMargin - result.baselineMargin) / scale +
    residualCoefficient * result.residualMargin / scale;
  close(result.challengerProbability, 1 / (1 + Math.exp(-logit)));
  assert.deepEqual(Object.keys(result).sort(), ['baselineMargin', 'baselineProbability', 'baselineSnapshotHash',
    'challengerProbability', 'gamesUsed', 'recentMargin', 'residualMargin']);
});

test('future finals and pending data do not enter either forecast at capture', () => {
  const expected = replay();
  const reportedLater = game('301', 7, '2026-10-11T02:00:00.000Z', { completed: true, homePoints: 66, awayPoints: 7 });
  const pending = game('302', 5, '2026-10-01T02:00:00.000Z', { homePoints: 99, awayPoints: 0 });
  const opened = { ...sample, games: [...sample.games, reportedLater, pending] };
  assert.deepEqual(replay(opened), expected);
  assert.equal(replay(opened, [reportedLater]).size, 0);
});

test('only correctly identified upcoming FBS games with confirmed kickoffs receive a forecast', () => {
  const fcs = game('201', 6, target.startDate, { away: 'c' });
  const season = { ...sample, games: [...sample.games, fcs] };
  assert.equal(replay(season, [fcs, { ...target, startTimeTbd: true }, { ...target, startDate: cutoff }]).size, 0);
  assert.throws(() => replay(season, [{ ...target, home: target.away, away: target.home }]), /normalized matchup/);
  assert.throws(() => replay(season, [target, target]), /Duplicate recent form target/);
  assert.equal(replay(season, [{ ...target, startDate: '2026-10-11T02:00:00.000Z' }]).size, 1);
});

test('neutral openers have the same preseason forecast before any completed games', () => {
  const opener = { ...target, neutral: true };
  const season = { ...sample, games: [opener] };
  const forecast = replay(season, [opener]).get(opener.id);
  close(forecast.baselineMargin, (8 - 4) * 0.75);
  close(forecast.recentMargin, forecast.baselineMargin);
  assert.equal(forecast.residualMargin, 0);
  close(forecast.challengerProbability, forecast.baselineProbability);
});
