import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { cfpSyncCredentials, fetchCfbdCfpGames, publishCfpSync, readWeeklyCfpGames, selectCfpResults, validateCfpBracket } from '../src/cfp-bracket-feed.js';

const official = JSON.parse(await readFile(new URL('../frontend/bracket-demo.json', import.meta.url), 'utf8'));
const teams = new Set(official.slots.flatMap(slot => [slot.home, slot.away]).filter(Boolean));
const bracket = validateCfpBracket(official, 2025, teams);
const finalCutoff = '2026-01-20T06:00:00Z';
// Matchups and kickoff slots are from the official 2025–26 bracket and recap.
// Model neutral-site feeds that list participants in the opposite order.
const games = bracket.slots.map((slot, index) => {
  const home = slot.home ?? official.results[slot.homeFrom].winner;
  const away = slot.away ?? official.results[slot.awayFrom].winner;
  const { homePoints, awayPoints } = official.results[slot.id];
  const base = { id: String(index + 100), seasonType: 'postseason', startDate: slot.kickoff, completed: true };
  return index % 2 === 0 ? { ...base, home, away, homePoints, awayPoints }
    : { ...base, home: away, away: home, homePoints: awayPoints, awayPoints: homePoints };
});

test('validates the lock, recognized entrants, slot order and single use of feeders', () => {
  assert.equal(bracket.slots.length, 11);
  assert.throws(() => validateCfpBracket({ ...official, lockAt: '2025-12-20T00:00:00Z' }, 2025, teams), /first kickoff/);
  const changed = (index, edits) => ({ ...official, slots: official.slots.map((slot, i) => i === index ? { ...slot, ...edits } : slot) });
  assert.throws(() => validateCfpBracket(changed(0, { home: 'BYU' }), 2025, teams), /Unknown or duplicate/);
  assert.throws(() => validateCfpBracket(changed(5, { awayFrom: 'r1-1' }), 2025, teams), /Invalid CFP feeder/);
  assert.throws(() => validateCfpBracket(changed(10, { round: '4' }), 2025, teams), /Invalid CFP slot/);
});

test('replays all 11 official 2025 finals in bracket orientation, independent of input order', () => {
  assert.deepEqual(selectCfpResults(bracket, games.toReversed(), finalCutoff), official.results);
});

test('keeps official seeds on initial entrants and accepts legacy fields without seed metadata', () => {
  assert.deepEqual(bracket.slots, official.slots);
  const legacySlots = official.slots.map(({ homeSeed, awaySeed, ...slot }) => slot);
  assert.deepEqual(validateCfpBracket({ ...official, slots: legacySlots }, 2025, teams).slots, legacySlots);

  for (const [index, edits] of [[0, { homeSeed: 13 }], [0, { homeSeed: '5' }],
    [0, { homeSeed: 1 }], [4, { awaySeed: 12 }]]) {
    const slots = official.slots.map((slot, i) => i === index ? { ...slot, ...edits } : slot);
    assert.throws(() => validateCfpBracket({ ...official, slots }, 2025, teams), /Invalid or duplicate CFP seed/);
  }
});

test('requires verified postseason finals at the right time and rejects ambiguous matches', () => {
  const missing = [
    { ...games[0], seasonType: 'regular' },
    { ...games[1], completed: false },
    { ...games[2], homePoints: null },
    { ...games[3], homePoints: 3, awayPoints: 3 },
    ...games.slice(4),
  ];
  assert.deepEqual(selectCfpResults(bracket, missing, finalCutoff), {});
  assert.deepEqual(selectCfpResults(bracket, [{ ...games[0], startDate: '2025-12-17T00:30:00Z' }], finalCutoff), {});
  assert.deepEqual(selectCfpResults(bracket, games, '2025-12-20T00:59:59Z'), {});
  assert.throws(() => selectCfpResults(bracket, [...games, { ...games[0], id: 'another' }], finalCutoff), /Multiple confirmed/);
});

test('uses corrected feeder winners when resolving downstream slots', () => {
  const corrected = [{ ...games[0], homePoints: 0 }, ...games.slice(1)];
  const results = selectCfpResults(bracket, corrected, finalCutoff);
  assert.deepEqual(results['r1-1'], { winner: 'James Madison', homePoints: 0, awayPoints: 34 });
  assert.equal(results['qf-1'], undefined);
  assert.equal(results['sf-1'], undefined);
  assert.equal(results.final, undefined);
  assert.deepEqual(results['sf-2'], official.results['sf-2']);
});

test('reuses a committed CFBD Weekly Picks snapshot and resolves game team IDs', () => {
  const ids = new Map(Array.from(teams, (team, index) => [team, String(index + 1)]));
  const picks = {
    season: 2025, source: { provider: 'cfbd', scheduleAsOf: finalCutoff },
    teams: Array.from(ids, ([name, id]) => ({ name, id })),
    games: games.map(game => ({ ...game, home: ids.get(game.home), away: ids.get(game.away), status: 'final' })),
  };
  const source = readWeeklyCfpGames(picks, 2025);
  assert.deepEqual(selectCfpResults(bracket, source.games, source.observedAt), official.results);
  assert.throws(() => readWeeklyCfpGames(picks, 2026), /No 2026 CFBD weekly result/);
});

test('makes one metered CFBD request and does not send either secret to the wrong service', async () => {
  const teamById = new Map([['1', 'Oregon'], ['2', 'James Madison']]);
  const calls = [];
  const source = await fetchCfbdCfpGames(2025, teamById, 'cfbd-example', async (url, options) => {
    calls.push(url);
    assert.equal(url, 'https://api.collegefootballdata.com/games?year=2025&seasonType=postseason');
    assert.deepEqual(options.headers, { Authorization: 'Bearer cfbd-example' });
    return Response.json([{ ...games[0], season: 2025, homeId: 1, awayId: 2 }]);
  });
  assert.equal(calls.length, 1);
  const results = selectCfpResults(bracket, source.games, source.observedAt);
  assert.deepEqual(results, { 'r1-1': official.results['r1-1'] });
  assert.throws(() => cfpSyncCredentials('https://example.supabase.co', 'sb_publishable_demo'), /CFP_SUPABASE_SECRET_KEY/);
  const creds = cfpSyncCredentials('https://example.supabase.co', 'sb_secret_demo');
  await publishCfpSync(creds, 2025, bracket, results, { observedAt: finalCutoff, fetcher: async (url, options) => {
    assert.equal(url.href, 'https://example.supabase.co/rest/v1/rpc/cfp_sync');
    assert.deepEqual(options.headers, { apikey: 'sb_secret_demo', 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(options.body), { p_season: 2025, p_bracket: bracket, p_results: results, p_observed_at: finalCutoff });
    assert.equal(options.redirect, 'error');
    return new Response(null, { status: 204 });
  } });
  await assert.rejects(publishCfpSync(creds, 2025, bracket, results), /requires the game-source cutoff/);
  await assert.rejects(publishCfpSync(creds, 2025, bracket, results, { observedAt: finalCutoff,
    fetcher: async () => new Response('untrusted content', { status: 403 }) }), /^Error: Supabase CFP sync failed \(HTTP 403\)$/);
});
