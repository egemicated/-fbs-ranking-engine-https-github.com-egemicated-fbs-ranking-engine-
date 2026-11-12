import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { rankSeason } from '../src/engine.js';

function fixture(advertise = true) {
  const teams = [{ id: 'a', name: 'Alpha', division: 'fbs', conference: 'East' },
    { id: 'b', name: 'Beta', division: 'fbs', conference: 'West' },
    { id: 'c', name: 'Gamma', division: 'fcs', conference: 'Lower' }];
  const game = (id, home, away) => ({ id, home, away, homePoints: 21, awayPoints: 7,
    completed: true, neutral: true, week: 1, seasonType: 'regular', startDate: '2026-09-05T12:00:00Z' });
  const snapshot = { ...rankSeason({ year: 2026, teams, games: [game('one', 'b', 'a'), game('two', 'a', 'c')],
    source: { provider: 'cfbd' } }), asOf: '2026-11-06T03:39:55.757Z' };
  for (const row of snapshot.rankings) Object.assign(row, { displayRank: row.id === 'a' ? 1 : 2,
    displayConferenceRank: 1, sor: row.id === 'a' ? 2.3 : 1.2, sorTailProbability: .01,
    sorExpectedWins: 1., strength: row.id === 'a' ? 20 : -5 });
  snapshot.rankings.sort((a, b) => a.displayRank - b.displayRank);
  if (advertise) snapshot.performanceEndpoint = '/performance';
  const performance = { season: 2026, asOf: snapshot.asOf, baseSnapshotHash: snapshot.snapshotHash,
    status: 'experimental', method: { id: 'test-performance', name: 'Scrimmage consistency' },
    coverage: { measuredFbsTeams: 2, sourceFbsTeams: 2, measuredFbsGames: 2, eligibleFbsGames: 2 },
    limitations: ['Historical FBS–FCS forecasting check remains under review.', 'Provider-covered scrimmage plays.'],
    rankings: [{ id: 'b', rank: 1, score: 3.25, measuredGames: 1, expectedGames: 1,
      offensiveSuccessRate: .55, defensiveSuccessRateAllowed: .35, provisional: true, explanation: {} },
    { id: 'a', rank: 2, score: -3.25, measuredGames: 2, expectedGames: 2,
      offensiveSuccessRate: .45, defensiveSuccessRateAllowed: .5, provisional: true, explanation: {} }] };
  return { snapshot, performance };
}

async function browser({ snapshot, performance, performanceStatus = 200, rejectPerformance = false,
  initialRoute = '#rankings', performanceGate }) {
  const nodes = new Map(), calls = [], errors = [], listeners = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', querySelector: node, addEventListener() {} });
    return nodes.get(id);
  };
  const context = { document: { querySelector: node, addEventListener: (name, callback) => {
    if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback);
  }, title: '' }, location: { hash: initialRoute }, window: { addEventListener() {}, scrollTo() {} },
    HTMLImageElement: class {}, console: { error: error => errors.push(error) },
    fetch: async path => {
      calls.push(path);
      if (path === '/rankings') return { ok: true, json: async () => snapshot };
      assert.equal(path, '/performance');
      if (performanceGate) await performanceGate;
      if (rejectPerformance) throw new Error('Optional snapshot offline');
      return { ok: performanceStatus === 200, status: performanceStatus, json: async () => performance };
    } };
  const source = await readFile('frontend/app.js', 'utf8');
  vm.runInNewContext(source + '\nglobalThis.ui={state,render,renderRankings,renderTeam,renderMethodology,rankingsContent,ordered,compareResult,acceptPerformance,hasPerformance};', context);
  await new Promise(setImmediate); await new Promise(setImmediate);
  assert.deepEqual(errors, []);
  async function click(action, value) {
    for (const listener of listeners.get('click') || []) listener({ target: {
      closest(selector) { return selector === '[data-action]' ? { dataset: { action, value } } : null; }
    } });
    await new Promise(setImmediate);
    return node('#main').innerHTML;
  }
  return { ...context, calls, node, html: () => node('#main').innerHTML, click,
    go(hash) { context.location.hash = hash; context.ui.render(); return node('#main').innerHTML; },
    clickModel: value => click('model', value),
    search(value) { for (const listener of listeners.get('input') || []) listener({ target: { id: 'team-search', value } });
      return node('#ranking-results').innerHTML; },
    conference(value) { for (const listener of listeners.get('change') || []) listener({ target: { id: 'conference-filter', value } });
      return node('#main').innerHTML; }
  };
}

test('matching Performance snapshot provides a third model with independent ordering, units and coverage', async () => {
  const data = fixture(), before = JSON.stringify(data), page = await browser(data);
  assert.deepEqual(page.calls, ['/rankings']);
  assert.match(page.html(), /Performance · Experimental/);
  assert.match(page.html(), /SOR score/);
  const html = await page.clickModel('performance');
  assert.deepEqual(page.calls, ['/rankings', '/performance']);
  assert.match(html, /Experimental scrimmage consistency/);
  assert.match(html, /Performance · pp/); assert.match(html, /Offense success/); assert.match(html, /Defense allowed/);
  assert.match(html, /table-rank top">1<\/span>.*?href="#team\/b"/s);
  assert.match(html, /\+3\.25 pp/); assert.match(html, /55\.00%/); assert.match(html, /1 \/ 1 · provisional/);
  assert.match(html, /Historical FBS–FCS forecasting checks remain under review/);
  assert.deepEqual(Array.from(page.ui.ordered('performance'), t => t.id), ['b', 'a']);
  assert.deepEqual(Array.from(page.ui.ordered('achievement'), t => t.id), ['a', 'b']);
  assert.deepEqual(Array.from(page.ui.ordered('strength'), t => t.id), ['a', 'b']);
  assert.equal(JSON.stringify(data), before);
});

test('Performance search and conference filters retain its rank while team pages show the measured evidence', async () => {
  const page = await browser(fixture()); await page.clickModel('performance');
  const searched = page.search('Beta');
  assert.match(searched, /href="#team\/b"/); assert.doesNotMatch(searched, /href="#team\/a"/);
  page.search(''); const conference = page.conference('East');
  assert.match(conference, /table-rank top">2<\/span>.*?href="#team\/a"/s);
  assert.doesNotMatch(conference, /href="#team\/b"/);
  const team = page.go('#team/b');
  assert.match(team, /<h2>Performance<\/h2>/); assert.match(team, /\+3\.25 pp/);
  assert.match(team, /Beta succeeded on 55\.00%/); assert.match(team, /opponents succeeded on 35\.00%/);
  assert.match(team, /Fewer than four measured games: provisional/);
  assert.match(team, /<b>#2<\/b> Strength of Record/);
});

test('Performance deep link and methodology distinguish consistency from achievement and matchup probability', async () => {
  const page = await browser({ ...fixture(), initialRoute: '#rankings/performance' });
  assert.match(page.html(), /Performance · pp/);
  assert.deepEqual(page.calls, ['/rankings', '/performance']);
  const method = page.go('#methodology');
  assert.match(method, /Three views\./); assert.match(method, /03 · Experimental Performance/);
  assert.match(method, /50% of needed yards on first down, 70% on second down, and 100%/);
  assert.match(method, /Raw offense and defense rates are diagnostics/);
  assert.match(method, /Human polls, betting lines, recruiting, conference reputation and previous team-season ratings do not enter/);
  page.ui.state.compareA = 'a'; page.ui.state.compareB = 'b'; page.ui.state.venue = 'neutral';
  assert.equal(page.ui.compareResult().edge, 25);
  assert.equal(page.ui.compareResult().probability, 1 / (1 + Math.exp(-25 / page.ui.state.snapshot.config.probabilityScale)));
});

test('stale, wrong-season, partial and duplicated Performance artifacts remain unavailable', async () => {
  for (const change of [p => p.baseSnapshotHash = 'older-game-set', p => p.asOf = '2026-11-05T03:39:55.757Z', p => p.season = 2025,
    p => p.rankings.pop(), p => p.rankings[1].id = 'b', p => p.status = 'approved']) {
    const data = fixture(); change(data.performance); const page = await browser(data);
    assert.match(await page.clickModel('performance'), /Performance is temporarily unavailable/);
    assert.equal(page.ui.hasPerformance(), false);
    assert.match(page.go('#rankings'), /SOR score/);
    assert.doesNotMatch(page.go('#team/a'), /Games measured/);
    assert.doesNotMatch(page.go('#rankings/performance'), /Performance · pp/);
  }
});

test('optional Performance failure preserves the primary rankings, while unadvertised snapshots make no extra request', async () => {
  for (const options of [{ performanceStatus: 404 }, { rejectPerformance: true }]) {
    const page = await browser({ ...fixture(), ...options });
    assert.match(await page.clickModel('performance'), /Performance is temporarily unavailable/);
    page.go('#rankings');
    assert.match(page.html(), /SOR score/); assert.equal(page.ui.hasPerformance(), false);
    assert.doesNotMatch(page.html(), /rankings are taking a moment/);
  }
  const old = await browser(fixture(false));
  old.go('#rankings/performance');
  assert.deepEqual(old.calls, ['/rankings']); assert.match(old.html(), /SOR score/);
});

test('untrusted Performance explanatory text is escaped before display', async () => {
  const data = fixture(); data.performance.limitations = ['<script>unsafe()</script>'];
  const page = await browser(data); const html = await page.clickModel('performance');
  assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>/);
});

test('team evidence exposes additive model terms in the same displayed percentage-point units', async () => {
  const data = fixture(); data.performance.rankings[0].explanation = {
    observedNetContribution: .1, venueContribution: -.01, divisionAdjustmentContribution: -.02,
    opponentContribution: .005, divisionOffset: .08, fbsReferenceAdjustment: -.1225
  };
  const page = await browser(data);
  assert.match(page.go('#team/b'), /Show Performance details/);
  assert.deepEqual(page.calls, ['/rankings']);
  await page.click('load-performance');
  assert.deepEqual(page.calls, ['/rankings', '/performance']);
  const html = page.go('#team/b');
  assert.match(html, /Inspect score contributions/); assert.match(html, /Measured net play success<\/span><strong>\+10\.00 pp/);
  assert.match(html, /FBS-average reference<\/span><strong>-12\.25 pp/);
  assert.match(html, /Performance score<\/span><strong>\+3\.25 pp/);
  assert.match(html, /rounded for display/);
});

test('a delayed Performance response does not replace another page and is reused on return', async () => {
  let release;
  const performanceGate = new Promise(resolve => { release = resolve; });
  const page = await browser({ ...fixture(), performanceGate });
  assert.match(page.go('#home'), /Performance · Experimental/);
  assert.match(page.go('#methodology'), /03 · Experimental Performance/);
  assert.deepEqual(page.calls, ['/rankings']);
  assert.match(await page.clickModel('performance'), /Loading Performance/);
  assert.match(page.go('#rankings/performance/all'), /Loading Performance/);
  const home = page.go('#home');
  release();
  await new Promise(setImmediate);
  assert.equal(page.html(), home);
  assert.match(page.go('#rankings/performance/all'), /Performance · pp/);
  assert.deepEqual(page.calls, ['/rankings', '/performance']);
});
