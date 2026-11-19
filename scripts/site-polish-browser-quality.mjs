import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {chromium} from 'playwright';
const directory=resolve('static-dist'),types={'.js':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=resolve(directory,'.'+path+(path.endsWith('/')?'index.html':''));if(!file.startsWith(directory+sep))return res.writeHead(404).end();try{res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream'}).end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base='http://127.0.0.1:'+server.address().port+'/';
const browser=await chromium.launch({headless:true,...(process.env.QUALITY_BROWSER?{executablePath:process.env.QUALITY_BROWSER}:{}),args:['--no-sandbox']});
const checks=[];
try{
  for(const width of [320,375,390,768,1024,1440]){
    const context=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://cdn.jsdelivr.net/**',route=>route.abort());
    await page.route('https://egxyfyorggwnrnmirrax.supabase.co/**',route=>route.abort());
    await page.goto(base+'#compare/matchup/252/254/neutral');
    await page.getByRole('searchbox',{name:'Filter Team A list',exact:true}).waitFor();
    const filterA=()=>page.getByRole('searchbox',{name:'Filter Team A list',exact:true});
    await filterA().fill('team-that-does-not-exist');
    await page.getByText(/No matching teams\. Your current selection is retained/).waitFor();
    assert.equal(await page.locator('#compare-a').inputValue(),'252');
    await filterA().fill('Texas');await filterA().press('Enter');assert.equal(await page.locator('#compare-a').evaluate(e=>e===document.activeElement),true);
    await page.locator('#compare-a').selectOption('251');
    await page.waitForURL('**/#compare/matchup/251/254/neutral');
    await page.getByRole('searchbox',{name:'Filter Team B list',exact:true}).fill('Texas');
    assert.equal(await page.locator('#compare-b option[value="251"]:not([disabled])').count(),0);
    await page.getByRole('searchbox',{name:'Filter Team B list',exact:true}).press('Escape');
    assert.equal(await page.locator('#compare-b').evaluate(e=>e===document.activeElement),true);
    assert.equal(await page.locator('.prediction-card').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true,'Team picker overflow '+width);
    for(const route of ['about','privacy','terms','support']){
      await page.goto(base+'#'+route);await page.locator('.platform-info h1').waitFor();
      assert.equal(await page.locator('main h1').count(),1,'Duplicate heading '+route);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true,route+' overflow '+width);
    }
    await page.goto(base+'#methodology');await page.locator('.method-grid').first().waitFor();
    await page.locator('a[href="#beat-the-model"]').first().click();
    await page.waitForFunction(()=>document.querySelector('link[rel="canonical"]')?.href==='https://fbs-intelligence.onrender.com/beat-the-model/');
    await page.waitForFunction(()=>document.querySelector('meta[property="og:title"]')?.content.includes('Beat the Model'));
    await page.goto(base+'#team/252');await page.locator('.team-narrative').waitFor();
    await page.waitForFunction(()=>document.querySelector('meta[property="og:image"]')?.content.endsWith('/social/team-252.png'));
    assert.ok((await page.locator('meta[name="description"]').getAttribute('content')).includes('BYU'));
    await page.goto(base+'#account');await page.waitForFunction(()=>!document.querySelector('link[rel="canonical"]'));
    assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'),'noindex, nofollow');
    await page.goto(base+'#home');await page.locator('.home-hero').waitFor();
    assert.equal(await page.locator('meta[data-account-robots]').count(),0);
    await page.evaluate(async()=>{
      const {mountMyTeam}=await import('/my-team.js');
      const data=await fetch('/data/rankings.json').then(r=>r.json());
      const target=document.createElement('div');target.id='home-picker-test';document.querySelector('main').append(target);
      window.teamSearchWrites=[];window.teamSearchFcs=data.fcsRankings[0];
      window.closeTeamSearchFixture=mountMyTeam(target,{teams:new Map([...data.rankings,...data.fcsRankings].map(t=>[t.id,t])),renderTeam:t=>t.name,
        adapter:{getPreference:async()=>({signedIn:true,userId:'team-search-fixture',teamId:null,teamIds:[]}),savePreference:async id=>window.teamSearchWrites.push(id)}});
    });
    await page.locator('#home-picker-test [data-my-team-action="edit"]').click();
    const fcs=await page.evaluate(()=>({id:window.teamSearchFcs.id,name:window.teamSearchFcs.name}));
    await page.locator('#home-picker-test input[type="search"]').fill(fcs.name);
    await page.locator('#home-picker-test select').selectOption(fcs.id);
    assert.deepEqual(await page.evaluate(()=>window.teamSearchWrites),[],'Filtering/choosing must not save before submission');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true,'Home team search overflow '+width);
    await page.evaluate(()=>{window.closeTeamSearchFixture();document.querySelector('#home-picker-test').remove();});
    await page.goto(base+'#sor-compare/fbs/252/254');
    await page.getByRole('searchbox',{name:'Filter Team A list',exact:true}).waitFor();
    await page.getByRole('searchbox',{name:'Filter Team A list',exact:true}).fill('Texas');
    await page.locator('select[data-sor-field="a"]').selectOption('251');
    await page.waitForURL('**/#sor-compare/fbs/251/254');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true,'SOR team search overflow '+width);
    assert.deepEqual(errors,[]);checks.push({width,nativeTeamSearch:true,noSelectionOnSearch:true,duplicateRejected:true,keyboard:true,singlePublicHeading:true,metadataTransitions:true,noOverflow:true});await context.close();
  }
  for(const path of ['beat-the-model/','scoreboard/','weekly-picks/fbs/','weekly-picks/fcs/','ranking-history/']){
    const response=await fetch(base+path);assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes(`rel="canonical" href="https://fbs-intelligence.onrender.com/${path}"`));assert.match(html,/<meta property="og:title"/);
  }
  console.log(JSON.stringify({passed:true,scope:'Real local browser; guest state and public publication. No accounts, picks, mail or CFBD requests.',checks},null,2));
}finally{await browser.close();await new Promise(done=>server.close(done));}
