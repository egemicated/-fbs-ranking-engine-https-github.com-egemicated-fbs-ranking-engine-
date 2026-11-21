import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';

// This isolated browser fixture avoids requests to providers and test accounts.
const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Private tournament preview test</title><link rel="stylesheet" href="/basketball-bracket.css">' +
  '<style>*{box-sizing:border-box}body{margin:0;padding:1rem;font:16px system-ui;background:#f5f8fc}main{max-width:1300px;margin:auto}</style>' +
  '<main id="bracket"></main><script type="module">import {mountBasketballBracket} from "/basketball/basketball-bracket.js";' +
  'const rankings = Array.from({length:128},(_,i)=>({id:String(i+1),name:"Fixture school " +(i+1),conference:"Fixture League " +(1+i%32),sorRank:i+1}));' +
  'mountBasketballBracket(document.querySelector("#bracket"),{rankings,forecast:(a,b)=>+a<+b?.62:.38,' +
  'previewProfile:{id:"test-profile"},storage:localStorage});</script></html>';
const sources = new Map([
  ['/basketball/basketball-bracket.js','../basketball/basketball-bracket.js'],
  ['/basketball-bracket.css','../basketball/basketball-bracket.css'],
  ['/basketball/bracket.js','../basketball/bracket.js'],
  ['/basketball/bracket-archive.js','../basketball/bracket-archive.js'],
]);
const server = createServer(async (req,res) => {
  if (new URL(req.url, 'http://local').pathname === '/') {
    res.setHeader('Content-Type','text/html; charset=utf-8').end(html);
    return;
  }
  const source = sources.get(req.url);
  if (!source) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('Content-Type',req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
  res.end(await readFile(new URL(source,import.meta.url)));
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/';
const pics = process.env.GD_BRACKET_SCREENSHOTS;
if (pics) await mkdir(pics,{recursive:true});
let browser;
try {
  const executablePath = process.env.QUALITY_BROWSER;
  browser = await chromium.launch(executablePath ? {executablePath} : {});
  for (const width of [390, 768, 1440, 1920]) {
    const desktop = width > 860;
    const page = await browser.newPage({viewport:{width,height:900}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.getByRole('heading',{name:'GD projected field'}).waitFor();
    if (desktop) await assertGeometry(page, 75, 12);
    await page.goto(url+'?mode=official');
    await page.getByRole('heading',{name:'Selection Sunday is ahead'}).waitFor();
    await page.getByRole('button',{name:'Try the 76-team format'}).click();
    await page.getByRole('heading',{name:'2027 format demonstration'}).waitFor();
    if (pics && !desktop) await page.screenshot({path:join(pics,'basketball-demo-' + width + '.png'),fullPage:true});
    const viewport = page.getByRole('region',{name:'Interactive tournament bracket'});
    const world = page.locator('.bb-map-world');
    const scale = async () => Number(await viewport.getAttribute('data-scale'));
    const sameProgress = async value => assert.equal(await page.getByRole('progressbar',{name:'Bracket completion'}).getAttribute('value'),String(value));
    if (desktop) {
      await assertGeometry(page, 75, 12);
      await viewport.scrollIntoViewIfNeeded();
      if (pics) await page.getByRole('region',{name:'Tournament map'}).screenshot({path:join(pics,'basketball-demo-' + width + '.png')});
      const fit = await scale();
      const area = await viewport.boundingBox();
      const before = await world.boundingBox();
      const anchorX = area.x + area.width * .36;
      const anchorY = area.y + area.height * .4;
      await page.mouse.move(anchorX, anchorY);
      await page.mouse.wheel(0, -330);
      await page.waitForFunction(fit => +document.querySelector('.bb-map-viewport').dataset.scale > fit, fit);
      const zoomed = await world.boundingBox();
      const ratio = zoomed.width / before.width;
      assert.ok(Math.abs((anchorX - before.x) * ratio - (anchorX - zoomed.x)) < 2, 'wheel preserves the pointer’s horizontal anchor');
      assert.ok(Math.abs((anchorY - before.y) * ratio - (anchorY - zoomed.y)) < 2, 'wheel preserves the pointer’s vertical anchor');
      const zoom = await scale();
      await page.getByRole('button',{name:'Zoom out'}).click();
      assert.ok(await scale() < zoom);
      const translation = await world.evaluate(el => el.style.transform);
      const view = await viewport.boundingBox();
      await page.mouse.move(view.x + view.width/2, view.y + 10);
      await page.mouse.down();
      await page.mouse.move(view.x + view.width/2 + 72, view.y + 50,{steps:8});
      assert.ok(await viewport.evaluate(el => el.classList.contains('is-dragging')));
      await page.mouse.up();
      assert.notEqual(await world.evaluate(el => el.style.transform),translation);
      await sameProgress(0);
      const jump = page.locator('[data-bracket-map-select]');
      await jump.selectOption('east');
      assert.ok(await scale() > fit);
      await page.getByRole('button',{name:'Fit entire bracket'}).click();
      assert.equal(await scale(),fit);
      await viewport.press('+');
      assert.ok(await scale() > fit);
      await page.getByRole('button',{name:'Reset view'}).click();
      assert.equal(await scale(),fit);
      await jump.selectOption('championship');
      assert.ok(await scale() > 1);
      await page.getByRole('button',{name:'Fullscreen bracket'}).click();
      await page.getByRole('button',{name:'Exit fullscreen bracket'}).waitFor();
      assert.ok(await page.evaluate(() => !!document.fullscreenElement || document.querySelector('#bracket').classList.contains('bb-map-expanded')));
      if (pics) await page.screenshot({path:join(pics,'basketball-fullscreen-' + width + '.png')});
      await page.getByRole('button',{name:'Exit fullscreen bracket'}).click();
      await page.getByRole('button',{name:'Fullscreen bracket'}).waitFor();
      await sameProgress(0);
      await jump.selectOption('east');
      if (pics) await page.getByRole('region',{name:'Tournament map'}).screenshot({path:join(pics,'basketball-east-' + width + '.png')});
    }
    const opening = page.locator('[data-bracket-slot=east-opening-16]').getByRole('button').first();
    await opening.focus();
    await opening.press('Space');
    assert.match(await page.getByRole('status').innerText(), /advances/);
    const identity = await opening.getAttribute('data-bracket-team');
    if (desktop) {
      await page.locator('[data-bracket-map-select]').selectOption('east');
      assert.equal(await page.locator('path[data-from=east-opening-16].is-picked').count(), 1);
    } else await page.locator('[data-bracket-select=round]').selectOption('1');
    const promoted = page.locator('[data-bracket-slot=east-r1-1]').getByRole('button').last();
    assert.equal(await promoted.getAttribute('data-bracket-team'),identity);
    await promoted.click();
    await sameProgress(2);
    if (desktop) {
      await page.locator('[data-bracket-map-select]').selectOption('east');
      assert.equal(await page.locator('path[data-from=east-opening-16].is-advancing').count(), 1);
      await page.locator('[data-bracket-slot=east-opening-16]').getByRole('button').last().click();
      await sameProgress(1);
      assert.notEqual(await promoted.getAttribute('data-bracket-team'),identity);
      assert.equal(await promoted.getAttribute('aria-pressed'),'false');
    }
    await page.getByRole('button',{name:'Save practice bracket'}).click();
    await page.getByRole('button',{name:'Reset picks'}).click();
    await page.getByRole('button',{name:'Reopen saved draft'}).click();
    await sameProgress(desktop ? 1 : 2);
    await page.getByRole('button',{name:'Go to Final Four'}).click();
    if (desktop) assert.equal(await page.locator('[data-bracket-map-select]').inputValue(),'national');
    else await page.getByRole('heading',{name:'National rounds'}).waitFor();
    await page.getByRole('button',{name:'GD projected bracket'}).click();
    await page.getByRole('heading',{name:'GD projected field'}).waitFor();
    assert.match(await page.locator('.bb-bracket-intro').innerText(),/Neutral-site model favorite/);
    await page.getByRole('button',{name:'My bracket'}).click();
    await page.locator('[data-bracket-select=practiceField]').selectOption('projection');
    await page.getByRole('button',{name:'Pick model favorites'}).click();
    assert.equal(await page.getByRole('progressbar',{name:'Bracket completion'}).getAttribute('value'),'75');
    await page.getByRole('button',{name:'Official bracket'}).click();
    await page.locator('[data-bracket-select=field]').selectOption('archive');
    assert.match(await page.locator('.bb-bracket-intro').innerText(),/Champion Michigan/);
    if (desktop) {
      await assertGeometry(page, 67, 4);
      await page.locator('[data-bracket-map-select]').selectOption('east');
    } else {
      await page.locator('[data-bracket-select=region]').selectOption('east');
      await page.locator('[data-bracket-select=round]').selectOption('1');
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow,false);
    assert.deepEqual(errors,[]);
    if (pics) await page.screenshot({path:join(pics,'basketball-bracket-' + width + '.png'),fullPage:true});
    await page.getByRole('button',{name:'My bracket'}).click();
    await page.locator('[data-bracket-select=practiceField]').selectOption('archive');
    await page.getByRole('heading',{name:'2026 historical practice'}).waitFor();
    if (desktop) await page.locator('[data-bracket-map-select]').selectOption('east');
    else await page.locator('[data-bracket-select=round]').selectOption('1');
    await page.getByRole('button',{name:'Advance Duke, seed 1'}).click();
    assert.match(await page.locator('.bb-bracket-progress').innerText(),/1 \/ 1 correct/);
    await page.goto(url+'?mode=projection');
    await page.getByRole('heading',{name:'GD projected field'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'GD projected bracket'}).getAttribute('aria-pressed'),'true');
    await page.close();
  }
  console.log('Basketball tournament browser checks passed at 390, 768, 1440 and 1920 px.');
} finally {
  await browser?.close();
  server.close();
}

async function assertGeometry(page, games, openers) {
  assert.equal(await page.locator('[data-bracket-slot]').count(),games);
  assert.equal(await page.locator('[data-bracket-slot][data-round="0"]').count(),openers);
  assert.equal(await page.locator('.bb-map-region').count(),4);
  assert.equal(await page.locator('.bb-map-connectors path').count(),games-1);
  const failures = await page.locator('.bb-map-viewport').evaluate(view => {
    const bounds = view.getBoundingClientRect();
    const cards = [...view.querySelectorAll('[data-bracket-slot]')];
    return cards.flatMap((card,index) => {
      const box = card.getBoundingClientRect();
      const outside = box.left < bounds.left || box.top < bounds.top || box.right > bounds.right || box.bottom > bounds.bottom;
      const overlaps = cards.slice(index + 1).some(next => {
        const other = next.getBoundingClientRect();
        return box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top;
      });
      return outside || overlaps ? [card.dataset.bracketSlot] : [];
    });
  });
  assert.deepEqual(failures,[]);
}
