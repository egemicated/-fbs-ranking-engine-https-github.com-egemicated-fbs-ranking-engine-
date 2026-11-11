import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRankingHistory, rankingHistoryMarkup } from '../frontend/ranking-history.js';

function fixture() {
  const row = (id, rank, sor) => ({ id, team: id === 'a' ? 'Alpha' : 'Beta', rank, sor, wins: 8, losses: 1,
    record: '8–1', weekGames: [{ result: 'W', opponentId: 'x', opponentName: '<Opponent>', margin: 7, opponentRank: 12 }] });
  return { schemaVersion: 1, season: 2026, editions: [
    { week: 9, seasonType: 'regular', kind: 'replay', complete: true, modelId: 'sor', asOf: '2026-11-01T06:00:00Z',
      gamesThrough: '2026-10-31', released: '2026-11-08', rows: [row('a', 24, null), row('b', 26, null)] },
    { week: 10, seasonType: 'regular', kind: 'saved', complete: true, modelId: 'sor', asOf: '2026-11-08T19:00:00Z',
      gamesThrough: '2026-11-07', released: '2026-11-08', rows: [row('b', 20, 1.2), row('a', 28, 1)] }
  ] };
}

test('weekly movement preserves replay provenance and unknown score changes', () => {
  const data = fixture();
  const comparison = compareRankingHistory(data);
  assert.equal(comparison.risers[0].team, 'Beta');
  assert.equal(comparison.risers[0].movement, 6);
  assert.equal(comparison.fallers[0].movement, -4);
  assert.deepEqual(comparison.arrivals.map(row => row.id), ['b']);
  assert.deepEqual(comparison.departures.map(row => row.id), ['a']);
  assert.equal(comparison.rows[0].scoreChange, null);
  const html = rankingHistoryMarkup(comparison);
  assert.match(html, /After Week 9 replay/);
  assert.match(html, /SOR score changes become available between saved editions/);
  assert.match(html, /Beat #12 &lt;Opponent&gt; by 7/);
  assert.doesNotMatch(html, /<Opponent>/);
});

test('the first edition has no invented movers or arrivals', () => {
  const comparison = compareRankingHistory(fixture(), 9);
  assert.equal(comparison.previous, null);
  assert.equal(comparison.risers.length, 0);
  assert.equal(comparison.arrivals.length, 0);
  assert.equal(comparison.rows[0].movement, null);
});

test('movement comparisons require a shared calculation method and retain partial labels', () => {
  const data = fixture();
  data.editions[1].modelId = 'other-sor';
  data.editions[1].complete = false;
  const comparison = compareRankingHistory(data);
  assert.equal(comparison.previous, null);
  assert.match(rankingHistoryMarkup(comparison), /Movement is provisional/);
  assert.throws(() => compareRankingHistory({ ...data, editions: [{ ...data.editions[0], rows: [data.editions[0].rows[0], data.editions[0].rows[0]] }] }), /identities/);
});
