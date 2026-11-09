import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { rankSeason } from '../src/engine.js';
import { matchupValidation } from '../src/site-validation.js';
import matchupEvidence from '../data/matchup-validation.json' with { type: 'json' };

function fixture(sor = true) {
  const teams = ['a', 'b', 'c'].map((id, i) => ({ id, name: ['Alpha', 'Beta', 'Gamma'][i],
    division: id === 'c' ? 'fcs' : 'fbs', conference: 'Example' }));
  const game = (id, home, away) => ({ id, home, away, homePoints: 21, awayPoints: 7, completed: true,
    neutral: true, week: 1, seasonType: 'regular', startDate: '2026-09-05T12:00:00Z' });
  const snapshot = { ...rankSeason({ year: 2026, teams, games: [game('one', 'b', 'a'), game('two', 'a', 'c')],
    source: { provider: 'cfbd', fetchedAt: '2026-11-06T03:00:00Z' } }), asOf: '2026-11-06T03:00:01Z' };
  if (sor) {
    snapshot.rankingMethod = { id: 'division-sor-v2', name: 'Division-aware Strength of Record' };
    for (const row of snapshot.rankings) Object.assign(row, { displayRank: row.id === 'a' ? 1 : 2,
      displayConferenceRank: row.id === 'a' ? 1 : 2, colleyRank: row.rank, sorRank: row.id === 'a' ? 1 : 2,
      sor: row.id === 'a' ? 2.3456 : 1.2345, sorTailProbability: row.id === 'a' ? .004512 : .0582, sorExpectedWins: .75 });
    snapshot.rankings.sort((a, b) => a.displayRank - b.displayRank);
  }
  return snapshot;
}

async function browser(snapshot) {
  const nodes = new Map(), calls = [], errors = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', addEventListener() {} });
    return nodes.get(id);
  };
  const context = { document: { querySelector: node, addEventListener() {}, title: '' },
    location: { hash: '#home' }, window: { addEventListener() {}, scrollTo() {} },
    HTMLImageElement: class {}, console: { error: e => errors.push(e) },
    fetch: async path => { calls.push(path); return { ok: true, json: async () => snapshot }; } };
  const source = await readFile('frontend/app.js', 'utf8');
  vm.runInNewContext(source + '\nglobalThis.ui={state,render,renderHome,renderRankings,renderTeams,renderTeam,renderMethodology,renderCompare,rankingsContent,compareResult,ordered,sosRank,teamCenterContent};', context, { filename: 'frontend/app.js' });
  await new Promise(setImmediate);
  assert.deepEqual(errors, []);
  return { ...context, calls, html: () => node('#main').innerHTML,
    go(hash) { context.location.hash = hash; context.ui.render(); return node('#main').innerHTML; } };
}

test('home, national table and directory display published SOR ranks and scores rather than legacy Colley', async () => {
  const snapshot = fixture(), before = JSON.stringify(snapshot), page = await browser(snapshot);
  assert.deepEqual(page.calls, ['/rankings']);
  assert.match(page.html(), /rank-chip">1<\/span>.*?<strong>Alpha<\/strong>/s);
  assert.match(page.html(), /Strength of Record rankings/);
  assert.match(page.html(), /SOR score/); assert.match(page.html(), /2\.3456/);
  const ranking = page.go('#rankings');
  assert.match(ranking, /table-rank top">1<\/span>.*?href="#team\/a"/s);
  assert.match(ranking, /SOR scores are not win probabilities/); assert.match(ranking, /SOS · Colley/);
  assert.match(page.go('#teams'), /team-card-rank">#1<\/span>.*?<h3>Alpha<\/h3>.*?2\.3456 SOR/s);
  assert.equal(JSON.stringify(snapshot), before);
});

test('team, opponent evidence, conference and model sections distinguish SOR from retained Colley calculations', async () => {
  const page = await browser(fixture()), html = page.go('#team/a');
  assert.match(html, /<b>#1<\/b> Strength of Record/); assert.match(html, /<span>#1 in conference<\/span>/);
  assert.match(html, /<strong>2\.3456<\/strong><span>SOR score/);
  assert.match(html, /WHY WE RANK ALPHA #1/); assert.match(html, /#2 FBS Strength of Record/);
  assert.match(html, /COLLEY BASELINE, EXPLAINED/); assert.match(html, /Colley baseline \(#2\), not the SOR score/);
  assert.match(html, /Each game is removed from the network/); assert.match(html, /Reference-team chance: 0\.45%/);
  page.ui.state.teamTab = 'model'; page.ui.renderTeam('a');
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
  const team = snapshot.rankings.find(row => row.id === 'a');
  const page = await browser(snapshot);
  page.ui.state.teamTab = 'model';
  Object.assign(team, { sor: 5, sorTailProbability: 0.00001 });
  assert.match(page.go('#team/a'), /less than 0\.01%.*less than once out of 1,000 tries/s);
  Object.assign(team, { wins: 0, losses: 2, sor: 0, sorTailProbability: 1 });
  assert.match(page.go('#team/a'), /Any team can reach zero wins.*100\.00%.*SOR score is zero/s);
  Object.assign(team, { games: 0, losses: 0, sorExpectedWins: 0, displayRank: null, displayConferenceRank: null });
  assert.match(page.go('#team/a'), /With zero completed games.*0\.00 expected wins.*gets a rank after it plays/s);
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
  assert.match(active, /fixed coefficients learned from older seasons/); assert.match(active, /independence assumption/);
  assert.match(active, /Colley network remains the opponent-rating baseline/);
  const historical = fixture(false), old = await browser(historical);
  assert.match(old.html(), /Colley achievement rankings/); assert.doesNotMatch(old.html(), /SOR score/);
  const method = old.go('#methodology');
  assert.match(method, /historical snapshot uses the Colley matrix method/);
  assert.doesNotMatch(method, /primary national and conference ranking uses <strong>division-aware/);
  assert.match(old.go('#team/a'), new RegExp(`<b>#${historical.rankings.find(r => r.id === 'a').rank}</b> Colley achievement`));
  old.ui.state.teamTab = 'model'; old.ui.renderTeam('a');
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
