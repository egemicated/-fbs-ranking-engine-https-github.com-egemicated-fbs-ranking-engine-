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
  ['/', '.fc-portal-grid','sports'], ['/sports/', '.fc-portal-grid','sports-alias'], ['/football/', '.home-hero','football'],
  ['/basketball/', '.fc-hoops-hero','basketball'], ['/basketball/rankings/','[data-ranking-browser]','rankings'],
  ['/basketball/polls/','[data-basketball-ranking-comparison]','ap-comparison'],
  ['/basketball/polls/coaches/','[data-basketball-ranking-comparison]','coaches-comparison'],
  ['/basketball/teams/','[data-team-browser]','teams'], [teamPath(teamA), '.fc-content','team'],
  [matchup,'[data-matchup-form][data-matchup-enhanced]','matchup'], ['/basketball/conferences/','[data-gd-basketball-conferences]','conference'],
  ['/basketball/scoreboard/?date='+picksDate,'.scoreboard-game','scoreboard'],
  ['/basketball/picks/?date='+picksDate,'.fc-games','picks'],
  ['/basketball/model-reports/','[data-view-results]','reports'],
  ['/basketball/ranking-history/','[data-view-results]','history'],
  ['/basketball/methodology/','.fc-stack','methodology'],
  ['/basketball/march-madness/','.bb-bracket','bracket'],
];

async function verifyMatchupHistory(page, basketball) {
  const path = basketball ? matchup : '/matchup-lab';
  const teamASelector = basketball ? 'select[data-matchup-team="a"]' : '#compare-a';
  const teamBSelector = basketball ? 'select[data-matchup-team="b"]' : '#compare-b';
  const a = page.locator(teamASelector), b = page.locator(teamBSelector);
  const result = page.locator('.matchup-win-chances');
  await page.goto(origin+path);
  await page.getByRole('searchbox',{name:'Filter Team A list',exact:true}).waitFor();
  await result.waitFor();
  await page.evaluate(()=>{ window.matchupBrowserCheck=true; });
  const state = async () => ({
    url:page.url(), a:await a.inputValue(), b:await b.inputValue(), result:await result.textContent(),
  });
  const history = [await state()];
  const scrollAt = control => control.evaluate(element => {
    element.focus({preventScroll:true});
    window.scrollTo({top:scrollY+element.getBoundingClientRect().top-112,behavior:'instant'});
    return scrollY;
  });
  const verifyChange = async (control, top) => {
    await page.waitForURL(url=>url.href!==history.at(-1).url);
    await result.waitFor();
    await page.waitForFunction(element=>element===document.activeElement,await control.elementHandle());
    const next = await state();
    assert.notEqual(next.result,history.at(-1).result);
    const url = new URL(next.url);
    assert.equal(url.hash,'');
    assert.deepEqual([url.searchParams.get('a'),url.searchParams.get('b')],[next.a,next.b]);
    const scroll = await page.evaluate(top=>({
      actual:scrollY, expected:Math.min(top,Math.max(0,document.documentElement.scrollHeight-innerHeight)),
    }),top);
    assert.ok(Math.abs(scroll.actual-scroll.expected)<=1,
      `${basketball?'Basketball':'Football'} matchup scroll at ${next.url}: ${scroll.actual}, expected ${scroll.expected} from ${top}`);
    history.push(next);
  };
  for (const select of [a,b]) {
    const selected = await select.inputValue();
    const options = await select.locator('option').evaluateAll(nodes=>nodes.filter(option=>option.value&&!option.disabled).map(option=>option.value));
    const replacement = options.findLast(id=>id!==selected);
    assert.ok(replacement);
    const top = await scrollAt(select);
    await select.selectOption(replacement);
    await verifyChange(select,top);
    assert.equal(await select.inputValue(),replacement);
  }
  const venue = page.getByRole('button',{name:'Team A at home',exact:true});
  const top = await scrollAt(venue);
  await venue.click();
  await verifyChange(venue,top);
  assert.equal(await venue.getAttribute('aria-pressed'),'true');
  const transition = await page.locator('[data-matchup-results]').evaluate(el=>({
    duration:parseFloat(getComputedStyle(el).animationDuration),
    reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,
  }));
  assert.equal(transition.duration===0,transition.reduce);
  for (const direction of ['goBack','goForward']) {
    const states = direction === 'goBack' ? history.slice(0,-1).reverse() : history.slice(1);
    for (const previous of states) {
      await page[direction]();
      await page.waitForURL(previous.url);
      await page.waitForFunction(expected=>document.querySelector('.matchup-win-chances')?.textContent===expected,previous.result);
      assert.deepEqual(await state(),previous);
      assert.equal(await venue.evaluate(element=>element===document.activeElement),true);
    }
  }
  assert.ok(await page.evaluate(()=>window.matchupBrowserCheck),'History and comparison edits stay in the same document');
  await page.goto(history.at(-1).url);
  await result.waitFor();
  if (basketball) await page.locator('[data-matchup-form][data-matchup-enhanced]').waitFor();
  assert.deepEqual(await state(),history.at(-1));
}

const rankingFields = {
  sor:['sorRank','sorScore',3], predictive:['predictiveRank','predictiveScore',1],
  performance:['performanceRank','performanceScore',1],
};
async function verifyRankings(page) {
  const rankingsPath = origin+'/basketball/rankings/';
  const view = page.locator('[data-ranking-browser]');
  const tab = model => view.locator('[data-ranking-model="'+model+'"]');
  const notice = view.locator('[data-team-error]');
  const checkModel = async model => {
    const [rank,score,digits] = rankingFields[model];
    await tab(model).and(page.locator('[aria-current="page"]')).waitFor();
    const visible = await view.locator('.fc-ranking-table tbody tr').evaluateAll(rows=>rows.map(row=>({
      team:row.querySelector('a').pathname.split('/').filter(Boolean).at(-1),
      rank:Number(row.querySelector('.fc-rank-marker').textContent.slice(1)),
      score:row.cells[3].textContent.trim(),
    })));
    const expected = sourceSeason.snapshot.teams.filter(team=>Number.isFinite(team[rank])&&team[rank]<=25)
      .sort((a,b)=>a[rank]-b[rank]||a.name.localeCompare(b.name))
      .map(team=>({team:team.id.split(':').at(-1),rank:team[rank],score:Number.isFinite(team[score])?team[score].toFixed(digits):'—'}));
    assert.deepEqual(visible,expected,model+' table matches the published model fields and order');
    assert.equal(await page.locator('.fc-fresh time').getAttribute('datetime'),sourceSeason.snapshot.asOf);
    assert.equal(await view.locator('[data-ranking-model-version]').textContent(),sourceSeason.snapshot.modelVersion);
  };
  const response = await page.goto(rankingsPath);
  assert.doesNotMatch(await response.text(),/Could not update rankings\./,'Fresh HTML must not describe a failure');
  await view.and(page.locator('[data-team-enhanced]')).waitFor();
  await checkModel('sor');
  await page.route('**/'+index.currentSeason+'/season.json',route=>route.fulfill({status:503}),{times:1});
  await tab('predictive').click();
  await notice.waitFor();
  assert.match(await notice.textContent(),/Could not update rankings\./);
  assert.equal(page.url(),rankingsPath);
  await checkModel('sor');
  await tab('predictive').click();
  await page.waitForURL(/model=predictive/);
  await checkModel('predictive');
  assert.equal(await notice.isHidden(),true);
  await tab('performance').click();
  await page.waitForURL(/model=performance/);
  await checkModel('performance');
  await page.goBack();
  await checkModel('predictive');
  await page.goForward();
  await checkModel('performance');
  for (const model of Object.keys(rankingFields)) {
    await page.goto(rankingsPath+'?model='+model);
    await checkModel(model);
  }
  await view.locator('[data-team-filters] input[name="q"]').fill('ZZZ-UNMATCHED-TEAM');
  await view.getByText('No teams match these filters.',{exact:true}).waitFor();
  assert.equal(await notice.isHidden(),true);
}

async function verifyRankingComparison(page) {
  const hub = page.getByRole('navigation', { name: 'Ranking views' });
  const source = page.getByRole('navigation', { name: 'Poll source' });
  const comparison = page.locator('[data-basketball-ranking-comparison]');
  await page.goto(origin + '/basketball/rankings/');
  assert.equal(await hub.getByRole('link', { name: 'Rankings', exact: true }).getAttribute('aria-current'), 'page');
  await hub.getByRole('link', { name: 'Compare Rankings' }).click();
  await page.waitForURL(origin + '/basketball/polls/');
  await comparison.waitFor();
  assert.equal(await hub.getByRole('link', { name: 'Compare Rankings' }).getAttribute('aria-current'), 'page');
  assert.equal(await source.getByRole('link', { name: 'AP Top 25' }).getAttribute('aria-current'), 'page');
  const leader = sourceSeason.snapshot.teams.find(team => team.sorRank === 1);
  assert.ok(leader);
  const top = comparison.locator('tbody tr').first().locator('td').first();
  await top.locator(`a[href^="${teamPath(leader)}"]`).waitFor();
  assert.equal(await comparison.locator('tbody tr').count(), 25);

  await source.getByRole('link', { name: 'USA TODAY Coaches Poll' }).click();
  await page.waitForURL(origin + '/basketball/polls/coaches/');
  await comparison.getByRole('columnheader', { name: 'USA TODAY Coaches Poll' }).waitFor();
  assert.equal(await source.getByRole('link', { name: 'USA TODAY Coaches Poll' }).getAttribute('aria-current'), 'page');
  await page.goBack();
  await comparison.getByRole('columnheader', { name: 'AP Top 25' }).waitFor();
  await page.goBack();
  await page.locator('[data-ranking-browser]').waitFor();
}

async function verifyScoreboard(page) {
  let date, slate;
  for (const candidate of index.directory[index.currentSeason].dates.slice().reverse()) {
    const record = await source('slate/'+candidate+'.json');
    if (record.games.filter(game=>game.completed).length>=2) { date=candidate; slate=record; break; }
  }
  assert.ok(slate,'Published basketball verification needs two saved finals on one game day');
  const nextDay = new Date(Date.parse(date)+86_400_000).toISOString().slice(0,10);
  const sample = slate.games.find(game=>game.completed);
  const alternate = version === 'f'.repeat(24) ? 'e'.repeat(24) : 'f'.repeat(24);
  const newer = new Date(Date.parse(sourceSeason.snapshot.asOf)+1_000).toISOString();
  const alternateRoot = '**/basketball-data/'+alternate+'/';
  let mode = 'baseline';
  const routes = [
    ['**/basketball-data/latest.json',route=>mode==='unavailable' ? route.fulfill({status:503,body:'Unavailable'})
      : route.fulfill({json:{version:mode==='newer' ? alternate : version}})],
    [alternateRoot+'index.json',route=>route.fulfill({json:index})],
    [alternateRoot+index.currentSeason+'/season.json',route=>route.fulfill({json:{...sourceSeason,
      snapshot:{...sourceSeason.snapshot,asOf:newer}}})],
    [alternateRoot+index.currentSeason+'/slate/'+date+'.json',route=>route.fulfill({json:{...slate,
      games:slate.games.map(game=>game.id===sample.id ? {...game,homePoints:game.homePoints+1} : game)}})],
  ];
  for (const [path,handler] of routes) await page.route(path,handler);
  try {
    const boardUrl=origin+'/basketball/scoreboard/?date='+date;
    await page.goto(boardUrl);
    const cards=page.locator('[data-scoreboard-section="final"] article');
    const direct=page.locator(`[data-game-id="${sample.id}"]`);
    const refresh=page.getByRole('button',{name:'Check for updates'});
    const next=page.getByRole('link',{name:'Next day'});
    const dateInput=page.getByLabel('Game date');
    await direct.waitFor();
    assert.equal(await cards.count(),slate.games.filter(game=>game.completed).length);
    assert.equal(await direct.locator('.scoreboard-score').last().textContent(),String(sample.homePoints));
    assert.equal(await page.getByRole('link',{name:/Gamecast/}).count(),0);
    assert.equal(await page.locator('[data-game-filter="scope"]').count(),0);
    await page.evaluate(()=>{window.basketballScoreboardTest=true;});
    await next.click();
    await page.waitForURL(url=>url.searchParams.get('date')===nextDay);
    assert.equal(await dateInput.inputValue(),nextDay);
    assert.equal(await next.evaluate(node=>node===document.activeElement),true);
    await page.goBack();
    await page.waitForFunction(value=>document.querySelector('input[name=date]')?.value===value,date);
    assert.equal(await page.evaluate(()=>window.basketballScoreboardTest),true);

    const first=await cards.first().getAttribute('data-game-id');
    await cards.first().focus();
    await page.keyboard.press('Alt+ArrowDown');
    assert.equal(await cards.nth(1).getAttribute('data-game-id'),first);
    await page.getByRole('button',{name:'Reset order'}).click();
    assert.equal(await cards.first().getAttribute('data-game-id'),first);
    await page.getByRole('button',{name:'Collapse completed games'}).click();
    await cards.first().waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Show completed games'}).click();
    await cards.first().waitFor();

    await page.getByLabel('Status',{exact:true}).selectOption('final');
    await page.getByLabel('Close matchups').check();
    const close=slate.games.filter(game=>game.completed && Math.abs(game.homePoints-game.awayPoints)<=7);
    assert.equal(await cards.count(),close.length);
    await page.getByLabel('Close matchups').uncheck();
    await page.getByLabel('SOR Top 25 teams').check();
    const ranked=new Set(sourceSeason.snapshot.teams.filter(team=>team.sorRank>0 && team.sorRank<=25).map(team=>team.id));
    const expectedRanked=slate.games.filter(game=>game.completed && (ranked.has(game.home)||ranked.has(game.away)));
    assert.equal(await cards.count(),expectedRanked.length);
    await page.getByLabel('SOR Top 25 teams').uncheck();
    await page.getByLabel('Status',{exact:true}).selectOption('all');

    mode='newer';
    await refresh.click();
    await direct.locator('.scoreboard-score').last().filter({hasText:new RegExp('^'+(sample.homePoints+1)+'$')}).waitFor();
    mode='unavailable';
    await refresh.click();
    await page.locator('.scoreboard-warning').filter({hasText:'The refresh failed'}).waitFor();
    assert.equal(await direct.locator('.scoreboard-score').last().textContent(),String(sample.homePoints+1));
    await dateInput.fill(nextDay);
    await page.waitForFunction(value=>document.querySelector('input[name=date]')?.value===value,date);
    assert.equal(await direct.locator('.scoreboard-score').last().textContent(),String(sample.homePoints+1));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);

    const pick=page.locator('[data-game-id] a').filter({hasText:'Saved prediction'}).first();
    if (await pick.count()) {
      const anchor = new URL(await pick.getAttribute('href'),origin).hash;
      await pick.click();
      await page.locator(anchor).waitFor();
      assert.equal(new URL(page.url()).hash,anchor);
    }
  } finally {
    for (const [path,handler] of routes) await page.unroute(path,handler);
  }
}

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
      assert.equal(await page.locator('header[data-gd-masthead]').count(),1,path+' shared masthead');
      assert.equal(await page.locator('footer.gd-footer').count(),1,path+' shared footer');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,width+' '+path);
      assert.equal(await page.locator('a[href*="/preview-profile/"]').count(),0);
      if (evidence && [390,1440].includes(width) && ['sports','football','basketball','rankings','team','matchup','scoreboard','bracket'].includes(name)) {
        await page.screenshot({path:resolve(evidence,name+'-'+width+'.png'),animations:'disabled'});
      }
    }
    assert.deepEqual(errors,[],width+' JavaScript errors');
    await context.close();
  }

  const context = await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page = await context.newPage();
  await page.goto(origin+'/#main');
  await page.locator('.fc-portal-grid').waitFor();
  assert.equal(new URL(page.url()).hash,'#main');
  await page.goto(origin+'/#team/252/results');
  await page.waitForURL('**/team/252/?view=results');
  await page.getByRole('heading',{name:/BYU/}).first().waitFor();
  await page.goto(origin+'/#home');
  await page.waitForURL('**/football/');
  await page.locator('.home-hero').waitFor();
  await page.getByText('Account controls could not load.',{exact:true}).waitFor();
  await page.locator('[data-gd-sport-link="basketball"]').click();
  await page.waitForURL('**/basketball/');
  await page.locator('.gd-brand').click();
  await page.waitForURL(origin+'/');
  await page.locator('.fc-portal-grid').waitFor();
  await page.goto(origin+'/beat-the-model/');
  assert.equal(await page.locator('[data-gd-sport-link="basketball"]').getAttribute('href'),'/basketball/picks/');
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
  await verifyMatchupHistory(page,true);
  await verifyMatchupHistory(page,false);
  await verifyRankings(page);
  await verifyRankingComparison(page);
  await verifyScoreboard(page);

  const [primary] = sourceSeason.conferenceQuality.rows.filter(row=>row.nonconference.games>0);
  await page.goto(origin+'/basketball/conferences/?'+new URLSearchParams({view:'head',a:primary.conference}));
  await page.getByRole('heading',{name:primary.conference+' vs all opponents'}).waitFor();
  const itemCount = await page.locator('.fc-game').count();
  assert.ok(itemCount>0 && itemCount<=12);
  await page.goto(origin+'/basketball/model-reports/');
  assert.equal(await page.getByText('Saved prospective forecasts',{exact:true}).count(),1);
  assert.ok(report.graded >= 0 && report.forecasts >= report.graded);
  await page.goto(origin+'/basketball/march-madness/');
  await page.getByRole('button',{name:'Official bracket'}).click();
  await page.getByRole('heading',{name:'Selection Sunday is ahead'}).waitFor();
  await page.getByRole('button',{name:'Try the 76-team format'}).click();
  await page.getByRole('heading',{name:'Practice a GD projection'}).waitFor();
  assert.equal(await page.locator('[data-bracket-select="practiceField"]').inputValue(),'projection');
  await page.getByRole('button',{name:'My bracket'}).click();
  assert.equal(await page.locator('option[value="format"]').count(),0);
  assert.equal(await page.getByRole('button',{name:'Save practice bracket'}).count(),1);
  await page.getByRole('button',{name:'Save practice bracket'}).click();
  assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('gd-bracket:mbb:'))),true);
  await context.close();
  const desktop = await browser.newContext({viewport:{width:1440,height:790},reducedMotion:'no-preference'});
  await desktop.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const desktopPage = await desktop.newPage();
  await verifyMatchupHistory(desktopPage,true);
  await verifyMatchupHistory(desktopPage,false);
  await verifyRankingComparison(desktopPage);
  await verifyScoreboard(desktopPage);
  await desktop.close();
  for (const path of ['/basketball/contest/','/preview-profile/','/basketball-preview/bracket-data.json','/basketball/preview-accounts.mjs','/.env.basketball.local']) {
    assert.equal((await fetch(origin+path)).status,404,path);
  }
  console.log('Passed '+pages.length*8+' public route and width checks, cross-sport matchup scroll and history, ranking rows and retry, bracket drafts, team evidence, and preview isolation.');
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
