import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { rankSeason } from '../src/engine.js';

const source = await readFile(new URL('../frontend/app.js', import.meta.url), 'utf8');
const editions = JSON.parse(await readFile(new URL('../frontend/ranking-editions.json', import.meta.url), 'utf8'));

function fixture() {
  const teams = [
    { id: 'a', name: 'Alpha State', division: 'fbs', conference: 'FBS East' },
    { id: 'b', name: 'Beta State', division: 'fbs', conference: 'FBS West' },
    { id: 'c', name: 'Cedar College', division: 'fcs', conference: 'FCS East' },
    { id: 'd', name: 'Dogwood College', division: 'fcs', conference: 'FCS West' },
  ];
  const game = (id, home, away) => ({ id, home, away, homePoints: 28, awayPoints: 14,
    completed: true, neutral: true, week: 1, seasonType: 'regular', startDate: '2026-09-05T12:00:00Z' });
  const snapshot = { ...rankSeason({ year: 2026, teams,
    games: [game('one', 'a', 'b'), game('two', 'b', 'c'), game('three', 'c', 'd')],
    source: { provider: 'cfbd' } }), asOf: '2026-11-06T03:39:55.757Z', performanceEndpoint: '/performance' };
  const sorRow = (row, index) => ({ ...row, displayRank: index + 1, displayConferenceRank: 1, sor: 3 - index,
    sorTailProbability: .01, sorExpectedWins: 1, sorWins: row.wins, sorGames: row.games, sorExcludedGames: 0,
    sosRank: index + 1, strength: 10 * index, strengthRank: 2 - index });
  snapshot.rankings = ['a', 'b'].map((id, index) => sorRow(snapshot.rankings.find(row => row.id === id), index));
  snapshot.fcsRankings = ['c', 'd'].map((id, index) => sorRow(snapshot.ratings.find(row => row.id === id), index));
  snapshot.fcsTeams = snapshot.fcsRankings.length;
  const performanceRow = (id, rank, score) => ({ id, rank, score, measuredGames: 1, expectedGames: 1,
    offensiveSuccessRate: .55, defensiveSuccessRateAllowed: .35, provisional: true, explanation: {} });
  const performance = { season: 2026, asOf: snapshot.asOf, baseSnapshotHash: snapshot.snapshotHash, status: 'experimental',
    method: { id: 'test-performance', name: 'Scrimmage consistency' },
    coverage: { measuredFbsTeams: 2, sourceFbsTeams: 2, measuredFbsGames: 1, eligibleFbsGames: 1,
      measuredFcsTeams: 2, sourceFcsTeams: 2, measuredFcsGames: 1, eligibleFcsGames: 1 },
    rankings: [performanceRow('b', 1, 4.75), performanceRow('a', 2, -4.75)],
    fcsRankings: [performanceRow('c', 1, 8.25), performanceRow('d', 2, -8.25)],
  };
  return { snapshot, performance };
}

async function browser({ snapshot, performance, initialRoute = '#rankings', performanceGate, reducedMotion }) {
  const nodes = new Map(), calls = [], errors = [], inputs = new Map(), events = new Map();
  const animations = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', querySelector: node, addEventListener() {} });
    return nodes.get(id);
  };
  const context = {
    document: { querySelector: node, addEventListener: (name, callback) => inputs.set(name, callback), title: '' },
    location: { hash: initialRoute },
    window: { addEventListener: (name, callback) => events.set(name, callback), scrollTo() {} },
    HTMLImageElement: class {}, URL,
    console: { error: error => errors.push(error) },
    fetch: async path => {
      calls.push(path);
      if (path === '/rankings') return { ok: true, json: async () => snapshot };
      if (path === '/ranking-editions.json') return { ok: true, json: async () => editions };
      assert.equal(path, '/performance');
      if (performanceGate) await performanceGate;
      return { ok: Boolean(performance), json: async () => performance };
    },
  };
  if (typeof reducedMotion === 'boolean') {
    Object.assign(context.window, {
      matchMedia: query => ({ matches: query === '(prefers-reduced-motion: reduce)' && reducedMotion }),
      getComputedStyle: () => ({ opacity: '1' }),
    });
    node('#main').querySelectorAll = () => [];
    Object.assign(node('#rankings-hub-content'), {
      isConnected: true,
      contains: () => false,
      animate(keyframes) {
        animations.push(keyframes.map(frame => frame.opacity).join(' to '));
        return { finished: Promise.resolve(), cancel() {} };
      },
    });
  }
  vm.runInNewContext(source, context, { filename: 'frontend/app.js' });
  const html = () => node('#main').innerHTML;
  const settle = async () => {
    await new Promise(setImmediate);
    assert.deepEqual(errors, []);
    return html();
  };
  await settle();
  return { calls, html, settle, context, animations, node,
    async go(hash) {
      const oldURL = `https://example.test/${context.location.hash}`;
      context.location.hash = hash;
      events.get('hashchange')({ oldURL });
      return settle();
    },
    search(value) {
      inputs.get('input')({ target: { id: 'team-search', value } });
      return node('#ranking-results').innerHTML;
    },
    select(id, value) { inputs.get('change')({ target: { id, value } }); },
    async click(action, value) {
      inputs.get('click')({ target: {
        closest: selector => selector === '[data-action]' ? { dataset: { action, value } } : null,
      } });
      return settle();
    },
  };
}

function rankingTable(html) {
  return html.match(/<table\b[^>]*>.*?<\/table>/s)?.[0] ?? '';
}

function activeHubTab(html) {
  const nav = html.match(/<nav\b[^>]*class="[^"]*\brankings-hub-nav\b[^"]*"[^>]*>.*?<\/nav>/s)?.[0] ?? '';
  const selected = nav.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
  assert.equal(selected.length, 1, 'exactly one hub tab is marked current');
  return selected[0].match(/href="([^"]+)"/)?.[1];
}

function assertTeams(html, first, second, excluded) {
  const table = rankingTable(html);
  assert.ok(table.indexOf(first) >= 0 && table.indexOf(first) < table.indexOf(second), `expected ${first} before ${second}`);
  assert.doesNotMatch(table, excluded);
}

function activeModel(html) {
  const pressed = [...html.matchAll(/<button\b[^>]*data-action="model"[^>]*aria-pressed="true"[^>]*>/g)];
  assert.equal(pressed.length, 1, 'exactly one model button is marked pressed');
  return pressed[0][0].match(/data-value="([^"]+)"/)?.[1];
}

test('Rankings Hub routes choose the tier and model independently', async () => {
  const page = await browser(fixture());
  for (const route of ['#rankings', '#rankings/sor', '#rankings/fbs/sor', '#rankings/all']) {
    const html = await page.go(route);
    assert.equal(activeHubTab(html), '#rankings');
    assert.match(html, /id="rankings-hub-content"/);
    assert.match(rankingTable(html), /SOR score/);
    assert.equal(activeModel(html), 'achievement');
    assertTeams(html, 'Alpha State', 'Beta State', /Cedar College|Dogwood College/);
  }
  for (const route of ['#rankings/strength', '#rankings/predictive', '#rankings/fbs/predictive']) {
    const html = await page.go(route);
    assert.equal(activeHubTab(html), '#rankings');
    assert.match(rankingTable(html), /Strength · pts/);
    assert.equal(activeModel(html), 'strength');
    assertTeams(html, 'Beta State', 'Alpha State', /Cedar College|Dogwood College/);
  }
  const fcs = await page.go('#rankings/fcs/sor');
  assert.equal(activeHubTab(fcs), '#rankings/fcs/sor');
  assert.match(rankingTable(fcs), /SOR score/);
  assert.equal(activeModel(fcs), 'achievement');
  assertTeams(fcs, 'Cedar College', 'Dogwood College', /Alpha State|Beta State/);
  const predictive = await page.go('#rankings/fcs/predictive');
  assert.equal(activeHubTab(predictive), '#rankings/fcs/sor');
  assert.match(rankingTable(predictive), /Strength · pts/);
  assert.equal(activeModel(predictive), 'strength');
  assertTeams(predictive, 'Dogwood College', 'Cedar College', /Alpha State|Beta State/);
  assert.deepEqual(page.calls, ['/rankings']);
});

test('clicking the FCS model and show-all controls keeps the selected tier and model in the URL', async () => {
  const page = await browser({ ...fixture(), initialRoute: '#rankings/fcs/sor' });
  assert.match(await page.click('model', 'strength'), /Strength · pts/);
  assert.equal(page.context.location.hash, '#rankings/fcs/predictive');
  const all = await page.click('toggle-all');
  assert.match(page.context.location.hash, /^#rankings\/fcs\/predictive\/all$/);
  assert.match(all, /All FCS teams/);
  assertTeams(all, 'Dogwood College', 'Cedar College', /Alpha State|Beta State/);
});

test('search and conference controls use the selected tier', async () => {
  const page = await browser({ ...fixture(), initialRoute: '#rankings/fcs/sor' });
  assert.match(page.html(), /<option\b[^>]*>FCS East<\/option>/);
  assert.doesNotMatch(page.html(), /<option\b[^>]*>FBS East<\/option>/);
  const searched = page.search('Dogwood');
  assert.match(rankingTable(searched), /Dogwood College/);
  assert.doesNotMatch(rankingTable(searched), /Cedar College|Beta State/);
  page.search('');
  page.select('conference-filter', 'FCS East');
  assert.match(rankingTable(page.html()), /Cedar College/);
  assert.doesNotMatch(rankingTable(page.html()), /Dogwood College/);
  const fbs = await page.go('#rankings');
  assertTeams(fbs, 'Alpha State', 'Beta State', /Cedar College|Dogwood College/);
});

test('performance is requested on demand and uses the selected tier rows', async () => {
  const page = await browser(fixture());
  assert.deepEqual(page.calls, ['/rankings']);
  const fcs = await page.go('#rankings/fcs/performance');
  assert.equal(activeHubTab(fcs), '#rankings/fcs/sor');
  assert.match(rankingTable(fcs), /Performance · pp/);
  assert.equal(activeModel(fcs), 'performance');
  assert.match(rankingTable(fcs), /\+8\.25 pp/);
  assertTeams(fcs, 'Cedar College', 'Dogwood College', /Alpha State|Beta State/);
  const fbs = await page.go('#rankings/performance');
  assert.equal(activeHubTab(fbs), '#rankings');
  assert.match(rankingTable(fbs), /\+4\.75 pp/);
  assertTeams(fbs, 'Beta State', 'Alpha State', /Cedar College|Dogwood College/);
  assert.deepEqual(page.calls, ['/rankings', '/performance']);
});

test('an unavailable FCS performance artifact keeps the Rankings Hub usable', async () => {
  const page = await browser({ ...fixture(), performance: null, initialRoute: '#rankings/fcs/performance' });
  assert.equal(activeHubTab(page.html()), '#rankings/fcs/sor');
  assert.match(page.html(), /Performance is temporarily unavailable/);
  assert.doesNotMatch(rankingTable(page.html()), /Alpha State|Beta State/);
  assertTeams(await page.go('#rankings/fcs/sor'), 'Cedar College', 'Dogwood College', /Alpha State|Beta State/);
});

test('invalid FCS rows do not replace FCS results with FBS ranks', async () => {
  const data = fixture();
  data.performance.fcsRankings[0].id = 'a';
  const page = await browser({ ...data, initialRoute: '#rankings/fcs/performance' });
  assert.equal(activeHubTab(page.html()), '#rankings/fcs/sor');
  assert.doesNotMatch(rankingTable(page.html()), /Alpha State|Beta State/);
  assertTeams(await page.go('#rankings/performance'), 'Beta State', 'Alpha State', /Cedar College|Dogwood College/);
  assert.deepEqual(page.calls, ['/rankings', '/performance']);
});

test('a delayed Performance response stays on the chosen tier and model', async () => {
  let release;
  const performanceGate = new Promise(resolve => { release = resolve; });
  const page = await browser({ ...fixture(), performanceGate, initialRoute: '#rankings/fcs/performance' });
  assert.match(page.html(), /Loading Performance/);
  const fbs = await page.go('#rankings');
  release();
  await page.settle();
  assert.equal(page.html(), fbs);
  assertTeams(await page.go('#rankings/fcs/performance'), 'Cedar College', 'Dogwood College', /Alpha State|Beta State/);
  assert.deepEqual(page.calls, ['/rankings', '/performance']);
});

test('Compare and Forge remain accessible through the hub and retain dated edition routes', async () => {
  const page = await browser(fixture());
  const compare = await page.go('#polls/coaches/9');
  assert.equal(activeHubTab(compare), '#polls');
  assert.match(compare, /id="rankings-hub-content"/);
  assert.match(compare, /After Week 9/);
  assert.match(rankingTable(compare), /<th scope="col">Coaches<\/th>/);
  page.select('edition-week', '8');
  assert.match(page.context.location.hash, /^#?polls\/coaches\/8$/);
  const forge = await page.go('#forge-top-25/8');
  assert.equal(activeHubTab(forge), '#forge-top-25');
  assert.match(forge, /id="rankings-hub-content"/);
  assert.match(rankingTable(forge), /Forge’s Top 25 for After Week 8/);
  assert.deepEqual(page.calls, ['/rankings', '/ranking-editions.json']);
});

test('the rankings stylesheet disables animation and transitions for reduced motion', async () => {
  const css = await readFile(new URL('../frontend/styles.css', import.meta.url), 'utf8');
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation:\s*none[\s\S]*?transition:\s*none/);
});

test('hub transitions switch content immediately when reduced motion is requested', async () => {
  for (const reducedMotion of [true, false]) {
    const page = await browser({ ...fixture(), reducedMotion });
    await page.go('#rankings/fcs/sor');
    const contents = page.node('#rankings-hub-content').innerHTML;
    assertTeams(contents, 'Cedar College', 'Dogwood College', /Alpha State|Beta State/);
    assert.deepEqual(page.animations, reducedMotion ? [] : ['1 to 0', '0 to 1']);
  }
});
