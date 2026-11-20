import assert from 'node:assert/strict';
import test from 'node:test';
import { formatNumber, formatProbability, formatRecord, formatSigned, formatSorScore, indefiniteArticle, plural, sorEligibleRecord } from '../frontend/format.js';

test('football display distinguishes missing values from zero and tiny positive probabilities', () => {
  assert.equal(formatNumber(null), '—');
  assert.equal(formatNumber(0,4), '0.0000');
  assert.equal(formatNumber(-0.00001,4), '0.0000');
  assert.equal(formatProbability(0), '0.00%');
  assert.equal(formatProbability(0.000001), '<0.01%');
  assert.equal(formatProbability(0.0042), '0.42%');
  assert.equal(formatProbability(undefined), '—');
  assert.equal(formatRecord({ wins:8,losses:2,ties:0 }), '8–2');
  assert.equal(formatRecord({ wins:0,losses:0,ties:1 }), '0–0–1');
  assert.equal(formatRecord({ wins:null,losses:0 }), '—');
  assert.equal(formatSigned(-0.000001,4), '0.0000');
  assert.equal(formatSigned(1.25,1,' pts'), '+1.3 pts');
  assert.equal(indefiniteArticle('8–2'), 'an');
  assert.equal(indefiniteArticle('11–0'), 'an');
  assert.equal(indefiniteArticle('7–3'), 'a');
  assert.equal(plural(1,'interception'), 'interception');
  assert.equal(plural(2,'interception'), 'interceptions');
});

test('SOR display preserves tiny positive scores and distinguishes current rounded scores', () => {
  assert.equal(formatSorScore(0.003303235106907429), '0.003303');
  assert.equal(formatSorScore(0.003280728231480426), '0.003281');
  assert.equal(formatSorScore(3.599794016804366e-7), '0.0000003600');
  assert.equal(formatSorScore(0), '0.0000');
  assert.equal(formatSorScore(null), '—');
  assert.equal(sorEligibleRecord({ sorWins:0, sorGames:6 }), '0–6');
  assert.equal(sorEligibleRecord({ sorWins:0, sorGames:0 }), null);
});
