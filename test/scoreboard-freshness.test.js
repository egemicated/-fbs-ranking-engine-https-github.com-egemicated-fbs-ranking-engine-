import test from 'node:test';
import assert from 'node:assert/strict';
import { readScoreboardSlate, reconcileScoreboardSlate, loadScoreboard, scoreboardDelayedGames, scoreboardTimestamp } from '../frontend/scoreboard.js';

const start = '2026-11-19T00:00:00Z';
const cutoff = '2026-11-19T13:00:00Z';
const teams = [
  { id: '1', name: 'Home', division: 'fbs' },
  { id: '2', name: 'Away', division: 'fbs' },
  { id: '3', name: 'FCS visitor', division: 'fcs' },
  { id: '4', name: 'FCS host', division: 'fcs' },
];
const game = (overrides = {}) => ({
  id: '401866467', home: '1', away: '2', startDate: start, startTimeTbd: false,
  status: 'scheduled', seasonType: 'regular', week: 12, ...overrides,
});
const publication = (games, scheduleAsOf = cutoff) => ({ season: 2026, teams, games, asOf: cutoff, source: { provider: 'cfbd', scheduleAsOf } });

test('publishes only FBS games from the current slate and retains a real 0–0 final', () => {
  const slate = readScoreboardSlate(publication([
    game(), game({ id: '2', status: 'postponed' }), game({ id: '3', status: 'final' }),
    game({ id: '4', status: 'final', homePoints: 0, awayPoints: 0 }),
    game({ id: '5', home: '4', away: '3' }), game({ id: '6', away: '3' }),
    game({ id: '7', week: 13, startDate: '2026-11-22T00:00:00Z' }),
  ]));
  assert.equal(slate.label, 'Week 12');
  assert.deepEqual(slate.games.map(row => row.state), ['upcoming', 'changed', 'changed', 'final', 'upcoming']);
  assert.equal(slate.games[1].detail, 'Postponed');
  assert.equal(slate.games[2].detail, 'Final score not reported');
  assert.deepEqual(slate.games[3].teams.map(team => team.score), [0, 0]);
});

test('a fresh final can correct a score while a stale status cannot overwrite the same confirmed final', () => {
  const final = game({ status: 'final', awayPoints: 34, homePoints: 33 });
  const previous = readScoreboardSlate(publication([final]));
  const slate = reconcileScoreboardSlate(readScoreboardSlate(publication([game()])), previous);
  assert.equal(slate.games[0].state, 'final');
  assert.equal(slate.retainedFinals, 1);
  assert.deepEqual(slate.games[0].teams.map(team => team.score), [34, 33]);
  const corrected = reconcileScoreboardSlate(readScoreboardSlate(publication([{ ...final, awayPoints: 35 }])), previous);
  assert.equal(corrected.games[0].teams[0].score, 35);
  const moved = reconcileScoreboardSlate(readScoreboardSlate(publication([game({ startDate: '2026-11-20T00:00:00Z' })])), previous);
  assert.equal(moved.games[0].state, 'upcoming');
});

test('past confirmed kickoff gets a delay notice while missing and TBD times do not', () => {
  const slate = readScoreboardSlate(publication([
    game(), game({ id: '2', startTimeTbd: true }), game({ id: '3', startTimeTbd: undefined }),
    game({ id: '4', startDate: '2026-11-20T00:00:00Z' }),
  ]));
  assert.deepEqual(scoreboardDelayedGames(slate, Date.parse(cutoff)).map(row => row.id), ['401866467']);
  assert.equal(scoreboardDelayedGames(slate, Date.parse(start) + 15 * 60_000).length, 0);
});

test('refresh revalidates the existing local publication, separately records receipt and rejects stale or empty snapshots', async () => {
  const calls = [], received = '2026-11-19T13:15:00.000Z', path = '/data/weekly-picks.json';
  const options = { path, now: () => Date.parse(received), fetcher: async (url, input) => {
    calls.push({ url, input });
    return { ok: true, json: async () => publication([game()]) };
  } };
  const slate = await loadScoreboard(undefined, undefined, options);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, path);
  assert.equal(calls[0].input.cache, 'no-cache');
  assert.equal(slate.receivedAt, received);
  assert.equal(slate.source.scheduleAsOf, cutoff);
  for (const invalid of [publication([]), publication([game()], start)]) {
    await assert.rejects(loadScoreboard(undefined, slate, { ...options, fetcher: async () => ({
      ok: true, json: async () => invalid,
    }) }), /temporarily unavailable/);
  }
  assert.equal(scoreboardTimestamp(null), 'Not reported');
  assert.match(scoreboardTimestamp(cutoff), /6:00:00 AM MST/);
  assert.match(scoreboardTimestamp('2026-07-19T13:00:00Z'), /7:00:00 AM MDT/);
});

test('unknown team, duplicate ID and unsupported provider are rejected without making up games', () => {
  const slate = readScoreboardSlate(publication([game(), game(), game({ id: '2', away: 'unknown' })]));
  assert.equal(slate.duplicateEvents, 1);
  assert.equal(slate.invalidEvents, 1);
  assert.equal(slate.games.length, 1);
  assert.throws(() => readScoreboardSlate({ ...publication([]), source: { provider: 'espn', scheduleAsOf: cutoff } }), /Missing published/);
});
