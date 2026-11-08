import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildTrialCapture } from '../research/preseason-trial-capture.mjs';
import { scoreTrial } from '../research/preseason-trial-score.mjs';

const protocol = JSON.parse(readFileSync(new URL('../preseason-preview/data/trial-2027.json', import.meta.url)));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const openingKickoff = '2027-08-21T17:00:00Z';
const capturedAt = '2027-08-19T16:00:00Z';
const scoredAt = '2027-12-01T17:00:00Z';
const teams = [
  { id: 'a', name: 'Example State', division: 'fbs', conference: 'East' },
  { id: 'b', name: 'Example Tech', division: 'fbs', conference: 'West' },
  { id: 'c', name: 'Example University', division: 'fbs', conference: 'West' },
  { id: 'd', name: 'Example College', division: 'fcs', conference: 'Example FCS' },
];
const game = (id, home, away, startDate, overrides = {}) =>
  ({ id, home, away, startDate, week: 1, neutral: false, completed: false, seasonType: 'regular', ...overrides });
const final = (fixture, overrides = {}) => ({ ...fixture, completed: true, homePoints: 24, awayPoints: 17, ...overrides });
const opener = game('opener', 'a', 'd', openingKickoff, { startTimeTbd: false });
const first = game('first', 'a', 'b', '2027-09-04');
const movedVenue = game('venue', 'b', 'c', '2027-09-11T19:00:00Z');
const noResult = game('missing', 'c', 'a', '2027-10-16T19:00:00Z');
const schedule = {
  year: 2027, teams, retrievedAt: '2027-08-19T15:00:00Z', openingKickoff,
  source: { provider: 'Synthetic test fixture', url: 'https://example.org/schedule', openingKickoffVerified: true },
  games: [opener, first, movedVenue, noResult,
    game('title', 'b', 'a', '2027-12-04T19:00:00Z', { conferenceChampionship: true })],
};
const history = Array.from({ length: 23 }, (_, index) => {
  const year = 2004 + index;
  return { year, teams, source: { fetchedAt: `${year + 1}-02-02T00:00:00Z` },
    games: [final(game(`prior-${year}`, 'a', 'b', `${year}-12-28T17:00:00Z`, { seasonType: 'postseason' }))] };
});
const capture = (input = schedule, time = capturedAt, archive = history) =>
  buildTrialCapture(protocol, input, archive, { capturedAt: time,
    sourceHashes: { protocol: sha(protocol), engine: protocol.engineSha256, capture: sha('synthetic'),
      schedule: sha(input), history: Object.fromEntries(archive.map(season => [season.year, sha(season)])) } });
const outcome = {
  year: 2027, teams,
  games: [final(opener), final(first, { startDate: '2027-09-04T20:00:00Z' }),
    final(movedVenue, { neutral: true }), final(game('late-add', 'a', 'c', '2027-11-13T19:00:00Z'))],
};

test('capture freezes one eligible slate and rejects incomplete or late inputs', () => {
  const { games, source, integritySha256, ...rest } = capture();
  assert.deepEqual(games.map(row => row.id), ['first', 'venue', 'missing']);
  assert.equal(games[0].startTimeTbd, true);
  assert.equal(source.captureCoverage.excluded.postseasonOrTitle, 1);
  assert.notEqual(games[0].baselineProbability, games[0].challengerProbability);
  assert.match(integritySha256, /^[a-f0-9]{64}$/);
  assert.equal(rest.season, 2027);
  assert.throws(() => capture(schedule, openingKickoff), /precede opening/);
  assert.throws(() => capture({ ...schedule, games: [opener, final(first)] }), /Target-season result/);
  const incomplete = history.with(-1, { ...history.at(-1), games: [{ ...history.at(-1).games[0], completed: false }] });
  assert.throws(() => capture(schedule, capturedAt, incomplete), /2026 FBS season/);
});

test('scoring uses only common finished fixtures and keeps kickoff-only changes', () => {
  const forecast = capture();
  const score = scoreTrial(forecast, outcome, protocol, { scoredAt });
  const { frozen, scored, unresolved, changed, added, scoredWithKickoffChanges } = score.coverage;
  assert.deepEqual({ frozen, scored, unresolved, changed, added, scoredWithKickoffChanges },
    { frozen: 3, scored: 1, unresolved: 1, changed: 1, added: 1, scoredWithKickoffChanges: 1 });
  for (const model of ['baseline', 'challenger']) {
    const p = forecast.games[0][`${model}Probability`];
    assert.equal(score.metrics[model].brier, (p - 1) ** 2);
    assert.equal(score.metrics[model].logLoss, -Math.log(p));
  }
});

test('scoring rejects forecast edits and an earlier FBS–FCS opener', () => {
  const forecast = capture();
  const tampered = { ...forecast, games: [{ ...forecast.games[0], baselineProbability: .5 }, ...forecast.games.slice(1)] };
  assert.throws(() => scoreTrial(tampered, outcome, protocol, { scoredAt }), /integrity mismatch/);
  const earlier = { ...outcome, games: [{ ...outcome.games[0], startDate: '2027-08-18T19:00:00Z' }, ...outcome.games.slice(1)] };
  assert.throws(() => scoreTrial(forecast, earlier, protocol, { scoredAt }), /actual FBS opening kickoff/);
});
