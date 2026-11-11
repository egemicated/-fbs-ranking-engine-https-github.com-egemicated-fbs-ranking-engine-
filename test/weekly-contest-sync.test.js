import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeeklyContestSync, publishWeeklyContest } from '../scripts/sync-weekly-contest.js';

const teams = [{ id: 'a', name: 'Alpha', division: 'fbs' }, { id: 'b', name: 'Beta', division: 'fbs' }, { id: 'c', name: 'Context', division: 'fcs' }];
const publication = {
  schemaVersion: 1, season: 2026, asOf: '2026-11-10T12:00:00Z', source: { provider: 'cfbd', scheduleAsOf: '2026-11-10T11:59:00Z' }, teams,
  games: [{ id: 'g1', week: 11, seasonType: 'regular', home: 'a', away: 'b', startDate: '2026-11-11T01:00:00Z',
    neutral: false, status: 'scheduled', homePoints: null, awayPoints: null,
    pick: { capturedAt: '2026-11-10T12:00:00Z', homeWinProbability: .7, favored: 'home' },
    replay: { homeWinProbability: .1, favored: 'away' }, estimate: { homeWinProbability: .2, favored: 'away' } }],
};
const now = '2026-11-10T12:01:00Z';

test('weekly contest sync uses only saved pregame model picks and FBS matchups', () => {
  const data = structuredClone(publication);
  data.games.push({ ...data.games[0], id: 'fcs', away: 'c' });
  const payload = buildWeeklyContestSync(data, now);
  assert.equal(payload.p_games.length, 1);
  assert.equal(payload.p_games[0].modelTeam, 'a');
  assert.equal(payload.p_games[0].homeWinProbability, .7);
  assert.equal(payload.p_observed_at, publication.asOf);
  assert.equal(JSON.stringify(payload).includes('replay'), false);
  delete data.games[0].pick;
  assert.equal(buildWeeklyContestSync(data, now).p_games[0].modelTeam, null);
});

test('weekly contest source rejects duplicates, invalid captures, future source times, and nonfinal scores', () => {
  const invalid = mutation => {
    const data = structuredClone(publication);
    mutation(data);
    assert.throws(() => buildWeeklyContestSync(data, now));
  };
  invalid(data => data.games.push(data.games[0]));
  invalid(data => { data.games[0].pick.capturedAt = data.games[0].startDate; });
  invalid(data => { data.source.scheduleAsOf = '2026-11-10T12:00:01Z'; });
  invalid(data => { data.games[0].pick.favored = 'away'; });
  invalid(data => { data.games[0].status = 'final'; data.games[0].homePoints = 21; data.games[0].awayPoints = 7; });
});

test('weekly contest ignores previews and tied model favorites and retains decided score corrections', () => {
  const data = structuredClone(publication);
  data.games[0].pick = { capturedAt: '2026-11-10T12:00:00Z', homeWinProbability: .5, favored: 'even' };
  assert.equal(buildWeeklyContestSync(data, now).p_games[0].modelTeam, null);
  data.games[0] = { ...data.games[0], startDate: '2026-11-09T01:00:00Z', status: 'final', homePoints: 14, awayPoints: 21, pick: null };
  const game = buildWeeklyContestSync(data, now).p_games[0];
  assert.equal(game.status, 'final');
  assert.equal(game.awayPoints, 21);
  assert.equal(game.modelTeam, null);
});

test('publisher sends one privileged request and redacts provider bodies and connection details', async () => {
  const credentials = { endpoint: new URL('https://example.supabase.co/rest/v1/rpc/cfp_sync'), key: 'sb_secret_local-test' };
  const payload = buildWeeklyContestSync(publication, now);
  let calls = 0;
  const result = await publishWeeklyContest(credentials, payload, async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://example.supabase.co/rest/v1/rpc/weekly_sync');
    assert.equal(options.headers.apikey, credentials.key);
    assert.deepEqual(JSON.parse(options.body), payload);
    return new Response('{"updated":1,"stale":false}');
  });
  assert.deepEqual(result, { updated: 1, stale: false });
  assert.equal(calls, 1);
  await assert.rejects(publishWeeklyContest(credentials, payload, async () => new Response('private error text', { status: 500 })), /^Error: Supabase weekly contest sync failed \(HTTP 500\)$/);
  await assert.rejects(publishWeeklyContest(credentials, payload, async () => { throw new Error(credentials.key); }), /^Error: Supabase weekly contest sync could not connect$/);
});
