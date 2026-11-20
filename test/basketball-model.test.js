import test from 'node:test';
import assert from 'node:assert/strict';
import { basketballPossessions, buildBasketballSnapshot, poissonBinomialWinTail } from '../basketball/model-engine.js';
import { BASKETBALL_MODEL_VERSION, PREVIEW_MODEL, predictBasketball } from '../basketball/model-forecast.js';
import { basketballPredictionMetrics, basketballReplayFeatures } from '../basketball/model-validation.js';
import { captureBasketballForecasts, reportBasketballForecasts } from '../basketball/model-ledger.js';
import modelSettings from '../basketball/model-settings.json' with { type: 'json' };
import validation from '../reports/full-court-basketball-validation.json' with { type: 'json' };

const competition = 'ncaam-d1';
const at = day => new Date(Date.UTC(2026, 10, day, 17)).toISOString();
const teams = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, name: id.toUpperCase(), conference: 'Test' }));
const box = { home: { possessions: 69 }, away: { possessions: 71 } };
const dataset = games => ({ competition, season: 2027, source: { asOf: at(10), sha256: 'source-fixture' }, teams, games });
const final = (id, home, away, when, { neutral = false, homePoints = 74, awayPoints = 68, ...rest } = {}) => ({
  id, home, away, startDate: at(when), completed: true, divisionOne: true, startTimeTbd: false, status: 'final',
  neutral, homePoints, awayPoints, ...rest,
});

test('Poisson-binomial tails are exact on small cases and stable for long undefeated records', () => {
  assert.ok(Math.abs(poissonBinomialWinTail([0.2, 0.7], 1) - 0.76) < 1e-15);
  assert.ok(Math.abs(poissonBinomialWinTail([0.2, 0.7], 2) - 0.14) < 1e-15);
  assert.equal(poissonBinomialWinTail([0.2, 0.7], 0), 1);
  assert.equal(poissonBinomialWinTail([0.2, 0.7], 3), 0);
  assert.ok(Math.abs(poissonBinomialWinTail(Array(40).fill(0.2), 40) - 0.2 ** 40) < 1e-40);
  assert.throws(() => poissonBinomialWinTail([NaN], 1));
});

test('SOR ignores margin and non-D-I games; equivalent résumés share ranks', () => {
  const games = [
    final('1', 'a', 'c', 1, { neutral: true, homePoints: 70, awayPoints: 69 }),
    final('2', 'b', 'd', 1, { neutral: true, homePoints: 91, awayPoints: 55 }),
    final('3', 'a', 'outside', 3, { divisionOne: false, homePoints: 69, awayPoints: 72 }),
  ];
  const snapshot = buildBasketballSnapshot(dataset(games));
  const [a, b, c, , e] = snapshot.teams;
  assert.equal(a.diWins, b.diWins);
  assert.equal(a.losses, 1);
  assert.equal(a.nonDiLosses, 1);
  assert.equal(a.sorRank, b.sorRank);
  assert.equal(a.sorScore, b.sorScore);
  assert.equal(a.schedule[0].opponentRating, 0.5);
  assert.equal(c.sorScore, 0);
  assert.ok(b.marginRating > a.marginRating);
  assert.equal(a.provisional, true);
  assert.equal(e.sorRank, null);
});

test('road wins earn more SOR than symmetric home wins and snapshot hash is deterministic', () => {
  const games = [final('1', 'a', 'c', 1), final('2', 'd', 'b', 1, { homePoints: 69, awayPoints: 70 })];
  const first = buildBasketballSnapshot(dataset(games));
  const shuffled = { ...dataset([...games].reverse()), teams: [...teams].reverse() };
  const second = buildBasketballSnapshot(shuffled);
  assert.deepEqual(second, first);
  const [a, b] = first.teams;
  assert.ok(b.sorScore > a.sorScore);
  assert.equal(first.gamesUsed, 2);
  assert.ok(a.schedule[0].referenceWinProbability > b.schedule[0].referenceWinProbability);
});

test('every leave-one-out difficulty agrees with solving the actual reduced Colley graph', () => {
  const games = [
    final('1', 'a', 'b', 1), final('2', 'b', 'c', 2), final('3', 'c', 'a', 3),
    final('4', 'a', 'b', 4, { homePoints: 62, awayPoints: 71 }), final('5', 'c', 'd', 5),
  ];
  const full = buildBasketballSnapshot(dataset(games));
  for (const game of games) {
    const reduced = buildBasketballSnapshot(dataset(games.filter(row => row.id !== game.id)));
    for (const [id, opponent] of [[game.home, game.away], [game.away, game.home]]) {
      const computed = full.teams.find(team => team.id === id).schedule.find(schedule => schedule.gameId === game.id);
      const expected = reduced.teams.find(team => team.id === opponent).colley;
      assert.ok(Math.abs(computed.opponentRating - expected) < 1e-12);
    }
  }
});

test('possession and tempo distinguish missing data and explicitly reported overtime', () => {
  assert.equal(basketballPossessions({ possessions: 72 }), 72);
  assert.equal(basketballPossessions({ fieldGoalsAttempted: 60, offensiveRebounds: 8, turnovers: 9, freeThrowsAttempted: 20 }), 70.5);
  assert.equal(basketballPossessions({ fieldGoalsAttempted: 60, offensiveRebounds: null, turnovers: 9, freeThrowsAttempted: 20 }), null);
  const games = [final('1', 'a', 'c', 1, { box, overtimeMinutes: 5 }), final('2', 'a', 'c', 3, { box }),
    final('3', 'b', 'c', 4)];
  const [a, b] = buildBasketballSnapshot(dataset(games)).teams;
  assert.ok(Math.abs(a.tempo - (70 + 70 * 40 / 45) / 2) < 1e-12);
  assert.equal(a.boxGames, 2);
  assert.ok(Number.isFinite(a.performanceScore));
  assert.equal(b.performanceRank, null);
});

test('basketball matchup probabilities are complementary with swapped teams and venue', () => {
  const snapshot = buildBasketballSnapshot(dataset([final('1', 'a', 'b', 1)]), { config: PREVIEW_MODEL });
  const home = predictBasketball(snapshot, { home: 'a', away: 'b', venue: 'home' });
  const neutral = predictBasketball(snapshot, { home: 'a', away: 'b', venue: 'neutral' });
  const reversed = predictBasketball(snapshot, { home: 'b', away: 'a', venue: 'away' });
  assert.ok(home.homeWinProbability > neutral.homeWinProbability);
  assert.ok(Math.abs(home.homeWinProbability + reversed.homeWinProbability - 1) < 1e-15);
  assert.equal(home.homeMargin, -reversed.homeMargin);
  assert.equal(home.calibrated, false);
  assert.equal(home.projectedHomePoints, null);
  assert.throws(() => predictBasketball(snapshot, { home: 'a', away: 'a' }));
});

test('the default basketball model is the frozen historically selected model', () => {
  assert.equal(modelSettings.modelVersion, BASKETBALL_MODEL_VERSION);
  assert.equal(modelSettings.validationProtocol, validation.protocol);
  assert.deepEqual(modelSettings.modelConfig, validation.modelConfig);
  const snapshot = buildBasketballSnapshot(dataset([]));
  assert.deepEqual(snapshot.modelConfig, modelSettings.modelConfig);
  assert.equal(snapshot.modelConfig.calibrated, true);
});

test('retrospective replay excludes same-window and future results and unknown tipoffs from grading', () => {
  const initial = final('1', 'a', 'b', 1);
  const recent = final('2', 'a', 'c', 3);
  const candidate = final('3', 'c', 'b', 4);
  const parts = [initial, recent, candidate, final('tbd', 'd', 'a', 5, { startTimeTbd: true })];
  const actual = basketballReplayFeatures(dataset(parts));
  const inverted = basketballReplayFeatures(dataset([initial, { ...recent, homePoints: 30 }, ...parts.slice(2)]));
  assert.equal(actual.length, 3);
  assert.deepEqual(actual[2].features, inverted[2].features);
  const withMeasuredAvailability = basketballReplayFeatures(dataset([
    initial, { ...recent, availableAt: '2026-11-03T19:00:00.000Z' }, candidate,
  ]));
  assert.notEqual(actual[2].features.margin, withMeasuredAvailability[2].features.margin);
  const pregame = buildBasketballSnapshot(dataset(parts), { retrospective: true, asOf: at(4) });
  assert.equal(pregame.gamesUsed, 2);
  const beforeIngestion = buildBasketballSnapshot(dataset(parts), { asOf: Date.parse(at(4)) - 1 });
  assert.equal(beforeIngestion.gamesUsed, 1);
});

test('forecast capture preserves originals and excludes tips corrected to before capture', () => {
  const archived = final('1', 'a', 'b', 1);
  const due = { id: '2', home: 'b', away: 'c', divisionOne: true, status: 'scheduled', startDate: at(11),
    startTimeTbd: false, completed: false, neutral: true };
  const schedule = dataset([archived, due, { ...due, id: 'tbd', startTimeTbd: true }, { ...due, id: 'soon', startDate: at(10) }]);
  const snapshot = buildBasketballSnapshot(schedule);
  const saved = captureBasketballForecasts(schedule, snapshot, [], at(10));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].gameId, due.id);
  assert.deepEqual(captureBasketballForecasts(schedule, snapshot, saved, Date.parse(at(10)) + 5000), saved);
  const result = { ...due, startDate: at(9), completed: true, homePoints: 70, awayPoints: 60, status: 'final' };
  assert.equal(reportBasketballForecasts(dataset([archived, result]), saved).excluded, 1);
  const report = reportBasketballForecasts(dataset([archived, { ...result, startDate: due.startDate }]), saved);
  assert.equal(report.graded, 1);
  assert.equal(report.missing, 1);
  assert.ok(Number.isFinite(report.brier));
  assert.equal(reportBasketballForecasts(schedule, []).accuracy, null);
});

test('holdout metrics use ties, log loss, slices, and calibration without synthetic live evidence', () => {
  const row = { actualMargin: 7, won: 1, features: { venue: 1, hasBox: true }, site: 'home court',
    datePhase: 'early-season', scheduleQuality: 'similar records', conferenceGame: false, tournament: false, season: 2025 };
  const stats = basketballPredictionMetrics([row], {}, { venue: 2 });
  assert.equal(stats.accuracy, 0.5);
  assert.equal(stats.brier, 0.25);
  assert.equal(stats.logLoss, Math.log(2));
  assert.equal(stats.marginMae, 5);
  assert.equal(stats.confidence[0].games, 1);
  assert.equal(stats.slices['home court'].games, 1);
});
