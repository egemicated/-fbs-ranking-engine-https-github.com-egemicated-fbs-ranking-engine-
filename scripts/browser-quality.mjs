import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { routeHref } from '../frontend/clean-routes.js';

const directory = resolve('static-dist');
const types = {'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.xml':'application/xml'};
const server = createServer(async (request,response) => {
  const path = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  let file = resolve(directory,'.'+path);
  if (!extname(path)) file = resolve(file,'index.html');
  if (!file.startsWith(directory+sep)) return response.writeHead(404).end();
  try { const body=await readFile(file); response.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream'}).end(body); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base = process.env.QUALITY_SITE || 'http://127.0.0.1:'+server.address().port+'/';
const localOrigin = new URL(base).origin;
const address = (route) => new URL(routeHref(route), base).href;
const openRoute = (page, route, options) => page.goto(address(route), options);
const isolate = context => context.route('**/*', route =>
  new URL(route.request().url()).origin === localOrigin ? route.continue() : route.abort());
const browser = await chromium.launch({headless:true, ...(process.env.QUALITY_BROWSER ? {executablePath:process.env.QUALITY_BROWSER}:{}), args:['--no-sandbox']});
const snapshot=JSON.parse(await readFile('static-dist/data/rankings.json','utf8'));
const fcs=snapshot.fcsRankings[0], fbs=snapshot.rankings[0];
const routes = [
  ['home','.home-hero'], ['polls/ap/-1','.edition-panel'],
  ['rankings','#ranking-results'], ['rankings/fcs','#ranking-results'], ['teams/fcs','.team-grid'], ['team/'+fbs.id,'.team-narrative'],
  ['team/'+fcs.id,'.team-narrative'], ['conference-strength/records','.conference-matrix'],
  ['conference-strength/quality','.conference-quality-list'], ['compare','.compare-picker'],
  ['sor-compare','[data-sor-evidence] .intelligence-panel'], ['model-report/fbs','.model-report'],
  ['model-report/fcs','.model-report'], ['my-teams','.my-teams-page'],
  ['bracket/demo','[data-bracket-action="sample"]'], ['cfp-scenarios','[data-scenario-action="fill"]'],
  ['about','[data-connected-feature] .platform-info'], ['privacy','[data-connected-feature] .platform-info'],
  ['terms','[data-connected-feature] .platform-info'], ['support','[data-connected-feature] .platform-info'],
  ['conference-strength/compare/2025/SEC/Big%20Ten','.conference-game'],
];
let checks=0;
try {
    for (const width of [320,375,390,430,768,1024,1440,1600]) {
    const context=await browser.newContext({viewport:{width,height:960},reducedMotion:'reduce'});
    await isolate(context);
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    for (const [route,selector] of routes) {
      const response = await openRoute(page, route, {waitUntil:'domcontentloaded'});
      assert.equal(response.status(),200,route+' direct route');
      await page.locator(selector).first().waitFor({timeout:15000});
      assert.equal(page.url(),address(route),route+' clean URL');
      assert.equal(await page.locator('main h1').count(),1,route+' primary heading');
      const dimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
      assert.equal(dimensions.scroll,dimensions.width,route+' overflow at '+width);
      const missingLabels=await page.locator('main').evaluate(main=>[...main.querySelectorAll('select,textarea,input:not([type="hidden"]):not([type="submit"])')].filter(control=>!control.labels?.length&&!control.getAttribute('aria-label')&&!control.getAttribute('aria-labelledby')).map(control=>control.id));
      assert.deepEqual(missingLabels,[],route+' unlabeled controls');
      assert.ok(!await page.locator('main').innerText().then(text=>/\bundefined\b|NaN%/.test(text)),route+' invalid displayed values');
      assert.equal(await page.locator('main .logo, main .bracket-team-logo, main img[src*="espncdn"]').count(),0,route+' school image placeholders');
      if (route === 'teams/fcs') {
        const wedges = await page.locator('.team-card.team-accent-card').evaluateAll(cards => cards.map(card => {
          const corner = getComputedStyle(card, '::after');
          const before = getComputedStyle(card, '::before');
          return corner.bottom === '0px' && corner.right === '0px' && corner.top !== '0px' &&
            corner.clipPath.startsWith('polygon(') && ['none', 'normal'].includes(before.content);
        }));
        assert.ok(wedges.length > 0 && wedges.every(Boolean), 'Every team card has one bottom-right wedge');
      }
      checks++;
    }
    const more = page.locator('.nav-more > summary');
    await more.focus();
    await page.keyboard.press('Space');
    await page.locator('.nav-more[open] .nav-more-links').waitFor();
    assert.ok(await more.evaluate(el => el.getBoundingClientRect().height >= 44));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.nav-more[open]').count(), 0);
    assert.ok(await more.evaluate(el => el === document.activeElement));
    await openRoute(page,'compare/matchup/254/254/home');
    await page.getByText(/Choose a different opponent/).waitFor();
    assert.equal(await page.locator('.prediction-card').count(),0);
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(()=>document.activeElement!==document.body));
    assert.deepEqual(errors,[]);
    await context.close();
  }
  const clean=await (await fetch(base+'team/252/')).text();
  assert.match(clean,/<link rel="canonical" href="https:\/\/www\.thegamesdecide\.com\/team\/252\/">/);
  assert.match(clean,/<meta property="og:image" content="https:\/\/www\.thegamesdecide\.com\/social\/team-252\.png">/);
  assert.match(clean,/<title>BYU/);
  const png=await fetch(base+'social/team-252.png');
  assert.equal(png.status,200);
  assert.equal(png.headers.get('content-type'),'image/png');
  const sitemap=await (await fetch(base+'sitemap.xml')).text();
  assert.match(sitemap,/\/team\/252\//);
  assert.match(sitemap,/\/model-reports\/fcs\//);
  assert.doesNotMatch(sitemap,/\/(?:account|admin|my-teams)(?:\/|<)/);
  for (const path of ['account','admin','my-teams']) {
    const response=await fetch(base+path), html=await response.text();
    assert.equal(response.status,200,path);
    assert.match(html,/name="robots" content="noindex, nofollow"/);
    assert.doesNotMatch(html,/rel="canonical"|property="og:/);
  }
  for (const path of ['invalid-route','team/99999999/','rankings/unregistered','account/unregistered']) {
    assert.equal((await fetch(base+path)).status,404,path);
  }
  for (const path of ['rankings.json','weekly-picks.json','weekly-fcs-picks.json','performance.json','conferences/index.json']) assert.equal((await fetch(base+'data/'+path)).status,200,path);
  const context=await browser.newContext({reducedMotion:'reduce'});
  await isolate(context);
  const page=await context.newPage();
  await openRoute(page,'team/252');
  await page.locator('.team-narrative').waitFor();
  assert.equal(page.url(),address('team/252'));
  const legacyState=address('team/252/results');
  await page.goto(base+'#team/252/results');
  await page.waitForURL(legacyState);
  const resultsTab=page.getByRole('button',{name:'Results',exact:true});
  await resultsTab.waitFor();
  assert.equal(await resultsTab.getAttribute('aria-pressed'),'true');
  await page.reload();
  await resultsTab.waitFor();
  assert.equal(page.url(),legacyState);
  assert.equal(await resultsTab.getAttribute('aria-pressed'),'true');
  await page.locator('nav[aria-label="Main navigation"] a[href="/rankings"]').click();
  await page.waitForURL(address('rankings'));
  await page.locator('#ranking-results').waitFor();
  await page.goBack();
  await page.waitForURL(legacyState);
  await resultsTab.waitFor();
  assert.equal(await resultsTab.getAttribute('aria-pressed'),'true');
  await page.goForward();
  await page.waitForURL(address('rankings'));
  await page.locator('#ranking-results').waitFor();
  await page.goto(base+'#polls/ap/-1');
  await page.waitForURL(address('polls/ap/-1'));
  await page.locator('.edition-panel').waitFor();
  assert.match(await page.locator('.edition-panel').innerText(),/exact game cutoff has not been verified/);
  assert.ok((await page.locator('.poll-rank-table tbody tr td:first-of-type').allTextContents()).every(text=>text.trim()==='—'));
  await openRoute(page,'conference-strength/quality/2025');
  await page.locator('[data-conference-field="method"]').selectOption('ap');
  await page.locator('[data-conference-field="rankScope"]').selectOption('pregame');
  assert.match(await page.locator('main').innerText(),/Pregame ranking coverage · 245 of 245 eligible games/);
  const slate=JSON.parse(await readFile('static-dist/data/weekly-picks.json','utf8'));
  const names=new Map(slate.teams.map(team=>[team.id,team.name]));
  const sampleWeek=slate.games.find(game=>game.seasonType==='regular')?.week;
  const samples=slate.games.filter(game=>game.week===sampleWeek&&game.seasonType==='regular').slice(0,4);
  const feed={season:{year:slate.season,type:2},week:{number:sampleWeek},leagues:[{calendar:[]}],events:samples.map((game,index)=>({
    id:game.id,date:game.startDate,competitions:[{date:game.startDate,dateValid:true,timeValid:true,
      status:{type:index===0?{state:'in',description:'Live',shortDetail:'3rd quarter'}:index===1?{state:'post',completed:true,name:'STATUS_FINAL',shortDetail:'Final'}:{state:'pre',shortDetail:'Scheduled'}},
      broadcasts:[{names:['ESPN']}],competitors:['away','home'].map(side=>({homeAway:side,score:index<2?'14':undefined,team:{id:game[side],displayName:names.get(game[side]),abbreviation:'TEST'}}))}]}))};
  await page.route('https://site.api.espn.com/**/scoreboard?*',request=>request.fulfill({json:feed}));
  await openRoute(page,'scoreboard');
  await page.locator('[data-game-id]').first().waitFor();
  assert.equal(await page.locator('[data-game-id]').count(),4);
  assert.equal(await page.locator('.scoreboard-team img').count(),0);
  await page.locator('[data-game-filter="status"]').selectOption('live');
  assert.equal(await page.locator('[data-game-id]').count(),1);
  await page.locator('[data-game-filter="status"]').selectOption('all');
  assert.equal(await page.locator('[data-game-id]').count(),4);
  await page.locator('[data-scoreboard-collapse]').click();
  assert.ok(await page.locator('[data-scoreboard-section="final"] [data-scoreboard-games]').isHidden());
  await page.locator('[data-scoreboard-collapse]').click();
  await page.locator('[data-scoreboard-refresh]').click();
  assert.equal(await page.locator('[data-game-id]').count(),4);
  await page.locator('[data-game-filter="scope"]').selectOption('mine');
  assert.equal(await page.locator('[data-game-id]').count(),0);
  assert.match(await page.locator('[data-scoreboard-filters]').innerText(),/Sign in and choose teams/);
  await openRoute(page,'support');
  await page.locator('[data-connected-feature] .platform-info').first().waitFor();
  await page.evaluate(async()=>{
    const root=document.createElement('div');root.id='support-test';document.querySelector('main').append(root);
    const {mountPlatformInfo}=await import('/platform-info.js');
    window.supportCalls=[];
    mountPlatformInfo(root,{page:'account',previewClient:{auth:{getUser:async()=>({data:{user:{id:'test-user'}}})},rpc:async(name,args)=>{
      window.supportCalls.push({name,args});return {data:name==='my_account_requests'?[]:{id:'test-request',kind:'support',status:'pending'}};
    }}});
  });
  await page.locator('#support-test [data-account-request]').waitFor();
  await page.locator('#support-test textarea').fill('Please check my account settings.');
  await page.locator('#support-test button[type="submit"]').click();
  await page.getByText(/Request test-request is saved for review/).waitFor();
  assert.equal(await page.evaluate(()=>window.supportCalls.filter(call=>call.name==='submit_support_request').length),1);
  await page.evaluate(async()=>{
    const {mountMyTeams}=await import('/my-teams.js');
    const snapshot=await fetch('/data/rankings.json').then(response=>response.json());
    const teams=new Map([...snapshot.rankings,...snapshot.fcsRankings].map(team=>[team.id,team]));
    let teamIds=['252',snapshot.fcsRankings[0].id];
    let listener=()=>{};
    const state=()=>({signedIn:true,teamIds:[...teamIds],primaryTeamId:teamIds[0]});
    const store={load:async()=>state(),subscribe:callback=>{listener=callback;return()=>{};},
      save:async ids=>{teamIds=ids;listener();return state();},
      primary:async id=>{teamIds=[id,...teamIds.filter(value=>value!==id)];listener();return state();},
      remove:async id=>{teamIds=teamIds.filter(value=>value!==id);listener();return state();}};
    const target=document.createElement('div');target.id='my-teams-signed-test';document.querySelector('main').append(target);
    mountMyTeams(target,{teams,store,movement:snapshot.rankingMovement,
      loadTeamDetails:id=>fetch('/data/teams/'+id+'.json').then(response=>response.json()),
      loadAvailability:id=>fetch('/data/team-availability/'+id+'.json').then(response=>response.ok?response.json():null)});
  });
  await page.locator('#my-teams-signed-test .my-teams-card').nth(1).waitFor();
  await page.waitForFunction(()=>!document.querySelector('#my-teams-signed-test [data-saved-team="252"]')?.textContent.includes('Vs. own conferenceNot reported'));
  const byu=page.locator('#my-teams-signed-test [data-saved-team="252"]');
  const byuDetails=JSON.parse(await readFile('static-dist/data/teams/252.json','utf8'));
  if (byuDetails.upcomingGames?.length) {
    const opponent=byuDetails.upcomingGames[0].opponentName;
    await byu.getByText(new RegExp(opponent.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))).first().waitFor();
  }
  assert.match(await byu.innerText(),/Predictive rank\s+#\d+/);
  await page.locator('#my-teams-signed-test [data-my-teams-primary]').nth(1).click();
  await page.waitForFunction(()=>document.querySelector('#my-teams-signed-test .my-teams-card')?.getAttribute('data-saved-team')!=='252');
  await page.locator('#my-teams-signed-test [data-my-teams-remove="252"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#my-teams-signed-test .my-teams-card').length===1);
  await context.close();
  console.log('Browser quality gate passed '+checks+' responsive routes, direct and legacy entry, refresh, browser history, 404s, metadata, duplicate matchup rejection, labels, JSON, scoreboard filters and private request UI.');
} finally {
  await browser.close();
  server.close();
}
