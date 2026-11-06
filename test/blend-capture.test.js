import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rankSeason } from '../src/engine.js';
import { evaluateBlendForecasts } from '../research/evaluate_blend_forecasts.mjs';
import { BLEND_FAMILIES, IMPLEMENTATION_PATHS, blendObservationHash, blendPercentiles,
  makeBlendObservation, persistBlendObservation, recordBlendObservation } from '../scripts/record-blend-comparison.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function repack(input) {
  input.normalizedBytes = Buffer.from(JSON.stringify(input.season));
  input.snapshotBytes = Buffer.from(JSON.stringify(input.snapshot));
  input.performanceBytes = Buffer.from(JSON.stringify(input.performance));
  return input;
}
function fixture() {
  const source = { provider: 'cfbd', sha256: hash('fixture-source'), fetchedAt: '2026-09-06T12:00:00Z' };
  const game = (id, home, away, startDate, completed = false) => ({ id, home, away, startDate, completed,
    homePoints: completed ? 21 : null, awayPoints: completed ? 7 : null, neutral: false, week: 1, seasonType: 'regular' });
  const season = { year: 2026, source, teams: ['a','b','c'].map(id => ({ id, name: id, division: 'fbs', conference:'X' })),
    games: [game('past-a','a','b','2026-08-01T12:00:00Z',true), game('past-b','b','c','2026-08-08T12:00:00Z',true),
      game('past-c','c','a','2026-08-15T12:00:00Z',true), game('past-d','a','b','2026-08-22T12:00:00Z',true),
      game('past-e','b','c','2026-08-29T12:00:00Z',true), game('past-f','c','a','2026-09-05T12:00:00Z',true),
      game('future','a','b','2026-09-08T12:00:00Z'), game('started','b','c','2026-09-06T11:00:00Z'),
      game('capture-boundary','a','c','2026-09-06T12:00:02Z'), game('far','b','c','2026-09-25T12:00:00Z')] };
  const config={ridge:3,retention:.75,homeAdvantage:2.5,marginCap:28,probabilityScale:14};
  const snapshot = {...rankSeason(season,{config}),asOf:'2026-09-06T12:00:01Z'};
  const performance = { season:2026, asOf:snapshot.asOf, baseSnapshotHash:snapshot.snapshotHash,
    generatedAt:'2026-09-06T12:00:01.500Z',status:'experimental',publicationHash:hash('performance'),
    source:{fetchedAt:'2026-09-06T12:00:01.200Z'},
    method:{id:'fixture-performance-v1',configuration:{ridge:1,contextPriorStrength:64,homePrior:.01,divisionPrior:.2}}, limitations:[],
    coverage:{sourceFbsTeams:3,measuredFbsGames:6,eligibleFbsGames:6,measuredFbsTeams:3},
    rankings:snapshot.rankings.map((row,index)=>({id:row.id,rank:index+1,score:index,measuredGames:row.games,expectedGames:row.games,
      offensiveSuccessRate:.5,defensiveSuccessRateAllowed:.4,explanation:{}})) };
  const implementationHashes=Object.fromEntries(IMPLEMENTATION_PATHS.map(path=>[path,hash('fixed-code')]));
  const protocol={id:'fixture-blend-v1',frozenAt:'2026-08-01T00:00:00Z',season:2026,forecastHorizonDays:7,tieTolerance:1e-10,minimumPrimaryGames:4,
    implementationSha256:{...implementationHashes},
    models:{sor:{methodId:'fixture-sor-v1',parameters:{slope:5.1,homeLogOdds:.38,divisionLogOdds:2.4}},strength:{config},
      performance:{methodId:performance.method.id,config:performance.method.configuration}},
    calibration:{trainingYears:[2018,2019],models:Object.fromEntries(Object.keys(BLEND_FAMILIES).map(key=>[key,{coefficients:[3,.2]}]))}};
  return repack(JSON.parse(JSON.stringify({season,snapshot,performance,protocol,implementationHashes,recordedAt:'2026-09-06T12:00:02.000Z'})));
}

test('percentiles preserve midrank ties, boundary ties and scale-independent equal weights',()=>{
  const a=blendPercentiles([{id:'a',value:9},{id:'b',value:4},{id:'c',value:4},{id:'d',value:1}]);
  assert.deepEqual([...a.values()].map(row=>row.percentile),[100,50,50,0]);
  assert.equal(a.get('b').midrank,2.5);assert.equal(a.get('c').rank,2);
  const b=blendPercentiles([{id:'d',value:20},{id:'c',value:50},{id:'b',value:50},{id:'a',value:100}]);
  assert.deepEqual([...a],[...b]);
});

test('capture calculates seven matched comparisons without mutating any input or using started games',()=>{
  const input=fixture(),before=JSON.stringify(input);
  const observation=makeBlendObservation(input);
  assert.deepEqual(observation.forecasts.map(row=>row.gameId),['future']);
  assert.equal(observation.commonFbsTeams,3);
  const forecast=observation.forecasts[0];
  assert.equal(forecast.primaryEligible,true);
  assert.deepEqual(Object.keys(forecast.models),Object.keys(BLEND_FAMILIES));
  assert.equal(forecast.models.sor.pick,'tie');
  assert.equal(forecast.models.triple.pick,'away');
  assert.equal(forecast.models.sor.homeWinProbability,1/(1+Math.exp(-.2)));
  const home=observation.rows.find(row=>row.id===forecast.home),away=observation.rows.find(row=>row.id===forecast.away);
  const sum=['sor','strength','performance'].reduce((total,key)=>total+home.indices[key]-away.indices[key],0)/3;
  assert.ok(Math.abs(sum-forecast.models.triple.indexDifference)<1e-12);
  assert.equal(observation.resultSha256,blendObservationHash(observation));
  assert.equal(JSON.stringify(input),before);
});

test('snapshot/source/model/calibration mismatch fail closed',()=>{
  const mutations=[
    input=>{input.implementationHashes[IMPLEMENTATION_PATHS[0]]=hash('changed');},
    input=>{input.performance.baseSnapshotHash=hash('other');repack(input);},
    input=>{input.performance.method.configuration.ridge=2;repack(input);},
    input=>{input.season.source.sha256=hash('other');repack(input);},
    input=>{input.season.games[0].homePoints=22;repack(input);},
    input=>{input.snapshot.config.marginCap=30;repack(input);},
    input=>{delete input.protocol.calibration.models.triple;},
    input=>{input.season.games[0].completed=false;repack(input);},
  ];
  for(const [index,mutate] of mutations.entries()){const input=fixture();mutate(input);assert.throws(()=>makeBlendObservation(input),undefined,'Mutation '+index);}
});

test('capture requires actual time after freeze, source and Performance generation',()=>{
  const input=fixture();input.recordedAt='2026-09-06T12:00:01Z';
  assert.throws(()=>makeBlendObservation(input),/capture precedes/);
  const frozen=fixture();frozen.protocol.frozenAt='2026-09-07T00:00:00Z';
  assert.throws(()=>makeBlendObservation(frozen),/capture precedes/);
});

test('seven-day boundary is included and unfinished FCS games are excluded',()=>{
  const input=fixture();input.season.games.find(row=>row.id==='future').startDate='2026-09-13T12:00:02Z';repack(input);
  assert.equal(makeBlendObservation(input).forecasts.length,1);
  input.season.games.find(row=>row.id==='future').startDate='2026-09-13T12:00:02.001Z';repack(input);
  assert.equal(makeBlendObservation(input).forecasts.length,0);
});

test('missing measured team is unavailable, never zero-filled',()=>{
  const input=fixture();const row=input.performance.rankings[0];
  row.measuredGames=0;row.expectedGames=0;row.rank=null;row.score=null;input.performance.coverage.measuredFbsTeams--;
  repack(input);
  assert.throws(()=>makeBlendObservation(input),/Performance snapshot/);
});

test('immutable persistence and idempotent reruns preserve actual original capture time',async()=>{
  const input=fixture();const directory=await mkdtemp(join(tmpdir(),'fbs-blend-capture-'));
  const clock=()=>Date.parse(input.recordedAt);
  const first=await recordBlendObservation({...input,recordedAt:'2026-08-01T00:00:00Z'},{directory,clock});
  assert.equal(first.observation.forecastCapturedAt,input.recordedAt);
  const bytes=await readFile(first.path,'utf8');
  const second=await recordBlendObservation(input,{directory,clock:()=>Date.parse('2026-09-09T00:00:00Z')});
  assert.equal(second.observation.forecastCapturedAt,input.recordedAt);
  assert.equal(await readFile(first.path,'utf8'),bytes);
  const corrupted=JSON.parse(bytes);corrupted.forecasts[0].models.triple.indexDifference=999;
  await writeFile(first.path,JSON.stringify(corrupted));
  await assert.rejects(()=>recordBlendObservation(input,{directory,clock}),/checksum/);
});

test('a capture crossing kickoff while writing is removed; existing history is retained',async()=>{
  const input=fixture();const observation=makeBlendObservation(input);
  const directory=await mkdtemp(join(tmpdir(),'fbs-blend-kickoff-'));
  let calls=0;
  await assert.rejects(()=>persistBlendObservation(observation,{directory,clock:()=>++calls===1?Date.parse(input.recordedAt):Date.parse(observation.forecasts[0].kickoff)}),/kickoff failed/);
  assert.deepEqual(await readdir(directory),[]);
  const first=await persistBlendObservation(observation,{directory,clock:()=>Date.parse(input.recordedAt)});
  const before=await readFile(first.path,'utf8');
  await persistBlendObservation(observation,{directory,clock:()=>Date.parse('2026-10-01T00:00:00Z')});
  assert.equal(await readFile(first.path,'utf8'),before);
});

test('different calculated evidence cannot replace a previously frozen record',async()=>{
  const input=fixture(),directory=await mkdtemp(join(tmpdir(),'fbs-blend-immutable-'));
  await recordBlendObservation(input,{directory,clock:()=>Date.parse(input.recordedAt)});
  input.performance.rankings[0].score+=1;repack(input);
  await assert.rejects(()=>recordBlendObservation(input,{directory,clock:()=>Date.parse(input.recordedAt)}),/refusing to rewrite/);
});

test('a persisted capture is scored unchanged when a later refresh confirms its future result',async()=>{
  const input=fixture(), directory=await mkdtemp(join(tmpdir(),'fbs-blend-two-refreshes-'));
  const saved=await recordBlendObservation(input,{directory,clock:()=>Date.parse(input.recordedAt)});
  const bytes=await readFile(saved.path,'utf8');
  const season=structuredClone(input.season);
  const game=season.games.find(row=>row.id==='future');
  Object.assign(game,{completed:true,homePoints:28,awayPoints:17});
  season.source.sha256=hash('later-confirmed-result');
  const report=evaluateBlendForecasts({observations:[JSON.parse(bytes)],season,
    asOf:'2026-09-09T12:00:00Z',generatedAt:'2026-09-09T12:01:00Z',
    protocol:input.protocol,implementationHashes:input.implementationHashes});
  assert.equal(report.scores.primary.games,1);
  assert.equal(report.evaluated[0].gameId,'future');
  assert.equal(Object.keys(report.scores.primary.models).length,7);
  assert.equal(report.evaluated[0].observationSha256,saved.observation.resultSha256);
  assert.equal(await readFile(saved.path,'utf8'),bytes);
});
