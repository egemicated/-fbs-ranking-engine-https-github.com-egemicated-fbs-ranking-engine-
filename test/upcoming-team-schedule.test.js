import assert from 'node:assert/strict';
import test from 'node:test';
import fcsEvidence from '../data/fcs-matchup-validation.json' with { type: 'json' };
import { buildUpcomingTeamSchedule, publicRankings, publicTeamDetails } from '../src/site-publication.js';
import { matchupValidation } from '../src/site-validation.js';

const asOf = '2026-11-15T18:04:41.489Z';
const fetchedAt = '2026-11-15T18:04:39.844Z';
const weekCapture = '2026-11-15T18:04:42.540Z';
const teams = [
  { id: 'a', name: 'Alpha', division: 'fbs', strength: 9 },
  { id: 'b', name: 'Beta', division: 'fbs', strength: 3 },
  { id: 'c', name: 'Charlie', division: 'fcs', strength: 2 },
  { id: 'd', name: 'Delta', division: 'fcs', strength: -2 },
  { id: 'idle', name: 'Idle', division: 'fcs', strength: 0 },
  { id: 'e', name: 'Echo', division: 'ii', strength: -10 },
];
const snapshot = { season: 2026, asOf, source: { provider: 'cfbd', fetchedAt }, snapshotHash: 'ranking-data',
  publicationHash: 'published-ranks', modelVersion: fcsEvidence.modelVersion, config: fcsEvidence.strengthConfig,
  rankings: teams.filter(t => t.division === 'fbs'), fcsRankings: teams.filter(t => t.division === 'fcs'), ratings: teams };
const fixture = (id, home, away, startDate, extra = {}) => ({ id, home, away, startDate, neutral: false, ...extra });
const upcoming = [
  fixture('fbs', 'a', 'b', '2026-11-23T20:00:00Z'),
  fixture('cross', 'b', 'c', '2026-11-21T21:00:00Z', { neutral: true }),
  fixture('fcs', 'c', 'd', '2026-11-21T17:30:00Z', { startTimeTbd: true }),
  fixture('lower', 'e', 'c', '2026-11-28T17:30:00Z'),
];
const artifact = (fcs, games, source = {}) => ({ schemaVersion: 1, season: snapshot.season, asOf: weekCapture,
  source: { provider: 'cfbd', scheduleAsOf: fetchedAt, rankingAsOf: asOf, snapshotHash: snapshot.snapshotHash,
    ...(fcs ? { matchupScope: 'fcs-fcs' } : {}), calibrated: true, ...source },
  teams, games: games.map(game => ({ status: 'scheduled', ...game })) });
const track = (game, homeWinProbability, capturedAt = weekCapture) => ({ ...game,
  pick: { capturedAt, homeWinProbability, favored: homeWinProbability > 0.5 ? 'home' : 'away' } });
const logistic = (margin, scale) => 1 / (1 + Math.exp(-margin / scale));

test('aligned slates supply saved odds, current model estimates, and venue from either team perspective', () => {
  const fbs = artifact(false, [upcoming[0], track(upcoming[1], .7)]);
  const fcs = artifact(true, [{ ...upcoming[2], week: 12, seasonType: 'regular' }]);
  const schedule = buildUpcomingTeamSchedule({ ...snapshot, futureFixtures: upcoming }, fbs, fcs);
  const [peer, cross, lower] = schedule.get('c');
  assert.deepEqual(peer, { gameId: 'fcs', week: 12, seasonType: 'regular', homeId: 'c', awayId: 'd', homeName: 'Charlie', awayName: 'Delta',
    opponentId: 'd', opponentName: 'Delta', startDate: '2026-11-21T17:30:00.000Z',
    venue: 'home', startTimeTbd: true, winProbability: logistic(6.5, fcsEvidence.scale),
    probabilitySource: 'estimate', calibrated: true });
  assert.equal(schedule.get('d')[0].venue, 'away');
  assert.equal(schedule.get('d')[0].winProbability, 1 - peer.winProbability);
  assert.equal(cross.venue, 'neutral');
  assert.equal(cross.probabilitySource, 'saved');
  assert.equal(cross.winProbability, 1 - .7);
  assert.equal(cross.calibrated, false);
  assert.deepEqual(lower, { gameId: 'lower', homeId: 'e', awayId: 'c', homeName: 'Echo', awayName: 'Charlie',
    opponentId: 'e', opponentName: 'Echo', startDate: '2026-11-28T17:30:00.000Z',
    venue: 'away', winProbability: null, probabilitySource: null, calibrated: false });
  assert.equal(schedule.get('a')[0].winProbability, logistic(8.5, matchupValidation(snapshot).winProbability.scale));
  assert.deepEqual(schedule.get('idle'), []);
});

test('past and stale fallback games stay out of profiles, and invalid saved odds use the current model', () => {
  const [peer, cross, fcs] = upcoming;
  const past = fixture('past', 'a', 'b', '2026-11-12T18:00:00.000Z');
  const fbs = artifact(false, [track(peer, .8, '2026-11-24T01:00:00Z'), cross, { ...past, status: 'final' }]);
  const fcsPicks = artifact(true, [track(fcs, .72)]);
  const schedule = buildUpcomingTeamSchedule(snapshot, fbs, fcsPicks);
  assert.deepEqual(schedule.get('a').map(game => game.probabilitySource), ['estimate']);
  assert.equal(schedule.get('b')[0].winProbability, logistic(1, snapshot.config.probabilityScale));
  assert.equal(schedule.get('b')[0].calibrated, false);
  assert.equal(schedule.get('c')[0].winProbability, .72);
  assert.equal(schedule.get('c')[0].probabilitySource, 'saved');
  assert.equal(schedule.get('c')[0].calibrated, true);
  const stale = artifact(true, [fcs], { scheduleAsOf: asOf });
  const partial = buildUpcomingTeamSchedule(snapshot, fbs, stale);
  assert.equal(partial.get('c'), undefined);
  assert.equal(partial.get('b').length, 2);
  const summary = publicRankings(snapshot, '/rankings/teams', true);
  const details = publicTeamDetails(snapshot, snapshot.fcsRankings[0],
    { upcomingGames: schedule.get('c'), includeTeamSchedule: true });
  assert.equal(details.teamDetailsVersion, summary.teamDetailsVersion);
  assert.equal(details.publicationHash, summary.publicationHash);
  assert.notEqual(publicRankings({ ...snapshot, source: { provider: 'cfbd', fetchedAt: asOf } }, '/rankings/teams', true).teamDetailsVersion,
    summary.teamDetailsVersion);
  assert.equal(publicTeamDetails(snapshot, snapshot.rankings[0]).upcomingGames, null);
});
