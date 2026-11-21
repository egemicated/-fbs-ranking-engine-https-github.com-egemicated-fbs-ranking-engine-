// Real homepage/component rendering with a disposable localhost account adapter.
// Public data comes from the existing static publication. No real account or
// preference is read or written and no CollegeFootballData request is made.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const directory=resolve('static-dist');
const types={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'};
const server=createServer(async(request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  let file=resolve(directory,'.'+pathname);
  if(!extname(pathname))file=resolve(file,'index.html');
  if(!file.startsWith(directory+sep))return response.writeHead(404).end();
  try{response.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream'}).end(await readFile(file));}
  catch{response.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}/`;
const publication=JSON.parse(await readFile(resolve(directory,'data/rankings.json'),'utf8'));
const ids=['252','251',publication.fcsRankings[0].id];
const browser=await chromium.launch({headless:true,...(process.env.QUALITY_BROWSER?{executablePath:process.env.QUALITY_BROWSER}:{}),args:['--no-sandbox']});
const results=[];
try{
  for(const width of [320,390,768,1440]){
    const context=await browser.newContext({viewport:{width,height:1050},reducedMotion:width===390?'no-preference':'reduce',hasTouch:true});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
    // Use the current source when this check is run before the combined build.
    for(const name of ['my-team.js','my-team.css'])await page.route(`**/${name}*`,async route=>route.fulfill({contentType:types[extname(name)],body:await readFile(resolve('frontend',name))}));
    await page.addInitScript(({ids})=>{
      let listener=()=>{};
      window.carouselAccount={signedIn:true,userId:'carousel-fixture',teamId:ids[0],teamIds:ids};
      window.carouselSaves=[];
      window.fbsReviewPreview={myTeam:{getPreference:async()=>({...window.carouselAccount,updatesEnabled:false}),
        savePreference:async(...args)=>{window.carouselSaves.push(args);},subscribe:callback=>{listener=callback;return()=>{};}},
        contest:{client:{auth:{getSession:async()=>({data:{session:{user:{id:'carousel-fixture'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}};
      window.refreshCarouselAccount=()=>listener();
    },{ids});
    await page.goto(base+'football/',{waitUntil:'domcontentloaded'});
    await page.locator(`[data-my-team] [data-favorite-team="${ids[0]}"]`).waitFor();
    const next=()=>page.getByRole('button',{name:'Next followed team',exact:true});
    const previous=()=>page.getByRole('button',{name:'Previous followed team',exact:true});
    const shown=()=>page.locator('[data-my-team] [data-favorite-team]').getAttribute('data-favorite-team');
    assert.equal(await page.getByRole('navigation',{name:'Followed teams'}).count(),1);
    await previous().click();assert.equal(await shown(),ids[2]);
    await next().click();assert.equal(await shown(),ids[0]);
    await next().focus();await page.keyboard.press('ArrowRight');assert.equal(await shown(),ids[1]);
    await page.keyboard.press('ArrowLeft');assert.equal(await shown(),ids[0]);
    // The touch path uses the same Pointer Events that browsers deliver, without
    // changing the account or faking a data request.
    await page.locator('[data-my-team-slide]').dispatchEvent('pointerdown',{pointerType:'touch',pointerId:4,clientX:230,clientY:300});
    await page.locator('[data-my-team-slide]').dispatchEvent('pointerup',{pointerType:'touch',pointerId:4,clientX:100,clientY:305});
    assert.equal(await shown(),ids[1]);
    await page.locator('[data-my-team-slide]').dispatchEvent('pointerdown',{pointerType:'touch',pointerId:5,clientX:230,clientY:300});
    await page.locator('[data-my-team-slide]').dispatchEvent('pointerup',{pointerType:'touch',pointerId:5,clientX:200,clientY:450});
    assert.equal(await shown(),ids[1]);
    await page.evaluate(()=>window.refreshCarouselAccount());
    await page.locator(`[data-my-team] [data-favorite-team="${ids[1]}"]`).waitFor();
    assert.equal(await page.evaluate(()=>window.carouselAccount.teamId),ids[0]);
    assert.deepEqual(await page.evaluate(()=>window.carouselSaves),[]);
    for(let i=0;i<7;i++)await next().click();
    assert.equal(await shown(),ids[2]);
    const dimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
    assert.equal(dimensions.scroll,dimensions.width,'Carousel overflow at '+width);
    const controls=await page.locator('.my-team-cycle').evaluateAll(elements=>elements.map(element=>({label:element.getAttribute('aria-label'),width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height})));
    assert.ok(controls.every(control=>control.label&&control.width>=44&&control.height>=44));
    if(width!==390)assert.equal(await page.locator('[data-my-team-slide]').evaluate(element=>getComputedStyle(element).animationName),'none');
    if(process.env.MY_TEAM_CAROUSEL_SCREENSHOTS){
      await mkdir(process.env.MY_TEAM_CAROUSEL_SCREENSHOTS,{recursive:true});
      await previous().click();
      await page.locator('[data-my-team] img').evaluateAll(images=>Promise.all(images.map(image=>Promise.race([
        image.decode().catch(()=>{}),new Promise(done=>setTimeout(done,1500)),
      ]))));
      await page.locator('[data-my-team] .my-team').screenshot({path:resolve(process.env.MY_TEAM_CAROUSEL_SCREENSHOTS,`carousel-${width}.png`)});
    }
    await page.evaluate(()=>{window.carouselAccount={signedIn:false,userId:null,teamId:null,teamIds:[]};window.refreshCarouselAccount();});
    await page.getByRole('link',{name:'Follow teams',exact:true}).waitFor();
    assert.equal(await page.locator('[data-my-team-carousel]').count(),0);
    if(width===1440){
      await page.evaluate(async()=>{
        const {mountMyTeam}=await import('/my-team.js');
        const target=document.createElement('div');target.id='carousel-race-check';document.querySelector('main').append(target);
        const teams=new Map([['26',{id:'26',name:'First',division:'fbs'}],['147',{id:'147',name:'Second',division:'fcs'}]]);
        window.carouselRaceWrites=[];window.carouselRaceFacts=[];window.carouselRaceExtras=[];
        mountMyTeam(target,{teams,season:2026,renderTeam:team=>`<strong>${team.name}</strong><span data-race-extra></span>`,
          adapter:{getPreference:async()=>({signedIn:true,userId:'race-fixture',teamId:'26',teamIds:['26','147']}),markUpdatesSeen:async id=>{window.carouselRaceWrites.push(id);return true;}},
          loadUpdateFacts:team=>new Promise(resolve=>{window.carouselRaceFacts.push(team.id);window.releaseOldCarouselFacts=()=>resolve({asOf:'2026-11-18T00:00:00Z',rank:1,method:'SOR rank'});}),
          mountExtras:(root,team)=>{let active=true;const slot=root.querySelector('[data-race-extra]');const timer=setTimeout(()=>{if(active&&slot.isConnected){slot.textContent=team.name;window.carouselRaceExtras.push(team.id);}},50);return()=>{active=false;clearTimeout(timer);};}});
      });
      await page.locator('#carousel-race-check [data-favorite-team="26"]').waitFor();
      await page.locator('#carousel-race-check [data-my-team-action="next"]').click();
      await page.evaluate(()=>window.releaseOldCarouselFacts());
      await page.locator('#carousel-race-check [data-race-extra]').filter({hasText:'Second'}).waitFor();
      assert.deepEqual(await page.evaluate(()=>window.carouselRaceWrites),[],'Old primary facts must not write after cycling');
      assert.deepEqual(await page.evaluate(()=>window.carouselRaceFacts),['26'],'Secondary facts must not use primary-only seen history');
      assert.equal(await page.locator('#carousel-race-check [data-favorite-team]').getAttribute('data-favorite-team'),'147');
    }
    assert.deepEqual(errors,[]);
    results.push({width,wrap:true,keyboard:true,horizontalTouch:true,verticalScrollPreserved:true,primaryUnchanged:true,preferenceWrites:0,noOverflow:true,touchTargets:true,signOutClears:true,...(width===1440?{staleFactsAndExtrasGuarded:true}:{})});
    await context.close();
  }
  console.log(JSON.stringify({passed:true,scope:'Actual localhost homepage and published teams; disposable account adapter, no real account/CFBD calls',checks:results},null,2));
}finally{await browser.close();await new Promise(done=>server.close(done));}
