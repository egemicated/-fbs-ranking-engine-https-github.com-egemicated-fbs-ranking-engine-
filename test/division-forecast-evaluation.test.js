import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluateForecasts } from '../research/evaluate_division_forecasts.mjs';

const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function observation({recordedAt='2026-11-08T15:00:00Z',probability=.8,phase='post-freeze-saved-before-kickoff'}={}){
  const data={schemaVersion:1,protocolId:'division-sor-v1',frozenAt:'2026-11-06T12:00:00Z',forecastCapturedAt:recordedAt,asOf:'2026-11-08T14:59:00Z',sourceFetchedAt:'2026-11-08T14:58:00Z',sourceHash:'source0',snapshotHash:'snapshot0',forecasts:[{gameId:'g1',modelId:'division-sor-v1',season:2026,asOf:'2026-11-08T14:59:00Z',sourceHash:'source0',snapshotHash:'snapshot0',kickoff:'2026-11-10T18:00:00Z',home:'a',away:'b',homeDivision:'fbs',awayDivision:'fcs',neutral:false,homeWinProbability:probability,controlHomeWinProbability:.6,phase}]};
  return {...data,resultSha256:sha(data),recordedAt,runtime:process.version};
}
function season(){return {year:2026,source:{sha256:'source'},games:[{id:'g1',home:'a',away:'b',neutral:false,startDate:'2026-11-10T18:00:00Z',completed:true,homePoints:28,awayPoints:7}]};}

test('scores first immutable pregame forecast per game and reports crossdivision separately',()=>{
  const a=observation(),later=observation({recordedAt:'2026-11-09T15:00:00Z',probability:.9});
  const r=evaluateForecasts({observations:[later,a],season:season(),asOf:'2026-11-15T15:00:00Z'});
  assert.equal(r.evaluated.length,1);assert.equal(r.evaluated[0].homeWinProbability,.8);
  const score=r.scoresByModel['division-sor-v1'];assert.equal(score.overall.games,1);assert.equal(score.fbsVsFcs.games,1);assert.equal(score.fbsVsFbs.games,0);
  assert.ok(Math.abs(score.overall.candidate.logLoss+Math.log(.8))<1e-12);
});
test('unfinished or missing results remain pending; retrospective shadows never become forecasts',()=>{
  const s=season();s.games[0].completed=false;
  const r=evaluateForecasts({observations:[observation(),observation({phase:'retrospective-baseline'})],season:s,asOf:'2026-11-15T15:00:00Z'});
  assert.equal(r.pending,1);assert.equal(r.evaluated.length,0);assert.deepEqual(r.scoresByModel,{});
});
test('corrupted or post-kickoff saved forecasts are rejected',()=>{
  const corrupted=observation();corrupted.forecasts[0].homeWinProbability=.99;
  assert.throws(()=>evaluateForecasts({observations:[corrupted],season:season(),asOf:'2026-11-15T15:00:00Z'}),/checksum/);
  const timeTampered=observation();timeTampered.forecastCapturedAt='2026-11-08T14:00:00Z';
  assert.throws(()=>evaluateForecasts({observations:[timeTampered],season:season(),asOf:'2026-11-15T15:00:00Z'}),/checksum/);
  assert.throws(()=>evaluateForecasts({observations:[observation({recordedAt:'2026-11-11T15:00:00Z'})],season:season(),asOf:'2026-11-15T15:00:00Z'}),/before kickoff/);
});
test('corrected kickoff or participants cannot silently validate a stale forecast',()=>{
  const s=season();s.games[0].startDate='2026-11-08T12:00:00Z';
  let r=evaluateForecasts({observations:[observation()],season:s,asOf:'2026-11-15T15:00:00Z'});assert.equal(r.evaluated.length,0);assert.equal(r.excluded[0].reason,'corrected-kickoff-not-after-capture');
  s.games[0].away='c';r=evaluateForecasts({observations:[observation()],season:s,asOf:'2026-11-15T15:00:00Z'});assert.equal(r.excluded[0].reason,'participants-or-venue-changed');
  s.games[0].away='b';s.games[0].startDate='2026-12-01T12:00:00Z';r=evaluateForecasts({observations:[observation()],season:s,asOf:'2026-12-02T15:00:00Z'});assert.equal(r.excluded[0].reason,'rescheduled-outside-seven-day-window');
});
test('outcome corrections change score against the same saved probability; duplicate results fail',()=>{
  const s=season();s.games[0].homePoints=0;s.games[0].awayPoints=7;
  const r=evaluateForecasts({observations:[observation()],season:s,asOf:'2026-11-15T15:00:00Z'});
  assert.equal(r.evaluated[0].homeWinProbability,.8);assert.equal(r.evaluated[0].outcome,0);
  assert.ok(Math.abs(r.scoresByModel['division-sor-v1'].overall.candidate.logLoss+Math.log(.2))<1e-12);
  s.games.push({...s.games[0]});assert.throws(()=>evaluateForecasts({observations:[observation()],season:s,asOf:'2026-11-15T15:00:00Z'}),/Duplicate/);
});
