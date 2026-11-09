import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chooseBracketWinner, pendingBracket, scoreBracket } from '../frontend/bracket.js';
import { renderBracketBoard } from '../frontend/bracket-board.js';

const slots = [
  { id: 'first', round: 1, home: 'Indiana', away: 'Texas Tech' },
  { id: 'second', round: 1, home: 'Georgia', away: 'Ole Miss' },
  { id: 'quarter', round: 2, home: 'Oregon', awayFrom: 'first' },
  { id: 'semi', round: 3, home: 'Miami', awayFrom: 'quarter' },
  { id: 'final', round: 4, home: 'Alabama', awayFrom: 'semi' },
];
const complete = { first: 'Indiana', second: 'Georgia', quarter: 'Indiana', semi: 'Indiana', final: 'Indiana' };

test('changing a winner clears dependent picks while keeping unrelated games', () => {
  assert.deepEqual(chooseBracketWinner(slots, complete, 'first', 'Texas Tech'), { first: 'Texas Tech', second: 'Georgia' });
  assert.deepEqual(chooseBracketWinner(slots, complete, 'quarter', 'Oregon'), { first: 'Indiana', second: 'Georgia', quarter: 'Oregon' });
  assert.equal(complete.final, 'Indiana');
});

test('scoring counts only final results and awards the round value once', () => {
  const results = { first: { winner: 'Texas Tech' }, quarter: { winner: 'Indiana' }, final: { winner: 'Indiana' } };
  assert.deepEqual(scoreBracket(slots, complete, results), { correct: 2, graded: 3, points: 10 });
  assert.deepEqual(scoreBracket(slots, complete, { ...results, final: { winner: 'Alabama' } }), { correct: 1, graded: 3, points: 2 });
});

test('desktop lanes follow actual feeder paths when bracket slots use a different order', async () => {
  const fixture = JSON.parse(await readFile(new URL('../frontend/bracket-demo.json', import.meta.url), 'utf8'));
  const changes = {
    'qf-1': { awayFrom: 'r1-3' }, 'qf-3': { awayFrom: 'r1-1' },
    'sf-1': { awayFrom: 'qf-3' }, 'sf-2': { homeFrom: 'qf-1' },
  };
  const slots = fixture.slots.map(slot => ({ ...slot, ...changes[slot.id] }));
  const byId = new Map(slots.map(slot => [slot.id, slot]));
  const html = renderBracketBoard({ slots, picks: {}, results: {}, winners: {}, editable: true, pointsByRound: [1, 2, 4, 8] });
  const order = [...html.matchAll(/data-bracket-slot="([^"]+)"/g)].map(([, id]) => byId.get(id));
  const firstRound = order.filter(slot => slot.round === 1);
  const quarterfinals = order.filter(slot => slot.round === 2);
  const semifinals = order.filter(slot => slot.round === 3);
  assert.equal(order.length, 11);
  assert.deepEqual(firstRound.map(slot => slot.id), quarterfinals.map(slot => slot.homeFrom ?? slot.awayFrom));
  for (const [index, semifinal] of semifinals.entries()) {
    const quarterfinalIds = quarterfinals.slice(index * 2, index * 2 + 2).map(slot => slot.id);
    assert.deepEqual(new Set(quarterfinalIds), new Set([semifinal.homeFrom, semifinal.awayFrom]));
  }
});

test('the pending field shows the seeded bracket and bye paths without opening picks', () => {
  const html = renderBracketBoard({ ...pendingBracket, picks: {}, results: {}, winners: {}, editable: false, pointsByRound: [1, 2, 4, 8] });
  const games = [...html.matchAll(/<article\b[\s\S]*?<\/article>/g)];
  const matchups = games.map(([game]) => game).join('');
  const seeds = [...matchups.matchAll(/aria-label="Seed (\d+)">\d+<\/small><span>TBD<\/span>/g)]
    .map(([, seed]) => Number(seed)).sort((left, right) => left - right);
  assert.equal(games.length, 11);
  assert.deepEqual(seeds, Array.from({ length: 12 }, (_, index) => index + 1));
  assert.equal((matchups.match(/<span>Winner TBD<\/span>/g) ?? []).length, 10);
  assert.equal((matchups.match(/<time\b/g) ?? []).length, 1);
  assert.equal((html.match(/data-bracket-bye=/g) ?? []).length, 4);
  assert.equal((html.match(/<path\b/g) ?? []).length, 14);
  assert.equal((html.match(/class="is-bye"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /data-bracket-game=/);
  for (const date of pendingBracket.roundDates) assert.ok(html.includes(date));
});
