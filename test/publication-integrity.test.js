import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPublicationBundle } from '../src/publication-integrity.js';

const snapshot = { season: 2026, snapshotHash: 'same-source', fcsRankings: [{ id: 'fcs' }] };
const picks = () => ({ season: 2026, source: { snapshotHash: 'same-source' }, games: [] });
const bundle = () => ({ fbsPicks: picks(), fcsPicks: picks(), conferences: {
  manifest: { seasons: [2026, 2025] }, datasets: [{ season: 2026, source: { snapshotHash: 'same-source' } }],
} });

test('a coherent publication bundle passes without changing any source', () => {
  const input = bundle(), before = JSON.stringify(input);
  assert.equal(assertPublicationBundle(snapshot, input), true);
  assert.equal(JSON.stringify(input), before);
});

test('stale picks or missing current conference evidence stop publication rather than degrade silently', () => {
  for (const division of ['fbsPicks', 'fcsPicks']) {
    const input = bundle(); input[division].source.snapshotHash = 'older-source';
    assert.throws(() => assertPublicationBundle(snapshot, input), /publication stopped/);
  }
  for (const datasets of [[], [{ season: 2025 }], [{ season: 2026, source: { snapshotHash: 'older-source' } }]]) {
    const input = bundle(); input.conferences.datasets = datasets;
    assert.throws(() => assertPublicationBundle(snapshot, input), /publication stopped/);
  }
});
