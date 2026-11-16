import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDivisionSor } from '../research/lib/division_candidate.mjs';
import { calculateScenario } from '../frontend/cfp-scenario-model.js';
import { compareRootingOutcome, rootingCacheVersion, rootingCandidates, rootingChampions, topRootingRecommendations } from '../frontend/rooting-guide-model.js';

const now = Date.parse('2026-11-15T18:00:00Z');
const teams = [
  { id: '1', name: 'Favorite', division: 'fbs', conference: 'Big 12', baselineRank: 12 },
  { id: '2', name: 'Previous opponent', division: 'fbs', conference: 'Big 12', baselineRank: 25 },
  { id: '3', name: 'League contender', division: 'fbs', conference: 'Big 12', baselineRank: 13 },
  { id: '4', name: 'Rank neighbor', division: 'fbs', conference: 'Big Ten', baselineRank: 11 },
  { id: '5', name: 'FCS', division: 'fcs', conference: 'Big Sky' },
  { id: '6', name: 'Unrelated', division: 'fbs', conference: 'ACC', baselineRank: 100 },
];
const scheduled = { id: '80', home: '3', away: '2', week: 12, seasonType: 'regular', startDate: '2026-11-18T23:30:00Z',
  neutral: false, status: 'scheduled', startTimeTbd: false };
const input = {
  season: 2026, asOf: '2026-11-15T17:59:00Z', snapshotHash: 'matching',
  parameters: { slope: 5, homeLogOdds: 0.3, divisionLogOdds: 2.4 },
  teams,
  games: [
    { id: '45', a: '1', b: '2', outcome: 1, venue: 1 },
    { id: '46', a: '1', b: '4', outcome: -1, venue: -1 },
    { id: '47', a: '3', b: '5', outcome: 1, venue: 1 },
    { id: '48', a: '2', b: '6', outcome: 1, venue: 1 },
  ],
  fixtures: [
    scheduled,
    { ...scheduled, id: '81', home: '1' },
    { ...scheduled, id: '82', away: '4', home: '6' },
    { ...scheduled, id: '83', startTimeTbd: true },
    { ...scheduled, id: '84', startTimeTbd: null },
    { ...scheduled, id: '85', status: 'pending' },
    { ...scheduled, id: '86', startDate: '2026-11-15T17:59:00Z' },
    { ...scheduled, id: '87', startDate: '2026-11-22T18:00:01Z' },
  ],
};

test('rooting guide picks confirmed external fixtures in the coming seven days and prioritizes prior opponents', () => {
  const candidates = rootingCandidates(input, '1', now);
  assert.deepEqual(candidates.map(candidate => candidate.game.id), ['80', '82']);
  assert.deepEqual(candidates.map(candidate => candidate.pastOpponents), [['2'], ['4']]);
  assert.deepEqual(rootingCandidates(input, '5', now), []);
  const near = { ...input, fixtures: Array.from({ length: 7 }, (_, i) => ({ ...scheduled, id: String(90 + i) })) };
  assert.equal(rootingCandidates(near, '1', now).length, 5);
});

test('both winners use the exact division SOR calculator with the same published results', () => {
  const before = structuredClone(input);
  const [candidate] = rootingCandidates(input, '1', now);
  const result = compareRootingOutcome(input, '1', candidate, null, calculateDivisionSor);
  const outcome = winner => calculateScenario(input, { '80': winner }, [], calculateDivisionSor).find(row => row.id === '1');
  const home = outcome('3');
  const away = outcome('2');
  assert.deepEqual(result.home, { rank: home.sorRank, sor: home.sor, seed: null });
  assert.deepEqual(result.away, { rank: away.sorRank, sor: away.sor, seed: null });
  assert.equal(result.winner, '2');
  assert.deepEqual(input, before);
});

test('the same champion choices are used for both branches and field changes outrank SOR-only effects', () => {
  const conferences = ['ACC', 'Big Ten', 'Big 12', 'SEC', 'Sun Belt'];
  const roster = Array.from({ length: 14 }, (_, i) => ({ id: String(i + 1), name: `Team ${i + 1}`,
    conference: conferences[i % conferences.length], division: 'fbs', displayRank: i + 1 }));
  const champions = rootingChampions(roster);
  const fixture = { ...scheduled, home: '2', away: '3' };
  const scope = { ...input, teams: roster, games: [], fixtures: [fixture] };
  const makeSor = dataset => {
    assert.equal(dataset.games.length, 1);
    const moving = roster.find(team => team.id === '13');
    const result = dataset.games[0].outcome;
    const ordered = roster.filter(team => team !== moving);
    ordered.splice(result === 1 ? 10 : 12, 0, moving);
    return { rows: ordered.map(({ id }, i) => ({ id, sorRank: i + 1, sor: (14 - i) / 10, wins: 7, losses: 3 })) };
  };
  assert.deepEqual(champions, { ACC: '1', 'Big Ten': '2', 'Big 12': '3', SEC: '4' });
  const row = compareRootingOutcome(scope, '13', { game: fixture, pastOpponents: [] }, champions, makeSor);
  assert.equal(row.home.seed, 11);
  assert.equal(row.away.seed, 0);
  assert.equal(row.winner, '2');
  const rows = [1, 2, 3, 4].map(num => ({ ...row, priority: num, game: { ...row.game, id: String(num) } }));
  assert.deepEqual(topRootingRecommendations([...rows, row]).map(candidate => candidate.priority), [5, 4, 3]);
});

test('cache identity changes with the favorite, rankings version, kickoff or candidate slate', () => {
  const candidates = rootingCandidates(input, '1', now);
  const key = rootingCacheVersion(input, '1', candidates);
  assert.equal(rootingCacheVersion(structuredClone(input), '1', candidates), key);
  assert.notEqual(rootingCacheVersion(input, '2', candidates), key);
  assert.notEqual(rootingCacheVersion({ ...input, snapshotHash: 'next' }, '1', candidates), key);
  assert.notEqual(rootingCacheVersion(input, '1', candidates.slice(1)), key);
  const delayed = structuredClone(candidates);
  delayed[0].game.startDate = '2026-11-19T00:00:00Z';
  assert.notEqual(rootingCacheVersion(input, '1', delayed), key);
});
