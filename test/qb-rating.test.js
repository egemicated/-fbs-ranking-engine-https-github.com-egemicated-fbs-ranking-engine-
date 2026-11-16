import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQBRatings, QB_RATING_METHOD } from '../src/qb-rating.js';

const kickoff = '2026-09-05T17:00:00.000Z';
const passing = { attempts: 40, completions: 20, yards: 240, touchdowns: 2, interceptions: 1 };

function row(id, { division = 'fbs', data = passing, ...changes } = {}) {
  return { gameId: `g${id}`, teamId: `t${id}`, opponentId: `o${id}`, playerId: `p${id}`,
    season: 2026, kickoff, division, passing: data, ...changes };
}

function referenceRows(division) {
  return Array.from({ length: 5 }, (_, index) => row(`${division}${index}`, { division }));
}

test('a rating reconciles the actual yard-equivalent, reference, and pseudo-attempt calculation', () => {
  const rows = referenceRows('fbs');
  rows[0].passing = { ...passing, yards: 440 };
  const result = buildQBRatings(rows, { season: 2026 });
  const qb = result.ratings.get('tfbs0:pfbs0');
  const total = 440 + 15 * 2 - 40;
  const reference = (total + 4 * (240 + 15 * 2 - 40)) / 200;
  assert.equal(qb.status, 'experimental');
  assert.equal(qb.attempts, 40);
  assert.equal(qb.sampleStatus, 'small-sample');
  assert.equal(qb.rating, 100 + 10 * (total - 40 * reference) / 100);
  assert.equal(qb.components.referenceRate, reference);
  assert.equal(qb.components.value, total);
  assert.equal(qb.formula, QB_RATING_METHOD.formula);
});

test('absent or invalid stats remain unrated and each subdivision has its own reference', () => {
  const fcs = referenceRows('fcs');
  for (const game of fcs) game.passing = { ...passing, yards: 200 };
  const rows = [...referenceRows('fbs'), ...fcs,
    row('missing', { data: { ...passing, interceptions: null } }),
    row('small', { data: { ...passing, attempts: 19, completions: 10 } }),
  ];
  const { comparisons, ratings } = buildQBRatings(rows, { season: 2026 });
  assert.ok(comparisons.fbs.yardEquivalentsPerAttempt > comparisons.fcs.yardEquivalentsPerAttempt);
  assert.equal(ratings.get('tfcs0:pfcs0').rating, 100);
  assert.equal(ratings.get('tmissing:pmissing').rating, null);
  assert.equal(ratings.get('tmissing:pmissing').attempts, 0);
  assert.equal(ratings.get('tmissing:pmissing').components.incompletePassingGames, 1);
  assert.equal(ratings.get('tsmall:psmall').rating, null);
  const smallDivision = buildQBRatings([rows[0]]);
  assert.equal(smallDivision.ratings.get('tfbs0:pfbs0').rating, null);
  assert.equal(smallDivision.comparisons.fbs.yardEquivalentsPerAttempt, null);
});

test('opponent defense uses only earlier completed evidence separated by at least one day', () => {
  const rows = referenceRows('fbs');
  rows[0].passing = { ...passing, yards: 440 };
  const earlierOpponent = rows[0].opponentId;
  rows.push(
    row('early', { opponentId: earlierOpponent, kickoff: '2026-09-06T16:59:00.000Z' }),
    row('later', { opponentId: earlierOpponent, kickoff: '2026-09-06T17:00:00.000Z' }),
    row('future', { data: { ...passing, yards: 999 }, opponentId: earlierOpponent, kickoff: '2026-09-21T17:00:00.000Z' }),
  );
  const now = { season: 2026, asOf: '2026-09-07T18:00:00.000Z' };
  const first = buildQBRatings(rows, now);
  const again = buildQBRatings([...rows].reverse(), now);
  const later = first.ratings.get('tlater:plater');
  assert.equal(first.ratings.get('tearly:pearly').components.defenseAdjustment, 0);
  assert.ok(later.components.defenseAdjustment > 0);
  assert.equal(later.components.adjustedAttempts, 40);
  assert.equal(later.rating, again.ratings.get('tlater:plater').rating);
  assert.equal(first.ratings.has('tfuture:pfuture'), false);
});

test('rejects duplicate observations, conflicting game context, wrong seasons and missing opponent identities', () => {
  const game = row('1');
  assert.throws(() => buildQBRatings([game, game]), /Duplicate/);
  assert.throws(() => buildQBRatings([game, { ...game, playerId: 'backup', opponentId: 'otherTeam' }]), /Conflicting/);
  assert.throws(() => buildQBRatings([game], { season: 2025 }), /season/);
  assert.throws(() => buildQBRatings([{ ...game, opponentId: null }]), /identity/);
});
