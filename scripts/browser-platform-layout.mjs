import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createBasketballPreview } from './serve-basketball-preview.mjs';

const external = process.env.FULL_COURT_PREVIEW_URL;
const origin = external ? new URL(external) : null;
if (origin && (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1')) {
  throw Error('Use a loopback preview for this check.');
}
const preview = origin ? null : await createBasketballPreview({accountDirectory:await mkdtemp(join(tmpdir(),'gd-layout-'))});
if (preview) await new Promise(resolve => preview.server.listen(0,'127.0.0.1',resolve));
const base = origin?.origin ?? 'http://127.0.0.1:' + preview.server.address().port;
const output = process.env.FULL_COURT_SCREENSHOTS && resolve(process.env.FULL_COURT_SCREENSHOTS);
if (output) await mkdir(output,{recursive:true});
const browser = await chromium.launch({
  headless:true,
  ...(process.env.QUALITY_BROWSER ? {executablePath:process.env.QUALITY_BROWSER} : {}),
});
const pairs = [
  ['home','/football/','/basketball/'],
  ['rankings','/rankings','/basketball/rankings/'],
  ['teams','/teams/fbs/','/basketball/teams/'],
  ['scoreboard','/scoreboard','/basketball/scoreboard/'],
  ['matchup','/matchup-lab','/basketball/matchup-lab/'],
  ['conferences','/conference-strength/?view=records','/basketball/conferences/'],
  ['reports','/model-reports/fbs/','/basketball/model-reports/'],
];
const sparse = [
  ['portal','/'], ['football-home','/football/'], ['basketball-home','/basketball/'],
  ['football-scoreboard','/scoreboard'], ['basketball-scoreboard','/basketball/scoreboard/?date=2026-11-01'],
  ['empty-search','/find-team/?q=an-implausible-team-name'], ['empty-rankings','/basketball/rankings/?q=an-implausible-team-name'],
  ['profile','/preview-profile/'], ['admin','/admin'], ['methodology','/basketball/methodology/'],
  ['not-found','/basketball/unknown-section/'],
];

async function open(page,path,withHero = false) {
  const response = await page.goto(base+path);
  assert.equal(response.status(),path.includes('unknown-section') ? 404 : 200,path);
  await page.locator('main > .loading').waitFor({state:'hidden'});
  await page.getByRole('heading',{level:1}).first().waitFor();
  if (withHero) await page.locator('main > .gd-page-hero').waitFor();
  if (path === '/scoreboard') {
    await page.locator('[data-scoreboard-health=unavailable]').waitFor();
    await page.getByRole('button',{name:'Check for updates'}).waitFor();
  }
  await page.evaluate(()=>document.fonts.ready);
}

async function layout(page) {
  return page.evaluate(()=>{
    const heading = document.querySelector('main h1');
    const hero = document.querySelector('main > .gd-page-hero');
    const footer = document.querySelector('.gd-footer');
    const bounds = footer.getBoundingClientRect();
    return {
      heading:heading.getBoundingClientRect().left, font:getComputedStyle(heading).fontSize,
      hero:hero?.getBoundingClientRect().height, variant:hero?.className.match(/gd-page-hero--\S+/)?.[0],
      position:getComputedStyle(footer).position, footerTop:bounds.top, footerBottom:bounds.bottom,
      mainBottom:document.querySelector('main').getBoundingClientRect().bottom,
      height:document.documentElement.scrollHeight, width:document.documentElement.scrollWidth,
      viewportHeight:innerHeight, viewportWidth:innerWidth,
    };
  });
}

try {
  for (const width of [320,360,390,768,1024,1440,1920]) {
    const context = await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===base ? route.continue() : route.abort());
    await context.route(url=>['/weekly-picks','/data/weekly-picks.json'].includes(url.pathname),route=>
      route.request().resourceType()==='fetch' ? route.fulfill({status:503}) : route.fallback());
    const page = await context.newPage();
    for (const [name,football,basketball] of pairs) {
      await open(page,football,true);
      const left = await layout(page);
      await open(page,basketball,true);
      const right = await layout(page);
      assert.equal(left.heading,right.heading,`${width} ${name} left margin`);
      assert.equal(left.font,right.font,`${width} ${name} title typography`);
      assert.equal(left.variant,right.variant,`${width} ${name} header variant`);
      assert.ok(left.variant && Math.abs(left.hero-right.hero) <= (name==='home' && width<=700 ? 100 : 27),
        `${width} ${name} hero heights ${left.hero}/${right.hero}`);
    }
    for (const [name,path] of sparse) {
      await open(page,path);
      const current = await layout(page);
      assert.ok(current.width <= width+1,`${width} ${name} no horizontal overflow`);
      assert.notEqual(current.position,'fixed');
      assert.ok(Math.abs(current.mainBottom-current.footerTop)<=1,`${width} ${name} footer follows content`);
      assert.ok(Math.abs(current.footerBottom-Math.max(current.viewportHeight,current.height))<=1,
        `${width} ${name} footer closes the page`);
      if (name==='football-scoreboard' && width>=1024) {
        assert.equal(current.height,current.viewportHeight,'Unavailable football scoreboard fits the viewport');
      }
      if (output && [390,1440].includes(width) && ['football-scoreboard','empty-search','not-found'].includes(name)) {
        await page.screenshot({path:join(output,`footer-${name}-${width}.png`)});
      }
    }
    if ([390,1440].includes(width)) {
      await open(page,'/basketball/scoreboard/?date=2026-11-20');
      await page.evaluate(()=>{ window.platformInteractionCheck = true; });
      await page.getByRole('link',{name:'Next day'}).click();
      await page.waitForURL(url=>url.searchParams.get('date')==='2026-11-21');
      assert.equal(await page.getByLabel('Game date').inputValue(),'2026-11-21');
      assert.equal(await page.getByRole('link',{name:'Next day'}).evaluate(element=>element===document.activeElement),true);
      await page.goBack();
      await page.waitForFunction(()=>document.querySelector('input[name=date]')?.value==='2026-11-20');
      assert.equal(await page.evaluate(()=>window.platformInteractionCheck),true,'Scoreboard date history stays in the same document');
      if (width === 1440) {
        await open(page,'/teams/fbs/');
        await page.evaluate(()=>{ document.documentElement.style.zoom='1.25'; });
        const enlarged = await layout(page);
        assert.ok(enlarged.width<=enlarged.viewportWidth+1,'Directory fits under 125% simulated layout zoom');
      }
    }
    await context.close();
  }
  console.log('Verified seven matched page pairs and eleven footer states at seven viewport widths.');
} finally {
  await browser.close();
  if (preview) await new Promise(resolve=>preview.server.close(resolve));
}
