import assert from 'node:assert/strict';
import test from 'node:test';
import { attachPollHistory, normalizePollEditions, pollPublicationWindow, selectPregamePoll } from '../src/poll-history.js';

const membership = Array.from({ length: 27 }, (_, i) => ({ id: String(i + 1), name: `Team ${i + 1}`, division: 'fbs', ranks: {} }));
const edition = (released, extra = {}) => ({ released, publication: { precision: 'date', sourceUrl: 'https://example.test/official' },
  rows: membership.slice(0, 25).map((team, index) => ({ id: team.id, team: team.name, rank: index + 1 })), ...extra });
const game = startDate => ({ id: 'game', home: '1', away: '27', startDate, pregame: {}, pregameAsOf: {} });

test('verified release instants use actual kickoff, never provider week or a later final poll', () => {
  const release = edition('2026-11-03', { publishedAt: '2026-11-04T00:30:00Z',
    publication: { precision: 'instant', sourceUrl: 'https://example.test/official' } });
  const next = edition('2026-11-10', { kind: 'final' });
  const editions = normalizePollEditions([release, next], membership);
  assert.equal(selectPregamePoll(game('2026-11-04T00:29:59Z'), editions, [release, next]).status, 'no-poll-yet');
  assert.equal(selectPregamePoll(game('2026-11-04T00:30:00Z'), editions, [release, next]).edition, null);
  assert.equal(selectPregamePoll(game('2026-11-04T00:30:01Z'), editions, [release, next]).edition.released, '2026-11-03');
  assert.equal(selectPregamePoll(game('2026-11-07T20:00:00Z'), editions, [release, next]).edition.released, '2026-11-03');
});

test('date-only release bounds respect Eastern time and DST without claiming same-day publication', () => {
  const autumn = pollPublicationWindow(edition('2026-11-01'));
  assert.equal(new Date(autumn.earliest).toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(new Date(autumn.latest).toISOString(), '2026-11-02T05:00:00.000Z');
  const spring = pollPublicationWindow(edition('2026-03-08'));
  assert.equal(spring.latest - spring.earliest, 23 * 36e5);
  const release = edition('2026-11-03');
  const editions = normalizePollEditions([release], membership);
  assert.equal(selectPregamePoll(game('2026-11-04T01:00:00Z'), editions, [release]).status, 'publication-time-uncertain');
  assert.ok(selectPregamePoll(game('2026-11-04T06:00:00Z'), editions, [release]).edition);
  assert.equal(selectPregamePoll({ ...game('2026-11-04T06:00:00Z'), startTimeTbd: true }, editions, [release]).edition, null);
});

test('missing editions never fall back to a stale poll and sparse archives cannot imply no earlier CFP existed', () => {
  const releases = [edition('2026-11-03'), edition('2026-11-10')];
  const editions = normalizePollEditions([releases[0]], membership);
  assert.equal(selectPregamePoll(game('2026-11-14T20:00:00Z'), editions, releases).status, 'missing');
  assert.equal(selectPregamePoll(game('2026-09-01T20:00:00Z'), editions, releases).status, 'no-poll-yet');
  assert.equal(selectPregamePoll(game('2026-09-01T20:00:00Z'), editions).status, 'missing');
});

test('season-ending AP ranks remain current context and never become a postponed game pregame ranking', () => {
  const weekly = edition('2025-12-07'); const final = edition('2026-01-20', { kind: 'final' });
  const editions = normalizePollEditions([weekly, final], membership);
  assert.equal(selectPregamePoll(game('2026-01-20T00:30:00Z'), editions, [weekly, final]).edition.released, '2025-12-07');
  assert.equal(selectPregamePoll(game('2026-01-24T20:00:00Z'), editions, [weekly, final]).status, 'missing');
  const enriched = attachPollHistory({ season: 2025, teams: Object.fromEntries(membership.map(team => [team.id, team])),
    games: [game('2026-01-24T20:00:00Z')], rankings: {} },
    { schemaVersion: 1, season: 2025, editions: { ap: [weekly, final] }, releases: { ap: [weekly, final] } });
  assert.equal(enriched.rankings.ap.kind, 'final'); assert.equal(enriched.teams['1'].ranks.ap, 1);
  assert.equal(enriched.games[0].pregame.ap, undefined);
});

test('stable identity and complete competition ranks protect confirmed unranked status, including AP ties', () => {
  const tied = edition('2026-08-17'); tied.rows[14].rank = 14;
  assert.equal(normalizePollEditions([tied], membership).length, 1);
  const badId = structuredClone(tied); badId.rows[0].id = 'unknown';
  assert.equal(normalizePollEditions([badId], membership).length, 0);
  const badRank = structuredClone(tied); badRank.rows[16].rank = 15;
  assert.equal(normalizePollEditions([badRank], membership).length, 0);
  assert.equal(normalizePollEditions([{ ...tied, rows: tied.rows.slice(1) }], membership).length, 0);
  assert.throws(() => normalizePollEditions([tied, tied], membership), /Duplicate poll edition/);
});

test('history enrichment preserves original results, membership, and independent model values', () => {
  const release = edition('2026-08-17', { kind: 'preseason' });
  const source = { season: 2026, teams: Object.fromEntries(membership.map(team => [team.id, { ...team, strength: 9 }])),
    games: [game('2026-09-01T20:00:00Z')], rankings: { predictive: { basis: 'season-end' } } };
  const before = structuredClone(source);
  const enriched = attachPollHistory(source, { schemaVersion: 1, season: 2026, editions: { ap: [release] }, releases: { ap: [release] } });
  assert.deepEqual(source, before);
  assert.deepEqual(enriched.games[0].pregame.ap, [1, null]);
  assert.deepEqual(enriched.games[0].pregameStatus.ap, ['ranked', 'unranked']);
  assert.deepEqual(enriched.rankings.predictive, source.rankings.predictive);
  assert.equal(enriched.teams['27'].strength, 9);
  assert.equal(enriched.games[0].startDate, source.games[0].startDate);
});
