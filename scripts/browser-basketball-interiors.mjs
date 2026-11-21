import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { dayKey } from '../basketball/preview-ui.mjs';
import { buildBasketballSnapshot } from '../basketball/model-engine.js';
import { basketballConferenceQuality } from '../basketball/conference-quality.mjs';
import { createBasketballPreview } from './serve-basketball-preview.mjs';

let server;
let year, teams, dataset, quality, seasonCount, host;
if (process.env.FULL_COURT_PREVIEW_URL) {
  const url = new URL(process.env.FULL_COURT_PREVIEW_URL);
  assert.equal(url.hostname,'127.0.0.1','Only use a loopback preview for browser tests');
  host = url.origin;
  const source = new URL('../data/seasons/basketball/',import.meta.url);
  const files = (await readdir(source)).filter(file=>/^\d{4}\.json$/.test(file)).sort();
  const validation = JSON.parse(await readFile(new URL('../reports/full-court-basketball-validation.json',import.meta.url),'utf8'));
  dataset = JSON.parse(await readFile(new URL(files.at(-1),source),'utf8'));
  const snapshot = buildBasketballSnapshot(dataset,{config:validation.modelConfig});
  year = snapshot.season;
  teams = snapshot.teams;
  quality = basketballConferenceQuality({snapshot,dataset});
  seasonCount = files.length;
} else {
  const preview = await createBasketballPreview({accountDirectory:await mkdtemp(join(tmpdir(),'gd-interiors-browser-'))});
  server = preview.server;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  host = `http://127.0.0.1:${server.address().port}`;
  year = Math.max(...preview.seasons.keys());
  const season = preview.seasons.get(year);
  teams = [...season.teams.values()];
  dataset = season.dataset;
  quality = season.conferenceQuality;
  seasonCount = preview.seasons.size;
}
const team = teams.find(team=>team.name==='Houston')??teams[0];
const [a,b,stat] = quality.rows.flatMap(row=>row.headToHead.map(pair=>[row.conference,pair.conference,pair]))
  .find(([, ,pair])=>pair.games >= 2 && pair.games <= 12 && pair.wins !== pair.losses);
const teamIds = new Set(teams.map(team=>team.id));
const game = dataset.games.findLast(game=>game.completed && game.box?.away && game.box?.home
  && teamIds.has(game.home) && teamIds.has(game.away));
const cards = '[data-team-card]';
const rankingRows = '.fc-ranking-table tbody tr';
const screenshots = resolve(process.env.FULL_COURT_SCREENSHOTS||'../tmp/gd-full-court/interiors');
await mkdir(screenshots,{recursive:true});

const browser = await chromium.launch({headless:true,args:['--no-sandbox'],
  ...(process.env.QUALITY_BROWSER ? {executablePath:process.env.QUALITY_BROWSER} : {}),
});
const pathFor = (view,params={}) => `/basketball/${view}/?${new URLSearchParams({season:year,...params})}`;
const assertFits = async page=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),page.url());

try {
  for (const width of [320,360,375,390,430,768,1024,1440]) {
    const context = await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===host ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    const visit = async (view,params) => {
      assert.equal((await page.goto(host+pathFor(view,params))).status(),200);
      await assertFits(page);
    };
    const save = async (name,element=null) => {
      if (![390,1440].includes(width)) return;
      await page.evaluate(()=>document.fonts.ready);
      await (element??page).screenshot({path:join(screenshots,`${name}-${width}.png`)});
    };

    await visit('rankings');
    assert.equal(await page.locator(rankingRows).count(),teams.filter(row=>row.sorRank !== null && row.sorRank <= 25).length);
    await save('rankings');
    await page.evaluate(()=>{ document.body.dataset.rankingsTest = 'same document'; });
    await page.getByRole('link',{name:'Predictive Strength',exact:true}).click();
    await page.waitForURL(/model=predictive/);
    assert.equal(await page.getByRole('link',{name:'Predictive Strength',exact:true}).getAttribute('aria-current'),'page');
    await page.getByRole('link',{name:`Show all ${teams.length} teams`,exact:true}).click();
    await page.waitForURL(/all=1/);
    assert.equal(await page.locator(rankingRows).count(),teams.length);
    await page.getByRole('searchbox',{name:'School or mascot'}).fill(team.name);
    await page.waitForURL(url=>url.searchParams.get('q')===team.name);
    await page.locator(rankingRows).filter({hasText:team.name}).first().waitFor();
    assert.equal(await page.locator('body').getAttribute('data-rankings-test'),'same document');
    await assertFits(page);

    await visit('teams');
    await page.waitForFunction(()=>performance.getEntriesByType('resource').some(entry=>entry.name.endsWith('/preview-interiors.js')));
    assert.equal(await page.locator(cards).count(),24);
    await save('teams');
    await page.evaluate(()=>{ document.body.dataset.interiorTest = 'same document'; });
    await page.getByRole('link',{name:'Show more teams'}).click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-team-card]').length===48);
    const search = page.getByRole('searchbox',{name:'School or mascot'});
    await search.fill('not a basketball team 104892');
    await page.getByText('No teams match these filters.').waitFor();
    await search.fill(team.name);
    await page.locator(cards).filter({hasText:team.name}).first().waitFor();
    assert.equal(await page.locator('body').getAttribute('data-interior-test'),'same document');
    await search.clear();
    await page.locator('[data-team-filters] select[name=conf]').selectOption(team.conference);
    const showCount = Math.min(24,teams.filter(row=>row.conference===team.conference).length);
    await page.waitForFunction(expected=>document.querySelectorAll('[data-team-card]').length===expected,showCount);
    assert.ok((await page.locator(cards).allTextContents()).every(label=>label.includes(team.conference)));
    await page.getByRole('combobox',{name:'Sort by',exact:true}).selectOption('name');
    await page.waitForURL(/sort=name/);
    const letter = team.name.charAt(0);
    await page.getByRole('navigation',{name:'Filter teams by first letter'}).getByRole('link',{name:letter,exact:true}).click();
    await page.waitForURL(/letter=/);
    assert.ok((await page.locator(cards).allTextContents()).every(label=>label.trim().startsWith(letter)));
    await assertFits(page);

    await visit('conferences');
    const overview = page.getByRole('region',{name:'Sortable conference results'});
    const mobileSort = page.getByLabel('Sort conferences');
    const useMobileSort = width <= 768;
    const sortByWins = async direction => {
      if (useMobileSort) await mobileSort.selectOption('wins:'+direction);
      else await overview.getByRole('link',{name:'Wins',exact:true}).click();
      assert.equal(await overview.locator(`th[aria-sort="${direction}"] [data-gd-conference-column="wins"]`).count(),1);
    };
    const wins = () => overview.locator('tbody td:nth-child(3) .gd-conference-cell-value').allTextContents().then(values=>values.map(Number));
    await page.evaluate(()=>{ document.body.dataset.interiorConference = 'same document'; });
    await sortByWins('descending');
    const descending = await wins();
    assert.deepEqual(descending,[...descending].sort((a,b)=>b-a));
    await sortByWins('ascending');
    assert.deepEqual(await wins(),[...descending].reverse());
    await page.goBack();
    assert.deepEqual(await wins(),descending);
    await page.goForward();
    assert.deepEqual(await wins(),[...descending].reverse());
    assert.equal(await page.locator('body').getAttribute('data-interior-conference'),'same document');
    if (useMobileSort) {
      assert.ok(await overview.locator('tbody tr').evaluateAll(rows=>rows.every(row=>{
        const record = row.querySelector('.gd-conference-card-record');
        const predictive = row.lastElementChild.getBoundingClientRect();
        return record.clientHeight > 0 && predictive.width > 0 && predictive.right <= row.getBoundingClientRect().right;
      })),'Basketball conference cards expose the previously obscured predictive stat');
      assert.equal(await overview.evaluate(element=>element.scrollWidth),await overview.evaluate(element=>element.clientWidth));
    }
    await save('conference-overview');
    if (width === 1440) {
      for (const [label,index] of [['Conference',1],['D-I teams',2],['Losses',4],['Win %',5],['Mean predictive strength',6]]) {
        const alphabetical = index === 1;
        const column = overview.locator(`tbody tr > :nth-child(${index}) .gd-conference-cell-value`);
        const sortedBy = (x,y) => alphabetical ? x.localeCompare(y) : x-y;
        for (const ascending of [alphabetical,!alphabetical]) {
          await overview.getByRole('link',{name:label,exact:true}).click();
          assert.equal(await overview.getByRole('columnheader',{name:label,exact:true}).getAttribute('aria-sort'),
            ascending ? 'ascending' : 'descending');
          const values = (await column.allTextContents()).map(value=>alphabetical ? value.trim() : Number.parseFloat(value))
            .filter(value=>!Number.isNaN(value));
          assert.deepEqual(values,[...values].sort((x,y)=>(ascending ? 1 : -1)*sortedBy(x,y)));
        }
      }
    }
    await page.getByRole('navigation',{name:'Conference analysis'}).getByRole('link',{name:'Head-to-Head',exact:true}).click();
    const cell = page.getByRole('link',{name:`${a} vs ${b}, ${stat.wins} wins and ${stat.losses} losses`,exact:true});
    await cell.waitFor();
    const compare = page.getByRole('button',{name:'Compare',exact:true});
    await page.getByLabel('Conference A',{exact:true}).selectOption(a);
    await page.getByLabel('Conference B',{exact:true}).selectOption(b);
    await compare.scrollIntoViewIfNeeded();
    const beforeCompare = await page.evaluate(()=>scrollY);
    await compare.click();
    await page.getByRole('heading',{name:`${a} vs ${b}`,exact:true}).waitFor();
    assert.equal(await page.locator('.fc-game').count(),stat.games);
    assert.equal(await page.getByLabel('Conference A',{exact:true}).inputValue(),a);
    assert.equal(await page.getByLabel('Conference B',{exact:true}).inputValue(),b);
    assert.equal(await page.locator('body').getAttribute('data-interior-conference'),'same document');
    assert.ok(Math.abs((await page.evaluate(()=>scrollY))-beforeCompare)<3,'Conference compare keeps scroll position');
    await page.getByRole('link',{name:'Swap conferences'}).click();
    await page.getByRole('heading',{name:`${b} vs ${a}`,exact:true}).waitFor();
    assert.equal(await page.locator('.fc-game').count(),stat.games);
    assert.match(await page.locator('.fc-metric').first().innerText(),new RegExp(`${stat.losses}–${stat.wins}`));
    assert.equal(await page.locator('body').getAttribute('data-interior-conference'),'same document');
    await assertFits(page);
    await page.getByRole('navigation',{name:'Conference analysis'}).getByRole('link',{name:'Trends',exact:true}).click();
    const trend = page.getByRole('region',{name:'Historical nonconference results'});
    await trend.waitFor();
    assert.equal(await trend.locator('tbody tr').count(),seasonCount);

    await visit('scoreboard',{date:dayKey(game.startDate)});
    const completedGame = page.locator('.fc-game').filter({has:page.getByText('Team box score',{exact:true})})
      .filter({has:page.getByRole('link',{name:'Matchup Lab'})}).first();
    const boxScore = completedGame.getByText('Team box score',{exact:true});
    await boxScore.click();
    await boxScore.locator('..').getByText('Possessions',{exact:true}).waitFor();
    assert.equal(await completedGame.locator('.fc-game-score').count(),2);
    assert.equal(await completedGame.locator('.fc-game-winner').count(),1);
    await completedGame.getByRole('link',{name:'Matchup Lab'}).waitFor();
    await assertFits(page);
    await save('scoreboard-game',completedGame);
    assert.deepEqual(errors,[]);
    await context.close();
    console.log(`Basketball interiors verified at ${width}px.`);
  }
  console.log(`Verified basketball ranking models, full list and filters, same-page team filtering, sortable conference tables and cards, reciprocal game counts, history and box score at eight widths. Screenshots: ${screenshots}`);
} finally {
  await browser.close();
  if (server) await new Promise(resolve=>server.close(resolve));
}
