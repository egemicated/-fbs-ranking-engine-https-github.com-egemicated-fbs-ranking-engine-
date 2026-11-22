import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { rankSeason } from '../src/engine.js';
import { appVmSource, installAppVmContext } from '../test-support/app-vm.mjs';

const source = appVmSource(await readFile(new URL('../frontend/app.js', import.meta.url), 'utf8'));
const editions = JSON.parse(await readFile(new URL('../frontend/ranking-editions.json', import.meta.url), 'utf8'));

function fixture() {
  const teams = [
    { id: '101', name: 'Alpha State', division: 'fbs', conference: 'FBS East' },
    { id: '102', name: 'Beta State', division: 'fbs', conference: 'FBS West' },
    { id: '201', name: 'Cedar College', division: 'fcs', conference: 'FCS East' },
    { id: '202', name: 'Dogwood College', division: 'fcs', conference: 'FCS West' },
  ];
  const game = (id, home, away) => ({ id, home, away, homePoints: 28, awayPoints: 14,
    completed: true, neutral: true, week: 1, seasonType: 'regular', startDate: '2026-09-05T12:00:00Z' });
  const snapshot = { ...rankSeason({ year: 2026, teams,
    games: [game('one', '101', '102'), game('two', '102', '201'), game('three', '201', '202')],
    source: { provider: 'cfbd' } }), asOf: '2026-11-06T03:39:55.757Z', performanceEndpoint: '/performance' };
  const sorRow = (row, index) => ({ ...row, displayRank: index + 1, displayConferenceRank: 1, sor: 3 - index,
    sorTailProbability: .01, sorExpectedWins: 1, sorWins: row.wins, sorGames: row.games, sorExcludedGames: 0,
    sosRank: index + 1, strength: 10 * index, strengthRank: 2 - index });
  snapshot.rankings = ['101', '102'].map((id, index) => sorRow(snapshot.rankings.find(row => row.id === id), index));
  snapshot.fcsRankings = ['201', '202'].map((id, index) => sorRow(snapshot.ratings.find(row => row.id === id), index));
  snapshot.fcsTeams = snapshot.fcsRankings.length;
  const performanceRow = (id, rank, score) => ({ id, rank, score, measuredGames: 1, expectedGames: 1,
    offensiveSuccessRate: .55, defensiveSuccessRateAllowed: .35, provisional: true, explanation: {} });
  const performance = { season: 2026, asOf: snapshot.asOf, baseSnapshotHash: snapshot.snapshotHash, status: 'experimental',
    method: { id: 'test-performance', name: 'Scrimmage consistency' },
    coverage: { measuredFbsTeams: 2, sourceFbsTeams: 2, measuredFbsGames: 1, eligibleFbsGames: 1,
      measuredFcsTeams: 2, sourceFcsTeams: 2, measuredFcsGames: 1, eligibleFcsGames: 1 },
    rankings: [performanceRow('102', 1, 4.75), performanceRow('101', 2, -4.75)],
    fcsRankings: [performanceRow('201', 1, 8.25), performanceRow('202', 2, -8.25)],
  };
  return { snapshot, performance };
}

async function browser({ snapshot, performance, archive = editions, initialRoute = '#rankings', performanceGate, reducedMotion }) {
  const nodes = new Map(), calls = [], errors = [], inputs = new Map();
  const animations = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', querySelector: node, addEventListener() {} });
    return nodes.get(id);
  };
  const context = {
    document: { querySelector: node, addEventListener: (name, callback) => inputs.set(name, callback), title: '' },
    location: initialRoute.startsWith('#') ? { hash: initialRoute } : { href: initialRoute },
    window: { scrollTo() {} },
    HTMLImageElement: class {}, URL,
    console: { error: error => errors.push(error) },
    fetch: async path => {
      calls.push(path);
      if (path === '/rankings') return { ok: true, json: async () => snapshot };
      if (path === '/ranking-editions.json') return { ok: true, json: async () => archive };
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
  installAppVmContext(context);
  vm.runInNewContext(source, context, { filename: 'frontend/app.js' });
  const html = () => node('#main').innerHTML;
  const settle = async () => {
    await new Promise(setImmediate);
    assert.deepEqual(errors, []);
    return html();
  };
  await settle();
  return { calls, html, settle, context, animations, node,
    async go(href) {
      context.visit(href);
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

test('Compare Rankings lives in the hub while More still lists the other pages', async () => {
  const page = await browser(fixture());
  const header = page.node('#header').innerHTML;
  assert.doesNotMatch(header, /href="\/polls\/ap\//);
  assert.match(header, /<summary>More/);
  assert.match(header, /href="\/scoreboard"/);
  assert.match(header, /href="\/ranking-history\/"/);
  assert.match(page.html(), /href="\/polls\/ap\/" data-ranking-section="polls">Compare Rankings/);
  assert.doesNotMatch(page.html(), /data-ranking-section="conference-strength"/);
  assert.deepEqual(page.calls, ['/rankings']);
  const comparison = await page.go('#polls/ap/10');
  assert.match(comparison, /After Week 10/);
  assert.match(comparison, /href="\/forge-rankings\/\?week=10">Forge’s full ballot for this week/);
  assert.doesNotMatch(comparison, />Official SOR <svg/);
});

test('Home offers a single all-team link and methodology describes both subdivisions on direct load', async () => {
  const data = fixture();
  data.snapshot.fcsRankingMethod = { id: 'fcs-sor-reference-v1' };
  const page = await browser({ ...data, initialRoute: '#home' });
  assert.equal([...page.html().matchAll(/href="\/rankings\?all=1"/g)].length, 1);
  const methodology = await page.go('#methodology');
  assert.match(methodology, /Three views\./);
  assert.match(methodology, /FCS Strength of Record uses the mean Colley rating of the season’s FCS teams/);
  assert.match(methodology, /relative to the measured average for each subdivision/);
  assert.deepEqual(page.calls, ['/rankings']);
});

test('Rankings Hub routes choose the tier and model independently', async () => {
  const page = await browser(fixture());
  for (const route of ['#rankings', '#rankings/sor', '#rankings/fbs/sor', '#rankings/all']) {
    const html = await page.go(route);
    assert.equal(activeHubTab(html), '/rankings');
    assert.match(html, /id="rankings-hub-content"/);
    assert.match(rankingTable(html), /SOR score/);
    assert.equal(activeModel(html), 'achievement');
    assertTeams(html, 'Alpha State', 'Beta State', /Cedar College|Dogwood College/);
  }
  for (const route of ['#rankings/strength', '#rankings/predictive', '#rankings/fbs/predictive']) {
    const html = await page.go(route);
    assert.equal(activeHubTab(html), '/rankings');
    assert.match(rankingTable(html), /Strength · pts/);
    assert.equal(activeModel(html), 'strength');
    assertTeams(html, 'Beta State', 'Alpha State', /Cedar College|Dogwood College/);
  }
  const fcs = await page.go('#rankings/fcs/sor');
  assert.equal(activeHubTab(fcs), '/rankings/fcs/');
  assert.match(rankingTable(fcs), /SOR score/);
  assert.equal(activeModel(fcs), 'achievement');
  assertTeams(fcs, 'Cedar College', 'Dogwood College', /Alpha State|Beta State/);
  const predictive = await page.go('#rankings/fcs/predictive');
  assert.equal(activeHubTab(predictive), '/rankings/fcs/');
  assert.match(rankingTable(predictive), /Strength · pts/);
  assert.equal(activeModel(predictive), 'strength');
  assertTeams(predictive, 'Dogwood College', 'Cedar College', /Alpha State|Beta State/);
  assert.deepEqual(page.calls, ['/rankings']);
});

test('clicking the FCS model and show-all controls keeps the selected tier and model in the URL', async () => {
  const page = await browser({ ...fixture(), initialRoute: '#rankings/fcs/sor' });
  assert.match(await page.click('model', 'strength'), /Strength · pts/);
  assert.equal(page.context.location.href, 'https://example.test/rankings/fcs/?model=strength');
  const all = await page.click('toggle-all');
  assert.equal(page.context.location.href, 'https://example.test/rankings/fcs/?model=strength&all=1');
  assert.match(all, /All FCS teams/);
  assertTeams(all, 'Dogwood College', 'Cedar College', /Alpha State|Beta State/);
  page.context.history.back();
  assert.match(await page.settle(), /Strength · pts/);
  assert.equal(page.context.location.search, '?model=strength');
  page.context.history.forward();
  assert.match(await page.settle(), /All FCS teams/);
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
  const filtered = page.node('#ranking-results').innerHTML;
  assert.match(rankingTable(filtered), /Cedar College/);
  assert.doesNotMatch(rankingTable(filtered), /Dogwood College/);
  const fbs = await page.go('#rankings');
  assertTeams(fbs, 'Alpha State', 'Beta State', /Cedar College|Dogwood College/);
});

test('performance is requested on demand and uses the selected tier rows', async () => {
  const page = await browser(fixture());
  assert.deepEqual(page.calls, ['/rankings']);
  const fcs = await page.go('#rankings/fcs/performance');
  assert.equal(activeHubTab(fcs), '/rankings/fcs/');
  assert.match(rankingTable(fcs), /Performance · pp/);
  assert.equal(activeModel(fcs), 'performance');
  assert.match(rankingTable(fcs), /\+8\.25 pp/);
  assertTeams(fcs, 'Cedar College', 'Dogwood College', /Alpha State|Beta State/);
  const fbs = await page.go('#rankings/performance');
  assert.equal(activeHubTab(fbs), '/rankings');
  assert.match(rankingTable(fbs), /\+4\.75 pp/);
  assertTeams(fbs, 'Beta State', 'Alpha State', /Cedar College|Dogwood College/);
  assert.deepEqual(page.calls, ['/rankings', '/performance']);
});

test('an unavailable FCS performance artifact keeps the Rankings Hub usable', async () => {
  const page = await browser({ ...fixture(), performance: null, initialRoute: '#rankings/fcs/performance' });
  assert.equal(activeHubTab(page.html()), '/rankings/fcs/');
  assert.match(page.html(), /Performance is temporarily unavailable/);
  assert.doesNotMatch(rankingTable(page.html()), /Alpha State|Beta State/);
  assertTeams(await page.go('#rankings/fcs/sor'), 'Cedar College', 'Dogwood College', /Alpha State|Beta State/);
});

test('invalid FCS rows do not replace FCS results with FBS ranks', async () => {
  const data = fixture();
  data.performance.fcsRankings[0].id = '101';
  const page = await browser({ ...data, initialRoute: '#rankings/fcs/performance' });
  assert.equal(activeHubTab(page.html()), '/rankings/fcs/');
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
  assert.equal(activeHubTab(compare), '/polls/ap/');
  assert.match(compare, /id="rankings-hub-content"/);
  assert.match(compare, /After Week 9/);
  assert.match(rankingTable(compare), /<th scope="col">Coaches<\/th>/);
  page.select('edition-week', '8');
  assert.equal(page.context.location.href, 'https://example.test/polls/coaches/?week=8');
  const forge = await page.go('#forge-top-25/8');
  assert.equal(activeHubTab(forge), '/forge-rankings/');
  assert.match(forge, /id="rankings-hub-content"/);
  assert.match(forge, /<a\b[^>]*href="\/polls\/ap\/"[^>]*>Compare Rankings<\/a>/);
  assert.match(forge, /<select\b[^>]*id="edition-week"/);
  assert.doesNotMatch(forge, /<a\b[^>]*class="text-link"[^>]*>Compare rankings/);
  assert.match(rankingTable(forge), /Forge’s Top 25 for After Week 8/);
  assert.deepEqual(page.calls, ['/rankings', '/ranking-editions.json']);
});

test('same-week Coaches and AP polls use their own archived SOR cutoff', async () => {
  const page = await browser({ ...fixture(), archive: { ...editions, forgeCheckpoints: [] }, initialRoute: '#polls/coaches/11' });
  const coaches = page.html();
  assert.match(coaches, /Games through Nov 14, 2026/);
  assert.match(coaches, /saved SOR checkpoint/i);
  assert.match(rankingTable(coaches), /<th scope="col">SOR checkpoint<\/th>/);
  assert.match(coaches, /Forge’s ballot covers games through Nov 15, 2026\. The Coaches Poll covers games through Nov 14, 2026\./);
  assert.match(coaches, /href="\/forge-rankings\/\?week=11">View Forge’s ballot for this week/);
  assert.match(rankingTable(coaches), /<tr><th scope="row">1<\/th><td>.*?Utah.*?<\/td><td>—<\/td><td>.*?Georgia/);
  assert.match(rankingTable(coaches), /Ole Miss[\s\S]*6–3/);
  const ap = await page.go('#polls/ap/11');
  assert.match(ap, /Games through Nov 15, 2026/);
  assert.match(rankingTable(ap), /<th scope="col">SOR<\/th>/);
  assert.doesNotMatch(ap, /saved SOR checkpoint/i);
  assert.doesNotMatch(ap, /The table only compares editions with matching cutoffs/);
  assert.match(ap, /Forge ballot reconstructed Nov 16, 2026/);
});

test('Coaches uses the exact Forge cutoff ballot and the weekly ballot remains canonical', async () => {
  const cutoff = { week: 11, gamesThrough: '2026-11-14', released: '2026-11-19',
    rows: [{ team: 'Alpha State', record: '9–1', game: 'W 21–7' }] };
  const archive = { ...editions, forgeCheckpoints: [
    { ...cutoff, week: 10, rows: [{ team: 'Incorrect week', record: '8–1' }] },
    { ...cutoff, gamesThrough: '2026-11-13', rows: [{ team: 'Incorrect date', record: '8–1' }] },
    cutoff,
  ] };
  const page = await browser({ ...fixture(), archive, initialRoute: '/polls/coaches/?week=11' });
  const coaches = page.html();
  assert.match(coaches, /Games through Nov 14, 2026/);
  assert.match(coaches, /Forge’s cutoff ballot was reconstructed using only games through the Coaches Poll cutoff/);
  assert.match(rankingTable(coaches), /<th scope="row">1<\/th><td>.*?Utah.*?<\/td><td>.*?Alpha State.*?9–1.*?<\/td><td>.*?Georgia/);
  assert.doesNotMatch(rankingTable(coaches), /Incorrect week|Incorrect date/);
  const link = coaches.match(/href="([^"]+)">View Forge’s cutoff ballot/)?.[1];
  assert.equal(link, '/forge-rankings/?week=11&through=2026-11-14');
  const checkpoint = await page.go(link);
  assert.match(checkpoint, /Week 11 cutoff ballot/);
  assert.match(checkpoint, /Games through Nov 14, 2026\. Retrospective ballot reconstructed Nov 19, 2026/);
  assert.match(checkpoint, /Rank movement is measured from the previous week’s full ballot/);
  assert.match(checkpoint, /href="\/forge-rankings\/\?week=11">View the full weekly ballot/);
  assert.match(rankingTable(checkpoint), /Alpha State.*?W 21–7.*?9–1/);

  page.context.history.back();
  assert.match(await page.settle(), /View Forge’s cutoff ballot/);
  const full = await page.go('/forge-rankings/?week=11');
  assert.match(full, /After Week 11.*?Games through Nov 15, 2026/s);
  assert.doesNotMatch(rankingTable(full), /Alpha State/);
  assert.match(full, /View ballot through Nov 14, 2026/);
  const missing = await page.go('/forge-rankings/?week=11&through=2026-11-12');
  assert.match(missing, /No Forge ballot is available for this game cutoff/);
  assert.equal(rankingTable(missing), '');

  for (const poll of ['ap', 'cfp']) {
    const comparison = await page.go(`/polls/${poll}/?week=11`);
    assert.match(comparison, /Games through Nov 15, 2026/);
    assert.match(comparison, /href="\/forge-rankings\/\?week=11">Forge’s full ballot for this week/);
    assert.doesNotMatch(rankingTable(comparison), /Alpha State/);
  }
});

test('published Week 11 Coaches comparison uses the stored November 14 ballot', async () => {
  const page = await browser({ ...fixture(), initialRoute: '/polls/coaches/?week=11' });
  const coaches = page.html();
  assert.match(coaches, /22 of 25 shared by Forge and Coaches/);
  const checkpoint = await page.go('/forge-rankings/?week=11&through=2026-11-14');
  assert.match(rankingTable(checkpoint), /<td class="num">19<\/td><td>Ole Miss.*?<\/td><td class="num">6–3<\/td>/);
  assert.match(rankingTable(checkpoint), /<td class="num">25<\/td><td>Auburn/);
  assert.doesNotMatch(rankingTable(checkpoint), />Oklahoma<small>/);
  const full = await page.go('/forge-rankings/?week=11');
  assert.match(full, /Games through Nov 15, 2026/);
  assert.match(rankingTable(full), />Oklahoma<small>/);
});

test('Coaches and full Forge ballots keep separate links when their cutoff dates are identical', async () => {
  const through = editions.forge.find(edition => edition.week === 11).gamesThrough;
  const checkpointPath = `/forge-rankings/?week=11&through=${through}`;
  const coachesEditions = editions.polls.coaches.map(edition => edition.week === 11 ? { ...edition, gamesThrough: through } : edition);
  const archive = { ...editions, polls: { ...editions.polls, coaches: coachesEditions }, forgeCheckpoints: [
    { week: 11, gamesThrough: through, released: '2026-11-19', rows: [{ team: 'Alpha State', record: '9–1' }] },
  ] };
  const page = await browser({ ...fixture(), archive, initialRoute: '/polls/coaches/?week=11' });
  assert.match(rankingTable(page.html()), /Alpha State/);
  assert.ok(page.html().includes(`href="${checkpointPath}">View Forge’s cutoff ballot`));

  const checkpoint = await page.go(checkpointPath);
  assert.match(checkpoint, /Week 11 cutoff ballot/);
  assert.match(rankingTable(checkpoint), /Alpha State/);
  assert.match(checkpoint, /href="\/forge-rankings\/\?week=11">View the full weekly ballot/);
  const full = await page.go('/forge-rankings/?week=11');
  assert.match(rankingTable(full), /After Week 11/);
  assert.doesNotMatch(rankingTable(full), /Alpha State/);
  assert.ok(full.includes(`href="${checkpointPath}">View cutoff ballot through`));

  for (const poll of ['ap', 'cfp']) {
    const comparison = await page.go(`/polls/${poll}/?week=11`);
    assert.doesNotMatch(rankingTable(comparison), /Alpha State/);
    assert.match(comparison, /href="\/forge-rankings\/\?week=11">Forge’s full ballot for this week/);
  }
});

test('a published Coaches cutoff is available while the same week’s full ballot is pending', async () => {
  const archive = { ...editions, forge: editions.forge.filter(edition => edition.week < 12), forgeCheckpoints: [...editions.forgeCheckpoints, {
    week: 12, gamesThrough: '2026-11-21', released: '2026-11-22', rows: [{ team: 'Alpha State', record: '10–1' }],
  }] };
  const page = await browser({ ...fixture(), archive, initialRoute: '/forge-rankings/?week=12&through=2026-11-21' });
  assert.match(page.html(), /<option value="12" selected>After Week 12<\/option>/);
  assert.match(rankingTable(page.html()), /Week 12 cutoff ballot/);
  const pending = await page.go('/forge-rankings/?week=12');
  assert.match(pending, /No full-week Forge ballot is available for this week yet/);
  assert.match(pending, /href="\/forge-rankings\/\?week=12&through=2026-11-21"/);
  assert.equal(rankingTable(pending), '');
  assert.match(rankingTable(await page.go('/forge-rankings/')), /After Week 11/);
});

test('a regular Forge ballot shows its publication date and keeps reconstructed editions labeled', async () => {
  const page = await browser({ ...fixture(), archive: editions, initialRoute: '/forge-rankings/?week=12' });
  assert.match(page.html(), /Games through Nov 21, 2026\. Ballot published Nov 22, 2026\./);
  const prior = await page.go('/forge-rankings/?week=11');
  assert.match(prior, /Retrospective ballot reconstructed Nov 16, 2026\./);
});

test('the shared stylesheet disables animation and transitions for reduced motion', async () => {
  const css = await readFile(new URL('../frontend/base.css', import.meta.url), 'utf8');
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
