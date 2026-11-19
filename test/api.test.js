import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../src/server.js';

test('API serves ratings without login, rejects writes, and keeps paths constrained', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fbs-api-'));
  const contribution = { opponentId: 'c', opponentName: 'Opponent', opponentRecord: '3-2', opponentAchievement: 0.6,
    result: 'W', finalMargin: 14 };
  const detail = { contributions: [{ ...contribution, gameId: 'game', adjustedMargin: 9 }],
    explanation: { baseline: 0.5 }, evidence: { connectedTeams: 3 }, preseasonStrength: 1 };
  const current = { season: 2026, snapshotHash: 'current-base', publicationHash: 'current-publication',
    rankings: [{ id: 'a', name: 'Current Team', rank: 2, displayRank: 1, ...detail, sorTailProbability: 0.05, sorExpectedWins: 2 }], ratings: [] };
  const archive = { season: 2025, snapshotHash: 'archive-base', rankings: [{ id: 'b', name: 'Past Team', rank: 1, ...detail }], ratings: [] };
  await Promise.all([writeFile(join(dir, 'latest.json'), JSON.stringify(current)), writeFile(join(dir, '2025.json'), JSON.stringify(archive))]);
  const server = createApi(dir); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [path, source, expectedRow] of [
      ['/rankings', current, { id: 'a', name: 'Current Team', rank: 2, displayRank: 1 }],
      ['/rankings/2025', archive, { id: 'b', name: 'Past Team', rank: 1 }],
    ]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      const summary = await response.json();
      assert.equal(summary.season, source.season);
      assert.equal(summary.teamDetailsPath, `${path}/teams`);
      assert.equal(summary.publicationHash, source.publicationHash ?? source.snapshotHash);
      assert.deepEqual(summary.rankings, [expectedRow]);
      assert.equal(summary.ratings, undefined);

      const teamResponse = await fetch(`${base}${summary.teamDetailsPath}/${expectedRow.id}.json?v=${summary.publicationHash}`);
      assert.equal(teamResponse.status, 200);
      const team = await teamResponse.json();
      assert.deepEqual(team, { id: expectedRow.id, publicationHash: summary.publicationHash,
        upcomingGames: null,
        contributions: [{ ...contribution, gameId: 'game' }], explanation: detail.explanation, evidence: detail.evidence, preseasonStrength: 1,
        ...(source === current ? { sorTailProbability: 0.05, sorExpectedWins: 2 } : {}) });
    }
    assert.equal((await fetch(base + '/rankings', { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + '/rankings/2024')).status, 503);
    assert.equal((await fetch(base + '/rankings/2024/teams/a.json')).status, 503);
    assert.equal((await fetch(base + '/rankings/teams/b.json')).status, 404);
    assert.equal((await fetch(base + '/rankings/2025/teams/a.json')).status, 404);
    assert.equal((await fetch(base + '/rankings/teams/%2e%2e%2F.env.json')).status, 404);
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base + '/health')).status, 200);
    const page = await fetch(base + '/'); assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /The Games Decide/);
    assert.equal((await fetch(base + '/app.js')).status, 200);
    assert.equal((await fetch(base + '/clean-routes.js')).status, 200);
    assert.equal((await fetch(base + '/page-routes.js')).status, 200);
    assert.equal((await fetch(base + '/src/engine.js')).status, 404);
    assert.equal((await fetch(base + '/published/latest.json')).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true }); }
});

test('clean website routes keep direct visits working alongside the preview API', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fbs-preview-routes-'));
  await writeFile(join(dir, 'latest.json'), JSON.stringify({ season: 2026, rankings: [{ id: '252' }], fcsRankings: [{ id: '149' }] }));
  const server = createApi(dir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const open = path => fetch(base + path, { headers: { Accept: 'text/html,application/xhtml+xml' } });
  try {
    for (const [path, canonical] of [
      ['/rankings?model=performance', '/rankings'], ['/rankings/fbs/', '/rankings'],
      ['/weekly-picks?week=regular%3A12&game=401', '/weekly-picks'],
      ['/weekly-picks/fbs/', '/weekly-picks'], ['/scoreboard/', '/scoreboard'],
      ['/team/252?view=results', '/team/252/'], ['/team/149/', '/team/149/'],
    ]) {
      const response = await open(path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.ok((await response.text()).includes(`rel="canonical" href="https://www.thegamesdecide.com${canonical}"`));
    }
    const jsonRankings = await fetch(base + '/rankings', { headers: { Accept: 'application/json' } });
    assert.equal(jsonRankings.headers.get('vary'), 'Accept');
    assert.equal((await jsonRankings.json()).rankings[0].id, '252');
    for (const path of ['/account', '/admin', '/my-teams?team=252']) {
      const response = await open(path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const html = await response.text();
      assert.match(html, /name="robots" content="noindex, nofollow"/);
      assert.doesNotMatch(html, /rel="canonical"|property="og:/);
    }
    for (const path of ['/unknown', '/team/999/', '/account/unregistered']) {
      assert.equal((await open(path)).status, 404, path);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
