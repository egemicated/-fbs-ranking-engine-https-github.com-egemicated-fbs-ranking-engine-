import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { rankSeason } from '../src/engine.js';
import { appVmSource, installAppVmContext } from '../test-support/app-vm.mjs';

const appPath = new URL('../frontend/app.js', import.meta.url);
const source = appVmSource(await readFile(appPath, 'utf8'));
const asOf = '2026-11-15T15:00:00Z';
const fetchedAt = '2026-11-15T14:59:00Z';
const teams = [
  { id: 'a', name: 'Alpha State', division: 'fbs', conference: 'FBS East' },
  { id: 'b', name: 'Beta State', division: 'fbs', conference: 'FBS West' },
  { id: 'c', name: 'Cedar College', division: 'fcs', conference: 'FCS East' },
  { id: 'd', name: 'Dogwood College', division: 'fcs', conference: 'FCS West' },
];
const game = (id, home, away, fields = {}) => ({
  id, home, away, week: 11, seasonType: 'regular', startDate: '2026-11-14T21:00:00Z',
  neutral: false, status: 'final', homePoints: 28, awayPoints: 14, ...fields,
});
const snapshot = {
  ...rankSeason({ year: 2026, teams, games: [game('prior', 'a', 'b', { completed: true })],
    source: { provider: 'cfbd', fetchedAt } }),
  asOf, fcsRankings: teams.filter(team => team.division === 'fcs'),
};
const pick = { capturedAt: '2026-11-12T14:00:00Z', homeWinProbability: .72, favored: 'home' };
const fbs = {
  schemaVersion: 1, season: 2026, asOf, source: { provider: 'cfbd', scheduleAsOf: fetchedAt }, teams,
  games: [game('fbs-final', 'a', 'c', { pick }), game('fbs-next', 'b', 'a', {
    week: 12, startDate: '2026-11-21T21:00:00Z', status: 'scheduled', homePoints: null, awayPoints: null,
  })],
};
const fcs = {
  schemaVersion: 1, season: 2026, asOf, teams: teams.filter(team => team.division === 'fcs'),
  source: {
    ...fbs.source, matchupScope: 'fcs-fcs', calibrated: true, probabilityScale: 7,
    rankingAsOf: snapshot.asOf, snapshotHash: snapshot.snapshotHash,
    validation: { firstSeason: 2023, lastSeason: 2025, games: 1000, picked: 995, correct: 700,
      accuracy: 700 / 995, brier: .18, nearSeventy: { games: 110, meanForecast: .701, actualWinRate: .69 } },
  },
  games: [
    game('fcs-saved', 'c', 'd', { pick }),
    game('fcs-late', 'd', 'c', { pick: { ...pick, capturedAt: '2026-11-14T21:00:00Z' } }),
    game('fcs-replay', 'c', 'd', { replay: { asOf: pick.capturedAt, homeWinProbability: .8, favored: 'home' } }),
  ],
};

async function browser({ hash = '#compare/weekly', missingFcs, fcsData = fcs, fcsGate } = {}) {
  const nodes = new Map(), documentEvents = new Map(), windowEvents = new Map(), calls = [], errors = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', querySelector: node, addEventListener() {} });
    return nodes.get(id);
  };
  const document = { title: '', querySelector: id => id === 'meta[name="publication-data-root"]' ? { content: '/data' } : node(id),
    addEventListener: (name, callback) => documentEvents.set(name, callback) };
  const context = {
    document, location: { hash }, URL, HTMLImageElement: class {},
    window: { scrollTo() {}, addEventListener: (name, callback) => windowEvents.set(name, callback) },
    console: { error: value => errors.push(value), warn: value => errors.push(value) },
    fetch: async path => {
      calls.push(path);
      if (path === '/data/rankings.json') return { ok: true, json: async () => snapshot };
      if (path === '/data/weekly-picks.json') return { ok: true, json: async () => fbs };
      assert.equal(path, '/data/weekly-fcs-picks.json');
      if (fcsGate) await fcsGate;
      if (missingFcs === '404') return { ok: false, status: 404 };
      if (missingFcs === 'spa') return new Response('<title>The Games Decide Top 25</title><meta name="publication-data-root" content="/data"><script type="module" src="/app.js?v=brand"></script>', {
        headers: { 'Content-Type': 'text/html' },
      });
      return { ok: true, json: async () => fcsData };
    },
  };
  installAppVmContext(context);
  vm.runInNewContext(source + '\nglobalThis.testWeeklyPicks={weeklyPickTabs,predictabilityContent};', context, {
    filename: fileURLToPath(appPath), importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  });
  const settle = async (division, scoring = false) => {
    const { weeklyPickTabs } = context.testWeeklyPicks;
    const tab = weeklyPickTabs[division];
    await new Promise(setImmediate);
    await tab.request;
    for (let retries = 0; scoring && !tab.scoring && !tab.scoringError && retries < 20; retries++) {
      await new Promise(setImmediate);
    }
  };
  const go = path => {
    const oldURL = `https://example.test/${context.location.hash}`;
    context.location.hash = path;
    windowEvents.get('hashchange')({ oldURL });
  };
  return { go, settle, calls, errors, document, node,
    html: () => node('#main').innerHTML,
    selectWeek: value => documentEvents.get('change')({ target: { id: 'weekly-week', value } }),
  };
}

test('FBS and FCS weekly routes load distinct schedules and preserve the selected week', async () => {
  const page = await browser();
  await page.settle('fbs', true);
  assert.deepEqual(page.calls, ['/data/rankings.json', '/data/weekly-picks.json']);
  assert.match(page.html(), /href="#compare\/weekly" aria-current="page">FBS/);
  assert.match(page.html(), /2026 FBS schedule and picks/);
  assert.match(page.html(), /Beta State/);
  page.selectWeek('regular:11');
  assert.match(page.node('#weekly-results').innerHTML, /FBS–FCS/);
  page.go('#compare/weekly/fcs');
  await page.settle('fcs', true);
  assert.match(page.document.title, /FCS Weekly Picks/);
  assert.match(page.html(), /href="#compare\/weekly\/fcs" aria-current="page">FCS/);
  assert.match(page.html(), /2026 FCS schedule and picks/);
  assert.match(page.html(), /FCS forecast validation/);
  assert.match(page.html(), /1,000 games in 2023–2025/);
  assert.match(page.html(), /Cedar College/);
  assert.match(page.html(), /Dogwood College/);
  assert.match(page.html(), /1 correct · 0 missed/);
  assert.match(page.html(), /No saved pregame pick/);
  assert.doesNotMatch(page.html(), /Alpha State|Beta State|weekly-team-stats/);
  assert.match(page.node('#predictability-content').innerHTML, /1 of 1 right/);
  page.go('#compare/weekly');
  assert.match(page.html(), /value="regular:11" selected/);
  assert.match(page.html(), /Alpha State/);
  assert.deepEqual(page.calls, ['/data/rankings.json', '/data/weekly-picks.json', '/data/weekly-fcs-picks.json']);
  assert.deepEqual(page.errors, []);
});

test('the first unpublished FCS schedule gives a useful message for 404 and the static fallback', async () => {
  for (const missingFcs of ['404', 'spa']) {
    const page = await browser({ hash: '#compare/weekly/fcs', missingFcs });
    await page.settle('fcs');
    assert.match(page.html(), /FCS forecasts passed historical testing/);
    assert.match(page.html(), /first saved schedule and picks/);
    assert.doesNotMatch(page.html(), /id="weekly-week"|Alpha State/);
    assert.deepEqual(page.calls, ['/data/rankings.json', '/data/weekly-fcs-picks.json']);
    assert.deepEqual(page.errors, []);
  }
});

test('an unaligned FCS artifact is rejected without redirecting visitors to FBS', async () => {
  for (const change of [data => { data.source.scheduleAsOf = '2026-11-14T14:59:00Z'; },
    data => { data.source.snapshotHash = 'stale'; }, data => { data.source.calibrated = false; },
    data => { data.teams[0].division = 'fbs'; }]) {
    const fcsData = structuredClone(fcs);
    change(fcsData);
    const page = await browser({ hash: '#compare/weekly/fcs', fcsData });
    await page.settle('fcs');
    assert.match(page.html(), /saved FCS weekly picks could not load/);
    assert.doesNotMatch(page.html(), /id="weekly-week"|Cedar College/);
    assert.equal(page.errors.length, 1);
  }
});

test('a delayed FCS schedule cannot redraw or rescore the active FBS tab', async () => {
  let release;
  const fcsGate = new Promise(resolve => { release = resolve; });
  const page = await browser({ hash: '#compare/weekly/fcs', fcsGate });
  await new Promise(setImmediate);
  assert.match(page.html(), /Loading FCS weekly picks/);
  page.go('#compare/weekly');
  await page.settle('fbs', true);
  const visible = page.html();
  const score = page.node('#predictability-content').innerHTML;
  release();
  await page.settle('fcs', true);
  assert.equal(page.html(), visible);
  assert.equal(page.node('#predictability-content').innerHTML, score);
  assert.deepEqual(page.errors, []);
});
