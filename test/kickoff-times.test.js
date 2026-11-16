import assert from 'node:assert/strict';
import test from 'node:test';
import board from './fixtures/espn-week-12-kickoffs.json' with { type: 'json' };
import { fetchKickoffBoards, reconcileKickoffTimes, reconcilePublishedKickoffs } from '../src/kickoff-times.js';
import { buildWeeklyContestSync } from '../scripts/sync-weekly-contest.js';
import { publicRankings } from '../src/site-publication.js';
import { contestGameLocked, contestPickChanges } from '../frontend/weekly-contest-score.js';
import { renderContestGames } from '../frontend/weekly-contest.js';

const season = 2026;
const observedAt = '2026-11-15T23:30:00.000Z';
const initialStartDate = '2026-11-21T05:00:00.000Z';
const byuKansas = '401856866';
const virginiaTechMiami = '401858302';
const picked = { capturedAt: '2026-11-14T17:02:40.824Z', homeWinProbability: 0.24528564139647047, favored: 'away' };
const games = board.events.map(event => {
  const { competitors, neutralSite: neutral } = event.competitions[0];
  return { id: event.id, home: competitors.find(team => team.homeAway === 'home').id,
    away: competitors.find(team => team.homeAway === 'away').id, week: 12, seasonType: 'regular', neutral,
    startDate: initialStartDate, startTimeTbd: true, status: 'scheduled', pick: picked };
});
const teams = [...new Set(games.flatMap(game => [game.home, game.away]))].map(id => ({ id, name: id, division: 'fbs' }));
const snapshot = { season, asOf: '2026-11-15T18:04:41.489Z', snapshotHash: 'base', publicationHash: 'rankings',
  source: { provider: 'cfbd', fetchedAt: '2026-11-15T18:04:39.844Z' }, rankings: teams,
  futureFixtures: games.map(({ id, home, away, startDate, neutral, startTimeTbd }) => ({ id, home, away, startDate, neutral, startTimeTbd })) };
const weekly = { season, asOf: '2026-11-15T18:04:42.452Z', schemaVersion: 1, games, teams,
  source: { provider: 'cfbd', scheduleAsOf: snapshot.source.fetchedAt, rankingAsOf: snapshot.asOf, snapshotHash: snapshot.snapshotHash } };

test('offline Week 12 slate aligns seven verified kickoffs with profiles, Weekly Picks, and the complete contest sync', () => {
  const update = reconcilePublishedKickoffs(snapshot, weekly, { boards: [board], observedAt });
  assert.equal(update.corrected.length, 7);
  assert.equal(update.unresolved.length, 3);
  const byu = update.weekly.games.find(game => game.id === byuKansas);
  assert.equal(byu.startDate, '2026-11-21T17:00:00.000Z');
  assert.equal(byu.startTimeTbd, false);
  assert.equal(byu.kickoffSource, 'espn');
  assert.deepEqual(byu.pick, picked);
  assert.equal(update.snapshot.futureFixtures.find(game => game.id === byuKansas).startDate, byu.startDate);
  assert.equal(update.snapshot.publicationHash, snapshot.publicationHash);
  assert.notEqual(publicRankings(update.snapshot, '/teams', true).teamDetailsVersion,
    publicRankings(snapshot, '/teams', true).teamDetailsVersion);
  assert.deepEqual(update.weekly.source, weekly.source);
  assert.equal(weekly.games.find(game => game.id === byuKansas).startDate, initialStartDate);
  const payload = buildWeeklyContestSync(update.weekly, new Date(observedAt));
  assert.equal(payload.p_games.length, games.length);
  assert.equal(payload.p_observed_at, observedAt);
  assert.equal(payload.p_games.find(game => game.id === byuKansas).startDate, byu.startDate);
  assert.equal(payload.p_games.find(game => game.id === byuKansas).modelCapturedAt, picked.capturedAt);
  assert.equal(payload.p_games.find(game => game.id === virginiaTechMiami).startTimeTbd, true);
  const next = reconcilePublishedKickoffs(update.snapshot, update.weekly, { boards: [board], observedAt: '2026-11-16T00:00:00.000Z' });
  assert.equal(next.weekly, update.weekly);
});

test('kickoff confirmation rejects uncertain, nonpregame, mismatched, and ambiguous records', () => {
  const entry = games.find(game => game.id === byuKansas);
  const original = board.events.find(event => event.id === byuKansas);
  const mutate = extra => ({ ...original, competitions: [{ ...original.competitions[0], ...extra }] });
  const incompatible = [
    [mutate({ dateValid: false })],
    [mutate({ timeValid: false })],
    [mutate({ neutralSite: true })],
    [mutate({ status: { type: { state: 'in' } } })],
    [mutate({ date: '2026-11-15T23:00Z' })],
    [mutate({ competitors: original.competitions[0].competitors.map(team => ({ ...team, homeAway: team.homeAway === 'home' ? 'away' : 'home' })) })],
    [original, original],
  ];
  for (const events of incompatible) {
    const result = reconcileKickoffTimes([entry], teams, { season, observedAt, boards: [{ ...board, events }] });
    assert.equal(result.games[0], entry);
    assert.deepEqual(result.corrected, []);
  }
  const wrongWeek = reconcileKickoffTimes([entry], teams, { season, observedAt, boards: [{ ...board, week: { number: 11 } }] });
  assert.deepEqual(wrongWeek.corrected, []);
  const canceled = reconcileKickoffTimes([entry], teams, { season, observedAt, boards: [board], excludeIds: new Set([entry.id]) });
  assert.deepEqual(canceled.corrected, []);
});

test('a previous confirmation persists only for the original unchanged placeholder and matchup', () => {
  const entry = games.find(game => game.id === byuKansas);
  const first = reconcileKickoffTimes([entry], teams, { season, observedAt, boards: [board] });
  const nextOptions = { season, observedAt: '2026-11-21T08:00:00.000Z', previousGames: first.games };
  const stale = reconcileKickoffTimes([{ ...entry, status: 'pending' }], teams, nextOptions).games[0];
  assert.equal(stale.startDate, first.games[0].startDate);
  assert.equal(stale.status, 'scheduled');
  assert.equal(stale.kickoffVerifiedAt, first.games[0].kickoffVerifiedAt);
  const futurePlaceholder = { ...entry, startDate: '2026-11-28T05:00:00.000Z' };
  assert.equal(reconcileKickoffTimes([futurePlaceholder], teams, nextOptions).games[0], futurePlaceholder);
  const final = { ...entry, status: 'final', homePoints: 21, awayPoints: 31 };
  const retainedFinal = reconcileKickoffTimes([final], teams, { ...nextOptions, observedAt: '2026-11-21T21:00:00.000Z' }).games[0];
  assert.equal(retainedFinal.startDate, first.games[0].startDate);
  assert.equal(retainedFinal.awayPoints, 31);
});

test('the first kickoff check carries existing TBD flags even without a confirmed update', () => {
  const initialized = reconcilePublishedKickoffs(snapshot, weekly, { observedAt });
  assert.equal(initialized.corrected.length, 0);
  assert.equal(initialized.unresolved.length, 10);
  assert.equal(initialized.weekly.kickoffVerificationAsOf, observedAt);
  const next = reconcilePublishedKickoffs(initialized.snapshot, initialized.weekly, { observedAt: '2026-11-16T00:00:00.000Z' });
  assert.equal(next.weekly, initialized.weekly);
});

test('only one public ESPN request is made per required competition week and failures leave the slate unchanged', async () => {
  const requested = [];
  const response = await fetchKickoffBoards(games, teams, { season, observedAt, fetcher: async url => {
    requested.push(new URL(url));
    return { ok: true, json: async () => board };
  } });
  assert.deepEqual(response, [board]);
  assert.equal(requested.length, 1);
  assert.equal(requested[0].hostname, 'site.api.espn.com');
  assert.equal(requested[0].searchParams.get('week'), '12');
  assert.deepEqual(await fetchKickoffBoards(games, teams, { season, observedAt, fetcher: async () => { throw new Error('offline'); } }), []);
});

test('unresolved contest rows keep saved picks visible without showing or using the placeholder deadline', () => {
  const game = { ...games[0], modelTeam: games[0].away, homeWinProbability: picked.homeWinProbability };
  const now = Date.parse(observedAt);
  assert.equal(contestGameLocked(game, now), true);
  assert.deepEqual(contestPickChanges([game], {}, { [game.id]: game.home }, now), {});
  const html = renderContestGames([game], { signedIn: true, now, saved: { [game.id]: game.away } });
  assert.match(html, /Time TBD/);
  assert.match(html, /Pick saved/);
  assert.match(html, /aria-pressed="true" disabled/);
  assert.doesNotMatch(html, /2026-11-21T05:00/);
  const known = { ...game, startTimeTbd: false, startDate: '2026-11-21T17:00:00.000Z' };
  assert.equal(contestGameLocked(known, Date.parse(initialStartDate)), false);
  assert.equal(contestGameLocked(known, Date.parse(known.startDate)), true);
});
