import assert from 'node:assert/strict';
import test from 'node:test';
import { CFP_RULES_URL, SCENARIO_CFP_SEASON, SCENARIO_CHAMPION_CONFERENCES, selectScenarioField } from '../frontend/cfp-scenario-field.js';

const conferences = [
  'Big Ten', 'SEC', 'ACC', 'Big 12', 'SEC', 'Big Ten', 'ACC', 'Big 12', 'SEC', 'Big Ten', 'SEC',
  'FBS Independents', 'Big 12', 'American Athletic', 'Pac-12', 'Mountain West', 'Conference USA', 'Mid-American',
  'Sun Belt', 'ACC', 'SEC', 'Big 12', 'Big Ten',
];

function scenarioRows() {
  return conferences.map((conference, index) => {
    const rank = index + 1;
    return { id: `team-${rank}`, name: rank === 12 ? 'Notre Dame' : `Team ${rank}`, conference,
      sorRank: rank, sor: 3 - index / 10, wins: 8, losses: 2 };
  });
}

test('uses 2026 bids, assumes the top team in each championship conference, and fixes the seed paths', () => {
  assert.equal(SCENARIO_CFP_SEASON, 2026);
  assert.match(CFP_RULES_URL, /^https:\/\/collegefootballplayoff\.com\//);
  const rows = Object.freeze(scenarioRows().map(Object.freeze));
  const { field, champions, matchups } = selectScenarioField(rows);
  assert.deepEqual(champions, SCENARIO_CHAMPION_CONFERENCES.map((conference, index) => ({
    conference, teamId: ['team-3', 'team-1', 'team-4', 'team-2'][index], assumed: true,
  })));
  assert.deepEqual(field.map(row => row.sorRank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14]);
  assert.deepEqual(field.map(row => row.bid), [
    ...Array(4).fill('conference champion'), ...Array(6).fill('at-large'), 'Notre Dame', 'highest-ranked eligible conference',
  ]);
  assert.deepEqual(matchups.map(({ home, away, byeOpponent }) => [home.seed, away.seed, byeOpponent.seed]),
    [[5, 12, 4], [6, 11, 3], [7, 10, 2], [8, 9, 1]]);
  assert.equal(matchups[0].away, field[11]);
});

test('honors every explicit champion and seeds multiple qualifiers outside the top 12 by SOR order', () => {
  const rows = scenarioRows();
  const choices = { ACC: 'team-20', 'Big Ten': 'team-23', 'Big 12': 'team-22', SEC: 'team-21' };
  const { field, champions } = selectScenarioField(rows, choices);
  assert.deepEqual(champions.map(row => [row.teamId, row.assumed]),
    [['team-20', false], ['team-23', false], ['team-22', false], ['team-21', false]]);
  assert.deepEqual(field.map(row => row.sorRank), [1, 2, 3, 4, 5, 6, 12, 14, 20, 21, 22, 23]);
  assert.equal(field[0].bid, 'at-large');
  assert.equal(field[6].bid, 'Notre Dame');
  assert.equal(field[11].bid, 'conference champion');
  assert.deepEqual(selectScenarioField(rows, { ACC: 'team-20', SEC: '' }).champions.map(row => row.assumed),
    [false, true, true, true]);
});

test('resolves shared SOR ranks in supplied order and excludes teams without a rating or results', () => {
  const rows = scenarioRows();
  rows[11].name = 'Independent Team';
  rows[12] = { ...rows[12], name: 'Notre Dame', conference: 'FBS Independents', sorRank: 12, sor: rows[11].sor };
  rows[13] = { ...rows[13], sorRank: null, sor: null, wins: 0, losses: 0 };
  rows[15] = { ...rows[15], wins: 0, losses: 0 };
  const { field } = selectScenarioField(rows);
  assert.deepEqual(field.map(row => row.id), [...Array.from({ length: 11 }, (_, index) => `team-${index + 1}`), 'team-15']);
  assert.equal(field[11].bid, 'highest-ranked eligible conference');
  [rows[11], rows[12]] = [rows[12], rows[11]];
  assert.equal(selectScenarioField(rows).field[10].bid, 'Notre Dame');
});

test('rejects unsupported options, an invalid champion, unsorted rankings, and incomplete eligible coverage', () => {
  const rows = scenarioRows();
  assert.throws(() => selectScenarioField(rows, { 'Pac-12': 'team-15' }), /Choose conference champions/);
  assert.throws(() => selectScenarioField(rows, { ACC: 'team-2' }), /Choose a ranked ACC team/);
  assert.throws(() => selectScenarioField(rows.slice(0, 11)), /at least 12 ranked/);
  assert.throws(() => selectScenarioField(rows.slice(0, 13)), /fifth automatic bid/);
  assert.throws(() => selectScenarioField([rows[1], rows[0], ...rows.slice(2)]), /SOR order/);
  assert.throws(() => selectScenarioField([...rows, rows[0]]), /unique teams/);
});
