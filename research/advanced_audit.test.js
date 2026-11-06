import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAdvanced} from './lib/advanced_audit.mjs';

function snapshot() {
  return {season: 2026, asOf: '2026-11-06T03:39:55.757Z', snapshotHash: 'fixture', ratings: [
    {id: '1', name: 'Alpha', division: 'fbs', contributions: [{gameId: '10', opponentId: '2'}, {gameId: '11', opponentId: '3'}]},
    {id: '2', name: 'Beta', division: 'fbs', contributions: [{gameId: '10', opponentId: '1'}]},
    {id: '3', name: 'Gamma', division: 'fcs', contributions: [{gameId: '11', opponentId: '1'}, {gameId: '12', opponentId: '4'}]},
    {id: '4', name: 'Delta', division: 'fcs', contributions: [{gameId: '12', opponentId: '3'}]}
  ]};
}
const stats = n => ({plays: 60, drives: 10, ppa: n, totalPPA: n*60, successRate: 0.4, explosiveness: null});
function pair(gameId, a, b) {
  return [{gameId, season: 2026, week: 1, team: a, opponent: b, offense: stats(0.1), defense: stats(0.2)},
    {gameId, season: 2026, week: 1, team: b, opponent: a, offense: stats(0.2), defense: stats(0.1)}];
}
const rows = () => [...pair(10, 'Alpha', 'Beta'), ...pair(11, 'Alpha', 'Gamma')];

test('paired exact identities count FBS and FCS coverage separately without raw data export', () => {
  const report = auditAdvanced(rows(), snapshot());
  assert.equal(report.fbsCoverage.expectedGames, 2); assert.equal(report.fbsCoverage.identityMatchedGames, 2);
  assert.equal(report.fbsCoverage.ppaReadyGames, 2); assert.equal(report.fbsCoverage.explosivenessReadyGames, 0);
  assert.equal(report.groups['fcs-fcs'].expectedGames, 1); assert.equal(report.groups['fcs-fcs'].identityMatchedGames, 0);
  assert.equal(report.fbsTeamsRepresented, 2); assert.equal(report.fbsTeamsComplete, 2);
  assert.equal(report.fields.counts['offense.explosiveness'].null, 4);
  assert.equal(report.fields.counts['offense.stuffRate'].missing, 4);
  assert.equal(report.mirror.mismatchedFields, 0);
  assert.equal(report.offense, undefined); assert.equal(JSON.stringify(report).includes('"totalPPA":6'), false);
});

test('one-sided, duplicate and wrong reciprocal names never become a paired game', () => {
  for (const bad of [[...rows(), rows()[0]], rows().slice(1), rows().map((r, i) => i===0 ? {...r, opponent:'Wrong'} : r)]) {
    assert.equal(auditAdvanced(bad, snapshot()).fbsCoverage.identityMatchedGames, 1);
  }
  const aliases = rows().map(r => r.team === 'Alpha' ? {...r, team:'ALPHA'} : r);
  assert.equal(auditAdvanced(aliases, snapshot()).fbsCoverage.identityMatchedGames, 0);
});

test('missing and invalid metrics stay unavailable, with mirrored disagreement visible', () => {
  const input = rows(); input[0].offense.successRate = 1.2; input[1].defense.ppa = 999;
  delete input[2].offense.ppa;
  const report = auditAdvanced(input, snapshot());
  assert.equal(report.fbsCoverage.successRateReadyGames, 1);
  assert.equal(report.fbsCoverage.ppaReadyGames, 1);
  assert.equal(report.mirror.mismatchedFields, 2);
  assert.equal(report.fields.counts['offense.ppa'].missing, 1);
  input[0].offense.plays=0;
  assert.equal(auditAdvanced(input, snapshot()).fbsCoverage.positivePlayPairedGames, 1);
});

test('wrong seasons, malformed rows and newer games are diagnosed without guessing participants', () => {
  const input = rows(); input[0].season=2025;
  input.push(...pair(99,'Alpha','Beta'), {gameId: 11, team:'Gamma'}, null);
  const report = auditAdvanced(input,snapshot());
  assert.equal(report.wrongSeasonRows,1); assert.equal(report.malformedRows,2);
  assert.deepEqual(report.outsideReferenceGameIds,['99']);
  assert.equal(report.fbsCoverage.identityMatchedGames,1);
});

test('order, unconsumed provider rankings and input names outside paired identity do not alter numbers', () => {
  const input=rows(), before=structuredClone(input), snap=snapshot();
  const first=auditAdvanced(input,snap);
  const second=auditAdvanced(input.slice().reverse().map(r=>({...r, apPoll:1, fpi:100})),snap);
  assert.deepEqual(first.fbsCoverage,second.fbsCoverage);assert.deepEqual(first.fields,second.fields);
  assert.deepEqual(first.teamCoverage,second.teamCoverage);assert.deepEqual(input,before);
});

test('invalid root and incomplete snapshot graph fail instead of making a new denominator', () => {
  assert.throws(()=>auditAdvanced({},snapshot()),/array/);
  const broken=snapshot();broken.ratings[0].contributions.pop();
  assert.throws(()=>auditAdvanced(rows(),broken),/reciprocal/);
});
