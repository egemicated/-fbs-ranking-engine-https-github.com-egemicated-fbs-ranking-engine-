import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rankSeason } from '../src/engine.js';
import { atomicJson } from '../src/ingest.js';
import { makeObservation,persistObservation,IMPLEMENTATION_PATHS } from '../scripts/record-research-comparison.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const source={provider:'cfbd',sha256:'fixture-source',fetchedAt:'2026-09-06T12:00:00Z'};
  const season={year:2026,source,teams:['a','b'].map(id=>({id,name:id,division:'fbs',conference:'X'})),games:[
    {id:'g',home:'a',away:'b',homePoints:21,awayPoints:7,completed:true,neutral:true,startDate:'2026-09-05T12:00:00Z',week:1,seasonType:'regular'}]};
  const snapshot={...rankSeason(season),asOf:'2026-09-06T12:00:01Z'};
  const normalizedBytes=Buffer.from(JSON.stringify(season)),snapshotBytes=Buffer.from(JSON.stringify(snapshot));
  const implementationHashes=Object.fromEntries(IMPLEMENTATION_PATHS.map(p=>[p,'fixed-code']));
  const protocol={id:'fixture-v1',frozenAt:'2026-08-01T00:00:00Z',implementationSha256:implementationHashes,parameters:{slope:4.2967562253807925,homeLogOdds:0.47455471946025424}};
  const sourceEvidence={status:'validated',snapshotHash:snapshot.snapshotHash,files:[{name:'normalized-season.json',sha256:hash(normalizedBytes)},{name:'snapshot.json',sha256:hash(snapshotBytes)},{name:'provider-responses.json',sha256:'raw'}]};
  return {season,snapshot,normalizedBytes,snapshotBytes,implementationHashes,protocol,sourceEvidence,recordedAt:'2026-09-06T12:00:02Z'};
}

test('frozen observation uses the identical game set and labels collection separately from forecasts',()=>{
  const input=fixture(),original=JSON.stringify(input.snapshot);const r=makeObservation(input);
  assert.equal(r.phase,'post-freeze-publication');assert.equal(r.rows.length,2);assert.equal(r.rows[0].colleyRank,1);
  assert.equal(JSON.stringify(input.snapshot),original);assert.match(r.interpretation,/not a pregame forecast/);
  input.season.games.push({...input.season.games[0],id:'extra',startDate:'2026-09-04T12:00:00Z'});
  assert.throws(()=>makeObservation(input),/game set differs/);
});

test('committed frozen protocol pins the actual numerical implementation',async()=>{
  const protocol=JSON.parse(await readFile('research/frozen-comparison.json','utf8'));
  for(const path of IMPLEMENTATION_PATHS)assert.equal(hash(await readFile(path)),protocol.implementationSha256[path],path);
  assert.equal(protocol.parameters.slope,4.2967562253807925);
  assert.equal(protocol.parameters.homeLogOdds,0.47455471946025424);
});

test('changed implementation or mismatched retained evidence blocks the research observation',()=>{
  const input=fixture();input.implementationHashes={...input.implementationHashes,[IMPLEMENTATION_PATHS[0]]:'changed'};
  assert.throws(()=>makeObservation(input),/Frozen implementation changed/);
  const other=fixture();other.sourceEvidence.files[0].sha256='wrong';
  assert.throws(()=>makeObservation(other),/checksums/);
  const retro=fixture();retro.protocol={...retro.protocol,frozenAt:'2026-10-01T00:00:00Z'};
  assert.equal(makeObservation(retro).phase,'retrospective-baseline');
});

test('observations persist with checksums and refuse rewritten numeric history',async()=>{
  const input=fixture(),r=makeObservation(input),root=await mkdtemp(join(tmpdir(),'fbs-research-observation-'));
  const paths={directory:join(root,'observations'),evidenceDirectory:join(root,'evidence')};
  await atomicJson(join(paths.evidenceDirectory,'manifest.json'),input.sourceEvidence);
  const first=await persistObservation(r,paths);const bytes=await readFile(first.path,'utf8');
  await persistObservation({...r,recordedAt:'2026-09-07T00:00:00Z'},paths);
  assert.equal(await readFile(first.path,'utf8'),bytes);
  const manifest=JSON.parse(await readFile(join(paths.evidenceDirectory,'manifest.json'),'utf8'));
  assert.equal(manifest.files.at(-1).name,'research-comparison.json');
  assert.equal(manifest.files.at(-1).sha256,hash(await readFile(join(paths.evidenceDirectory,'research-comparison.json'))));
  await assert.rejects(persistObservation({...r,resultSha256:'different-result'},paths),/refusing to rewrite/);
});
