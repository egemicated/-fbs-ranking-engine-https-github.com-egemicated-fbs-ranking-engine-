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
  if (req.url === '/') {
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
  for (const width of [390, 768, 1440]) {
    const page = await browser.newPage({viewport:{width,height:900}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await page.getByRole('heading',{name:'Selection Sunday is ahead'}).waitFor();
    await page.getByRole('button',{name:'Try the 76-team format'}).click();
    await page.getByRole('heading',{name:'2027 format demonstration'}).waitFor();
    if (pics) await page.screenshot({path:join(pics,'basketball-demo-' + width + '.png'),fullPage:true});
    const opening = page.locator('[data-bracket-slot=east-opening-16]').getByRole('button').first();
    await opening.focus();
    await opening.press('Space');
    assert.match(await page.getByRole('status').innerText(), /advances/);
    const identity = await opening.getAttribute('data-bracket-team');
    await page.locator('[data-bracket-select=round]').selectOption('1');
    const promoted = page.locator('[data-bracket-slot=east-r1-1]').getByRole('button').last();
    assert.equal(await promoted.getAttribute('data-bracket-team'),identity);
    await promoted.click();
    await page.getByRole('button',{name:'Save practice bracket'}).click();
    await page.getByRole('button',{name:'Reset picks'}).click();
    await page.getByRole('button',{name:'Reopen saved draft'}).click();
    assert.equal(await page.getByRole('progressbar',{name:'Bracket completion'}).getAttribute('value'),'2');
    await page.getByRole('button',{name:'Go to Final Four'}).click();
    await page.getByRole('heading',{name:'National rounds'}).waitFor();
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
    await page.locator('[data-bracket-select=region]').selectOption('east');
    if (width <= 860) await page.locator('[data-bracket-select=round]').selectOption('1');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow,false);
    assert.deepEqual(errors,[]);
    if (pics) await page.screenshot({path:join(pics,'basketball-bracket-' + width + '.png'),fullPage:true});
    await page.getByRole('button',{name:'My bracket'}).click();
    await page.locator('[data-bracket-select=practiceField]').selectOption('archive');
    await page.getByRole('heading',{name:'2026 historical practice'}).waitFor();
    await page.locator('[data-bracket-select=round]').selectOption('1');
    await page.getByRole('button',{name:'Advance Duke, seed 1'}).click();
    assert.match(await page.locator('.bb-bracket-progress').innerText(),/1 \/ 1 correct/);
    await page.close();
  }
  console.log('Basketball tournament browser checks passed at 390, 768 and 1440 px.');
} finally {
  await browser?.close();
  server.close();
}
