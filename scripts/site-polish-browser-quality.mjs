import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {chromium} from 'playwright';
import {routeHref} from '../frontend/clean-routes.js';
const directory=resolve('static-dist'),types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=resolve(directory,'.'+path,extname(path)?'':'index.html');if(!file.startsWith(directory+sep))return res.writeHead(404).end();try{const body=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream'}).end(body);}catch{res.writeHead(404).end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base='http://127.0.0.1:'+server.address().port+'/';
const basketballEntry=await fetch(base+'basketball/');
const unifiedSite=basketballEntry.ok&&(await basketballEntry.text()).includes('name="basketball-publication"');
const address = route => new URL(routeHref(route),base).href;
const openRoute = (page,route) => page.goto(address(route));
const browser=await chromium.launch({headless:true,...(process.env.QUALITY_BROWSER?{executablePath:process.env.QUALITY_BROWSER}:{}),args:['--no-sandbox']});
const checks=[];
try{
  for(const width of [320,375,390,768,1024,1440]){
    const context=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
    let metadataRequests=0;
    page.on('request',request=>{if(new URL(request.url()).pathname==='/data/page-metadata.json')metadataRequests++;});
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
    await openRoute(page,'compare/matchup/252/254/neutral');
    await page.getByRole('searchbox',{name:'Filter Team A list',exact:true}).waitFor();
    const filterA=()=>page.getByRole('searchbox',{name:'Filter Team A list',exact:true});
    await filterA().fill('team-that-does-not-exist');
    await page.getByText(/No matching teams\. Your current selection is retained/).waitFor();
    assert.equal(await page.locator('#compare-a').inputValue(),'252');
    await filterA().fill('Texas');await filterA().press('Enter');assert.equal(await page.locator('#compare-a').evaluate(e=>e===document.activeElement),true);
    await page.locator('#compare-a').selectOption('251');
    await page.waitForURL(address('compare/matchup/251/254/neutral'));
    await page.reload();
    await page.locator('#compare-a').waitFor();
    assert.equal(await page.locator('#compare-a').inputValue(),'251');
    assert.equal(await page.locator('#compare-b').inputValue(),'254');
    await page.getByRole('searchbox',{name:'Filter Team B list',exact:true}).fill('Texas');
    assert.equal(await page.locator('#compare-b option[value="251"]:not([disabled])').count(),0);
    await page.getByRole('searchbox',{name:'Filter Team B list',exact:true}).press('Escape');
    assert.equal(await page.locator('#compare-b').evaluate(e=>e===document.activeElement),true);
    assert.equal(await page.locator('.prediction-card').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true,'Team picker overflow '+width);
    for(const route of ['about','privacy','terms','support']){
      await openRoute(page,route);await page.locator('[data-connected-feature] .platform-info h1').waitFor();
      assert.equal(await page.locator('main h1').count(),1,'Duplicate heading '+route);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true,route+' overflow '+width);
    }
    const beforeMetadata=metadataRequests;
    await openRoute(page,'methodology');await page.locator('.method-grid').first().waitFor();
    assert.equal(metadataRequests,beforeMetadata,'Direct static page should retain its prerendered metadata');
    let contestLink=page.locator('a[href="/beat-the-model/"]').first();
    if(unifiedSite){
      const mobileMenu=page.locator('.gd-menu-toggle');
      if(await mobileMenu.isVisible())await mobileMenu.click();
      await page.locator('summary[data-nav-section="predictions"]').click();
      contestLink=page.getByRole('navigation',{name:'Football sections',exact:true}).getByRole('link',{name:'Beat the Model',exact:true});
    }
    await Promise.all([
      page.waitForResponse(response=>new URL(response.url()).pathname==='/data/page-metadata.json'&&response.ok()),
      contestLink.click(),
    ]);
    await page.waitForURL(address('beat-the-model'));
    await page.waitForFunction(()=>document.querySelector('link[rel="canonical"]')?.href==='https://www.thegamesdecide.com/beat-the-model/');
    await page.waitForFunction(()=>document.querySelector('meta[property="og:title"]')?.content.includes('Beat the Model'));
    assert.equal(metadataRequests,beforeMetadata+1,'Navigation should read the public metadata registry once');
    await openRoute(page,'team/252');await page.locator('.team-narrative').waitFor();
    await page.waitForFunction(()=>document.querySelector('meta[property="og:image"]')?.content.endsWith('/social/team-252.png'));
    assert.ok((await page.locator('meta[name="description"]').getAttribute('content')).includes('BYU'));
    await openRoute(page,'account');await page.waitForFunction(()=>!document.querySelector('link[rel="canonical"]'));
    assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'),'noindex, nofollow');
    await openRoute(page,'home');await page.locator('.home-hero').waitFor();
    assert.equal(await page.locator('meta[data-account-robots]').count(),0);
    if(unifiedSite){
      await page.locator('header .gd-brand').click();
      await page.waitForURL(base);
      await page.locator('main .fc-portal-grid').waitFor();
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'),'https://www.thegamesdecide.com/');
      assert.equal(await page.locator('meta[data-account-robots]').count(),0);
      const football=page.getByRole('navigation',{name:'Switch sport',exact:true}).locator('a[href="/football/"]');
      await football.click();
      await page.waitForURL(address('home'));
      await page.locator('.home-hero').waitFor();
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'),'https://www.thegamesdecide.com/football/');
    }
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
    await openRoute(page,'sor-compare/fbs/252/254');
    await page.getByRole('searchbox',{name:'Filter Team A list',exact:true}).waitFor();
    await page.getByRole('searchbox',{name:'Filter Team A list',exact:true}).fill('Texas');
    await page.locator('select[data-sor-field="a"]').selectOption('251');
    await page.waitForURL(address('sor-compare/fbs/251/254'));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true,'SOR team search overflow '+width);
    assert.deepEqual(errors,[]);checks.push({width,nativeTeamSearch:true,noSelectionOnSearch:true,duplicateRejected:true,keyboard:true,singlePublicHeading:true,metadataTransitions:true,noOverflow:true});await context.close();
  }
  for(const path of ['beat-the-model/','rankings','matchup-lab','scoreboard','weekly-picks','weekly-picks/fcs/','ranking-history/','support']){
    const response=await fetch(base+path);assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes(`rel="canonical" href="https://www.thegamesdecide.com/${path}"`));assert.match(html,/<meta property="og:title"/);
  }
  console.log(JSON.stringify({passed:true,scope:'Real local browser; guest state and public publication. No accounts, picks, mail or CFBD requests.',checks},null,2));
}finally{await browser.close();await new Promise(done=>server.close(done));}
