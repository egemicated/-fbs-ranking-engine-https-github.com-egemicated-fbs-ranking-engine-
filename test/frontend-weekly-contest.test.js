import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contestGames, contestGameLocked, contestGameWinner, contestPickChanges,
  defaultContestWeek, scoreContestPicks,
} from '../frontend/weekly-contest-score.js';
import { renderContestDeadline, renderContestGames, renderContestLeaderboard, renderContestPlayerPicks, renderContestScores } from '../frontend/weekly-contest.js';

const startDate = '2026-11-14T19:00:00Z';
const modelCapturedAt = '2026-11-08T19:00:00Z';
const game = (id, change = {}) => ({ id, home: `h-${id}`, away: `a-${id}`, homeName: `Home ${id}`, awayName: `Away ${id}`,
  week: 11, seasonType: 'regular', startDate, modelCapturedAt, homeWinProbability: .7,
  modelTeam: `h-${id}`, status: 'scheduled', eligible: true, locked: false, ...change });
const publication = games => ({ season: 2026, observedAt: modelCapturedAt, serverNow: '2026-11-10T12:00:00Z', games });
const final = (id, change = {}) => game(id, { status: 'final', locked: true, homePoints: 21, awayPoints: 7, winner: `h-${id}`, ...change });

test('the contest admits only actual saved pregame favorites and retains voided records', () => {
  const rows = [game('ok'), game('replay', { eligible: false, modelTeam: null }),
    game('late', { modelCapturedAt: startDate }), game('even', { homeWinProbability: .5 }),
    game('mismatch', { modelTeam: 'a-mismatch' }), game('unknown', { eligible: false }),
    game('void', { eligible: false, voidReason: 'Game no longer available for contest scoring' })];
  assert.deepEqual(contestGames(publication(rows)).map(game => game.id), ['ok', 'void']);
  assert.throws(() => contestGames(publication([game('same'), game('same')])), /Invalid weekly contest game/);
  assert.throws(() => contestGames({ ...publication([]), serverNow: null }), /Invalid weekly contest/);
});

test('a game locks at its own kickoff, on the server flag, and when voided', () => {
  const kickoff = Date.parse(startDate);
  assert.equal(contestGameLocked(game('one'), kickoff - 1), false);
  assert.equal(contestGameLocked(game('one'), kickoff), true);
  assert.equal(contestGameLocked(game('one', { locked: true }), kickoff - 1), true);
  assert.equal(contestGameLocked(game('one', { voidReason: 'Schedule changed' }), kickoff - 1), true);
  assert.deepEqual(contestPickChanges([game('one'), game('two', { locked: true })],
    { one: 'h-one', two: 'h-two' }, { one: 'a-one', two: 'a-two', invented: 'x' }, kickoff - 1), { one: 'a-one' });
  assert.deepEqual(contestPickChanges([game('one')], {}, { one: 'a-one' }, kickoff), {});
});

test('all games in a slate respect the Pacific deadline while keeping their kickoff times', () => {
  const lockAt = '2026-11-14T07:59:00Z';
  const lock = Date.parse(lockAt);
  const games = [game('first', { lockAt, weeklyLockAt: lockAt }),
    game('later', { startDate: '2026-11-15T02:00:00Z', lockAt, weeklyLockAt: lockAt })];
  assert.equal(contestGameLocked(games[0], lock - 1), false);
  assert.equal(contestGameLocked(games[1], lock - 1), false);
  assert.equal(contestGameLocked(games[0], lock), true);
  assert.equal(contestGameLocked(games[1], lock), true);
  assert.deepEqual(contestPickChanges(games, {}, { later: 'a-later' }, lock), {});
  const deadline = renderContestDeadline(games, 'regular:11', lock - 1);
  assert.match(deadline, /Week 11 pick deadline/);
  assert.match(deadline, /Fri, Nov 13, 11:59 p\.m\. PT/);
  assert.match(renderContestDeadline(games, 'regular:11', lock), /Week 11 picks closed/);
  assert.match(renderContestDeadline([game('old')], 'regular:11'), /Week 11 picks lock at each game’s kickoff/);
  assert.match(renderContestGames(games, { now: lock }), /Kickoff · <time datetime="2026-11-15T02:00:00Z">.*?MT/);
});

test('head to head grades the exact same decided saved-game cohort for both players', () => {
  const games = [final('one'), final('two'), final('unpicked'), game('pending'),
    final('void', { eligible: false, voidReason: 'Matchup changed' }),
    final('past', { week: 10, awayPoints: 28, winner: 'a-past' })];
  const picks = { one: 'h-one', two: 'a-two', pending: 'a-pending', void: 'h-void', past: 'a-past' };
  assert.deepEqual(scoreContestPicks(games, picks, 'regular:11'), {
    picked: 3, correct: 1, wrong: 1, pending: 1, voided: 1, graded: 2, points: 1,
    modelCorrect: 2, accuracy: .5, modelAccuracy: 1,
  });
  assert.equal(scoreContestPicks(games, picks).points, 2);
  assert.equal(scoreContestPicks(games, picks).modelCorrect, 2);
  assert.equal(scoreContestPicks(games, picks).graded, 3);
  assert.equal(scoreContestPicks(games, {}).accuracy, null);
});

test('grading requires a matching verified winner and valid final scores', () => {
  assert.equal(contestGameWinner(final('one')), 'h-one');
  for (const change of [{ winner: 'a-one' }, { homePoints: null }, { homePoints: 7 }, { status: 'pending' }, { voidReason: 'Excluded' }]) {
    assert.equal(contestGameWinner(final('one', change)), null);
  }
});

test('default week selects the next open cohort and retains completed records', () => {
  const games = [final('old', { week: 10 }), game('soon'), game('later', { week: 12, startDate: '2026-11-21T19:00:00Z' })];
  assert.equal(defaultContestWeek(games, Date.parse('2026-11-10T12:00:00Z')), 'regular:11');
  assert.equal(defaultContestWeek(games, Date.parse('2026-12-01T12:00:00Z')), 'regular:12');
  assert.equal(defaultContestWeek([]), '');
});

test('cards distinguish unsaved, saved, locked, and completed selections while escaping names', () => {
  const rows = [game('open', { homeName: '<img src=x onerror=alert(1)>' }), final('done')];
  const html = renderContestGames(rows, { saved: { open: 'h-open', done: 'h-done' }, draft: { open: 'a-open', done: 'a-done' }, signedIn: true,
    now: Date.parse('2026-11-10T12:00:00Z') });
  assert.match(html, /Unsaved selection/);
  assert.match(html, /Your pick: correct · \+1 point/);
  assert.match(html, /data-contest-game="done" data-contest-team="h-done"\s+aria-pressed="true" disabled/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(renderContestGames([game('one')]), /aria-pressed="true"/);
});

test('empty scorecards use a pending state and leaderboards preserve server tie ranks', () => {
  const scores = renderContestScores([final('one')], {}, 'regular:11');
  assert.match(scores, /No decided saved picks yet/);
  assert.doesNotMatch(scores, /0\.0%/);
  const row = nickname => ({ rank: 1, nickname, points: 2, correct: 2, graded: 3, picked: 4, modelCorrect: 1, compared: 3 });
  const html = renderContestLeaderboard({ rows: [row('First'), row('<script>bad</script>')], me: { ...row('Private me'), rank: 4 }, model: { correct: 7, graded: 10 } }, 'Week 11');
  assert.equal((html.match(/<td>1<\/td>/g) ?? []).length, 2);
  assert.match(html, /Private me/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /Model overall: 7 of 10/);
  assert.doesNotMatch(html, /<script>/);
});

test('leaderboard names open game picks only for players with a public sharing ID', () => {
  const row = { rank: 1, points: 2, correct: 2, graded: 3, picked: 4, modelCorrect: 1, compared: 3 };
  const html = renderContestLeaderboard({ rows: [
    { ...row, nickname: 'Score only' },
    { ...row, nickname: '<Shared name>', publicPickId: 'public-id' },
    { ...row, nickname: 'My name', isYou: true },
  ] }, 'Week 11', 'public-id');
  assert.equal((html.match(/data-contest-player=/g) ?? []).length, 1);
  assert.match(html, /data-contest-player="public-id" aria-label="View picks by &lt;Shared name&gt;" aria-expanded="true"/);
  assert.match(html, /<th scope="row">Score only<\/th>/);
  assert.equal((html.match(/data-contest-sharing-settings/g) ?? []).length, 1);
  assert.match(html, /My name.*?data-contest-sharing-settings>Share picks/s);
});

test('server-published picks show verified grades and include future games', () => {
  const first = { ...final('first', { homeName: '<Home>' }), teamId: 'h-first' };
  const second = { ...final('second'), teamId: 'a-second' };
  const pending = { ...game('pending'), teamId: 'h-pending' };
  const later = { ...game('later', { startDate: '2026-11-15T20:00:00Z' }), teamId: 'h-later' };
  const voided = { ...game('voided', { voidReason: 'Removed game' }), teamId: 'h-voided' };
  const profile = { picks: [first, second, pending, later, voided] };
  assert.match(renderContestPlayerPicks({ picks: [] }), /No shared picks for this selection yet/);
  const html = renderContestPlayerPicks(profile);
  assert.match(html, /Player pick.*?&lt;Home&gt;/s);
  assert.match(html, /Model pick/);
  assert.match(html, /is-correct">Correct/);
  assert.match(html, /is-wrong">Miss/);
  assert.match(html, />Pending<\/dd>/);
  assert.match(html, /Away later at Home later/);
  assert.doesNotMatch(html, /voided|<Home>/);
});
