import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {canonicalPath,pageMetadata} from '../frontend/page-routes.js';
import { prerenderPublicPages } from '../scripts/prerender-pages.js';

test('major public routes have independent canonical destinations, including weekly game links',()=>{
  for(const [hash,path] of [['#methodology','/methodology/'],['#beat-the-model','/beat-the-model/'],['#rankings/strength','/rankings'],['#compare/matchup/252/24/away','/matchup-lab'],['#scoreboard','/scoreboard'],['#compare/weekly/regular:12/401','/weekly-picks'],['#compare/weekly/fcs/regular:12/402','/weekly-picks/fcs/'],['#polls/cfp/12','/polls/cfp/'],['#ranking-history/11','/ranking-history/']])assert.equal(canonicalPath(hash),path);
  assert.notEqual(pageMetadata('#methodology').canonical,pageMetadata('#beat-the-model').canonical);
});
test('team metadata reuses the generated team-specific publication description and image',()=>{
  const registry={'/team/252/':{title:'BYU · The Games Decide',description:'BYU published team evidence.',image:'/social/team-252.png'}};
  const metadata=pageMetadata('#team/252/players',registry);
  assert.equal(metadata.title,registry['/team/252/'].title);assert.equal(metadata.description,registry['/team/252/'].description);
  assert.equal(metadata.canonical,'https://www.thegamesdecide.com/team/252/');
  assert.equal(metadata.image,'https://www.thegamesdecide.com/social/team-252.png');
});
test('account and unknown routes cannot retain an unrelated public canonical or leak callback credentials',()=>{
  for(const hash of ['#account','#admin','#my-teams']){const metadata=pageMetadata(hash);assert.equal(metadata.canonical,null);assert.equal(metadata.noindex,true);}
  for(const hash of ['#access_token=private&refresh_token=private','#unknown/private']){
    const metadata=pageMetadata(hash);assert.equal(metadata.canonical,null);assert.doesNotMatch(JSON.stringify(metadata),/private/);
  }
  assert.equal(pageMetadata('#team/252',{'/team/252/':{image:'https://private.example/pixel'}}).image,'https://www.thegamesdecide.com/social/platform.png');
});

test('static build writes an allowlist of rendered destinations, canonicalizes aliases and keeps private shells out of discovery', async () => {
  const root = resolve(import.meta.dirname, '..');
  const output = await mkdtemp(join(tmpdir(), 'public-page-metadata-'));
  const origin = 'https://www.thegamesdecide.com';
  const readPage = path => readFile(join(output, path, 'index.html'), 'utf8');
  try {
    await mkdir(join(output, 'data'));
    await prerenderPublicPages({
      root, output,
      snapshot: { asOf: '2026-11-18T09:00:00.000Z', season: 2026, fbsTeams: 26, fcsTeams: 1 },
      teams: [
        { id: '252', name: 'BYU', division: 'fbs', conference: 'Big 12', wins: 8, losses: 2, displayRank: 12 },
        { id: '149', name: 'North Dakota', division: 'fcs', conference: 'MVFC', wins: 6, losses: 4, displayRank: 21 },
        ...Array.from({length:26}, (_, i) => i+1).filter(rank => rank !== 12).map(rank => ({
          id:String(500+rank), name:`Test team ${rank}`, division:'fbs', conference:'Example', wins:8, losses:2, displayRank:rank,
        })),
      ],
      html: await readFile(join(root, 'frontend/index.html'), 'utf8'),
    });
    const sitemap = await readFile(join(output, 'sitemap.xml'), 'utf8');
    const paths = [...sitemap.matchAll(/<loc>https:\/\/www\.thegamesdecide\.com([^<]+)<\/loc>/g)].map(match => match[1]);
    assert.equal(paths.length, new Set(paths).size);
    for (const path of ['/', '/rankings', '/matchup-lab', '/scoreboard', '/weekly-picks', '/support', '/team/252/', '/team/149/']) {
      assert.ok(paths.includes(path), `Missing sitemap entry ${path}`);
    }
    for (const path of paths) {
      assert.ok((await readPage(path)).includes(`<link rel="canonical" href="${origin}${path}">`));
    }
    for (const [alias, canonical] of [['/rankings/fbs/', '/rankings'], ['/weekly-picks/fbs/', '/weekly-picks'],
      ['/teams/', '/teams/fbs/'], ['/model-reports/', '/model-reports/fbs/'], ['/polls/', '/polls/ap/']]) {
      assert.ok(!paths.includes(alias));
      assert.ok((await readPage(alias)).includes(`<link rel="canonical" href="${origin}${canonical}">`));
    }
    const team = await readPage('/team/252/');
    assert.match(team, /<h1>BYU<\/h1>/);
    assert.match(team, /href="\/team\/252\/\?view=results"/);
    assert.ok(team.includes(`property="og:image" content="${origin}/social/team-252.png"`));
    const home = await readPage('/'), rankings = await readPage('/rankings');
    assert.equal((home.match(/<tr><td>/g) ?? []).length, 25);
    assert.equal((rankings.match(/<tr><td>/g) ?? []).length, 26);
    assert.doesNotMatch(home, /Test team 26/);
    assert.match(home, /href="\/rankings\?all=1">View all 26 FBS teams/);
    assert.equal(((await readPage('/teams/fbs/')).match(/<tr><td>/g) ?? []).length, 26);
    const registry = JSON.parse(await readFile(join(output, 'data/page-metadata.json'), 'utf8'));
    for (const path of ['/account', '/admin', '/my-teams']) {
      assert.ok(!paths.includes(path));
      assert.equal(registry[path], undefined);
      const document = await readPage(path);
      assert.match(document, /name="robots" content="noindex, nofollow"/);
      assert.doesNotMatch(document, /rel="canonical"|property="og:|<h1>BYU/);
    }
    await assert.rejects(readPage('/not-a-registered-route'), { code: 'ENOENT' });
    await assert.rejects(readPage('/team/999999/'), { code: 'ENOENT' });
    const missing = await readFile(join(output, '404.html'), 'utf8');
    assert.match(missing, /<h1>Page not found<\/h1>/);
    assert.doesNotMatch(missing, /rel="canonical"|src="\/app\.js"/);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
