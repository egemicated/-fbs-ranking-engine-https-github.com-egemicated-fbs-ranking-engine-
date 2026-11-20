import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { dataHash, normalizeBasketballSeason, parseBasketballExport } from '../basketball/data.js';
import { acquireBasketballSeason, fetchBasketballDateWindows, planBasketballSeason, scheduleWindows } from '../basketball/data-refresh.js';
import { basketballBudgetReport, createBasketballClient, normalizeBasketballQuota, withBasketballRefreshLock } from '../basketball/data-client.js';

const now = new Date('2026-11-20T22:00:00.000Z');
const source = { asOf: now.toISOString(), fullSchedule: true };
const firstTeams = [
  { id: 1, school: 'Fixture A', conference: 'League 1', conferenceId: 11, primaryColor: '037961' },
  { id: 2, school: 'Fixture B', conference: 'League 2', conferenceId: 12 },
];
const base = {
  id: 101, season: 2027, seasonType: 'regular', startDate: '2026-11-20T01:00:00.000Z', status: 'final',
  homeTeamId: 1, awayTeamId: 2, homeTeam: 'Fixture A', awayTeam: 'Fixture B',
  startTimeTbd: false, neutralSite: false, homePoints: 70, awayPoints: 65,
  homePeriodPoints: [28, 33, 9], awayPeriodPoints: [28, 33, 4],
};
const stats = points => ({ points: { total: points }, possessions: 64,
  fieldGoals: { made: 24, attempted: 50 }, rebounds: { offensive: 0 }, turnovers: { total: 0 } });
const box = {
  gameId: 101, season: 2027, startDate: base.startDate, isHome: false, teamId: 2, opponentId: 1,
  teamStats: stats(65), opponentStats: stats(70),
};
const normalized = ({ teamRows = firstTeams, gameRows = [base], boxRows = [box], previous } = {}) =>
  normalizeBasketballSeason({ season: 2027, source, teamRows, gameRows, boxRows, previous });
const responseQuota = { tierName: 'Free', monthlyLimit: 1000, usedCalls: 86, remainingCalls: 914,
  resetAt: '2026-12-01T00:00:00.000Z', sharedPool: true };
const centered = endpoint => endpoint === '/info' ? Response.json(responseQuota) : Response.json([]);

test('normalizes private season facts, non-D-I opponents, played games and verified overtime', () => {
  const data = normalized({ gameRows: [
    base, base,
    { ...base, id: 103, startDate: '2026-11-18T01:00:00Z', awayTeamId: 3, awayTeam: 'Outside registry' },
    { ...base, id: 104, startDate: '2026-11-20T23:00:00Z' },
    { ...base, id: 105, startDate: '2026-11-19T01:00:00Z', awayPoints: null },
  ] });
  assert.equal(data.competition, 'ncaam-d1');
  assert.equal(data.teams[0].color, '#037961');
  assert.equal(data.coverage.teams, 2);
  assert.equal(data.coverage.duplicateGames, 1);
  assert.equal(data.coverage.unverifiedFinals, 2);
  assert.equal(data.coverage.divisionOneFinalsWithPossessionInputs, 1);
  assert.equal(data.coverage.otherFinals, 1);
  assert.equal(data.games[0].awayName, 'Outside registry');
  const game = data.games.find(item => item.providerId === 101);
  assert.equal(game.overtimeMinutes, 5);
  assert.equal(game.box.home.turnovers, 0);
  assert.equal(game.box.home.freeThrowsMade, null);
  assert.equal(data.games.find(item => item.providerId === 104).homePoints, null);
});

test('stable identity and corrected scores preserve prior evidence without transferring a stale box', () => {
  const previous = normalized();
  assert.throws(() => normalized({ gameRows: [base, { ...base, homePoints: 75 }] }), /Conflicting basketball schedule record/);
  assert.throws(() => normalized({ gameRows: [base, { ...base, id: 102 }] }), /Duplicate basketball fixture/);
  assert.throws(() => normalized({ gameRows: [{ ...base, season: 2026 }] }), /season does not match/);
  const corrected = normalized({
    previous, gameRows: [{ ...base, homePoints: 71 }], boxRows: [],
    teamRows: [firstTeams[0], { ...firstTeams[1], conferenceId: 13, conference: 'League 3' }],
  });
  assert.equal(corrected.games[0].box, undefined);
  assert.deepEqual(corrected.corrections.find(item => item.entity === 'game').changes.homePoints, [70, 71]);
  assert.deepEqual(corrected.corrections.find(item => item.entity === 'team').changes.conference, ['League 2', 'League 3']);
  assert.equal(previous.games[0].homePoints, 70);
  assert.equal(previous.games[0].box.home.possessions, 64);
  assert.equal(normalized({ previous }).source.sha256, previous.source.sha256);
});

test('reads flattened exporter field names and never turns empty values into zero', () => {
  const [row] = parseBasketballExport('\uFEFF"GameId","HomePeriodPoints","TeamStats Rebounds Offensive","TeamStats Points Total"\r\n"1","37,37,7","","81"');
  assert.equal(row.gameId, '1');
  assert.deepEqual(row.homePeriodPoints, [37, 37, 7]);
  assert.deepEqual(row.teamStats, { rebounds: { offensive: null }, points: { total: '81' } });
  assert.throws(() => parseBasketballExport('"__proto__ bad"\n"yes"'), /Invalid basketball CSV field/);
});

test('splits capped provider responses and consumes each inclusive date boundary only once', async () => {
  const start = '2026-11-01T00:00:00.000Z';
  const end = '2026-11-09T00:00:00.000Z';
  const rows = [2, 5, 8].map(day => ({ season: 2027, startDate: `2026-11-0${day}T00:00:00.000Z` }));
  const windows = [];
  const result = await fetchBasketballDateWindows({ request: async (endpoint, { startDateRange, endDateRange }) => {
    assert.equal(endpoint, '/games');
    windows.push([startDateRange, endDateRange]);
    return rows.filter(row => row.startDate >= startDateRange && row.startDate <= endDateRange);
  } }, '/games', 2027, [[start, end]], 'current', { cap: 3 });
  assert.equal(windows.length, 3);
  assert.deepEqual(result, rows);
  await assert.rejects(fetchBasketballDateWindows({ request: async () => [{ ...rows[0], season: 2026 }] },
    '/games', 2027, [[start, end]], 'current'), /outside the requested season/);
  const season = scheduleWindows(2027);
  assert.equal(season.length, 4);
  assert.deepEqual(season.map(item => item[1]).slice(0, -1), season.map(item => item[0]).slice(1));
});

test('quota verification is unmetered and an insufficient shared balance prevents any sports data requests', async () => {
  const quota = normalizeBasketballQuota({ ...responseQuota, usedCalls: 250, remainingCalls: 750 });
  assert.equal(basketballBudgetReport(quota, []).basketballAllowedForRun, 0);
  assert.throws(() => normalizeBasketballQuota({ ...responseQuota, sharedPool: false }), /bounded shared/);
  const endpoints = [];
  const client = createBasketballClient({ token: 'private_test_key', now: () => now, fetcher: async (url, init) => {
    assert.equal(url.origin, 'https://api.collegebasketballdata.com');
    assert.equal(init.redirect, 'error');
    endpoints.push(url.pathname);
    return Response.json(quota);
  } });
  await assert.rejects(client.request('/teams'), /Check shared quota/);
  await client.checkQuota();
  await assert.rejects(client.request('/teams'), /protected|reserve/);
  assert.deepEqual(endpoints, ['/info']);
});

test('bounds retries and debit attempts, accepts lower shared quota readings and keeps secrets out of evidence', async () => {
  const saved = [];
  let tries = 0;
  const client = createBasketballClient({
    token: 'fixture_key_to_keep_private', now: () => now, maxCalls: 2, sleep: async () => {},
    saveLedger: async ledger => { saved.push(structuredClone(ledger)); },
    fetcher: async url => {
      if (url.pathname === '/info') return centered('/info');
      tries++;
      return tries === 1 ? new Response('transient', { status: 503 })
        : Response.json([{ id: 1 }], { headers: { 'X-CallLimit-Remaining': '750' } });
    },
  });
  await client.checkQuota();
  assert.deepEqual(await client.request('/teams', { season: 2027 }), [{ id: 1 }]);
  assert.equal(client.runAttempts, 2);
  assert.equal(client.observations[0].remainingCalls, 750);
  assert.doesNotMatch(JSON.stringify([...saved, ...client.observations]), /fixture_key_to_keep_private/);
  await assert.rejects(client.request('/teams', { season: 2027 }), /reserve/);
  const exhausted = createBasketballClient({ token: 'private', now: () => now,
    sleep: async () => assert.fail('The monthly quota error cannot retry'), fetcher: async url =>
      url.pathname === '/info' ? centered('/info') : new Response('Monthly call quota exceeded.', { status: 429 }) });
  await exhausted.checkQuota();
  await assert.rejects(exhausted.request('/teams'), /monthly quota exhausted/);
  assert.equal(exhausted.runAttempts, 1);
  await assert.rejects(exhausted.request('/scoreboard'), /outside the approved/);
});

test('serializes acquisitions and preserves the valid snapshot across a missing-page refresh', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'basketball-ingest-test-'));
  try {
    const lock = join(directory, 'test.lock');
    await withBasketballRefreshLock(lock, async () =>
      assert.rejects(withBasketballRefreshLock(lock, () => assert.fail('Concurrent reservation entered')), /already reserved/));
    const teams = [...firstTeams, ...Array.from({ length: 248 }, (_, index) => ({ id: index + 3, name: 'Fixture ' + index }))];
    const makeClient = fixture => ({ observations: [], request: async (endpoint, query) =>
      endpoint === '/teams' ? teams : endpoint === '/games' && fixture
        && query.startDateRange <= fixture.startDate && fixture.startDate < query.endDateRange ? [fixture] : [] });
    const artifactsDir = join(directory, 'artifacts'), cacheDir = join(directory, 'cache');
    const first = await acquireBasketballSeason({ client: makeClient(base), season: 2027, now, artifactsDir, cacheDir });
    assert.equal(first.changed, true);
    const file = join(artifactsDir, '2027.json');
    const original = await readFile(file, 'utf8');
    const prior = JSON.parse(original);
    const checkpoint = planBasketballSeason({ season: 2027, previous: prior, now });
    assert.equal(checkpoint.mode, 'incremental');
    const unchanged = await acquireBasketballSeason({ client: makeClient(base), season: 2027, now, artifactsDir, cacheDir });
    assert.equal(unchanged.changed, false);
    await assert.rejects(acquireBasketballSeason({ client: makeClient(null), season: 2027, now, artifactsDir, cacheDir }),
      /omitted previously observed final/);
    assert.equal(dataHash(await readFile(file, 'utf8')), dataHash(original));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
