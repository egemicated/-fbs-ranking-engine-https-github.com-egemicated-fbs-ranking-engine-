import assert from 'node:assert/strict';
import test from 'node:test';
import { compareTeamUpdates } from '../frontend/my-team-updates.js';

const team = { id: '252' };
const oldDate = '2026-11-08T17:00:00Z';
const newDate = '2026-11-15T17:00:00Z';
const game = (gameId, result, opponentName) => ({ gameId, result, opponentName, finalMargin: 7 });
const report = (reportAt, status, players = []) => ({ teamId: '252', season: 2026, reports: [{
  gameId: '7', opponentName: 'Baylor', reportAt,
  players: [{ playerId: '45', name: 'Player A', status }, ...players],
}] });
const start = { team, season: 2026, rank: 14, method: 'SOR rank', asOf: oldDate, viewedAt: oldDate,
  contributions: [game('3', 'W', 'Utah')], availability: report(oldDate, 'Questionable') };
const current = { ...start, rank: 12, asOf: newDate, viewedAt: newDate,
  contributions: [...start.contributions, game('7', 'W', 'Baylor')],
  availability: report(newDate, 'Out') };

test('first visit and a different favorite team establish a baseline without news', () => {
  const first = compareTeamUpdates(null, start);
  assert.deepEqual(first.updates, []);
  assert.equal(first.next.rank.value, 14);
  assert.equal(first.next.viewedAt, oldDate);
  assert.deepEqual(compareTeamUpdates(first.next, { ...current, team: { id: '254' } }).updates, []);
  assert.deepEqual(compareTeamUpdates(first.next, { ...current, season: 2027 }).updates, []);
});

test('rank, newly completed game and changed availability link to the correct details', () => {
  const prior = compareTeamUpdates(null, start).next;
  const { updates, next, changed } = compareTeamUpdates(prior, current);
  assert.equal(changed, true);
  assert.deepEqual(updates.map(update => [update.title, update.href, update.asOf]), [
    ['SOR rank #14 → #12', '#team/252', newDate],
    ['Win over Baylor by 7', '#team/252/results', newDate],
    ['Player A · Out vs. Baylor', '#team/252/availability', newDate],
  ]);
  assert.deepEqual(compareTeamUpdates(next, current), { updates: [], next, changed: false });
});

test('older, missing and unaligned data do not rewind the last viewed baseline', () => {
  const baseline = compareTeamUpdates(null, current).next;
  assert.deepEqual(compareTeamUpdates(baseline, start), { updates: [], next: baseline, changed: false });
  const mismatch = { ...current, contributions: undefined, availability: { ...current.availability, teamId: '254' } };
  assert.deepEqual(compareTeamUpdates(baseline, mismatch), { updates: [], next: baseline, changed: false });
  const missing = { ...current, contributions: undefined, availability: null };
  assert.deepEqual(compareTeamUpdates(baseline, missing), { updates: [], next: baseline, changed: false });
});

test('old reports and unrelated new available rows do not trigger alerts', () => {
  const alreadyViewed = compareTeamUpdates(null, { ...current, availability: null }).next;
  assert.deepEqual(compareTeamUpdates(alreadyViewed, current).updates, []);
  const oldStatus = compareTeamUpdates(null, start).next;
  const extra = { playerId: '99', name: 'Another Player', status: 'Available' };
  const revised = { ...start, availability: report(newDate, 'Questionable', [extra]), viewedAt: newDate };
  assert.deepEqual(compareTeamUpdates(oldStatus, revised).updates, []);
});
