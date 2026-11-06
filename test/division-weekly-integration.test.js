import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rankSeason } from '../src/engine.js';
import { atomicJson } from '../src/ingest.js';
import { makeDivisionObservation,recordDivisionObservation,IMPLEMENTATION_PATHS } from '../scripts/record-division-comparison.js';
import { evaluateForecasts } from '../research/evaluate_division_forecasts.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('two weekly checkpoints preserve the first forecast, then score a confirmed result without provider access',async()=>{
  const protocol=JSON.parse(await readFile('research/frozen-division-comparison-v2.json','utf8'));
  const implementationHashes=Object.fromEntries(await Promise.all(IMPLEMENTATION_PATHS.map(async p=>[p,sha(await readFile(p))])));
  const source={provider:'cfbd',sha256:sha('fixture-first-source'),fetchedAt:'2026-11-08T14:59:00Z'};
  const season={year:2026,source,teams:[{id:'a',name:'A',division:'fbs',conference:'Example'},{id:'b',name:'B',division:'fbs',conference:'Example'},{id:'c',name:'C',division:'fcs',conference:'Example'}],games:[
    {id:'g1',home:'a',away:'b',startDate:'2026-11-01T18:00:00Z',completed:true,homePoints:21,awayPoints:7,neutral:false,week:10,seasonType:'regular'},
    {id:'g2',home:'b',away:'c',startDate:'2026-11-14T18:00:00Z',completed:false,homePoints:null,awayPoints:null,neutral:false,week:11,seasonType:'regular'}]};
  const snapshot={...rankSeason(season),asOf:'2026-11-08T15:00:00Z'};
  const normalizedBytes=Buffer.from(JSON.stringify(season)),snapshotBytes=Buffer.from(JSON.stringify(snapshot));
  const sourceEvidence={status:'validated',snapshotHash:snapshot.snapshotHash,files:[{name:'normalized-season.json',sha256:sha(normalizedBytes)},{name:'snapshot.json',sha256:sha(snapshotBytes)},{name:'provider-responses.json',sha256:sha('fixture-raw')}],researchComparison:{protocolId:'sor-colley-v1'}};
  const input={season,snapshot,protocol,sourceEvidence,implementationHashes,normalizedBytes,snapshotBytes,recordedAt:'2026-11-08T15:00:01Z'};
  const observed=makeDivisionObservation(input);assert.equal(observed.forecasts.length,1);assert.equal(observed.controlRows.length,observed.rows.length);
  const root=await mkdtemp(join(tmpdir(),'division-weekly-integration-')),paths={directory:join(root,'observations'),evidenceDirectory:join(root,'evidence'),clock:()=>Date.parse('2026-11-08T15:00:03Z')};
  await atomicJson(join(paths.evidenceDirectory,'manifest.json'),sourceEvidence);
  const first=await recordDivisionObservation(input,paths);
  const again=await recordDivisionObservation({...input,recordedAt:'2026-11-15T15:00:00Z'},paths);
  assert.equal(again.observation.forecastCapturedAt,first.observation.forecastCapturedAt);
  const next=structuredClone(season);next.source={...source,sha256:sha('fixture-result-source'),fetchedAt:'2026-11-15T14:59:00Z'};
  next.games[1]={...next.games[1],completed:true,homePoints:35,awayPoints:7};
  const evaluated=evaluateForecasts({observations:[again.observation],season:next,asOf:'2026-11-15T15:00:00Z'});
  assert.equal(evaluated.evaluated.length,1);assert.equal(evaluated.scoresByModel[protocol.id].fbsVsFcs.games,1);
  assert.equal(evaluated.evaluated[0].homeWinProbability,observed.forecasts[0].homeWinProbability);
  const manifest=JSON.parse(await readFile(join(paths.evidenceDirectory,'manifest.json'),'utf8'));
  assert.equal(manifest.researchComparison.protocolId,'sor-colley-v1');
});
test('frozen evaluator pin and existing weekly fetch/schedule are preserved',async()=>{
  const protocol=JSON.parse(await readFile('research/frozen-division-comparison-v2.json','utf8'));
  const path='research/evaluate_division_forecasts.mjs';assert.equal(protocol.evaluationImplementationSha256[path],sha(await readFile(path)));
  const workflow=await readFile('.github/workflows/weekly.yml','utf8');
  assert.match(workflow,/cron: '0 8 \* \* 0'/);assert.match(workflow,/timezone: 'America\/Denver'/);
  assert.equal((workflow.match(/run: node scripts\/refresh-weekly.js/g)??[]).length,1);
  assert.match(workflow,/git add research\/division-observations\//);
});
