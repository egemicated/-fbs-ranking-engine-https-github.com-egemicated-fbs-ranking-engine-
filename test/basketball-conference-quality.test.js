import test from 'node:test';
import assert from 'node:assert/strict';
import { basketballConferenceQuality } from '../basketball/conference-quality.mjs';
import { buildBasketballSnapshot } from '../basketball/model-engine.js';

const team = (id, conference) => ({ id, name: id.toUpperCase(), conference });
const source = { asOf: '2026-11-20T23:00:00.000Z', sha256: 'example' };
const final = (id, home, away, overrides = {}) => ({
  id, home, away, startDate: '2026-11-10T21:00:00.000Z', completed: true, status: 'final',
  divisionOne: true, homePoints: 75, awayPoints: 69, neutral: false, ...overrides,
});
const data = {
  competition: 'ncaam-d1', season: 2027, source,
  teams: [team('a', 'Amber'), team('b', 'Amber'), team('c', 'Blue'), team('d', 'Blue'), team('e', 'Gold'), team('f', null)],
  games: [
    final('home', 'a', 'c'),
    final('neutral', 'b', 'd', { neutral: true, homePoints: 64 }),
    final('road', 'c', 'a', { homePoints: 64 }),
    final('unknown', 'd', 'b', { neutral: null }),
    final('same-conference', 'a', 'b', { conferenceGame: true }),
    final('unknown-conference', 'a', 'f'),
    final('non-di', 'c', 'outside', { divisionOne: false }),
    final('future', 'a', 'c', { startDate: '2026-11-21T21:00:00.000Z' }),
    final('observed-later', 'c', 'a', { availableAt: '2026-11-21T21:00:00.000Z' }),
  ],
};

test('conference totals follow the actual snapshot and venue slices', () => {
  const snapshot = buildBasketballSnapshot(data);
  const report = basketballConferenceQuality({ snapshot, dataset: data });
  const [amber, blue, gold] = report.rows;
  assert.equal(report.gameCount, 4);
  assert.equal(amber.conference, 'Amber');
  assert.equal(amber.nonconference.wins, 2);
  assert.equal(amber.nonconference.losses, 2);
  assert.equal(amber.nonconference.winRate, 0.5);
  assert.equal(amber.nonconference.home.wins, 1);
  assert.equal(amber.nonconference.away.wins, 1);
  assert.equal(amber.nonconference.neutral.losses, 1);
  assert.equal(amber.nonconference.unconfirmed.losses, 1);
  assert.equal(amber.nonconference.unconfirmed.expectedWins, null);
  assert.equal(amber.nonconference.sample, 3);
  assert.equal(amber.nonconference.limitedSample, true);
  assert.equal(blue.nonconference.games, amber.nonconference.games);
  assert.equal(report.matrix.Amber.Blue.wins, report.matrix.Blue.Amber.losses);
  assert.equal(gold.nonconference.winRate, null);
  assert.equal(gold.nonconference.winSurplus, null);
  assert.equal(gold.predictive.mean, null);
});

test('the published win surplus uses only comparable reference-team outcomes', () => {
  const snapshot = buildBasketballSnapshot(data);
  const report = basketballConferenceQuality({ snapshot, dataset: data });
  const [amber] = report.rows;
  const teams = snapshot.teams.filter(team => team.conference === 'Amber');
  const probabilities = teams.flatMap(team => team.schedule).filter(game =>
    ['home', 'road', 'neutral'].includes(game.gameId)).map(game => game.referenceWinProbability);
  const expected = probabilities.reduce((sum, p) => sum + p, 0);
  assert.equal(amber.teams, teams.length);
  assert.equal(amber.rankedTeams, 2);
  assert.ok(Math.abs(amber.nonconference.expectedWins - expected) < 1e-15);
  assert.ok(Math.abs(amber.nonconference.winSurplus - (2 - expected)) < 1e-15);
  assert.ok(Math.abs(amber.nonconference.surplusPerGame - (2 - expected) / 3) < 1e-15);
  assert.equal(amber.predictive.min, Math.min(...teams.map(team => team.predictiveScore)));
  assert.equal(amber.predictive.max, Math.max(...teams.map(team => team.predictiveScore)));
  assert.equal(amber.predictive.mean, amber.predictive.median);
  assert.throws(() => basketballConferenceQuality({ snapshot, dataset: { ...data, source: { ...source, sha256: 'different' } } }),
    /matching basketball season/);
});
