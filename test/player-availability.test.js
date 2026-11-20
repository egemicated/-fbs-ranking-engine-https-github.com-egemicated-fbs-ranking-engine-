import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  buildAvailabilitySchedule, fetchOfficialAvailability, mergeAvailability, parseOfficialAvailability,
  planAvailabilityChecks,
} from '../src/player-availability.js';

const kickoff = '2026-11-21T17:00:00.000Z';
const checkedAt = '2026-11-21T15:52:00.000Z';
const byu = { id: '252', name: 'BYU', division: 'fbs', conference: 'Big 12' };
const kansas = { id: '2305', name: 'Kansas', division: 'fbs', conference: 'Big 12' };
const game = { id: '401866458', home: kansas.id, away: byu.id, startDate: kickoff, startTimeTbd: false, status: 'scheduled' };
const slate = { schemaVersion: 1, season: 2026, teams: [byu, kansas], games: [game] };
const reportRows = [
  { teamDisplayName: 'BYU', rows: [
    { name: 'QB #7 Test O’Neal', status: 'Out' },
    { name: 'WR #10 Match Jersey', status: 'Game Time Decision' },
    { name: 'RB #2 No Match', status: 'Out', exemptStatus: 'Out' },
    { name: 'OL #88 Not Displayed', status: 'Available' },
    { name: 'OL #90 Not Listed', status: 'Exempt' },
  ] },
  { teamDisplayName: 'Kansas', rows: [{ name: 'QB #1 Fully Available', status: 'Available' }] },
];
const official = {
  ReportType: 'Game Day', conferenceTimeZone: 'CT', publishDate: '2026-11-21', postedTime: '9:30:00',
  footer: { date: '2026-11-21', time: '11:00:00' }, games: reportRows,
};
const rosters = new Map([
  ['252', { schemaVersion: 1, season: 2026, teamId: '252', players: [
    { id: '921', name: "Test O'Neal", jersey: 7 },
    { id: '922', name: 'Match Jersey', jersey: 1 },
    { id: '923', name: 'Match Jersey', jersey: 10 },
  ] }],
  ['2305', { schemaVersion: 1, season: 2025, teamId: '2305', players: [{ id: '924', name: 'Fully Available', jersey: 1 }] }],
]);
const schedule = buildAvailabilitySchedule(slate);
const parse = (body, options = {}) => parseOfficialAvailability(body, schedule, 'Big 12', { checkedAt, rosters, ...options });

test('matches both teams and exact kickoff and retains only public availability fields', () => {
  const reports = parse({ publish: official });
  assert.equal(reports.length, 2);
  assert.deepEqual(reports[0], {
    teamId: '252', season: 2026, report: {
      gameId: game.id, kickoff, opponentId: '2305', opponentName: 'Kansas', source: 'Big 12',
      sourceUrl: 'https://big12sports.com/sports/2025/8/14/FBreporting.aspx',
      reportAt: '2026-11-21T15:30:00.000Z', checkedAt, final: true,
      players: [
        { playerId: '923', name: 'Match Jersey', position: 'WR', jersey: 10, status: 'Game Time Decision' },
        { playerId: null, name: 'No Match', position: 'RB', jersey: 2, status: 'Out' },
        { playerId: '921', name: 'Test O’Neal', position: 'QB', jersey: 7, status: 'Out' },
      ],
    },
  });
  assert.deepEqual(reports[1].report.players, []);
});

test('rejects ambiguous schedules, placeholders and incomplete or mismatched official reports', () => {
  assert.equal(buildAvailabilitySchedule({ ...slate, games: [game, game] }).length, 0);
  assert.equal(buildAvailabilitySchedule({ ...slate, games: [{ ...game, startTimeTbd: true }] }).length, 0);
  assert.equal(buildAvailabilitySchedule({ ...slate, teams: [byu, { ...kansas, division: 'fcs' }] }).length, 0);
  assert.equal(buildAvailabilitySchedule({ ...slate, teams: [byu, { ...kansas, conference: 'SEC' }] }).length, 0);
  assert.deepEqual(parse({
    expected: { ...official, ReportType: 'Report Pending' },
    differentTime: { ...official, footer: { ...official.footer, time: '11:15:00' } },
    wrongTeam: { ...official, games: [reportRows[0], { ...reportRows[1], teamDisplayName: 'Kansas State' }] },
    wrongOrder: { ...official, games: [...reportRows].reverse() },
    tooLate: { ...official, postedTime: '11:30:00' },
    notYet: { ...official, postedTime: '10:00:00' },
  }), []);
  const incomplete = parse({ publish: { ...official, games: [reportRows[0], { ...reportRows[1], rows: [] }] } });
  assert.deepEqual(incomplete.map(report => report.teamId), ['252']);
});

test('does not infer availability or attach an ID from another season', () => {
  const preliminary = { ...official, ReportType: 'Friday Update', publishDate: '2026-11-20', postedTime: '21:00:00',
    games: [reportRows[0], { ...reportRows[1], rows: [{ ...reportRows[1].rows[0], status: 'Questionable' }] }] };
  const previous = mergeAvailability(new Map(), parse({ preliminary }));
  const [report] = previous.get('2305').reports;
  assert.equal(report.final, false);
  assert.equal(report.players[0].playerId, null);
  assert.equal(report.players[0].status, 'Questionable');
  const merged = mergeAvailability(previous, parse({ official }, { previous }));
  assert.equal(merged.get('2305').reports[0].players[0].status, 'Available');
  assert.deepEqual(mergeAvailability(merged, parse({ preliminary })), merged);
  const rerun = parse({ official }, { previous: merged, checkedAt: '2026-11-21T16:30:00.000Z' });
  assert.equal(mergeAvailability(merged, rerun).get('252'), merged.get('252'));
});

test('checks night reports and league deadlines with one pending-only backup window', () => {
  const due = (mode, now, previous = new Map()) => planAvailabilityChecks(schedule, previous, { mode, now }).size;
  assert.equal(due('nightly', '2026-11-19T03:20:00.000Z'), 1);
  assert.equal(due('nightly', '2026-11-18T03:20:00.000Z'), 0);
  assert.equal(due('game-day', '2026-11-21T15:44:00.000Z'), 0);
  assert.equal(due('game-day', checkedAt), 1);
  assert.equal(due('game-day', '2026-11-21T16:15:00.000Z'), 0);
  assert.equal(due('game-day', '2026-11-21T16:37:00.000Z'), 1);
  assert.equal(due('game-day', '2026-11-21T17:00:00.000Z'), 0);
  const reports = parse({ official });
  const previous = mergeAvailability(new Map(), reports.slice(0, 1));
  assert.equal(due('game-day', '2026-11-21T16:37:00.000Z', previous), 1);
  assert.equal(due('game-day', '2026-11-21T16:37:00.000Z', mergeAvailability(previous, reports)), 0);
  const bigTenSchedule = buildAvailabilitySchedule({ ...slate, teams: slate.teams.map(team => ({ ...team, conference: 'Big Ten' })) });
  assert.equal(planAvailabilityChecks(bigTenSchedule, new Map(), { mode: 'game-day', now: '2026-11-21T15:22:00.000Z' }).size, 1);
  assert.equal(planAvailabilityChecks(bigTenSchedule, new Map(), { mode: 'game-day', now: checkedAt }).size, 0);
});

test('overnight checks include same-day games and can archive the prior day’s official reports', () => {
  const overnight = '2026-11-21T07:45:00.000Z';
  const due = (now, games = schedule, previous = new Map()) =>
    planAvailabilityChecks(games, previous, { mode: 'overnight', now }).size;
  assert.equal(due(overnight), 1);
  assert.equal(due('2026-11-18T07:45:00.000Z'), 1);
  assert.equal(due('2026-11-17T07:45:00.000Z'), 0);
  assert.equal(due(overnight, [{ ...schedule[0], status: 'final' }]), 0);
  assert.equal(due(kickoff), 0);
  assert.equal(due(checkedAt, schedule, mergeAvailability(new Map(), parse({ official }))), 0);
  const nextNight = '2026-11-22T07:45:00.000Z';
  const completed = [{ ...schedule[0], status: 'final' }];
  assert.equal(due(nextNight, completed), 1);
  assert.equal(due(nextNight, completed, mergeAvailability(new Map(), parse({ official }))), 0);
  assert.equal(due('2026-11-23T07:45:00.000Z', completed), 0);
});

test('overnight publication retains successful reports and marks a partial feed failure for retry', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'availability-publication-'));
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory, { recursive: true, force: true });
  });
  await mkdir(join(directory, 'published'));
  const secHome = { id: '1', name: 'Home', division: 'fbs', conference: 'SEC' };
  const secAway = { id: '2', name: 'Away', division: 'fbs', conference: 'SEC' };
  await writeFile(join(directory, 'published', 'weekly-picks.json'), JSON.stringify({ ...slate,
    teams: [...slate.teams, secHome, secAway],
    games: [game, { ...game, id: '1', home: secHome.id, away: secAway.id }],
  }));
  const preliminary = { ...official, ReportType: 'Friday Update', publishDate: '2026-11-20', postedTime: '21:00:00' };
  await writeFile(join(directory, 'B12-publish.json'), JSON.stringify({ preliminary }));

  const workflowOutput = join(directory, 'workflow-output');
  const publisher = fileURLToPath(new URL('../scripts/publish-player-availability.js', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, [publisher, '--mode', 'overnight',
    '--source-dir', directory, '--at', '2026-11-21T07:45:00.000Z'], {
    cwd: directory, env: { ...process.env, GITHUB_OUTPUT: workflowOutput },
  });
  assert.match(stdout, /Checked 1 of 2 due conference feeds/);
  assert.equal(await readFile(workflowOutput, 'utf8'), 'incomplete=true\n');
  const artifact = JSON.parse(await readFile(join(directory, 'published', 'team-availability', `${byu.id}.json`), 'utf8'));
  assert.equal(artifact.reports[0].reportAt, '2026-11-21T03:00:00.000Z');
  assert.equal(artifact.reports[0].final, false);
});

test('keeps only reports for the exact rescheduled kickoff', () => {
  const old = mergeAvailability(new Map(), parse({ official }));
  const revisedKickoff = '2026-11-22T17:00:00.000Z';
  const revised = buildAvailabilitySchedule({ ...slate, games: [{ ...game, startDate: revisedKickoff }] });
  const now = '2026-11-22T15:52:00.000Z';
  assert.equal(planAvailabilityChecks(revised, old, { now, mode: 'game-day' }).size, 1);
  const report = { ...official, publishDate: '2026-11-22', footer: { ...official.footer, date: '2026-11-22' } };
  const refreshed = parseOfficialAvailability({ report }, revised, 'Big 12', { checkedAt: now, previous: old });
  assert.deepEqual(mergeAvailability(old, refreshed).get('252').reports.map(item => item.kickoff), [revisedKickoff]);
});

test('uses the anonymous public conference report endpoint', async () => {
  const payload = { report: official };
  const result = await fetchOfficialAvailability('Big 12', async (url, request) => {
    assert.equal(url, 'https://app.hdintelligence.com/api/get-publish-public');
    assert.equal(request.method, 'POST');
    assert.deepEqual(Object.keys(request.headers).sort(), ['Accept', 'Content-Type']);
    assert.deepEqual(JSON.parse(request.body), { sport: 'Football', organization: 'B12', conference: 'B12' });
    return { ok: true, json: async () => payload };
  });
  assert.equal(result, payload);
});
