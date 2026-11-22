import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { publishFootballPolls } from '../scripts/publish-football-polls.js';
import { footballWeekendPollWindow } from '../scripts/football-poll-window.js';

const rankings = Array.from({ length: 26 }, (_, i) => ({ id: String(i + 1), name: `Team ${i + 1}` }));
const snapshot = { season: 2026, rankings };
const slate = { season: 2026, games: [
  { week: 12, seasonType: 'regular', startDate: '2026-11-21T17:00:00Z' },
  { week: 12, seasonType: 'regular', startDate: '2026-11-22T01:00:00Z' },
  { week: 13, seasonType: 'regular', startDate: '2026-11-27T16:00:00Z' },
  { week: 15, seasonType: 'regular', startDate: '2026-12-12T20:00:00Z' },
] };
const oldCfp = ['2026-11-03', '2026-11-10', '2026-11-17'].map(released => ({ released }));
const comparison = { season: 2026, sor: [{ week: 12, gamesThrough: '2026-11-21' }], forge: [], polls: {
  ap: [], coaches: [{ week: 11, released: '2026-11-15' }], cfp: oldCfp,
} };
const history = { schemaVersion: 1, season: 2026, editions: { ap: [], cfp: oldCfp },
  releases: { ap: [], cfp: [] }, sourceHashes: [] };
const ap = date => Response.json({ rankings: [{ name: 'AP Top 25', season: { year: 2026 }, date,
  occurrence: { number: 13 }, ranks: rankings.slice(0, 25).map((team, i) => ({ current: i + 1, team: { id: team.id } })) }] });
const coaches = (rows = rankings.slice(0, 25)) => Response.json([{ season: 2026, week: 13, seasonType: 'regular', polls: [
  { poll: 'AP Top 25', ranks: [] },
  { poll: 'Coaches Poll', ranks: rows.map((team, i) => ({ rank: i + 1, teamId: Number(team.id), school: team.name })) },
] }]);

function cfp(dates) {
  const values = [];
  const ref = value => (values.push(value), values.length - 1);
  const editions = dates.map(released => {
    const rows = rankings.slice(0, 25).map((team, i) => ref({ rank: ref(i + 1), team: ref(team.name), record: ref('9-2') }));
    return ref({ releaseDate: ref(released + 'T00:00:00'), year: ref(2026), teams: ref(rows) });
  });
  ref({ rankingsByYear: ref({ 2026: ref(editions) }) });
  return new Response(`<script id="__NUXT_DATA__">${JSON.stringify(values)}</script>`);
}

async function withArchive(run) {
  const temp = await mkdtemp(join(tmpdir(), 'football-polls-test-'));
  const comparisonPath = join(temp, 'comparison.json');
  const historyPath = join(temp, 'history.json');
  const read = file => readFile(file, 'utf8').then(JSON.parse);
  try {
    await writeFile(comparisonPath, JSON.stringify(comparison));
    await writeFile(historyPath, JSON.stringify(history));
    return await run({ snapshot, slate, comparisonPath, historyPath }, () => read(comparisonPath), () => read(historyPath));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

test('weekend windows follow Eastern time and skip solitary makeup games and off-season checks', async () => {
  assert.deepEqual(footballWeekendPollWindow(new Date('2026-11-22T18:59:00Z'), slate),
    { week: 12, expectedAfter: '2026-11-22', open: false });
  assert.equal(footballWeekendPollWindow(new Date('2026-11-22T19:00:00Z'), slate).open, true);
  assert.equal(footballWeekendPollWindow(new Date('2026-11-23T12:00:00Z'), slate).expectedAfter, '2026-11-22');
  assert.equal(footballWeekendPollWindow(new Date('2026-12-13T19:00:00Z'), slate), null);
  await withArchive(async options => {
    const fetcher = () => assert.fail('Off-season refresh made a source request');
    const rows = await publishFootballPolls({ ...options, fetcher, clock: () => new Date('2027-06-21T18:00:00Z') });
    assert.deepEqual(rows.map(row => row.status), ['no-due', 'no-due', 'no-due']);
  });
});

test('Sunday publishes AP and an explicitly observed Coaches edition with one bounded CFBD call', async () => {
  await withArchive(async (options, compare, archive) => {
    const clock = () => new Date('2026-11-22T19:15:00Z');
    const calls = [];
    const fetcher = async (url, request) => {
      const destination = new URL(url);
      calls.push(destination.hostname);
      if (destination.hostname === 'site.api.espn.com') return ap('2026-11-22T08:00Z');
      assert.equal(destination.href, 'https://api.collegefootballdata.com/rankings?year=2026&seasonType=regular&week=13');
      assert.equal(request.headers.Authorization, 'Bearer test-only');
      assert.equal(request.redirect, 'error');
      return coaches();
    };
    const run = { ...options, scope: 'weekend', key: 'test-only', clock, fetcher };
    const rows = await publishFootballPolls(run);
    assert.deepEqual(rows.map(row => row.status), ['saved', 'saved']);
    assert.deepEqual(calls, ['site.api.espn.com', 'api.collegefootballdata.com']);
    assert.equal(rows[1].released, undefined);
    assert.equal(rows[1].observedAt, '2026-11-22T19:15:00.000Z');
    const saved = await compare();
    assert.deepEqual(saved.sor, comparison.sor);
    assert.equal(saved.polls.ap.at(-1).released, '2026-11-22');
    const current = saved.polls.coaches.at(-1);
    assert.equal(current.releaseDateBasis, 'observed');
    assert.equal(current.gamesThrough, null);
    assert.equal(current.rows.length, 25);
    assert.equal(current.rows[0].id, '1');
    assert.equal((await archive()).editions.coaches[0].provenance.providerWeek, 13);
    assert.deepEqual((await publishFootballPolls(run)).map(row => row.status), ['current', 'current']);
    assert.equal(calls.length, 2);
  });
});

test('weekend subscriptions can distinguish early, pending, and malformed provider editions', async () => {
  await withArchive(async (options, compare, archive) => {
    const run = { ...options, scope: 'weekend', key: 'test-only' };
    const clock = () => new Date('2026-11-22T18:59:00Z');
    const early = await publishFootballPolls({ ...run, clock, fetcher: () => assert.fail('Poll checked before due window') });
    assert.deepEqual(early.map(row => row.status), ['not-yet-released', 'not-yet-released']);
    const after = () => new Date('2026-11-22T20:15:00Z');
    const pending = await publishFootballPolls({ ...run, clock: after, fetcher: async url =>
      new URL(url).hostname === 'site.api.espn.com' ? ap('2026-11-16T08:00Z') : Response.json([]) });
    assert.deepEqual(pending.map(row => row.status), ['not-yet-released', 'not-yet-released']);
    const malformed = await publishFootballPolls({ ...run, clock: after, fetcher: async url =>
      new URL(url).hostname === 'site.api.espn.com' ? ap('2026-11-16T08:00Z') : coaches(rankings.slice(0, 24)) });
    assert.deepEqual(malformed.map(row => row.status), ['not-yet-released', 'failed']);
    assert.deepEqual(await compare(), comparison);
    assert.deepEqual(await archive(), history);
  });
});

test('an officially delayed weekend check targets only the requested poll and skips before the announced time and after 36 hours', async () => {
  await withArchive(async options => {
    const call = { ...options, scope: 'weekend', weekendPoll: 'ap',
      weekendReleaseAt: '2026-11-24T17:15:00-05:00', weekendSourceUrl: 'https://apnews.com/example-release-notice' };
    const never = () => assert.fail('The delayed poll check should not use its source');
    const [early] = await publishFootballPolls({ ...call, fetcher: never, clock: () => new Date('2026-11-24T22:14Z') });
    assert.equal(early.poll, 'ap');
    assert.equal(early.status, 'not-yet-released');
    assert.equal(early.scheduledReleaseAt, '2026-11-24T22:15:00.000Z');
    const attempted = [];
    const clock = () => new Date('2026-11-24T22:20Z');
    const rows = await publishFootballPolls({ ...call, clock, fetcher: async url => {
      attempted.push(new URL(url).hostname);
      return ap('2026-11-24T08:00Z');
    } });
    assert.deepEqual(rows.map(row => [row.poll,row.status]), [['ap','saved']]);
    assert.deepEqual(attempted, ['site.api.espn.com']);
    assert.equal((await publishFootballPolls({ ...call, clock, fetcher: never }))[0].status, 'current');
    const [expired] = await publishFootballPolls({ ...call, fetcher: never, clock: () => new Date('2026-11-26T11:00Z') });
    assert.equal(expired.status, 'no-due');
    await assert.rejects(publishFootballPolls({ ...call, fetcher: never,
      weekendSourceUrl: 'https://apnews.com.example.test/fake' }), /first-party release notice/);
  });
});

test('CFP catches a missed edition after Eastern midnight and skips it once both archives hold it', async () => {
  await withArchive(async (options, compare, archive) => {
    const clock = () => new Date('2026-11-25T06:00:00Z');
    const run = { ...options, clock, scope: 'cfp' };
    const [pending] = await publishFootballPolls({ ...run, fetcher: async () => cfp(['2026-11-17']) });
    assert.equal(pending.status, 'not-yet-released');
    assert.equal(pending.released, '2026-11-24');
    const [saved] = await publishFootballPolls({ ...run, fetcher: async () => cfp(['2026-11-24']) });
    assert.equal(saved.status, 'saved');
    assert.equal((await compare()).polls.cfp.at(-1).gamesThrough, null);
    assert.equal((await archive()).editions.cfp.at(-1).released, '2026-11-24');
    const [current] = await publishFootballPolls({ ...run, fetcher: () => assert.fail('Existing CFP edition should not be downloaded twice') });
    assert.equal(current.status, 'current');
  });
});

test('a conflicting official CFP response cannot leave partial changes in either archive', async () => {
  await withArchive(async (options, compare, archive) => {
    const clock = () => new Date('2026-11-25T06:00:00Z');
    const [failed] = await publishFootballPolls({ ...options, clock, scope: 'cfp',
      fetcher: async () => cfp(['2026-11-17', '2026-11-24']) });
    assert.equal(failed.status, 'failed');
    assert.deepEqual(await compare(), comparison);
    assert.deepEqual(await archive(), history);
  });
});
