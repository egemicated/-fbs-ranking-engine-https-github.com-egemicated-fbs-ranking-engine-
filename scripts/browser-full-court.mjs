import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createBasketballPreview } from './serve-basketball-preview.mjs';
import { dayKey } from '../basketball/preview-ui.mjs';

const profileRoot=await mkdtemp(join(tmpdir(),'gd-bracket-browser-'));
const {server,seasons}=await createBasketballPreview({accountDirectory:profileRoot});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const screenshots=resolve(process.env.FULL_COURT_SCREENSHOTS||'../tmp/gd-visual/after');
await mkdir(screenshots,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.QUALITY_BROWSER ? {executablePath:process.env.QUALITY_BROWSER} : {}),args:['--no-sandbox']});
const visited=[];
const timings=[];
const widthDoesFit=async page=>{
  const [viewport,content]=await page.evaluate(()=>[innerWidth,document.documentElement.scrollWidth]);
  assert.ok(content<=viewport+1,`Viewport overflow (${viewport}px viewport, ${content}px content) on ${page.url()}`);
};
const year=Math.max(...seasons.keys());
const active=seasons.get(year);
assert.ok(active?.snapshot.teams.length>=360,'Current published data');
const team=[...active.teams.values()].find(t=>t.name==='Houston')??active.snapshot.teams[0];
const rival=[...active.teams.values()].find(t=>t.id!==team.id&&t.sorRank);
const teamRoute=`/basketball/teams/${encodeURIComponent(team.id)}/`;
const matchupRoute='/basketball/matchup-lab/?'+new URLSearchParams({a:team.id,b:rival.id,venue:'neutral'});
const basketballRoutes = [
  ['/basketball/','College','basketball-home'], ['/basketball/rankings/','Basketball rankings','rankings'],
  ['/basketball/teams/','Teams','teams'], [teamRoute,team.name,'team-profile'], [matchupRoute,'Matchup Lab','matchup'],
  ['/basketball/scoreboard/','Scoreboard','scoreboard'], ['/basketball/picks/','Daily Picks','daily-picks'],
  ['/basketball/conferences/','Conference Strength','conferences'], ['/basketball/model-reports/','Model Report Card','model-reports'],
  ['/basketball/ranking-history/','Ranking History','ranking-history'], ['/basketball/march-madness/','March Madness'],
  ['/basketball/methodology/','Basketball methodology'], ['/basketball/contest/','Beat the Model'],
];
const footballRoutes = [
  ['/football/','football-home'], ['/rankings','football-rankings'], ['/rankings/fcs/','football-fcs-rankings'],
  ['/teams/fbs/'], ['/teams/fcs/'], ['/team/252/'], ['/scoreboard'], ['/matchup-lab'], ['/beat-the-model/'],
  ['/weekly-picks'], ['/weekly-picks/fcs/'], ['/model-reports/fbs/'], ['/model-reports/fcs/'], ['/conference-strength/'],
  ['/ranking-history/'], ['/cfp-scenarios/'], ['/playoff-bracket/'], ['/sor-compare/'], ['/polls/ap/'], ['/polls/coaches/'],
  ['/polls/cfp/'], ['/forge-rankings/'], ['/my-teams'], ['/methodology/'], ['/about/'], ['/privacy/'], ['/terms/'], ['/support'], ['/admin'],
];
const routes = [
  ['/','Results over','sports-home',''], ['/preview-profile/','Local practice profile',null,''],
  ['/account',null,null,''],
  ...basketballRoutes.map(row=>[row[0],row[1],row[2],'basketball']),
  ...footballRoutes.map(([route,name])=>[route,null,name,'football']),
];
try {
  for(const width of [320,375,390,430,768,1024,1100,1440,1920]) {
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    await context.addInitScript(()=>{
      let score=0;
      const observer=new PerformanceObserver(list=>{
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) score+=entry.value;
      });
      observer.observe({type:'layout-shift',buffered:true});
      window.readPreviewLayoutShift=()=>score;
    });
    await context.route('**/*', route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',problem=>errors.push(problem.message));
    for (const [route, label, name, sport] of routes) {
      const response=await page.goto(base+route);
      assert.equal(response.status(),200,route);
      assert.match(response.headers()['x-robots-tag'],/noindex/);
      if (route==='/football/') {
        await page.locator('.home-hero').waitFor();
        await page.locator('.top-five h2').filter({hasText:/SOR top five/i}).waitFor();
      } else if (label) {
        assert.ok((await page.locator('main h1').first().innerText()).toLowerCase().includes(label.toLowerCase()),route);
      } else {
        await page.locator('main > .loading').waitFor({state:'hidden'});
        assert.ok((await page.locator('main').innerText()).trim(),route);
      }
      const masthead=page.locator('[data-gd-masthead]');
      assert.equal(await masthead.count(),1,route);
      assert.equal(await masthead.getAttribute('data-gd-sport'),sport,route);
      assert.equal(await page.locator('header img[alt="The Games Decide"]').count(),1,route);
      assert.equal(await page.locator('.gd-footer').count(),1,route);
      assert.equal(await page.getByText('Retry sign-in',{exact:true}).count(),0,route);
      await widthDoesFit(page);
      visited.push(`${width} ${route}`);
      await page.evaluate(()=>document.fonts.ready);
      timings.push(await page.evaluate(([width,path])=>{
        const resources=performance.getEntriesByType('resource');
        const navigation=performance.getEntriesByType('navigation')[0];
        const size=pattern=>resources.filter(r=>pattern.test(new URL(r.name).pathname)).reduce((n,r)=>n+r.encodedBodySize,0);
        return {width,path,ms:Math.round(navigation.domContentLoadedEventEnd),layoutShift:window.readPreviewLayoutShift(),
          html:navigation.encodedBodySize,requests:resources.length+1,
          css:size(/\.css$/),js:size(/\.(?:js|mjs)$/),images:size(/\.(?:webp|png|jpe?g|svg)$/),
          bytes:navigation.transferSize+resources.reduce((n,r)=>n+r.transferSize,0)};
      },[width,route]));
      if (name && ([390,1440].includes(width) || route==='/basketball/'&&width===768)) {
        await page.screenshot({path:join(screenshots,`${name}-${width}.png`),fullPage:['sports-home','basketball-home'].includes(name)});
      }
      if ([390,1440].includes(width) && ['/football/','/basketball/'].includes(route)) {
        await masthead.screenshot({path:join(screenshots,`${sport}-header-${width}.png`)});
        await page.locator('.gd-footer').screenshot({path:join(screenshots,`${sport}-footer-${width}.png`)});
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
      await page.locator('.fc-team-card').filter({hasText:team.name}).first().click();
      assert.match(page.url(),/\/basketball\/teams\//);
      await page.getByRole('link',{name:'2025–26',exact:true}).click();
      assert.match(page.url(),/season=2026/);
      await page.goto(base+'/basketball/conferences/?'+new URLSearchParams({a:team.conference}));
      await page.getByRole('heading',{name:team.conference+' membership',exact:true}).waitFor();
      await widthDoesFit(page);
      await page.goto(base+'/basketball/matchup-lab/?'+new URLSearchParams({a:team.id,b:team.id}));
      await page.getByRole('heading',{name:'Choose a different opponent'}).waitFor();
      assert.equal(await page.locator('.fc-probability').count(),0);
      await page.goto(base+'/basketball/march-madness/?mode=projection');
      await page.locator('.bb-bracket button[data-bracket-action="national"]').waitFor();
      await widthDoesFit(page);
      await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({path:join(screenshots,`projected-bracket-${width}.png`)});
      await page.getByRole('button',{name:'My bracket',exact:true}).click();
      await page.locator('[data-bracket-select="practiceField"]').selectOption('format');
      const opening=page.locator('button[data-bracket-game]:enabled:visible').first();
      await opening.focus();
      await opening.press('Enter');
      await widthDoesFit(page);
      await page.evaluate(async()=>document.fonts.ready.then(()=>true));
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:join(screenshots,`march-madness-practice-${width}.png`)});
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
  const noScript=await browser.newContext({viewport:{width:390,height:900},javaScriptEnabled:false});
  const noScriptPage=await noScript.newPage();
  await noScriptPage.goto(base+'/basketball/');
  await noScriptPage.getByRole('navigation',{name:'Basketball sections'}).getByRole('link',{name:'Scoreboard',exact:true}).click();
  assert.equal(new URL(noScriptPage.url()).pathname,'/basketball/scoreboard/');
  await noScript.close();
  const denied=await fetch(base+'/preview-profile/',{method:'POST',headers:{origin:'https://www.thegamesdecide.com','content-type':'application/x-www-form-urlencoded'},
    body:'action=register'});
  assert.equal(denied.status,403);
  await writeFile(join(screenshots,'performance.json'),JSON.stringify(timings,null,2));
  console.log(`Verified ${visited.length} rendered viewport/routes, a single header and footer, sport switching, filter and team links, invalid matchup rejection, bracket interaction, practice profile and picks, network isolation, and private file denial.`);
  const median = values => values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  console.log(`Local Chromium median DOMContentLoaded ${Math.round(median(timings.map(x=>x.ms)))} ms; median total transfer ${Math.round(median(timings.map(x=>x.bytes))/1024)} KiB. Maximum HTML response ${Math.round(Math.max(...timings.map(x=>x.html))/1024)} KiB.`);
  console.log(`Screenshots: ${screenshots}`);
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
