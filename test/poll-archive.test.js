import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { archiveApHistory } from '../scripts/archive-ap-history.js';
import { archiveCfpHistory } from '../scripts/archive-cfp-history.js';
import { normalizePollEditions, selectPregamePoll } from '../src/poll-history.js';
import { saveApComparisonEdition } from '../src/poll-comparison.js';

const rankings = Array.from({ length: 26 }, (_, i) => ({ id: String(i + 1), name: `Team ${i + 1}`, division: 'fbs' }));
const snapshot = { season: 2026, rankings };
const ap = () => JSON.stringify({ rankings: [{ name: 'AP Top 25', season: { year: 2026 }, date: '2026-11-16T08:00Z',
  ranks: rankings.slice(0, 25).map((team, i) => ({ current: i + 1, team: { id: team.id } })) }] });
function cfp() {
  const payload = []; const ref = value => (payload.push(value), payload.length - 1);
  const rows = rankings.slice(0, 25).map((team, i) => ref({ rank: ref(i + 1), team: ref(team.name) }));
  const edition = ref({ releaseDate: ref('2026-11-17T00:00:00'), year: ref(2026), teams: ref(rows) });
  ref({ rankingsByYear: ref({ 2026: ref([edition]) }) });
  return `<script id="__NUXT_DATA__">${JSON.stringify(payload)}</script>`;
}

test('future AP archival preserves first observed availability and refuses retrospective row replacement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ap-archive-')); const path = join(directory, 'history.json');
  try {
    assert.equal(await archiveApHistory({ text: ap(), snapshot, path, observedAt: '2026-11-16T20:00:00Z' }), true);
    const first = await readFile(path, 'utf8');
    assert.equal(await archiveApHistory({ text: ap(), snapshot, path, observedAt: '2026-11-17T20:00:00Z' }), false);
    assert.equal(await readFile(path, 'utf8'), first);
    const history = JSON.parse(first); const editions = normalizePollEditions(history.editions.ap, rankings);
    assert.equal(selectPregamePoll({ startDate: '2026-11-16T19:00:00Z' }, editions, history.releases.ap).edition, null);
    assert.ok(selectPregamePoll({ startDate: '2026-11-16T21:00:00Z' }, editions, history.releases.ap).edition);
    const correction = JSON.parse(ap()); correction.rankings[0].ranks[24].team.id = '26';
    await assert.rejects(archiveApHistory({ text: JSON.stringify(correction), snapshot, path, observedAt: '2026-11-17T20:00:00Z' }), /reconciliation/);
    await assert.rejects(archiveApHistory({ text: 'invalid JSON', snapshot, path }), /invalid JSON/);
    assert.equal(await readFile(path, 'utf8'), first);
  } finally { await rm(directory, { recursive: true }); }
});

test('CFP archival can reuse an already downloaded official response with no additional requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cfp-history-')); const path = join(directory, 'history.json');
  try {
    assert.equal(await archiveCfpHistory({ html: cfp(), snapshot, path, now: '2026-11-18T20:00:00Z' }), 1);
    const first = await readFile(path, 'utf8');
    assert.equal(await archiveCfpHistory({ html: cfp(), snapshot, path, now: '2026-11-19T20:00:00Z' }), 0);
    assert.equal(await readFile(path, 'utf8'), first);
    assert.equal(JSON.parse(first).editions.cfp[0].rows[0].id, '1');
  } finally { await rm(directory, { recursive: true }); }
});

test('AP comparison shares exact ranks without inventing a cutoff or replacing a saved edition', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ap-comparison-')); const path = join(directory, 'comparison.json');
  try {
    const existing = { week: 10, released: '2026-11-08', gamesThrough: '2026-11-07', rows: [{ team: 'Old team' }] };
    await writeFile(path, JSON.stringify({ season: 2026, polls: { ap: [existing] }, sor: [] }));
    const edition = { released: '2026-11-16', observedAt: '2026-11-16T20:00Z', kind: 'weekly', url: 'https://example.test/ap',
      publication: { precision: 'observed', sourceUrl: 'https://example.test/ap' },
      rows: rankings.slice(0, 25).map((team, i) => ({ id: team.id, team: team.name, rank: i + 1 })) };
    assert.equal(await saveApComparisonEdition({ path, season: 2026, edition, week: 11 }), true);
    const saved = await readFile(path, 'utf8'); const archive = JSON.parse(saved);
    assert.deepEqual(archive.polls.ap[0], existing);
    assert.equal(archive.polls.ap[1].gamesThrough, null);
    assert.deepEqual(archive.polls.ap[1].rows, edition.rows);
    assert.equal(await saveApComparisonEdition({ path, season: 2026, edition, week: 11 }), false);
    const correction = structuredClone(edition); correction.rows.reverse(); correction.rows[0].rank = 1;
    await assert.rejects(saveApComparisonEdition({ path, season: 2026, edition: correction, week: 11 }), /reconciliation/);
    assert.equal(await readFile(path, 'utf8'), saved);
  } finally { await rm(directory, { recursive: true }); }
});
