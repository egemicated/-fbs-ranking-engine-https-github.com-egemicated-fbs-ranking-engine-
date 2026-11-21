import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const directory = resolve(process.argv[2] ?? 'static-dist');
const evidence = process.env.BASKETBALL_SCREENSHOTS;
const media = {
  '.mjs':'text/javascript', '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.json':'application/json',
  '.png':'image/png', '.woff2':'font/woff2', '.webp':'image/webp',
};
const server = createServer(async (req,res) => {
  const path = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  const file = resolve(directory,'.'+path, ...(!extname(path) ? ['index.html'] : []));
  if (!file.startsWith(directory+sep)) return res.writeHead(404).end();
  try {
    const body = await readFile(file);
    res.writeHead(200,{'Content-Type':media[extname(file)] ?? 'application/octet-stream'}).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = 'http://127.0.0.1:'+server.address().port;
const version = (await readFile(resolve(directory,'basketball/index.html'),'utf8'))
  .match(/name="basketball-publication" content="([a-f0-9]{24})"/)?.[1];
assert.ok(version,'Publication version in the static HTML');
const index = JSON.parse(await readFile(resolve(directory,'basketball-data',version,'index.json'),'utf8'));
const source = path => readFile(resolve(directory,'basketball-data',version,String(index.currentSeason), path),'utf8').then(JSON.parse);
const sourceSeason = await source('season.json');
const [teamA,teamB] = sourceSeason.snapshot.teams.filter(row=>row.sorRank && row.boxGames>2).slice(0,2);
const teamPath = team => '/basketball/teams/'+team.id.split(':')[1]+'/';
const matchup = '/basketball/matchup-lab/?'+new URLSearchParams({a:teamA.id,b:teamB.id,venue:'neutral'});
const picksDate = index.directory[index.currentSeason].dates.find(date=>date>=index.generatedAt.slice(0,10)) ??
  index.directory[index.currentSeason].dates.at(-1);
const report = sourceSeason.modelReport.totals;
assert.ok(index.years.length >= 1 && teamA && teamB && picksDate);
const pages = [
  ['/sports/', '.fc-portal-grid','sports'], ['/football/', '.home-hero','football'],
  ['/basketball/', '.fc-hoops-hero','basketball'], ['/basketball/rankings/','[data-ranking-browser]','rankings'],
  ['/basketball/teams/','[data-team-browser]','teams'], [teamPath(teamA), '.fc-content','team'],
  [matchup,'[data-matchup-form][data-matchup-enhanced]','matchup'], ['/basketball/conferences/','[data-gd-basketball-conferences]','conference'],
  ['/basketball/scoreboard/?date='+picksDate,'.fc-games','scoreboard'],
  ['/basketball/picks/?date='+picksDate,'.fc-games','picks'],
  ['/basketball/model-reports/','[data-view-results]','reports'],
  ['/basketball/ranking-history/','[data-view-results]','history'],
  ['/basketball/methodology/','.fc-stack','methodology'],
  ['/basketball/march-madness/','.bb-bracket','bracket'],
];
const browser = await chromium.launch({headless:true,
  ...(process.env.QUALITY_BROWSER ? {executablePath:process.env.QUALITY_BROWSER} : {}),args:['--no-sandbox']});
try {
  if (evidence) await mkdir(evidence,{recursive:true});
  for (const width of [320,375,390,430,768,1024,1440,1920]) {
    const context = await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'});
    await context.route('**/*',route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{
      if (response.status()>=400 && /\.(?:m?js|css|webp|woff2)(?:\?|$)/.test(response.url())) errors.push(response.url());
    });
    for (const [path,ready,name] of pages) {
      const result = await page.goto(origin+path,{waitUntil:'load'});
      assert.equal(result.status(),200,path);
      await page.locator(ready).first().waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,width+' '+path);
      assert.equal(await page.locator('a[href*="/preview-profile/"]').count(),0);
      if (evidence && [390,1440].includes(width) && ['basketball','rankings','team','matchup','bracket'].includes(name)) {
        await page.screenshot({path:resolve(evidence,name+'-'+width+'.png'),animations:'disabled'});
      }
    }
    assert.deepEqual(errors,[],width+' JavaScript errors');
    await context.close();
  }

  const context = await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page = await context.newPage();
  await page.goto(origin+matchup);
  await page.locator('[data-matchup-form][data-matchup-enhanced]').waitFor();
  const original = await page.locator('.prediction-number').textContent();
  await page.getByRole('button',{name:'Team A at home'}).click();
  await page.waitForURL(/venue=home/);
  assert.notEqual(await page.locator('.prediction-number').textContent(),original);
  await page.getByText('Players to know',{exact:true}).click();
  await page.getByRole('row',{name:/Points/}).first().waitFor();
  assert.equal(await page.locator('select[name="b"] option[value="'+teamA.id+'"]').evaluate(option=>option.disabled),true);
  await page.goto(origin+'/basketball/matchup-lab/?a='+teamA.id+'&b='+teamA.id);
  await page.getByRole('heading',{name:'Choose a different opponent'}).waitFor();
  assert.equal(await page.locator('.prediction-number').count(),0);

  await page.goto(origin+teamPath(teamA));
  await page.getByRole('heading',{name:'Player leaders',exact:true}).waitFor();
  await page.getByRole('heading',{name:'Four Factors',exact:true}).waitFor();
  await page.getByRole('heading',{name:'Team statistics',exact:true}).waitFor();
  await page.goto(origin+'/basketball/rankings/');
  await page.locator('[data-ranking-browser][data-team-enhanced]').waitFor();
  await page.getByRole('link',{name:'Predictive Strength',exact:true}).last().click();
  await page.waitForURL(/model=predictive/);
  await page.getByRole('heading',{name:'Predictive Strength'}).waitFor();

  const [primary] = sourceSeason.conferenceQuality.rows.filter(row=>row.nonconference.games>0);
  await page.goto(origin+'/basketball/conferences/?'+new URLSearchParams({view:'head',a:primary.conference}));
  await page.getByRole('heading',{name:primary.conference+' vs all opponents'}).waitFor();
  const itemCount = await page.locator('.fc-game').count();
  assert.ok(itemCount>0 && itemCount<=12);
  await page.goto(origin+'/basketball/model-reports/');
  assert.equal(await page.getByText('Saved prospective forecasts',{exact:true}).count(),1);
  assert.ok(report.graded >= 0 && report.forecasts >= report.graded);
  await page.goto(origin+'/basketball/march-madness/');
  await page.getByRole('button',{name:'My bracket'}).click();
  assert.equal(await page.locator('option[value="format"]').count(),0);
  assert.equal(await page.getByRole('button',{name:'Save practice bracket'}).count(),1);
  await page.getByRole('button',{name:'Save practice bracket'}).click();
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('gd-bracket:mbb:'))),true);
  await context.close();
  for (const path of ['/basketball/contest/','/preview-profile/','/basketball-preview/bracket-data.json','/basketball/preview-accounts.mjs','/.env.basketball.local']) {
    assert.equal((await fetch(origin+path)).status,404,path);
  }
  console.log('Passed '+pages.length*8+' public route and width checks, filters, bracket drafts, matchup, player and team evidence, plus preview isolation.');
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
