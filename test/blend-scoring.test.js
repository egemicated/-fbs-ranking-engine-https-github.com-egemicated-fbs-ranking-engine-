import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BLEND_MODELS, blendObservationHash, evaluateBlendForecasts } from '../research/evaluate_blend_forecasts.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const hash = letter => letter.repeat(64);
const indices = (sor, strength, performance) => ({ sor, strength, performance,
  triple: (sor + strength + performance) / 3,
  'sor+strength': (sor + strength) / 2, 'sor+performance': (sor + performance) / 2,
  'strength+performance': (strength + performance) / 2 });

function sign(observation) {
  observation.resultSha256 = blendObservationHash(observation);
  return observation;
}

function updateModels(observation) {
  for (const row of observation.rows) {
    row.componentRanks = Object.fromEntries(['sor', 'strength', 'performance'].map(family => {
      const greater = observation.rows.filter(other => other.indices[family] > row.indices[family] + 1e-10).length;
      const equal = observation.rows.filter(other => Math.abs(other.indices[family] - row.indices[family]) <= 1e-10).length;
      return [family, greater + (equal + 1) / 2];
    }));
  }
  const forecast = observation.forecasts[0];
  const home = observation.rows.find(row => row.id === forecast.home);
  const away = observation.rows.find(row => row.id === forecast.away);
  forecast.models = Object.fromEntries(BLEND_MODELS.map(family => {
    const difference = home.indices[family] - away.indices[family];
    return [family, { indexDifference: difference,
      homeWinProbability: 1 / (1 + Math.exp(-(2 * difference / 100 + .2 * Number(!forecast.neutral)))),
      pick: Math.abs(difference) <= 1e-10 ? 'tie' : difference > 0 ? 'home' : 'away' }];
  }));
  return sign(observation);
}

function fixture() {
  const implementationHashes = { 'scripts/record-blend-comparison.js': hash('b') };
  const protocol = { id: 'blend-v1', frozenAt: '2026-11-06T20:00:00.000Z', forecastHorizonDays: 7,
    implementationSha256: implementationHashes,
    calibration: { models: Object.fromEntries(BLEND_MODELS.map(family => [family, { coefficients: [2, .2] }])) } };
  const observation = {
    schemaVersion: 1, protocolId: protocol.id, protocolSha256: sha(JSON.stringify(protocol)), frozenAt: protocol.frozenAt,
    season: 2026, asOf: '2026-11-06T03:39:55.757Z', sourceFetchedAt: '2026-11-06T03:39:50.000Z',
    performanceGeneratedAt: '2026-11-06T03:40:00.000Z', performanceSourceFetchedAt: '2026-11-06T03:39:58.000Z', forecastCapturedAt: '2026-11-06T20:01:00.000Z',
    sourceHash: hash('a'), snapshotHash: hash('c'), performancePublicationHash: hash('d'),
    normalizedInputSha256: hash('e'), snapshotInputSha256: hash('f'), performanceInputSha256: hash('0'),
    implementationSha256: implementationHashes,
    rows: [{ id: '1', team: 'Home', games: 4, measuredGames: 4, indices: indices(100, 0, 50) },
      { id: '2', team: 'Away', games: 4, measuredGames: 4, indices: indices(0, 100, 50) }],
    forecasts: [{ season: 2026, gameId: 'game', home: '1', away: '2', kickoff: '2026-11-07T20:00:00.000Z', neutral: true,
      asOf: '2026-11-06T03:39:55.757Z', forecastCapturedAt: '2026-11-06T20:01:00.000Z',
      primaryEligible: true, homeGames: 4, awayGames: 4, homeMeasuredGames: 4, awayMeasuredGames: 4 }],
    forecastSelection: { forecastHorizonDays: 7 }, recordedAt: '2026-11-06T20:01:00.000Z', runtime: process.version,
  };
  updateModels(observation);
  const season = { year: 2026, source: { sha256: hash('1') },
    teams: [{ id: '1', division: 'fbs' }, { id: '2', division: 'fbs' }],
    games: [{ id: 'game', home: '1', away: '2', neutral: true, startDate: '2026-11-07T20:00:00.000Z',
      completed: true, homePoints: 24, awayPoints: 17, seasonType: 'regular', week: 11 }] };
  return { observations: [observation], season, asOf: '2026-11-08T20:00:00.000Z',
    generatedAt: '2026-11-08T20:00:00.000Z', protocol, implementationHashes };
}

test('scores the same future outcome for all seven models with half credit for ranking ties', () => {
  const result = evaluateBlendForecasts(fixture());
  assert.equal(result.evaluated.length, 1);
  assert.equal(result.scores.primary.games, 1);
  assert.equal(result.scores.primary.models.sor.accuracy, 1);
  assert.equal(result.scores.primary.models.strength.accuracy, 0);
  assert.equal(result.scores.primary.models.triple.accuracy, .5);
  assert.equal(result.scores.primary.models.triple.rankingTies, 1);
  assert.equal(result.scores.primary.models.triple.brier, .25);
  assert.equal(result.scores.primary.models.triple.logLoss, Math.log(2));
  assert.equal(result.scores.groups.componentTop25.games, 1);
  assert.equal(result.scores.groups.componentsDisagree.games, 1);
});

test('incomplete results remain pending rather than becoming evidence of success', () => {
  const input = fixture(); input.season.games[0].completed = false;
  const result = evaluateBlendForecasts(input);
  assert.equal(result.pending.length, 1);
  assert.deepEqual(result.scores.primary, { games: 0, models: {} });
  input.observations = [];
  assert.equal(evaluateBlendForecasts(input).eligibleForecasts, 0);
});

test('earliest valid immutable checkpoint wins regardless of input order', () => {
  const input = fixture(); const later = structuredClone(input.observations[0]);
  later.forecastCapturedAt = '2026-11-06T21:00:00.000Z';
  later.forecasts[0].forecastCapturedAt = later.forecastCapturedAt;
  later.rows[0].indices = indices(0, 100, 50); later.rows[1].indices = indices(100, 0, 50); updateModels(later);
  input.observations = [later, ...input.observations];
  const result = evaluateBlendForecasts(input);
  assert.equal(result.duplicateCheckpoints, 1);
  assert.equal(result.evaluated[0].forecastCapturedAt, '2026-11-06T20:01:00.000Z');
  assert.equal(result.scores.primary.models.sor.accuracy, 1);
});

test('identity correction excludes earliest checkpoint without selecting a later eligible one', () => {
  const input = fixture(); const later = structuredClone(input.observations[0]);
  later.forecastCapturedAt = '2026-11-06T21:00:00.000Z'; later.forecasts[0].forecastCapturedAt = later.forecastCapturedAt;
  later.forecasts[0].neutral = false; updateModels(later);
  input.observations.push(later); input.season.games[0].neutral = false;
  const result = evaluateBlendForecasts(input);
  assert.equal(result.evaluated.length, 0);
  assert.equal(result.excluded[0].reason, 'participants-or-venue-changed');
});

test('corrected earlier kickoff and postponement outside seven days are explicit exclusions', () => {
  for (const [kickoff, reason] of [['2026-11-06T20:00:00.000Z', 'corrected-kickoff-not-after-capture'],
    ['2026-11-14T20:00:00.000Z', 'rescheduled-outside-seven-day-window']]) {
    const input = fixture(); input.season.games[0].startDate = kickoff;
    const result = evaluateBlendForecasts(input);
    assert.equal(result.evaluated.length, 0);
    assert.equal(result.excluded[0].reason, reason);
  }
});

test('early games enter secondary evidence but do not enter established primary evidence', () => {
  const input = fixture(); const observation = input.observations[0];
  observation.rows[0].games = 3; observation.forecasts[0].homeGames = 3; observation.forecasts[0].primaryEligible = false; sign(observation);
  const result = evaluateBlendForecasts(input);
  assert.equal(result.scores.primary.games, 0);
  assert.equal(result.scores.allEligible.games, 1);
});

test('checksum, frozen protocol, implementation and historical calibration edits fail closed', () => {
  const mutations = [
    input => { input.observations[0].forecasts[0].models.sor.pick = 'away'; },
    input => { input.observations[0].protocolSha256 = hash('9'); sign(input.observations[0]); },
    input => { input.implementationHashes = { 'scripts/record-blend-comparison.js': hash('9') }; },
    input => { input.observations[0].forecasts[0].models.sor.homeWinProbability = .7; sign(input.observations[0]); },
    input => { input.observations[0].rows[0].indices.triple = 80; sign(input.observations[0]); },
  ];
  for (const mutate of mutations) { const input = fixture(); mutate(input); assert.throws(() => evaluateBlendForecasts(input)); }
});

test('cannot backdate capture before freeze, source retrieval or saved kickoff', () => {
  for (const value of ['2026-11-06T19:59:00.000Z', '2026-11-07T20:00:00.000Z']) {
    const input = fixture(); const observation = input.observations[0];
    observation.forecastCapturedAt = value; observation.forecasts[0].forecastCapturedAt = value; sign(observation);
    assert.throws(() => evaluateBlendForecasts(input));
  }
  const input = fixture(); input.observations[0].performanceGeneratedAt = '2026-11-06T20:02:00.000Z'; sign(input.observations[0]);
  assert.throws(() => evaluateBlendForecasts(input));
});

test('invalid primary flag and same-time conflicting checkpoints are refused', () => {
  const input = fixture(); input.observations[0].forecasts[0].primaryEligible = false; sign(input.observations[0]);
  assert.throws(() => evaluateBlendForecasts(input));
  const other = fixture(); const duplicate = structuredClone(other.observations[0]);
  duplicate.rows[0].indices = indices(0, 100, 50); duplicate.rows[1].indices = indices(100, 0, 50); updateModels(duplicate);
  other.observations.push(duplicate);
  assert.throws(() => evaluateBlendForecasts(other), /Conflicting/);
  const venue = fixture(); const changed = structuredClone(venue.observations[0]);
  // With zero venue coefficients, identical model values still cannot hide a
  // contradictory venue at the same capture time.
  for (const family of BLEND_MODELS) venue.protocol.calibration.models[family].coefficients[1] = 0;
  for (const observation of [venue.observations[0], changed]) {
    observation.protocolSha256 = sha(JSON.stringify(venue.protocol));
    for (const family of BLEND_MODELS) observation.forecasts[0].models[family].homeWinProbability =
      1 / (1 + Math.exp(-2 * observation.forecasts[0].models[family].indexDifference / 100));
  }
  changed.forecasts[0].neutral = false;
  sign(venue.observations[0]); sign(changed); venue.observations.push(changed);
  assert.throws(() => evaluateBlendForecasts(venue), /Conflicting/);
});

test('future capture is not scored with an earlier result cutoff and duplicate source IDs fail', () => {
  const input = fixture(); input.asOf = '2026-11-06T20:00:30.000Z';
  const result = evaluateBlendForecasts(input);
  assert.equal(result.ignoredAfterResultCutoffObservations, 1);
  assert.equal(result.evaluated.length, 0);
  const duplicate = fixture(); duplicate.season.games.push({ ...duplicate.season.games[0] });
  assert.throws(() => evaluateBlendForecasts(duplicate), /Duplicate/);
});

test('empty and absent result sources remain pending, while invalid final scores fail', () => {
  const missing = fixture(); missing.season.games = [];
  assert.equal(evaluateBlendForecasts(missing).pending[0].reason, 'absent-from-current-source');
  const tie = fixture(); tie.season.games[0].awayPoints = tie.season.games[0].homePoints;
  assert.throws(() => evaluateBlendForecasts(tie), /decisive/);
});

test('tracking denominator reveals completed games with no forecast and excludes pre-freeze history', () => {
  const input = fixture();
  input.season.games.push({ ...input.season.games[0], id: 'missed' });
  input.season.games.push({ ...input.season.games[0], id: 'old', startDate: '2026-11-05T20:00:00.000Z' });
  const report = evaluateBlendForecasts(input);
  assert.equal(report.trackingCoverage.completedFbsFbsGamesSinceFreeze, 2);
  assert.equal(report.trackingCoverage.scored, 1);
  assert.equal(report.trackingCoverage.noSavedForecastCount, 1);
  assert.equal(report.trackingCoverage.noSavedForecast[0].gameId, 'missed');
});

test('inconsistent component midranks are rejected even with a valid payload checksum', () => {
  const input = fixture(); input.observations[0].rows[0].componentRanks.sor = 2;
  sign(input.observations[0]);
  assert.throws(() => evaluateBlendForecasts(input), /midranks/);
});
