import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const origin = new URL(process.env.FULL_COURT_PREVIEW_URL || 'http://127.0.0.1:4318').origin;
assert.equal(new URL(origin).hostname,'127.0.0.1','Use an isolated loopback preview.');
const screenshots = resolve(process.env.FULL_COURT_SCREENSHOTS || '../tmp/gd-one-platform/discovery');
await mkdir(screenshots,{recursive:true});
const browser = await chromium.launch({headless:true,args:['--no-sandbox'],
  ...(process.env.QUALITY_BROWSER ? {executablePath:process.env.QUALITY_BROWSER} : {}),
});
const routes = {
  football: { teams:'/teams/fbs/', rankings:'/rankings' },
  basketball: { teams:'/basketball/teams/', rankings:'/basketball/rankings/' },
};
const widths = [320,360,390,768,1024,1440,1920];
const searches = ['Wildcats','Mountaineers','Razorbacks'];
const timings = [];
const byName = (a,b) => a.localeCompare(b);
const noOverflow = page => page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1);

async function verifyMascots(page,cards) {
  const violations = await cards.evaluateAll(elements=>elements.flatMap(card=>{
    const mascot=card.querySelector('.team-nickname,.fc-team-name > strong');
    if (!mascot) return [];
    const text=mascot.firstChild;
    const bounds=card.getBoundingClientRect();
    return [...text.textContent.matchAll(/\p{L}+/gu)].flatMap(match=>{
      const range=document.createRange();
      range.setStart(text,match.index);
      range.setEnd(text,match.index+match[0].length);
      const parts=[...range.getClientRects()].filter(part=>part.width);
      return parts.length !== 1 || parts.some(part=>part.left < bounds.left || part.right > bounds.right)
        ? [`${match[0]} in ${card.textContent.trim()}`] : [];
    });
  }));
  assert.deepEqual(violations,[],page.url());
  assert.ok(await noOverflow(page),page.url());
}

try {
  for (const width of widths) {
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',hasTouch:width<=390});
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const cards=page.locator('.gd-team-card');
    const dropdown=label=>page.getByRole('combobox',{name:label,exact:true});
    const search=()=>page.getByRole('searchbox',{name:'School or mascot',exact:true});
    const names=()=>cards.evaluateAll(elements=>elements.map(card=>(card.querySelector('.team-school,.fc-team-name > span,h3:not(:has(.team-school))')).textContent.trim()));
    const waitQuery=(key,value=null)=>page.waitForURL(url=>url.searchParams.get(key)===value);
    const visit=path=>page.goto(origin+path);
    for (const [sport,route] of Object.entries(routes)) {
      await visit(route.teams);
      await cards.first().waitFor();
      assert.equal(await page.getByRole('heading',{name:'Teams',exact:true}).count(),1);
      assert.equal(await dropdown('Sort by').inputValue(),'rank');
      assert.equal(await cards.first().locator('.gd-team-card-rank').innerText(),'#1');
      assert.ok(await noOverflow(page),page.url());
      if (sport==='basketball') {
        assert.equal(await cards.count(),24);
        await page.getByRole('link',{name:'Show more teams'}).click();
        await waitQuery('limit','48');
        assert.equal(await cards.count(),48);
      }
      await page.evaluate(()=>{ window.sameDocument=true; });
      for (const mascot of searches) {
        const start=performance.now();
        await search().fill(mascot);
        await waitQuery('q',mascot);
        timings.push({sport,width,mascot,milliseconds:Math.round(performance.now()-start)});
        assert.ok(await cards.count()>0,`${sport} ${mascot}`);
        assert.ok((await cards.allTextContents()).every(card=>card.toLowerCase().includes(mascot.toLowerCase())));
        assert.ok(await page.evaluate(()=>window.sameDocument));
        await verifyMascots(page,cards);
        if (width===320) {
          await page.evaluate(()=>window.scrollTo(0,0));
          await page.screenshot({path:join(screenshots,`${sport}-${mascot.toLowerCase()}-320.png`)});
        }
      }
      await search().fill('imaginary team 296403');
      await page.getByText('No teams match these filters.',{exact:true}).waitFor();
      await search().clear();
      await waitQuery('q');
      await dropdown('Conference').selectOption('Big 12');
      await waitQuery('conf','Big 12');
      assert.ok((await cards.allTextContents()).every(card=>card.includes('Big 12')));
      await dropdown('Sort by').selectOption('name');
      await waitQuery('sort','name');
      const sorted=await names();
      assert.deepEqual(sorted,[...sorted].sort(byName));
      assert.ok(await page.evaluate(()=>window.sameDocument));
      if ([390,1440].includes(width)) await page.screenshot({path:join(screenshots,`${sport}-directory-${width}.png`)});
      await cards.first().click();
      await page.goBack();
      await dropdown('Conference').waitFor();
      assert.equal(await dropdown('Conference').inputValue(),'Big 12');
      assert.equal(await dropdown('Sort by').inputValue(),'name');
      await dropdown('Sort by').selectOption('rank');
      await page.waitForFunction(()=>document.querySelectorAll('.gd-team-card').length>0 &&
        [...document.querySelectorAll('.gd-team-card-rank')].every((el,index,all)=>
          index===0 || (+all[index-1].textContent.replace('#','')||Infinity) <= (+el.textContent.replace('#','')||Infinity)));
      await visit(route.rankings);
      await page.locator('.gd-team-list-tabs').waitFor();
      await page.evaluate(()=>{ window.sameDocument=true; });
      await search().fill('Houston');
      await waitQuery('q','Houston');
      const type=sport==='basketball'?'link':'button';
      const tabs=page.locator('.gd-team-list-tabs');
      const activeTab=tabs.locator('[aria-current="page"],[aria-pressed="true"]');
      await tabs.getByRole(type,{name:'Predictive Strength',exact:true}).click();
      await waitQuery('model',sport==='basketball'?'predictive':'strength');
      await activeTab.filter({hasText:'Predictive Strength'}).waitFor();
      assert.equal(await search().inputValue(),'Houston');
      assert.ok(await page.evaluate(()=>window.sameDocument));
      await page.goBack();
      await page.waitForFunction(()=>!['predictive','strength'].includes(new URL(location.href).searchParams.get('model')));
      await activeTab.filter({hasText:'Strength of Record'}).waitFor();
      assert.equal(await search().inputValue(),'Houston');
      await page.goForward();
      await activeTab.filter({hasText:'Predictive Strength'}).waitFor();
      assert.equal(await search().inputValue(),'Houston');
      assert.ok(await noOverflow(page),page.url());
    }
    await visit(routes.football.teams);
    await page.getByRole('navigation',{name:'Switch sport'}).getByRole('link',{name:'Basketball'}).click();
    await page.waitForURL(url=>url.pathname===routes.basketball.teams);
    assert.equal(await dropdown('Sort by').inputValue(),'rank');
    assert.deepEqual(errors,[]);
    await context.close();
  }
  console.log(`Verified directory search, stable card typography, conference filtering, ordering, browser history, ranking tabs and sport switching at ${widths.join(', ')}px.`);
  for (const sport of Object.keys(routes)) {
    const ms=timings.filter(row=>row.sport===sport).map(row=>row.milliseconds).sort((a,b)=>a-b);
    console.log(`${sport}: median ${ms[Math.floor(ms.length/2)]} ms from search entry to updated URL (${ms.length} local Chromium actions).`);
  }
  console.log(`Screenshots: ${screenshots}`);
} finally {
  await browser.close();
}
