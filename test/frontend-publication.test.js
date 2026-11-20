import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { rankSeason } from '../src/engine.js';
import { matchupValidation } from '../src/site-validation.js';
import { appVmSource, installAppVmContext } from '../test-support/app-vm.mjs';
import matchupEvidence from '../data/matchup-validation.json' with { type: 'json' };

function fixture(sor = true) {
  const teams = ['101', '102', '201'].map((id, i) => ({ id, name: ['Alpha', 'Beta', 'Gamma'][i],
    division: id === '201' ? 'fcs' : 'fbs', conference: 'Example' }));
  const game = (id, home, away) => ({ id, home, away, homePoints: 21, awayPoints: 7, completed: true,
    neutral: true, week: 1, seasonType: 'regular', startDate: '2026-09-05T12:00:00Z' });
  const snapshot = { ...rankSeason({ year: 2026, teams, games: [game('one', '102', '101'), game('two', '101', '201')],
    source: { provider: 'cfbd', fetchedAt: '2026-11-06T03:00:00Z' } }), asOf: '2026-11-06T03:00:01Z' };
  if (sor) {
    snapshot.rankingMethod = { id: 'division-sor-v2', name: 'Division-aware Strength of Record' };
    for (const row of snapshot.rankings) Object.assign(row, { displayRank: row.id === '101' ? 1 : 2,
      displayConferenceRank: row.id === '101' ? 1 : 2, colleyRank: row.rank, sorRank: row.id === '101' ? 1 : 2,
      sor: row.id === '101' ? 2.3456 : 1.2345, sorTailProbability: row.id === '101' ? .004512 : .0582, sorExpectedWins: .75 });
    snapshot.rankings.sort((a, b) => a.displayRank - b.displayRank);
  }
  return snapshot;
}

async function browser(snapshot, detailResponse, now = Date.parse('2026-11-06T12:00:00Z')) {
  const nodes = new Map(), calls = [], errors = [], listeners = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', addEventListener() {}, querySelector: node, focus() {} });
    return nodes.get(id);
  };
  const context = { document: { querySelector: node, addEventListener: (type, handler) => listeners.set(type, handler), title: '' },
    location: { hash: '#home' }, window: { addEventListener() {}, scrollTo() {} },
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
    HTMLImageElement: class {}, console: { error: e => errors.push(e) },
    fetch: async path => {
      calls.push(path);
      if (path !== '/rankings' && detailResponse) return detailResponse(path);
      return { ok: true, json: async () => snapshot };
    } };
  const source = appVmSource(await readFile('frontend/app.js', 'utf8'));
  installAppVmContext(context);
  vm.runInNewContext(source + '\nglobalThis.ui={state,render,renderHome,renderRankings,renderTeams,renderTeam,renderMethodology,renderCompare,renderPollComparison,rankingsContent,compareResult,compareOptions,selectMatchupTeam,ordered,sosRank,teamCenterContent};', context, { filename: 'frontend/app.js' });
  await new Promise(setImmediate);
  assert.deepEqual(errors, []);
  return { ...context, calls, html: () => node('#main').innerHTML,
    go(href) { context.visit(href); context.ui.render(); return node('#main').innerHTML; },
    teamTab(value) {
      listeners.get('click')({ target: { closest: selector => selector === '[data-action]' ? { dataset: { action: 'team-tab', value } } : null } });
      return node('#main').innerHTML;
    },
  };
}

function separatedFixture(includeFcs = false) {
  const snapshot = { ...fixture(), publicationHash: 'test-version', teamDetailsPath: '/data/teams' };
  const details = new Map();
  const separate = row => {
    const { contributions, explanation, evidence, sorTailProbability, sorExpectedWins, preseasonStrength, ...summary } = row;
    details.set(`/data/teams/${row.id}.json?v=test-version`, { id: row.id, publicationHash: snapshot.publicationHash,
      contributions, explanation, evidence, sorTailProbability, sorExpectedWins, preseasonStrength });
    return summary;
  };
  snapshot.rankings = snapshot.rankings.map(separate);
  if (includeFcs) {
    snapshot.fcsRankings = snapshot.ratings.filter(row => row.division === 'fcs')
      .map(row => separate({ ...row, displayRank: 1, displayConferenceRank: 1, sor: 0.5, sorWins: 0, sorGames: 1 }));
  }
  return { snapshot, details };
}

const detailPath = id => `/data/teams/${id}.json?v=test-version`;
const lookupDetails = details => async path => ({ ok: details.has(path), json: async () => details.get(path) });

async function openResults(page, id) {
  page.go(`#team/${id}`);
  await new Promise(setImmediate);
  return page.teamTab('results');
}

const upcomingPanel = html => html.match(/<section\b[^>]*class="[^"]*\bteam-upcoming\b[^"]*"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? '';

test('home, national table and directory display published SOR ranks and scores rather than legacy Colley', async () => {
  const snapshot = fixture(), before = JSON.stringify(snapshot), page = await browser(snapshot);
  assert.deepEqual(page.calls, ['/rankings']);
  assert.match(page.html(), /rank-chip">1<\/span>.*?<strong>Alpha<\/strong>/s);
  assert.match(page.html(), /Strength of Record rankings/);
  assert.match(page.html(), /SOR score/); assert.match(page.html(), /2\.3456/);
  const ranking = page.go('#rankings');
  assert.match(ranking, /table-rank top">1<\/span>.*?href="\/team\/101\/"/s);
  assert.match(ranking, /average FBS Colley rating/);
  assert.match(ranking, /SOS · Colley/);
  assert.match(page.go('#teams'), /team-card-rank">#1<\/span>.*?<h3>Alpha<\/h3>.*?2\.3456 SOR/s);
  assert.equal(JSON.stringify(snapshot), before);
});

test('a recovered poll with unknown results cutoff never borrows a same-week SOR or Forge comparison', async () => {
  const page = await browser(fixture());
  const base = { week: 0, released: '2026-09-06', gamesThrough: '2026-09-05', rows: [{ team: 'Alpha', rank: 1, record: '1–0' }] };
  const html = page.ui.renderPollComparison({ sor: [base], forge: [base], polls: {
    ap: [{ ...base, gamesThrough: null, url: 'https://apnews.com/hub/ap-top-25-college-football-poll' }],
    coaches: [], cfp: [],
  } }, 'ap', '0');
  assert.match(html, /exact game cutoff has not been verified/);
  assert.match(html, /SOR comparison unavailable/);
  assert.match(html, /AP Top 25 released/);
  assert.doesNotMatch(html, /SOR published|Forge ballot reconstructed|Jan 1, 1970|Invalid Date/);
});

test('team, opponent evidence, conference and model sections distinguish SOR from retained Colley calculations', async () => {
  const page = await browser(fixture()), html = page.go('#team/101');
  assert.match(html, /<b>#1<\/b> Strength of Record/); assert.match(html, /<span>#1 in conference<\/span>/);
  assert.match(html, /<strong>2\.3456<\/strong><span>SOR score/);
  assert.match(html, /WHY WE RANK ALPHA #1/); assert.match(html, /#2 FBS Strength of Record/);
  assert.match(html, /COLLEY BASELINE, EXPLAINED/); assert.match(html, /Colley baseline \(#2\), not the SOR score/);
  assert.match(html, /team with the average FBS Colley rating/); assert.match(html, /Reference-team chance: 0\.45%/);
  page.ui.state.teamTab = 'model'; page.ui.renderTeam('101');
  const calculation = page.html();
  assert.match(calculation, /average FBS Colley rating playing the same opponents/);
  assert.match(calculation, /0\.75 games.*0\.45%.*1 win.*about 5 times out of 1,000 tries/s);
  assert.match(calculation, /SOR = −log10\[P\(at least 1 win\)\] = <b>2\.3456<\/b>/);
  assert.match(calculation, /COLLEY BASELINE, EXPLAINED/);
  assert.match(calculation, /The small starting amount built into the formula/);
  assert.match(calculation, /This comes from the team’s 1–1 record/);
  assert.match(calculation, /sum\(opponent achievement\)/);
  assert.match(calculation, /Conference Strength of Record rank/);
  assert.match(calculation, /model’s point margin on a neutral field/);
  assert.match(calculation, /Preseason strength prior.*starting rating/s);
});

test('team calculations distinguish zero wins, no games and very small schedule chances', async () => {
  const snapshot = fixture();
  const team = snapshot.rankings.find(row => row.id === '101');
  const page = await browser(snapshot);
  Object.assign(team, { sor: 5, sorTailProbability: 0.00001 });
  assert.match(page.go('#team/101/model'), /less than 0\.01%.*less than once out of 1,000 tries/s);
  Object.assign(team, { wins: 0, losses: 2, sor: 0, sorTailProbability: 1 });
  assert.match(page.go('#team/101/model'), /Any team can reach zero wins.*100\.00%.*SOR score is zero/s);
  Object.assign(team, { games: 0, losses: 0, sorExpectedWins: 0, displayRank: null, displayConferenceRank: null });
  assert.match(page.go('#team/101/model'), /With zero completed games.*0\.00 expected wins.*gets a rank after it plays/s);
});

test('team details load once on demand and a slow request cannot replace a different team page', async () => {
  const { snapshot, details } = separatedFixture();
  let releaseAlpha;
  const alphaWait = new Promise(resolve => { releaseAlpha = resolve; });
  const alpha = '/data/teams/101.json?v=test-version';
  const beta = '/data/teams/102.json?v=test-version';
  const page = await browser(snapshot, async path => {
    if (path === alpha) await alphaWait;
    return { ok: details.has(path), json: async () => details.get(path) };
  });
  assert.match(page.go('#rankings'), /2\.3456/);
  assert.deepEqual(page.calls, ['/rankings']);
  assert.match(page.go('#team/101'), /Loading team details/);
  page.ui.renderTeam('101');
  assert.deepEqual(page.calls, ['/rankings', alpha]);
  page.go('#team/102');
  await new Promise(setImmediate);
  assert.match(page.html(), /WHY WE RANK BETA #2/);
  releaseAlpha();
  await new Promise(setImmediate);
  assert.match(page.html(), /WHY WE RANK BETA #2/);
  assert.match(page.go('/team/101/?view=model'), /about 5 times out of 1,000 tries/);
  assert.deepEqual(page.calls, ['/rankings', alpha, beta]);
});

test('team details from another publication stay off the page and offer a retry', async () => {
  const { snapshot, details } = separatedFixture();
  const page = await browser(snapshot, async path => ({ ok: true, json: async () => ({
    ...details.get(path), publicationHash: 'stale-version',
  }) }));
  page.go('#team/101');
  await new Promise(setImmediate);
  assert.match(page.html(), /The team details could not load/);
  assert.match(page.html(), /data-action="retry-team-details"/);
  assert.doesNotMatch(page.html(), /WHY WE RANK ALPHA/);
});

test('team Results shows the dated upcoming schedule without changing completed records', async () => {
  const { snapshot, details } = separatedFixture(true);
  const upcomingGames = [
    { opponentId: '999', opponentName: '<Neutral opponent>', startDate: '2026-11-28T19:00:00Z', venue: 'neutral',
      winProbability: null, probabilitySource: null },
    { opponentId: '201', opponentName: 'Gamma', startDate: '2026-11-15T01:30:00Z', venue: 'away', startTimeTbd: false,
      winProbability: .625, probabilitySource: 'saved', calibrated: false },
    { opponentId: '102', opponentName: 'Beta', startDate: '2026-11-21T18:00:00Z', venue: 'home', startTimeTbd: true,
      winProbability: .44, probabilitySource: 'estimate', calibrated: true },
    { opponentId: 'old', opponentName: 'Kickoff passed', startDate: '2026-11-06T10:00:00Z', venue: 'away' },
  ];
  details.get(detailPath('101')).upcomingGames = upcomingGames;
  const before = JSON.stringify(details.get(detailPath('101')));
  const page = await browser(snapshot, lookupDetails(details));
  page.go('#team/101');
  await new Promise(setImmediate);
  assert.match(page.html(), /<button\b[^>]*data-action="team-tab"[^>]*data-value="results"[^>]*>\s*<span\b[^>]*>Record<\/span>/);
  const results = page.teamTab('results');
  const upcoming = upcomingPanel(results);
  assert.match(upcoming, /upcoming games/i);
  assert.match(upcoming, /href="\/team\/201\/"[^>]*>Gamma</);
  assert.match(upcoming, /href="\/team\/102\/"[^>]*>Beta</);
  assert.match(upcoming, /Gamma[\s\S]*Beta[\s\S]*&lt;Neutral opponent&gt;/);
  assert.match(upcoming, /Nov 14[^<]*6:30\s?PM/i);
  assert.match(upcoming, /Time pending/i);
  assert.match(upcoming, /\bHome\b/i);
  assert.match(upcoming, /\bAway\b/i);
  assert.match(upcoming, /neutral site/i);
  assert.match(upcoming, /62\.5%<\/strong><small>Saved win chance · Experimental/);
  assert.match(upcoming, /44\.0%<\/strong><small>Win chance estimate/);
  assert.match(upcoming, /Odds unavailable/);
  assert.doesNotMatch(upcoming, /Kickoff passed|<Neutral opponent>|href="\/team\/999\/"/);
  assert.match(results, /1–1 overall/);
  assert.match(results, /THE COMPLETED RESULTS/);
  const completed = results.match(/<table class="evidence-table">[\s\S]*?<\/table>/)?.[0] ?? '';
  assert.equal((completed.match(/<tr>/g) ?? []).length, 3);
  assert.doesNotMatch(completed, /2026-11|Neutral opponent/);
  assert.doesNotMatch(page.teamTab('overview'), /upcoming games/i);
  assert.deepEqual(page.calls, ['/rankings', detailPath('101')]);
  assert.equal(JSON.stringify(details.get(detailPath('101'))), before);
});

test('FCS team Results links a ranked FBS opponent from the same team-details response', async () => {
  const { snapshot, details } = separatedFixture(true);
  details.get(detailPath('201')).upcomingGames = [
    { opponentId: '102', opponentName: 'Beta', startDate: '2026-11-21T18:00:00Z', venue: 'home',
      winProbability: .257, probabilitySource: 'estimate', calibrated: false },
  ];
  const page = await browser(snapshot, lookupDetails(details));
  const results = await openResults(page, '201');
  assert.match(results, /<h1>Gamma<\/h1>/);
  const upcoming = upcomingPanel(results);
  assert.match(upcoming, /upcoming games/i);
  assert.match(upcoming, /href="\/team\/102\/"[^>]*>Beta</);
  assert.match(upcoming, /25\.7%/);
  assert.match(results, /0–1 overall/);
  assert.match(results, /THE COMPLETED RESULTS/);
  assert.deepEqual(page.calls, ['/rankings', detailPath('201')]);
});

test('a known empty schedule differs from missing schedule data on older team details', async () => {
  for (const upcomingGames of [[], null, undefined]) {
    const { snapshot, details } = separatedFixture();
    if (upcomingGames !== undefined) details.get(detailPath('101')).upcomingGames = upcomingGames;
    const page = await browser(snapshot, lookupDetails(details));
    const results = await openResults(page, '101');
    assert.match(results, /THE COMPLETED RESULTS/);
    assert.match(results, /1–1 overall/);
    assert.match(results, Array.isArray(upcomingGames) ? /no upcoming games/i : /schedule[^<]*unavailable/i);
    assert.doesNotMatch(results, Array.isArray(upcomingGames) ? /schedule[^<]*unavailable/i : /no upcoming games/i);
    assert.deepEqual(page.calls, ['/rankings', detailPath('101')]);
  }
});

test('SOS keeps the Colley opponent average while predictive ordering and matchup calculations remain separate', async () => {
  const snapshot = fixture(), page = await browser(snapshot);
  const expectedSos = [...snapshot.rankings].sort((a, b) => b.achievementScheduleStrength - a.achievementScheduleStrength);
  for (const [i, row] of expectedSos.entries()) assert.equal(page.ui.sosRank(row), i + 1);
  page.ui.state.model = 'strength'; page.ui.renderRankings();
  assert.match(page.html(), /Predictive strength rankings/); assert.match(page.html(), /Strength · pts/);
  const expectedOrder = [...snapshot.rankings].sort((a, b) => b.strength - a.strength).map(t => t.id);
  assert.deepEqual(Array.from(page.ui.ordered('strength'), t => t.id), expectedOrder);
  const [a, b] = snapshot.rankings; page.ui.state.venue = 'home';
  const expectedMargin = a.strength - b.strength + snapshot.config.homeAdvantage;
  assert.equal(page.ui.compareResult().edge, expectedMargin);
  assert.equal(page.ui.compareResult().probability, 1 / (1 + Math.exp(-expectedMargin / snapshot.config.probabilityScale)));
  page.ui.renderCompare(); assert.match(page.html(), /These probabilities have not been calibrated/);
});

test('methodology explains active SOR and historical snapshots retain their Colley labels', async () => {
  const current = await browser(fixture()); const active = current.go('#methodology');
  assert.match(active, /primary national and conference ranking uses <strong>division-aware Strength of Record/);
  assert.match(active, /Earlier seasons supplied the venue and FBS\/FCS coefficients/); assert.match(active, /independence assumption/);
  assert.match(active, /Colley network remains the opponent-rating baseline/);
  const historical = fixture(false), old = await browser(historical);
  assert.match(old.html(), /Colley achievement rankings/); assert.doesNotMatch(old.html(), /SOR score/);
  const method = old.go('#methodology');
  assert.match(method, /historical snapshot uses the Colley matrix method/);
  assert.doesNotMatch(method, /primary national and conference ranking uses <strong>division-aware/);
  assert.match(old.go('#team/101'), new RegExp(`<b>#${historical.rankings.find(r => r.id === '101').rank}</b> Colley achievement`));
  old.ui.state.teamTab = 'model'; old.ui.renderTeam('101');
  assert.match(old.html(), /This season’s national and conference rankings use Colley/);
  assert.match(old.html(), /Preseason strength prior/);
  assert.doesNotMatch(old.html(), /SOR = −log10/);
});

test('validated matchup odds preserve the strength edge and show a range only for established teams', async () => {
  const snapshot = fixture();
  snapshot.config = { ...matchupEvidence.strengthConfig };
  snapshot.matchupValidation = matchupValidation(snapshot);
  assert.ok(snapshot.matchupValidation);
  assert.equal(matchupValidation({ ...snapshot, config: { ...snapshot.config, ridge: 4 } }), null);
  assert.equal(matchupValidation({ ...snapshot, season: 2025 }), null);

  const page = await browser(snapshot);
  page.ui.state.venue = 'home';
  const { a, b, edge, probability } = page.ui.compareResult();
  assert.equal(edge, a.strength - b.strength + snapshot.config.homeAdvantage);
  assert.equal(probability, 1 / (1 + Math.exp(-edge / matchupEvidence.winProbability.scale)));
  assert.match(page.go('#compare'), /Historically calibrated odds/);
  assert.doesNotMatch(page.html(), /Historical final-margin range for/);
  a.games = b.games = 4;
  assert.match(page.go('#compare'), /Historical final-margin range for/);
  const methodology = page.go('#methodology');
  assert.match(methodology, /WHAT WE CHECKED/);
  assert.match(methodology, /Confidence intervals for team ranks remain unvalidated/);
});

test('Matchup Lab rejects identical and invalid shared teams before calculating probabilities', async () => {
  const page = await browser(fixture());
  const identical = page.go('#compare/matchup/101/101/home');
  assert.match(identical, /Choose a different opponent/);
  assert.doesNotMatch(identical, /probability-track|prediction-number|Historically calibrated odds/);
  assert.equal(page.ui.compareResult(), null);
  const invalid = page.go('#compare/matchup/101/9999/away');
  assert.match(invalid, /Choose two different teams/);
  assert.doesNotMatch(invalid, /prediction-number/);
  page.go('#compare/matchup/101/102/home');
  assert.match(page.ui.compareOptions('101','102'), /value="102" disabled/);
  page.ui.selectMatchupTeam('a','102');
  assert.equal(page.ui.state.compareB, '');
  assert.equal(page.ui.compareResult(), null);
  page.ui.selectMatchupTeam('b','101');
  page.ui.selectMatchupTeam('a','101');
  assert.equal(page.ui.compareResult(), null);
  page.ui.selectMatchupTeam('b','102');
  const restored = page.ui.compareResult();
  assert.equal(restored.a.id, '101');
  assert.equal(restored.b.id, '102');
  assert.ok(restored.probability > 0 && restored.probability < 1);
});

test('FCS directory uses its own rows and preserves subdivision search state', async () => {
  const { snapshot, details } = separatedFixture(true);
  const page = await browser(snapshot, lookupDetails(details));
  const fcs = page.go('#teams/fcs');
  assert.match(fcs, /1 of 1 FCS teams/);
  assert.match(fcs, /Gamma/);
  assert.doesNotMatch(fcs, /class="team-school">(?:Alpha|Beta)</);
  page.ui.state.search = 'no such team';
  assert.match(page.go('#teams/fcs'), /No teams match these filters/);
  const fbs = page.go('#teams');
  assert.match(fbs, /2 of 2 FBS teams/);
  assert.doesNotMatch(fbs, />Gamma<\/a>/);
  assert.match(fbs, /href="\/teams\/fcs\/"/);
});

test('Matchup Lab uses the approved subdivision scale and keeps cross-division estimates uncalibrated', async () => {
  const { snapshot, details } = separatedFixture(true);
  snapshot.fcsRankings.push({ ...snapshot.fcsRankings[0], id:'202',name:'Delta',strength:snapshot.fcsRankings[0].strength-7 });
  snapshot.fcsMatchupValidation = { scale:7,approvedForWeeklyPicks:true };
  const page = await browser(snapshot,lookupDetails(details));
  const fcs = page.go('#compare/matchup/201/202/neutral');
  assert.match(fcs,/FCS Weekly Picks/);
  assert.match(fcs,/<optgroup label="FCS">/);
  const result = page.ui.compareResult();
  assert.equal(result.probability,1/(1+Math.exp(-1)));
  assert.equal(result.fcs,true);
  assert.doesNotMatch(fcs,/Historical final-margin range for/);
  const cross = page.go('#compare/matchup/101/201/home');
  assert.match(cross,/have not been calibrated for FBS–FCS games/);
  assert.doesNotMatch(cross,/Historically calibrated odds/);
  const mixed=page.ui.compareResult();
  assert.equal(mixed.probability,1/(1+Math.exp(-mixed.edge/snapshot.config.probabilityScale)));
});
