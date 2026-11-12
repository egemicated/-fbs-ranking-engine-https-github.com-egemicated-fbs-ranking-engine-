import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildScenarioPublication, browserSorSource } from '../src/scenario-publication.js';
import { calculateDivisionSor } from '../research/lib/division_candidate.mjs';
import { calculateScenario, fillScenarioFavorites, predictScenarioGame } from '../frontend/cfp-scenario-model.js';

const policy = { parameters: { slope: 5, homeLogOdds: 0.3, divisionLogOdds: 2.4 } };
const ratings = [
  { id: 'a', name: 'Alpha', conference: 'East', division: 'fbs', strength: 8, games: 0, contributions: [] },
  { id: 'b', name: 'Beta', conference: 'East', division: 'fbs', strength: 4, games: 0, contributions: [] },
  { id: 'c', name: 'Gamma', conference: 'West', division: 'fcs', strength: -1, games: 0, contributions: [] },
];
const snapshot = { season: 2026, asOf: '2026-11-08T19:16:55Z', snapshotHash: 'saved-snapshot', gamesUsed: 0, ratings,
  rankings: ratings.slice(0, 2).map((team, index) => ({ ...team, displayRank: index + 1 })),
  config: { marginCap: 28, homeAdvantage: 2.5, probabilityScale: 14 },
  source: { audit: { confirmedCanceledRecords: [{ id: 'cancelled' }] } } };

function schedule() {
  const fixture = { home: 'a', away: 'b', neutral: false, week: 14, status: 'scheduled', seasonType: 'regular',
    startDate: '2026-12-05T17:00:00Z' };
  return { season: 2026, source: { rankingAsOf: snapshot.asOf, snapshotHash: snapshot.snapshotHash,
    probabilityScale: 6, homeAdvantage: 2.5 }, games: [
    { ...fixture, id: 'selected', pick: { homeWinProbability: 0.2 } },
    { ...fixture, id: 'title', seasonType: 'postseason', neutral: true, estimate: { homeWinProbability: 0.6 } },
    { ...fixture, id: 'pending', status: 'pending', away: 'c' },
    { ...fixture, id: 'cancelled', status: 'pending' },
    { ...fixture, id: 'final', status: 'final' },
    { ...fixture, id: 'late', startDate: '2026-12-06T17:00:00Z' },
    { ...fixture, id: 'unknown', away: 'unrecognized' },
  ] };
}

test('publishes only eligible pre-selection fixtures matched to the rankings snapshot', () => {
  const weekly = schedule();
  const result = buildScenarioPublication(snapshot, weekly, policy);
  assert.deepEqual(result.fixtures.map(game => [game.id, game.status, game.probabilitySource]), [
    ['selected', 'scheduled', 'saved'], ['title', 'scheduled', 'estimate'], ['pending', 'pending', 'snapshot'],
  ]);
  assert.equal(result.fixtures[0].homeWinProbability, 0.2);
  assert.equal(result.fixtures[2].homeWinProbability, predictScenarioGame(result, 'a', 'c', false));
  assert.equal(buildScenarioPublication({ ...snapshot, season: 2027 }, weekly, policy), null);
  assert.equal(buildScenarioPublication({ ...snapshot, asOf: '2026-12-06T17:00:00Z' }, weekly, policy), null);
  weekly.source.rankingAsOf = '2026-11-07T12:00:00Z';
  assert.throws(() => buildScenarioPublication(snapshot, weekly, policy), /same saved snapshot/);
});

test('favorites fill unpicked games with available unequal odds and preserve manual picks', () => {
  const input = buildScenarioPublication(snapshot, schedule(), policy);
  const fixtures = [...input.fixtures,
    { ...input.fixtures[0], id: 'even', homeWinProbability: 0.5 },
    { ...input.fixtures[0], id: 'unknown-odds', homeWinProbability: null }];
  const picks = { selected: 'a' };
  assert.deepEqual(fillScenarioFavorites(fixtures, picks), { selected: 'a', title: 'a', pending: 'a' });
  assert.deepEqual(picks, { selected: 'a' });
  assert.throws(() => fillScenarioFavorites(fixtures, { selected: 'c' }), /Choose one/);
});

test('scenario sends exact winner signs and venues to SOR and rejects repeated games', () => {
  const input = buildScenarioPublication(snapshot, schedule(), policy);
  const before = structuredClone(input);
  const custom = [{ id: 'championship', home: 'a', away: 'b', neutral: true, winner: 'a' }];
  const rows = calculateScenario(input, { selected: 'b' }, custom, (dataset, parameters) => {
    assert.deepEqual(dataset.games, [
      { id: 'selected', a: 'a', b: 'b', outcome: -1, venue: 1 },
      { id: 'championship', a: 'a', b: 'b', outcome: 1, venue: 0 },
    ]);
    return calculateDivisionSor(dataset, parameters);
  });
  assert.deepEqual(rows.map(row => [row.wins, row.losses]), [[1, 1], [1, 1]]);
  assert.deepEqual(input, before);
  assert.throws(() => calculateScenario(input, { selected: 'c' }, [], calculateDivisionSor), /Choose one/);
  assert.throws(() => calculateScenario(input, {}, [{ ...custom[0], id: 'selected' }], calculateDivisionSor), /new game ID/);
  assert.throws(() => calculateScenario(input, {}, [...custom, { ...custom[0], id: 'repeat', home: 'b', away: 'a' }],
    calculateDivisionSor), /already in the custom games/);
});

test('generated browser calculator reproduces every published SOR rank and score', async () => {
  const read = path => readFile(new URL(path, import.meta.url), 'utf8').then(JSON.parse);
  const [source, policy, moduleSource] = await Promise.all([
    read('../published/latest.json'), read('../data/publication-model.json'), browserSorSource(),
  ]);
  // Schedule alignment is tested above. A delayed Weekly Picks publication
  // should never prevent the ranking refresh from recovering.
  const weekly = { season: source.season, source: { rankingAsOf: source.asOf, snapshotHash: source.snapshotHash }, games: [] };
  const input = buildScenarioPublication(source, weekly, policy);
  // Future publications after Selection Day do not supply a 2026 scenario.
  if (input === null) return;
  const calculator = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
  const rows = calculateScenario(input, {}, [], calculator.calculateDivisionSor);
  const published = new Map(source.rankings.map(team => [team.id, team]));
  assert.equal(rows.length, published.size);
  for (const row of rows) {
    assert.equal(row.sorRank, published.get(row.id).displayRank);
    assert.equal(row.sor, published.get(row.id).sor);
  }
});
