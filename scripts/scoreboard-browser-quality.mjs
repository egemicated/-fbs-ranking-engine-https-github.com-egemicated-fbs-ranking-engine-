// Real browser/production components with an explicit publication fixture.
// No real account, contest mutation, CFBD pull or live-result publication.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {chromium} from 'playwright';

const directory=resolve('static-dist');
const types={'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'};
const server=createServer(async(req,res)=>{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  let file=resolve(directory,'.'+path);if(!extname(path))file=resolve(file,'index.html');
  if(!file.startsWith(directory+sep))return res.writeHead(404).end();
  try{res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream'}).end(await readFile(file));}
  catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}/`;
const source=JSON.parse(await readFile(resolve(directory,'data/weekly-picks.json'),'utf8'));
const samples=source.games.filter(g=>['401866467','401866469'].includes(g.id));
assert.equal(samples.length,2,'Retained fixture games required for the regression');
const fixture=mode=>({ ...source, games:mode==='empty'?[]:samples.map((game,index)=>({ ...game,
  status:mode==='final'?'final':'scheduled', startTimeTbd:false,
  awayPoints:mode==='final'?(index===0?34:21):null, homePoints:mode==='final'?(index===0?33:40):null,
})) });
const browser=await chromium.launch({headless:true,...(process.env.QUALITY_BROWSER?{executablePath:process.env.QUALITY_BROWSER}:{}),args:['--no-sandbox']});
const checks=[];
try{
  for(const width of [320,375,390,768,1024,1440]){
    const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const espnRequests=[];
    await context.route('**/*',route=>{
      const url=route.request().url();
      if(new URL(url).hostname==='site.api.espn.com')espnRequests.push(url);
      return url.startsWith(base)?route.continue():route.abort();
    });
    await page.clock.install({time:new Date('2026-11-19T13:00:00Z')});
    let mode='scheduled';
    const publicationRoute='**/data/weekly-picks.json';
    await page.route(publicationRoute,route=>route.fulfill(mode==='failure'?{status:503,body:'Unavailable'}:{json:fixture(mode)}));
    for(const name of ['scoreboard.js','scoreboard.css'])await page.route(`**/${name}*`,async route=>route.fulfill({contentType:types[extname(name)],body:await readFile(resolve('frontend',name))}));
    await page.goto(base+'scoreboard',{waitUntil:'domcontentloaded'});
    await page.locator('[data-game-id]').first().waitFor();
    await page.locator('.scoreboard-warning').filter({hasText:'still marked Scheduled'}).waitFor();
    await page.getByText('Data times and coverage',{exact:true}).click();
    assert.equal(await page.locator('[data-game-filter="status"] option[value="live"]').count(),0);
    assert.match(await page.locator('[data-scoreboard-checked]').innerText(),/^Schedule as of/);
    await page.locator('[data-scoreboard-time="schedule"]').filter({hasNotText:'Not reported'}).waitFor();
    const link=page.locator(`[data-game-id="${samples[0].id}"] a`).filter({hasText:'Saved prediction'});
    await link.waitFor();
    const savedPrediction=`/weekly-picks?week=regular%3A12&game=${samples[0].id}`;
    assert.equal(await link.getAttribute('href'),savedPrediction);
    mode='final';await page.locator('[data-scoreboard-refresh]').click();
    await page.locator('[data-game-id][data-state="final"]').first().waitFor();
    assert.equal(await page.locator('[data-game-id][data-state="final"]').count(),2);
    assert.match(await page.locator(`[data-game-id="${samples[0].id}"]`).innerText(),/34[\s\S]*33/);
    mode='scheduled';await page.locator('[data-scoreboard-refresh]').click();
    await page.locator('.scoreboard-warning').filter({hasText:'previously final'}).waitFor();
    assert.equal(await page.locator('[data-game-id][data-state="final"]').count(),2);
    const completedLabel=await page.locator('[data-scoreboard-time="received"]').innerText();
    mode='failure';await page.locator('[data-scoreboard-refresh]').click();
    await page.locator('.scoreboard-warning').filter({hasText:'refresh failed'}).waitFor();
    assert.equal(await page.locator('[data-scoreboard-time="received"]').innerText(),completedLabel);
    mode='empty';await Promise.all([page.waitForResponse(response=>response.url().includes('/data/weekly-picks.json')&&response.status()===200),page.locator('[data-scoreboard-refresh]').click()]);
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    await page.locator('[data-scoreboard][data-scoreboard-health="unavailable"]').waitFor();
    assert.equal(await page.locator('[data-game-id][data-state="final"]').count(),2);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width,'Page overflow at '+width);
    assert.match(await page.locator(`[data-game-id="${samples[0].id}"] a`).filter({hasText:'Gamecast'}).getAttribute('href'),/https:\/\/www\.espn\.com\/college-football\/game\//);
    assert.deepEqual(espnRequests,[]);
    // Follow the actual existing deep link into its retained weekly snapshot.
    await page.unroute(publicationRoute);
    await page.locator(`[data-game-id="${samples[0].id}"] a`).filter({hasText:'Saved prediction'}).click();
    await page.locator(`#weekly-game-${samples[0].id}`).waitFor();
    assert.equal(page.url(),new URL(savedPrediction,base).href);
    assert.equal(await page.locator('#weekly-week').inputValue(),'regular:12');
    assert.equal(await page.locator(`#weekly-game-${samples[0].id}`).getAttribute('id'),`weekly-game-${samples[0].id}`);
    assert.deepEqual(errors,[]);
    checks.push({width,sourceTimesHonest:true,delayedStatusWarning:true,eagerSavedGameLink:true,finalTransition:true,regressionGuard:true,failedRefreshPreservesReceipt:true,temporaryEmptyRetainsFinals:true,deepLink:true,noOverflow:true});
    await context.close();
  }
  console.log(JSON.stringify({passed:true,scope:'Real local browser and a published schedule fixture, no provider calls or contest mutation',checks},null,2));
}finally{await browser.close();await new Promise(done=>server.close(done));}
