import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createBasketballPreview } from './serve-basketball-preview.mjs';
import { dayKey } from '../basketball/preview-ui.mjs';

const profileRoot=await mkdtemp(join(tmpdir(),'gd-bracket-browser-'));
const {server,seasons}=await createBasketballPreview({accountDirectory:profileRoot});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const screenshots=resolve(process.env.FULL_COURT_SCREENSHOTS||'../tmp/gd-full-court/integrated');
await mkdir(screenshots,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.QUALITY_BROWSER ? {executablePath:process.env.QUALITY_BROWSER} : {}),args:['--no-sandbox']});
const visited=[];
const timings=[];
const widthDoesFit=async page=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Viewport overflow on '+page.url());
const year=Math.max(...seasons.keys());
const active=seasons.get(year);
assert.ok(active?.snapshot.teams.length>=360,'Current published data');
const team=[...active.teams.values()].find(t=>t.name==='Houston')??active.snapshot.teams[0];
const rival=[...active.teams.values()].find(t=>t.id!==team.id&&t.sorRank);
const teamRoute=`/basketball/teams/${encodeURIComponent(team.id)}/`;
const matchupRoute='/basketball/matchup-lab/?'+new URLSearchParams({a:team.id,b:rival.id,venue:'neutral'});
const routes = [
  ['/','Results over'], ['/football/','The Games Decide'], ['/basketball/','College'], ['/basketball/rankings/','Basketball rankings'],
  ['/basketball/teams/','Teams'],[teamRoute,team.name], [matchupRoute,'Matchup Lab'],
  ['/basketball/scoreboard/','Scoreboard'], ['/basketball/picks/','Daily Picks'], ['/basketball/conferences/','Conference Strength'],
  ['/basketball/model-reports/','Model Report Card'], ['/basketball/ranking-history/','Ranking History'], ['/basketball/march-madness/','March Madness'],
  ['/basketball/methodology/','Basketball methodology'], ['/basketball/contest/','Beat the Model'], ['/preview-profile/','Local practice profile'],
];
try {
  for(const width of [320,390,768,1100,1440]) {
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    await context.route('**/*', route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',problem=>errors.push(problem.message));
    for (const [route, label] of routes) {
      const response=await page.goto(base+route);
      assert.equal(response.status(),200,route);
      assert.match(response.headers()['x-robots-tag'],/noindex/);
      if (route==='/football/') {
        await page.locator('.home-hero').waitFor();
      } else {
        assert.ok((await page.locator('main h1').first().innerText()).toLowerCase().includes(label.toLowerCase()),route);
      }
      await widthDoesFit(page);
      visited.push(`${width} ${route}`);
      timings.push(await page.evaluate(()=>{
        const navigation=performance.getEntriesByType('navigation')[0];
        return { ms:navigation.domContentLoadedEventEnd,html:navigation.encodedBodySize,
          bytes:navigation.transferSize+performance.getEntriesByType('resource').reduce((n,r)=>n+r.transferSize,0) };
      }));
      const screenshot = route==='/basketball/'&&[390,768,1440].includes(width) ? `basketball-home-${width}.png` :
        route==='/'&&[390,1440].includes(width) ? `sports-home-${width}.png` :
        route==='/basketball/rankings/'&&[390,1440].includes(width) ? `rankings-${width}.png` :
        route===matchupRoute&&[390,1440].includes(width) ? `matchup-${width}.png` : null;
      if (screenshot) {
        await page.evaluate(async()=>document.fonts.ready.then(()=>true));
        await page.screenshot({path:join(screenshots,screenshot)});
      }
    }

    if (width===390||width===1440) {
      await page.goto(base+'/');
      await page.getByRole('navigation',{name:'Switch sport'}).getByRole('link',{name:'Football'}).click();
      await page.locator('.home-hero').waitFor();
      await page.getByRole('navigation',{name:'Switch sport'}).getByRole('link',{name:'Basketball'}).click();
      assert.equal(new URL(page.url()).pathname,'/basketball/');
      await page.goto(base+'/basketball/teams/');
      await page.getByRole('searchbox',{name:'School or mascot'}).fill(team.name);
      await page.getByRole('button',{name:'Apply filters'}).click();
      await page.locator('.fc-team-card').filter({hasText:team.name}).first().click();
      assert.match(page.url(),/\/basketball\/teams\//);
      await page.getByRole('link',{name:'2025–26',exact:true}).click();
      assert.match(page.url(),/season=2026/);
      await page.goto(base+'/basketball/matchup-lab/?'+new URLSearchParams({a:team.id,b:team.id}));
      await page.getByRole('heading',{name:'Choose a different opponent'}).waitFor();
      assert.equal(await page.locator('.fc-probability').count(),0);
      await page.goto(base+'/basketball/march-madness/');
      await page.getByRole('button',{name:'Try the 76-team format'}).click();
      const opening=page.locator('button[data-bracket-game]:enabled').first();
      await opening.focus();
      await opening.press('Enter');
      await widthDoesFit(page);
      await page.evaluate(async()=>document.fonts.ready.then(()=>true));
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:join(screenshots,`march-madness-${width}.png`)});
      await page.getByRole('button',{name:'GD projected bracket'}).click();
      await page.locator('.bb-bracket button[data-bracket-action="national"]').waitFor();
      await widthDoesFit(page);
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:join(screenshots,`projected-bracket-${width}.png`)});
    }

    if (width===390) {
      const fixture=active.dataset.games.find(g=>g.divisionOne&&g.status==='scheduled'&&g.startTimeTbd===false&&Date.parse(g.startDate)>Date.now());
      assert.ok(fixture,'An upcoming Division I game is required for practice regression');
      await page.goto(base+'/preview-profile/');
      const registration=page.locator('.fc-panel').filter({hasText:'Create a practice profile'});
      await registration.getByRole('textbox',{name:'Handle'}).fill('fixture-test');
      await registration.locator('[name=passphrase]').fill('Disposable-Preview-Passphrase');
      await registration.getByRole('button',{name:'Create profile'}).click();
      await page.getByRole('status').getByText('Practice profile created.',{exact:true}).waitFor();
      const date=dayKey(fixture.startDate);
      await page.goto(base+'/basketball/contest/?'+new URLSearchParams({date,season:String(year)}));
      const row=page.locator('.fc-pick-row').filter({has:page.locator('[name=gameId][value="'+fixture.id+'"]')});
      await row.getByRole('button').first().click();
      await page.getByRole('status').getByText('Practice pick saved.',{exact:true}).waitFor();
      await page.goto(base+'/preview-profile/');
      await page.getByRole('button',{name:'Sign out'}).click();
      await page.getByRole('status').getByText('Signed out of the local preview.',{exact:true}).waitFor();
      await page.goto(base+'/basketball/contest/?'+new URLSearchParams({date,season:String(year)}));
      assert.equal(await page.locator('button[name=winnerId]').count(),0);
    }
    assert.deepEqual(errors,[]);
    await context.close();
  }
  for(const secretPath of ['/.env.basketball.local','/research/cache/basketball/preview/2027-forecasts.json','/data/seasons/basketball/2027.json','/basketball/unknown/']) {
    assert.equal((await fetch(base+secretPath)).status,404,secretPath);
  }
  const denied=await fetch(base+'/preview-profile/',{method:'POST',headers:{origin:'https://www.thegamesdecide.com','content-type':'application/x-www-form-urlencoded'},
    body:'action=register'});
  assert.equal(denied.status,403);
  console.log(`Verified ${visited.length} rendered viewport/routes, sport switching, filters, real team links, matchup rejection, bracket progression, isolated profile and picks, network isolation, and private file denial.`);
  const median = values => values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  console.log(`Local Chromium median DOMContentLoaded ${Math.round(median(timings.map(x=>x.ms)))} ms; median total transfer ${Math.round(median(timings.map(x=>x.bytes))/1024)} KiB. Maximum HTML response ${Math.round(Math.max(...timings.map(x=>x.html))/1024)} KiB.`);
  console.log(`Screenshots: ${screenshots}`);
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
