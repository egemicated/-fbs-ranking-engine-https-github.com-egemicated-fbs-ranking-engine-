// Real browser/production components with explicit ESPN transport fixtures.
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
  let file=resolve(directory,'.'+path);if(path.endsWith('/'))file=resolve(file,'index.html');
  if(!file.startsWith(directory+sep))return res.writeHead(404).end();
  try{res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream'}).end(await readFile(file));}
  catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}/`;
const source=JSON.parse(await readFile(resolve(directory,'data/weekly-picks.json'),'utf8'));
const samples=source.games.filter(g=>['401866467','401866469'].includes(g.id));
assert.equal(samples.length,2,'Retained fixture games required for the regression');
const names=new Map(source.teams.map(t=>[t.id,t.name]));
const fixture=final=>({season:{year:2026,type:2},week:{number:12},leagues:[{calendar:[]}],events:samples.map((g,index)=>({id:g.id,date:g.startDate,
  competitions:[{date:g.startDate,dateValid:true,timeValid:true,status:{type:final?{state:'post',completed:true,name:'STATUS_FINAL',shortDetail:'Final'}:{state:'pre',name:'STATUS_SCHEDULED',shortDetail:'Scheduled'}},
    competitors:['away','home'].map((side,i)=>({homeAway:side,score:final?(index===0?[34,33]:[21,40])[i].toString():undefined,
      team:{id:g[side],displayName:names.get(g[side]),abbreviation:'TEST'}}))}]}))});
const browser=await chromium.launch({headless:true,...(process.env.QUALITY_BROWSER?{executablePath:process.env.QUALITY_BROWSER}:{}),args:['--no-sandbox']});
const checks=[];
try{
  for(const width of [320,375,390,768,1024,1440]){
    const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.clock.install({time:new Date('2026-11-19T13:00:00Z')});
    let mode='scheduled';
    await page.route('https://site.api.espn.com/**/scoreboard?*',route=>route.fulfill(mode==='failure'?{status:503,body:'Unavailable'}:{json:mode==='empty'?{...fixture(false),events:[]}:fixture(mode==='final')}));
    for(const name of ['scoreboard.js','scoreboard.css'])await page.route(`**/${name}*`,async route=>route.fulfill({contentType:types[extname(name)],body:await readFile(resolve('frontend',name))}));
    await page.goto(base+'#scoreboard',{waitUntil:'domcontentloaded'});
    await page.locator('[data-game-id]').first().waitFor();
    await page.locator('.scoreboard-warning').filter({hasText:'still marked Scheduled'}).waitFor();
    await page.getByText('Data times and coverage',{exact:true}).click();
    assert.equal(await page.getByText('Not reported by ESPN',{exact:true}).count(),1);
    assert.match(await page.locator('[data-scoreboard-checked]').innerText(),/^Last successful ESPN response/);
    await page.locator('[data-scoreboard-time="schedule"]').filter({hasNotText:'Not reported'}).waitFor();
    const link=page.locator(`[data-game-id="${samples[0].id}"] a`).filter({hasText:'Saved prediction'});
    await link.waitFor();
    assert.equal(await link.getAttribute('href'),`#compare/weekly/regular:12/${samples[0].id}`);
    mode='final';await page.locator('[data-scoreboard-refresh]').click();
    await page.locator('[data-game-id][data-state="final"]').first().waitFor();
    assert.equal(await page.locator('[data-game-id][data-state="final"]').count(),2);
    assert.match(await page.locator(`[data-game-id="${samples[0].id}"]`).innerText(),/34[\s\S]*33/);
    mode='scheduled';await page.locator('[data-scoreboard-refresh]').click();
    await page.locator('.scoreboard-warning').filter({hasText:'previously final'}).waitFor();
    assert.equal(await page.locator('[data-game-id][data-state="final"]').count(),2);
    const completedLabel=await page.locator('[data-scoreboard-checked]').innerText();
    mode='failure';await page.locator('[data-scoreboard-refresh]').click();
    await page.locator('.scoreboard-warning').filter({hasText:'refresh failed'}).waitFor();
    assert.equal(await page.locator('[data-scoreboard-checked]').innerText(),completedLabel);
    mode='empty';await Promise.all([page.waitForResponse(response=>response.url().includes('/scoreboard?')&&response.status()===200),page.locator('[data-scoreboard-refresh]').click()]);
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    await page.locator('[data-scoreboard][data-scoreboard-health="unavailable"]').waitFor();
    assert.equal(await page.locator('[data-game-id][data-state="final"]').count(),2);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width,'Page overflow at '+width);
    // Follow the actual existing deep link into its retained weekly snapshot.
    await page.locator(`[data-game-id="${samples[0].id}"] a`).filter({hasText:'Saved prediction'}).click();
    await page.locator(`#weekly-game-${samples[0].id}`).waitFor();
    assert.match(page.url(),new RegExp(`#compare/weekly/regular:12/${samples[0].id}$`));
    assert.equal(await page.locator('#weekly-week').inputValue(),'regular:12');
    assert.equal(await page.locator(`#weekly-game-${samples[0].id}`).getAttribute('id'),`weekly-game-${samples[0].id}`);
    assert.deepEqual(errors,[]);
    checks.push({width,sourceTimesHonest:true,delayedStatusWarning:true,eagerSavedGameLink:true,finalTransition:true,regressionGuard:true,failedRefreshPreservesReceipt:true,temporaryEmptyRetainsFinals:true,deepLink:true,noOverflow:true});
    await context.close();
  }
  console.log(JSON.stringify({passed:true,scope:'Real local browser and published data; explicit ESPN transport fixtures, no live provider or contest mutation',checks},null,2));
}finally{await browser.close();await new Promise(done=>server.close(done));}
