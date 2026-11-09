import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readCfpEdition, saveCfpEdition } from '../src/cfp-poll.js';

const schedule = { week: 10, gamesThrough: '2026-11-07', released: '2026-11-10' };
const teamNames = ['USC', ...Array.from({ length: 24 }, (_, index) => `Team ${index + 2}`)];
const sourceRows = teamNames.map((team, index) => ({
  rank: index + 1, team: index === 0 ? 'Southern California' : team, record: '7-2'
}));

function officialPage(rows = sourceRows, date = schedule.released) {
  const values = [];
  function ref(value) {
    values.push(value);
    return values.length - 1;
  }
  const refs = rows.map(({ rank, team, record }) => ref({ rank: ref(rank), team: ref(team), record: ref(record) }));
  const week = ref({ releaseDate: ref(`${date}T00:00:00`), year: ref(2026), teams: ref(refs) });
  ref({ rankingsByYear: ref({ 2026: ref([week]) }) });
  return `<img alt="CFP Top 25 November 10 2026"><script type="application/json" id="__NUXT_DATA__">${JSON.stringify(values)}</script>`;
}

test('reads the exact CFP release with all 25 canonical teams in rank order', async () => {
  const edition = await readCfpEdition(schedule, teamNames, async url => {
    assert.equal(url, 'https://collegefootballplayoff.com/rankings');
    return new Response(officialPage(sourceRows.toReversed()));
  });
  assert.deepEqual(edition, {
    ...schedule, url: 'https://collegefootballplayoff.com/rankings',
    rows: teamNames.map(team => ({ team, record: '7–2' }))
  });
});

test('ignores a future promotion when the official archive still has the previous release', async () => {
  const edition = await readCfpEdition(schedule, teamNames, async () => new Response(officialPage(sourceRows, '2026-11-03')));
  assert.equal(edition, null);
});

test('rejects failed requests and incomplete or ambiguous official results', async () => {
  await assert.rejects(readCfpEdition(schedule, teamNames, async () => new Response('', { status: 503 })), /HTTP 503/);
  await assert.rejects(readCfpEdition(schedule, teamNames, async () => new Response('<html>Unavailable</html>')), /structured data/);
  await assert.rejects(readCfpEdition(schedule, teamNames, async () => new Response(officialPage(sourceRows.slice(0, 24)))), /25 teams/);
  const duplicate = [...sourceRows.slice(0, 24), { ...sourceRows[0], rank: 25 }];
  await assert.rejects(readCfpEdition(schedule, teamNames, async () => new Response(officialPage(duplicate))), /unique teams/);
});

test('publishes a new CFP edition, keeps the rest of the archive and skips identical editions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cfp-archive-'));
  const path = join(directory, 'ranking-editions.json');
  const previous = { week: 9, gamesThrough: '2026-10-31', released: '2026-11-03', url: 'https://collegefootballplayoff.com/news/2026/11/3/rankings', rows: [] };
  const original = { season: 2026, sor: [{ week: 10 }], polls: { ap: [{ week: 10 }], coaches: [{ week: 10 }], cfp: [previous] } };
  const edition = await readCfpEdition(schedule, teamNames, async () => new Response(officialPage()));
  try {
    await writeFile(path, JSON.stringify(original));
    assert.equal(await saveCfpEdition(path, edition), true);
    const updated = await readFile(path, 'utf8');
    assert.deepEqual(JSON.parse(updated), { ...original, polls: { ...original.polls, cfp: [previous, edition] } });
    assert.equal(await saveCfpEdition(path, edition), false);
    await assert.rejects(saveCfpEdition(path, { ...edition, released: '2026-11-11' }), /different CFP edition/);
    await assert.rejects(saveCfpEdition(path, { ...edition, released: '2027-11-10', gamesThrough: '2027-11-07' }), /does not match CFP season/);
    assert.equal(await readFile(path, 'utf8'), updated);
  } finally {
    await rm(directory, { recursive: true });
  }
});
