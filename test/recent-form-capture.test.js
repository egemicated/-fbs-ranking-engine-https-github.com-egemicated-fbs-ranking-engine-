import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildWeeklyPicks } from '../scripts/publish-weekly-picks.js';
import { buildWeeklySnapshot } from '../src/weekly.js';
import {
  RECENT_FORM_PROTOCOL_ID, makeRecentFormObservation, recentFormObservationHash, recordRecentFormObservation,
} from '../research/capture-recent-form-shadow.mjs';
import { evaluateRecentFormShadow } from '../research/evaluate-recent-form-shadow.mjs';
import calibration from '../data/matchup-validation.json' with { type: 'json' };

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const publishedAt = '2026-11-22T08:00:05.000Z';
const actualCapture = '2026-11-22T08:00:06.000Z';
const imminentKickoff = '2026-11-22T08:00:07.000Z';
const now = () => Date.parse(actualCapture);

function fixture() {
  const config = calibration.strengthConfig;
  const teams = ['home', 'away', 'other', 'last', 'fcs'].map(id => ({
    id, name: id, division: id === 'fcs' ? 'fcs' : 'fbs',
  }));
  const source = { provider: 'cfbd', fetchedAt: '2026-11-22T08:00:00.000Z', sha256: hash('source snapshot') };
  const old = (id, startDate, week, home, away, homePoints, awayPoints) => ({
    id, startDate, week, seasonType: 'regular', home, away, homePoints, awayPoints,
    neutral: false, startTimeTbd: false, completed: true,
  });
  const fixture = (id, startDate, home, away, startTimeTbd = false) => ({
    id, startDate, week: 14, seasonType: 'regular', home, away, homePoints: null, awayPoints: null,
    neutral: id === 'eligible', startTimeTbd, completed: false,
  });
  const season = { year: 2026, source, teams, games: [
    old('old-one', '2026-10-24T20:00:00.000Z', 9, 'home', 'other', 28, 10),
    old('old-two', '2026-11-15T00:00:00.000Z', 12, 'away', 'last', 13, 31),
    old('old-three', '2026-11-21T18:00:00.000Z', 13, 'other', 'away', 17, 7),
    fixture('eligible', '2026-11-28T15:00:00.000Z', 'home', 'away'),
    fixture('near', imminentKickoff, 'other', 'last'),
    fixture('cross', '2026-11-25T20:00:00.000Z', 'fcs', 'home'),
    fixture('tbd', '2026-11-28T15:00:00.000Z', 'last', 'away', true),
    fixture('outside', '2026-12-05T15:00:00.000Z', 'other', 'home'),
  ] };
  const previous = {
    season: 2025, snapshotHash: hash('prior'), ratings: teams.map((team, index) => ({ id: team.id, strength: index * 1.2 })),
  };
  const snapshot = buildWeeklySnapshot(season, previous, config, new Date('2026-11-22T08:00:03.000Z'));
  const weeklyPicks = buildWeeklyPicks(season, snapshot, { capturedAt: publishedAt });
  const protocol = { schemaVersion: 1, season: season.year, id: RECENT_FORM_PROTOCOL_ID, frozenAt: '2026-11-17T00:00:00.000Z',
    forecastHorizonDays: 7, baseline: { modelVersion: snapshot.modelVersion, strengthConfig: config,
      probabilityScale: calibration.winProbability.scale },
    coefficients: { graph: 0.2540683417149627, residual: -0.010280561743755447, ageHalfLife: 35,
      residualHalfLife: 21, residualPriorGames: 3 } };
  const inputSha256 = { normalizedSeason: hash(season), snapshot: hash(snapshot), weeklyPicks: hash(weeklyPicks), previous: hash(previous) };
  return { season, snapshot, weeklyPicks, previous, protocol, inputSha256 };
}

const pick = (input, id) => input.weeklyPicks.games.find(game => game.id === id);

test('captures exact fresh FBS probabilities and records a separate actual pregame shadow timestamp', () => {
  const input = fixture();
  const before = JSON.stringify(input);
  assert.ok(pick(input, 'cross').pick);
  assert.ok(pick(input, 'tbd').pick);
  const observation = makeRecentFormObservation(input, { clock: now });
  assert.deepEqual(observation.forecasts.map(game => game.gameId), ['near', 'eligible']);
  assert.equal(observation.forecastCapturedAt, actualCapture);
  assert.equal(observation.sourceFetchedAt, input.season.source.fetchedAt);
  assert.equal(observation.asOf, input.snapshot.asOf);
  assert.equal(observation.weeklyPicksAsOf, publishedAt);
  assert.equal(observation.resultSha256, recentFormObservationHash(observation));
  for (const game of observation.forecasts) {
    assert.equal(game.baselineCapturedAt, pick(input, game.gameId).pick.capturedAt);
    assert.equal(game.baselineProbability, pick(input, game.gameId).pick.homeWinProbability);
    assert.ok(game.challengerProbability > 0 && game.challengerProbability < 1);
    assert.ok(!Object.hasOwn(game, 'outcome'));
    assert.ok(!Object.hasOwn(game, 'homePoints'));
  }
  assert.equal(JSON.stringify(input), before);
});

test('ignores a carried pick, excludes already tracked games and drops any kickoff that passes while calculating', () => {
  const input = fixture();
  pick(input, 'eligible').pick.capturedAt = '2026-11-21T08:00:05.000Z';
  assert.deepEqual(makeRecentFormObservation(input, { clock: now }).forecasts.map(game => game.gameId), ['near']);
  assert.equal(makeRecentFormObservation(input, { clock: now, seen: new Set(['near']) }), null);
  assert.equal(makeRecentFormObservation(input, { clock: () => Date.parse(imminentKickoff) }), null);
});

test('refuses a pre-protocol checkpoint, mismatched source or kickoff, and tampered baseline', () => {
  for (const [label, mutate, error] of [
    ['freeze', input => { input.protocol.frozenAt = actualCapture; }, /fresh checkpoint/],
    ['coefficient', input => { input.protocol.coefficients.graph = 0.25; }, /frozen model/],
    ['source', input => { input.weeklyPicks.source.snapshotHash = hash('other'); }, /exact fresh calibrated/],
    ['kickoff', input => { pick(input, 'eligible').startDate = '2026-11-28T16:00:00.000Z'; }, /confirmed pregame fixture/],
    ['baseline', input => { pick(input, 'eligible').pick.homeWinProbability = 0.2; pick(input, 'eligible').pick.favored = 'away'; }, /same-checkpoint/],
    ['prior', input => { input.previous.snapshotHash = hash('wrong prior'); }, /Rebuilt Strength graph/],
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => makeRecentFormObservation(input, { clock: now }), error, label);
  }
});

test('scores the actual retained forecast format against a later confirmed result without changing its odds', () => {
  const input = fixture();
  const observation = makeRecentFormObservation(input, { seen: new Set(['near']), clock: now });
  const bytes = JSON.stringify(observation);
  const season = structuredClone(input.season);
  const final = season.games.find(game => game.id === 'eligible');
  Object.assign(final, { completed: true, homePoints: 27, awayPoints: 24 });
  season.source.fetchedAt = '2026-11-29T08:00:00.000Z';
  season.source.sha256 = hash('confirmed result source');
  const score = evaluateRecentFormShadow({ observations: [observation], season, protocol: input.protocol,
    asOf: '2026-11-29T08:00:01.000Z', generatedAt: '2026-11-29T08:00:02.000Z' });
  assert.equal(score.scores.games, 1);
  assert.equal(score.evaluated[0].gameId, 'eligible');
  assert.equal(score.evaluated[0].baselineProbability, observation.forecasts[0].baselineProbability);
  assert.equal(score.evaluated[0].challengerProbability, observation.forecasts[0].challengerProbability);
  assert.equal(JSON.stringify(observation), bytes);
});

test('saved observations are immutable and cannot be backdated, replaced or newly persisted after kickoff', async () => {
  const input = fixture();
  const directory = await mkdtemp(join(tmpdir(), 'recent-form-capture-'));
  try {
    const first = await recordRecentFormObservation(input, { directory, clock: now });
    const bytes = await readFile(first.path, 'utf8');
    const again = await recordRecentFormObservation(input, { directory, clock: () => Date.parse('2026-12-01T08:00:00Z') });
    assert.equal(again.created, false);
    assert.equal(again.observation.forecastCapturedAt, actualCapture);
    assert.equal(await readFile(first.path, 'utf8'), bytes);
    input.inputSha256.weeklyPicks = hash('changed input');
    await assert.rejects(recordRecentFormObservation(input, { directory, clock: now }), /refusing to replace/);
    const observation = JSON.parse(bytes);
    observation.forecasts[0].baselineProbability = 0.25;
    await writeFile(first.path, JSON.stringify(observation));
    await assert.rejects(recordRecentFormObservation(input, { directory, clock: now }), /checksum/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a write crossing kickoff retains only games still upcoming on a fresh actual timestamp', async () => {
  const input = fixture();
  const directory = await mkdtemp(join(tmpdir(), 'recent-form-boundary-'));
  try {
    let calls = 0;
    const clock = () => ++calls < 3 ? now() : Date.parse(imminentKickoff);
    const saved = await recordRecentFormObservation(input, { directory, clock });
    assert.deepEqual(saved.observation.forecasts.map(game => game.gameId), ['eligible']);
    assert.equal(saved.observation.forecastCapturedAt, imminentKickoff);
    assert.deepEqual(await readdir(directory), [saved.path.split(/[\\/]/).at(-1)]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
