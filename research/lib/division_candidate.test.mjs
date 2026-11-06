import test from 'node:test';
import assert from 'node:assert/strict';
import { solveGraph } from '../../src/engine.js';
import { calculateSor, SOR_DEFAULT_PARAMETERS } from './sor_candidate.mjs';
import { calculateDivisionSor, calculateDivisionForecasts } from './division_candidate.mjs';

const beta = { slope: 5.1, homeLogOdds: .38, divisionLogOdds: 2.4 };
function fixture() {
  return { teams: ['a', 'b', 'c', 'd', 'idle'].map(id => ({ id, name: id, division: id === 'c' || id === 'd' ? 'fcs' : 'fbs' })), games: [
    { id: 'one', a: 'a', b: 'b', outcome: 1, venue: 1 },
    { id: 'two', a: 'a', b: 'b', outcome: -1, venue: -1 },
    { id: 'three', a: 'a', b: 'c', outcome: 1, venue: 0 },
    { id: 'four', a: 'd', b: 'b', outcome: 1, venue: 1 },
    { id: 'context', a: 'c', b: 'd', outcome: 0, venue: 1 }
  ] };
}

function bruteRatings(data) {
  const index = new Map(data.teams.map((t, i) => [t.id, i]));
  const rhs = new Float64Array(data.teams.length), edges = [];
  for (const g of data.games) {
    const a = index.get(g.a), b = index.get(g.b);
    edges.push([a, b]); rhs[a] += g.outcome / 2; rhs[b] -= g.outcome / 2;
  }
  const r = solveGraph(data.teams.length, edges, rhs, 2);
  return new Map(data.teams.map((t, i) => [t.id, r[i] + .5]));
}

function bruteSor(data, parameters) {
  const teams = new Map(data.teams.map(t => [t.id, t]));
  const fbs = data.teams.filter(t => t.division === 'fbs');
  const rows = new Map(fbs.map(t => [t.id, { probabilities: [], wins: 0 }]));
  data.games.forEach((g, i) => {
    const r = bruteRatings({ ...data, games: data.games.filter((_, j) => i !== j) });
    const reference = fbs.reduce((s, t) => s + r.get(t.id), 0) / fbs.length;
    for (const [id, other, outcome, venue] of [[g.a, g.b, g.outcome, g.venue], [g.b, g.a, -g.outcome, -g.venue]]) {
      if (!rows.has(id)) continue;
      const logit = parameters.slope * (reference - r.get(other)) + parameters.homeLogOdds * venue +
        parameters.divisionLogOdds * Number(teams.get(other).division === 'fcs');
      rows.get(id).probabilities.push(1 / (1 + Math.exp(-logit)));
      rows.get(id).wins += Number(outcome > 0);
    }
  });
  for (const row of rows.values()) {
    row.expectedWins = row.probabilities.reduce((s, p) => s + p, 0); row.tail = 0;
    for (let bits = 0; bits < 2 ** row.probabilities.length; bits++) {
      let probability = 1, wins = 0;
      row.probabilities.forEach((p, i) => { const win = Boolean(bits & 2 ** i); wins += Number(win); probability *= win ? p : 1 - p; });
      if (wins >= row.wins) row.tail += probability;
    }
  }
  return rows;
}

test('division SOR agrees with complete excluded-game refits and enumerated record tails', () => {
  for (const divisionLogOdds of [2.4, -1.3]) {
    const data = fixture(), parameters = { ...beta, divisionLogOdds }, brute = bruteSor(data, parameters);
    for (const row of calculateDivisionSor(data, parameters).rows) {
      assert.ok(Math.abs(row.expectedWins - brute.get(row.id).expectedWins) < 1e-11);
      assert.ok(Math.abs(row.tail - brute.get(row.id).tail) < 1e-11);
    }
  }
});

test('zero gap exactly reproduces frozen v1 without changing its implementation', () => {
  assert.deepEqual(calculateDivisionSor(fixture(), { ...SOR_DEFAULT_PARAMETERS, divisionLogOdds: 0 }), calculateSor(fixture()));
});

test('orientation, order, names and polls cannot change numeric evidence', () => {
  const data = fixture(), copy = structuredClone(data), before = calculateDivisionSor(data, beta);
  copy.teams.reverse().forEach(t => { t.name = 'renamed'; t.conference = 'prestige'; t.poll = 1; });
  copy.games.reverse(); copy.games = copy.games.map(g => ({ ...g, a: g.b, b: g.a, outcome: -g.outcome, venue: -g.venue, margin: 1000 }));
  const after = calculateDivisionSor(copy, beta);
  for (const row of before.rows) {
    const other = after.rows.find(t => t.id === row.id);
    assert.ok(Math.abs(row.sor - other.sor) < 1e-11); assert.equal(row.sorRank, other.sorRank);
  }
  assert.deepEqual(data, fixture());
});

test('context ties are retained, FBS ties and unknown direct opponent divisions are rejected', () => {
  const data = fixture(); assert.equal(calculateDivisionSor(data, beta).rows.length, 3);
  const unknown = structuredClone(data); unknown.teams.find(t => t.id === 'c').division = 'unknown';
  assert.throws(() => calculateDivisionSor(unknown, beta), /known FBS\/FCS/);
  const tied = structuredClone(data); tied.games[0].outcome = 0;
  assert.throws(() => calculateDivisionSor(tied, beta), /decisive FBS/);
});

test('parameters are explicit finite numbers with no fitted sign restrictions', () => {
  for (const p of [undefined, {}, { ...beta, slope: Infinity }, { ...beta, divisionLogOdds: '2' }, { ...beta, pollWeight: 1 }]) {
    assert.throws(() => calculateDivisionSor(fixture(), p), /parameters/);
  }
  assert.doesNotThrow(() => calculateDivisionSor(fixture(), { slope: -1, homeLogOdds: -.4, divisionLogOdds: -2 }));
});

test('prospective probabilities use full current ratings, signed division gap and venue', () => {
  const data = fixture(), r = bruteRatings(data), fixtures = [{ id: 'future', a: 'a', b: 'c', venue: 1 }];
  const [p] = calculateDivisionForecasts(data, fixtures, beta);
  const expected = 1 / (1 + Math.exp(-(beta.slope * (r.get('a') - r.get('c')) + beta.homeLogOdds + beta.divisionLogOdds)));
  assert.ok(Math.abs(p.aWinProbability - expected) < 1e-12);
  const [reverse] = calculateDivisionForecasts(data, [{ id: 'future', a: 'c', b: 'a', venue: -1 }], beta);
  assert.ok(Math.abs(p.aWinProbability + reverse.aWinProbability - 1) < 1e-12);
  const neutral = calculateDivisionForecasts(data, [{ ...fixtures[0], venue: 0 }], beta)[0];
  const zeroHome = calculateDivisionForecasts(data, fixtures, { ...beta, homeLogOdds: 0 })[0];
  assert.equal(neutral.aWinProbability, zeroHome.aWinProbability);
});

test('forecast division gap leaves fixed-coefficient FBS-FBS probabilities unchanged', () => {
  const data = fixture(), fixtures = [{ id: 'future', a: 'a', b: 'b', venue: 0 }];
  assert.deepEqual(calculateDivisionForecasts(data, fixtures, beta), calculateDivisionForecasts(data, fixtures, { ...beta, divisionLogOdds: -100 }));
  assert.throws(() => calculateDivisionForecasts(data, [{ id: 'bad', a: 'c', b: 'd', venue: 1 }], beta), /at least one FBS/);
  assert.throws(() => calculateDivisionForecasts(data, [fixtures[0], fixtures[0]], beta), /Invalid forecast/);
});
