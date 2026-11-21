import assert from 'node:assert/strict';
import test from 'node:test';
import { preservePublishedKickoffs, reconcileKickoffTimes, reconcilePublishedKickoffs } from '../src/kickoff-times.js';
import { buildWeeklyContestSync } from '../scripts/sync-weekly-contest.js';
import { publicRankings } from '../src/site-publication.js';
import { contestGameLocked, contestPickChanges } from '../frontend/weekly-contest-score.js';
import { renderContestGames } from '../frontend/weekly-contest.js';

const season = 2026;
const observedAt = '2026-11-15T23:30:00.000Z';
const initialStartDate = '2026-11-21T05:00:00.000Z';
const verified = '2026-11-21T17:00:00.000Z';
const picked = { capturedAt: '2026-11-14T17:02:40.824Z', homeWinProbability: 0.24528564139647047, favored: 'away' };
const entry = { id: '401856866', home: '2305', away: '252', week: 12, seasonType: 'regular', neutral: false,
  startDate: initialStartDate, startTimeTbd: true, status: 'scheduled', pick: picked };
const unknown = { ...entry, id: '401858302', home: '2390', away: '265' };
const games = [entry, unknown];
const teams = [...new Set(games.flatMap(game => [game.home, game.away]))].map(id => ({ id, name: id, division: 'fbs' }));
const priorEntry = { ...entry, startDate: verified, startTimeTbd: false, kickoffSource: 'espn',
  kickoffOriginalDate: initialStartDate, kickoffVerifiedAt: observedAt };
const snapshot = { season, asOf: '2026-11-15T18:04:41.489Z', snapshotHash: 'base', publicationHash: 'rankings',
  source: { provider: 'cfbd', fetchedAt: '2026-11-15T18:04:39.844Z' }, rankings: teams };
const weekly = { season, asOf: '2026-11-15T18:04:42.452Z', schemaVersion: 1, games, teams,
  source: { provider: 'cfbd', scheduleAsOf: snapshot.source.fetchedAt, rankingAsOf: snapshot.asOf, snapshotHash: snapshot.snapshotHash } };

test('refresh keeps historical confirmation and leaves new TBD games unresolved without calling a provider', t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw Error('Expected offline reconciliation'); });
  const current = { year: season, teams, games };
  const result = preservePublishedKickoffs(current, { ...weekly, games: [priorEntry] }, observedAt);
  assert.equal(fetch.mock.callCount(), 0);
  assert.deepEqual(result.games, [priorEntry, unknown]);
  assert.equal(result.games[0].pick, picked);
  assert.equal(preservePublishedKickoffs(current, null, observedAt), current);
});

test('an earlier time persists only for the original unchanged placeholder and matchup', () => {
  const options = { season, observedAt: '2026-11-21T08:00:00.000Z', previousGames: [priorEntry] };
  const stale = reconcileKickoffTimes([{ ...entry, status: 'pending' }], teams, options).games[0];
  assert.equal(stale.startDate, verified);
  assert.equal(stale.status, 'scheduled');
  assert.equal(stale.kickoffVerifiedAt, observedAt);
  const changed = [
    { ...entry, startDate: '2026-11-28T05:00:00.000Z' }, { ...entry, week: 13 }, { ...entry, neutral: true },
    { ...entry, home: entry.away, away: entry.home },
    { ...entry, startTimeTbd: false, startDate: '2026-11-21T18:00:00.000Z' },
  ];
  for (const game of changed) assert.equal(reconcileKickoffTimes([game], teams, options).games[0], game);
  assert.equal(reconcileKickoffTimes([entry], teams, { ...options, excludeIds: new Set([entry.id]) }).games[0], entry);
  assert.equal(reconcileKickoffTimes([entry], teams, { ...options, observedAt: weekly.asOf }).games[0], entry);
  const final = { ...entry, status: 'final', homePoints: 21, awayPoints: 31 };
  const retainedFinal = reconcileKickoffTimes([final], teams, { ...options, observedAt: '2026-11-21T21:00:00.000Z' }).games[0];
  assert.equal(retainedFinal.startDate, verified);
  assert.equal(retainedFinal.awayPoints, 31);
});

test('first saved kickoff sync marks existing TBD flags without modifying a schedule or prediction', () => {
  const initialized = reconcilePublishedKickoffs(snapshot, weekly, { observedAt });
  assert.deepEqual(initialized.unresolved, games.map(game => game.id));
  assert.equal(initialized.weekly.kickoffVerificationAsOf, observedAt);
  assert.equal(initialized.weekly.source, weekly.source);
  assert.equal(initialized.weekly.games, games);
  assert.notEqual(publicRankings(initialized.snapshot, '/teams', true).teamDetailsVersion,
    publicRankings(snapshot, '/teams', true).teamDetailsVersion);
  const payload = buildWeeklyContestSync(initialized.weekly, new Date(observedAt));
  assert.equal(payload.p_games.length, games.length);
  assert.equal(payload.p_observed_at, observedAt);
  assert.equal(payload.p_games[0].startTimeTbd, true);
  assert.equal(payload.p_games[0].modelCapturedAt, picked.capturedAt);
  const next = reconcilePublishedKickoffs(initialized.snapshot, initialized.weekly, { observedAt: '2026-11-16T00:00:00.000Z' });
  assert.equal(next.weekly, initialized.weekly);
});

test('unresolved contest rows retain existing picks and cannot use the placeholder as a deadline', () => {
  const game = { ...entry, modelTeam: entry.away, homeWinProbability: picked.homeWinProbability };
  const now = Date.parse(observedAt);
  assert.equal(contestGameLocked(game, now), true);
  assert.deepEqual(contestPickChanges([game], {}, { [game.id]: game.home }, now), {});
  const html = renderContestGames([game], { signedIn: true, now, saved: { [game.id]: game.away } });
  assert.match(html, /Time TBD/);
  assert.match(html, /Pick saved/);
  assert.match(html, /aria-pressed="true" disabled/);
  assert.doesNotMatch(html, /2026-11-21T05:00/);
  const known = { ...game, startTimeTbd: false, startDate: verified };
  assert.equal(contestGameLocked(known, Date.parse(initialStartDate)), false);
  assert.equal(contestGameLocked(known, Date.parse(verified)), true);
});
