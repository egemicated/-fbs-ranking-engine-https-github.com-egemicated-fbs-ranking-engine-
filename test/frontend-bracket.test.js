import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseBracketWinner, scoreBracket } from '../frontend/bracket.js';

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
