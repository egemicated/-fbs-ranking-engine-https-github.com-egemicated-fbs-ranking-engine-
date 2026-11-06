import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rankSeason } from '../src/engine.js';
import { outcomeDataset, publishDivisionSnapshot, readPublicationPolicy } from '../src/publication.js';
import { makeObservation, IMPLEMENTATION_PATHS as LEGACY_IMPLEMENTATION_PATHS } from '../scripts/record-research-comparison.js';
import { makeDivisionObservation, IMPLEMENTATION_PATHS as DIVISION_IMPLEMENTATION_PATHS } from '../scripts/record-division-comparison.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
const policy=JSON.parse(await readFile(new URL('../data/publication-model.json',import.meta.url),'utf8'));
const asOf='2026-11-06T03:39:55.757Z';
const publishedAt='2026-11-06T20:00:00.000Z';

function snapshotFixture({symmetric=false,homeAdvantage=2.5}={}) {
  const teams=[
    {id:'a',name:'A',division:'fbs',conference:'Example'},
    {id:'b',name:'B',division:'fbs',conference:'Example'},
    {id:'c',name:'C',division:'fcs',conference:'Other'},
    {id:'idle',name:'Idle',division:'fbs',conference:'Example'},
    {id:'x',name:'Context',division:'unknown',conference:'Other'}
  ];
  const game=(id,home,away,homePoints,awayPoints,neutral=false,extra={})=>({id,home,away,homePoints,awayPoints,neutral,completed:true,
    week:10,seasonType:'regular',startDate:`2026-11-0${id==='g2'?2:1}T18:00:00Z`,...extra});
  const games=symmetric?[game('g1','a','c',21,7,true),game('g2','b','c',21,7,true)]:[
    game('g1','a','b',21,7),
    game('g2','b','a',10,13),
    // Confirmed OT: final margin and adjusted margin use different signals.
    game('g3','c','a',14,21,false,{regulationMargin:0}),
    // Zero-outcome indirect context must stay in the existing graph.
    game('g4','c','x',6,6,true)
  ];
  const source={provider:'cfbd',sha256:sha('fixture-source'),fetchedAt:'2026-11-06T03:39:54.774Z'};
  const snapshot=rankSeason({year:2026,teams,games,source},{config:{ridge:3,retention:.75,homeAdvantage,marginCap:28,probabilityScale:14}});
  return {...snapshot,asOf,update:{lastSuccessfulUpdate:asOf,apiCallsThisUpdate:2}};
}

function fromTeam(game,id) {
  assert.ok(game.a===id||game.b===id);
  return {opponent:game.a===id?game.b:game.a,outcome:game.outcome*(game.a===id?1:-1),venue:game.venue*(game.a===id?1:-1)};
}

test('publication reconstructs exactly one edge per paired game, including rematches and OT venue',()=>{
  const snapshot=snapshotFixture(),original=structuredClone(snapshot),dataset=outcomeDataset(snapshot);
  assert.deepEqual(snapshot,original);
  assert.equal(dataset.teams.length,snapshot.ratings.length);
  assert.equal(dataset.games.length,4);
  const games=new Map(dataset.games.map(g=>[g.id,g]));
  assert.equal(games.size,4);
  assert.deepEqual(fromTeam(games.get('g1'),'a'),{opponent:'b',outcome:1,venue:1});
  assert.deepEqual(fromTeam(games.get('g2'),'a'),{opponent:'b',outcome:1,venue:-1});
  assert.deepEqual(fromTeam(games.get('g3'),'a'),{opponent:'c',outcome:1,venue:-1});
  assert.equal(games.get('g4').outcome,0);
  assert.equal(games.get('g4').venue,0);
});

test('publication rejects incomplete, duplicated or inconsistent paired evidence and wrong game counts',()=>{
  for(const corrupt of [
    s=>s.ratings.find(t=>t.id==='b').contributions.splice(0,1),
    s=>s.ratings.find(t=>t.id==='a').contributions.push(structuredClone(s.ratings.find(t=>t.id==='a').contributions[0])),
    s=>{s.ratings.find(t=>t.id==='b').contributions[0].adjustedMargin+=.2;},
    s=>{s.ratings.find(t=>t.id==='b').contributions[0].finalMargin+=1;},
    s=>{s.gamesUsed+=1;}
  ]) {
    const snapshot=structuredClone(snapshotFixture());corrupt(snapshot);
    assert.throws(()=>outcomeDataset(snapshot));
  }
  // A zero venue adjustment loses the information needed to recover location.
  assert.throws(()=>outcomeDataset(snapshotFixture({homeAdvantage:0})));
});

test('publication preserves every existing rating field, records, strength and original data timestamps',()=>{
  const snapshot=snapshotFixture(),original=structuredClone(snapshot);
  const published=publishDivisionSnapshot(snapshot,policy,{publishedAt});
  assert.deepEqual(snapshot,original);
  assert.equal(published.asOf,original.asOf);
  assert.deepEqual(published.source,original.source);
  assert.equal(published.snapshotHash,original.snapshotHash);
  assert.equal(published.modelPublishedAt,publishedAt);
  assert.equal(published.rankingMethod.id??published.rankingMethod.modelId,policy.id);
  assert.match(published.publicationHash,/^[a-f0-9]{64}$/);
  assert.equal(published.ratings.length,original.ratings.length);
  assert.equal(published.rankings.length,original.rankings.length);
  for(const row of original.ratings) {
    const after=published.ratings.find(t=>t.id===row.id);
    for(const [key,value] of Object.entries(row))assert.deepEqual(after[key],value,`${row.id}: original ${key} changed`);
  }
  for(const row of published.rankings.filter(t=>t.games)) {
    assert.equal(row.displayRank,row.sorRank);
    assert.equal(row.colleyRank,row.rank);
    assert.equal(row.strengthOfRecord.score,row.sor);
    assert.equal(row.strengthOfRecord.tailProbability,row.sorTailProbability);
    assert.equal(row.strengthOfRecord.expectedWins,row.sorExpectedWins);
    assert.ok(row.sorTailProbability>0&&row.sorTailProbability<=1);
    assert.ok(Math.abs(row.sor+Math.log10(row.sorTailProbability))<1e-10);
  }
  const active=published.rankings.filter(t=>t.games);
  assert.deepEqual(active.map(t=>t.sor),[...active].sort((a,b)=>b.sor-a.sor).map(t=>t.sor));
  const idle=published.rankings.find(t=>t.id==='idle');
  assert.equal(idle.displayRank,null);
  assert.equal(idle.sorRank,null);
});

test('publication has shared SOR ranks and conference ranks for symmetric records',()=>{
  const result=publishDivisionSnapshot(snapshotFixture({symmetric:true}),policy,{publishedAt});
  const a=result.rankings.find(t=>t.id==='a'),b=result.rankings.find(t=>t.id==='b');
  assert.ok(Math.abs(a.sor-b.sor)<1e-9);
  assert.equal(a.displayRank,b.displayRank);
  assert.equal(a.displayConferenceRank,b.displayConferenceRank);
  assert.equal(a.displayRank,1);
});

test('publication checksum is stable across wall clocks and changes with mathematical policy identity',()=>{
  const snapshot=snapshotFixture();
  const first=publishDivisionSnapshot(snapshot,policy,{publishedAt});
  // Render rebuilds also receive snapshots already promoted by Sunday's job.
  assert.deepEqual(publishDivisionSnapshot(first,policy),first);
  const later=publishDivisionSnapshot(snapshot,policy,{publishedAt:'2026-11-07T20:00:00.000Z'});
  assert.equal(first.publicationHash,later.publicationHash);
  assert.notEqual(first.modelPublishedAt,later.modelPublishedAt);
  const changed={...policy,id:`${policy.id}-test-version`};
  assert.notEqual(first.publicationHash,publishDivisionSnapshot(snapshot,changed,{publishedAt}).publicationHash);
});

test('publication rejects unknown direct opponents and FBS-involving ties without a fallback model',()=>{
  const unknown=structuredClone(snapshotFixture());
  unknown.ratings.find(t=>t.id==='c').division='unknown';
  assert.throws(()=>publishDivisionSnapshot(unknown,policy,{publishedAt}));
  const tied={...rankSeason({year:2026,source:unknown.source,
    teams:[{id:'a',name:'A',division:'fbs',conference:'Example'},{id:'b',name:'B',division:'fbs',conference:'Example'}],
    games:[{id:'tie',home:'a',away:'b',homePoints:7,awayPoints:7,neutral:true,completed:true,
      week:10,seasonType:'regular',startDate:'2026-11-01T18:00:00Z'}]}),asOf};
  assert.throws(()=>publishDivisionSnapshot(tied,policy,{publishedAt}));
});

test('all 138 promoted ranks and scores reproduce the independently reviewed historical research baseline',async()=>{
  const archivedBytes=await readFile(new URL('../published/archive/colley-2026-11-06.json',import.meta.url));
  const snapshot=JSON.parse(archivedBytes);
  const golden=JSON.parse(await readFile(new URL('./fixtures/division-promotion-baseline.json',import.meta.url),'utf8'));
  const candidate=JSON.parse(await readFile(new URL(`../${policy.candidateProtocolPath}`,import.meta.url),'utf8'));
  assert.equal(snapshot.snapshotHash,golden.baseSnapshotHash);
  assert.equal(golden.parentReportSha256,candidate.researchReportSha256);
  const actual=publishDivisionSnapshot(snapshot,policy,{publishedAt});
  assert.equal(actual.rankings.length,138);assert.equal(actual.ratings.length,716);assert.equal(actual.gamesUsed,2842);
  assert.equal(golden.rows.length,138);
  const expected=new Map(golden.rows.map(row=>[row.id,row]));
  for(const row of actual.rankings) {
    assert.ok(expected.has(row.id),`Unexpected published team ${row.id}`);
    assert.equal(row.displayRank,expected.get(row.id).displayRank,`${row.name}: research rank differs`);
    assert.ok(Math.abs(row.sor-expected.get(row.id).sor)<1e-8,`${row.name}: research SOR differs`);
    const old=snapshot.rankings.find(t=>t.id===row.id);
    for(const key of ['wins','losses','ties','games','rank','achievement','strength','preseasonStrength'])assert.equal(row[key],old[key],`${row.name}: baseline ${key} differs`);
  }
  assert.equal(sha(JSON.stringify(snapshot)),sha(JSON.stringify(JSON.parse(archivedBytes))));
});

test('promoted weekly snapshots remain compatible with both frozen observations and their retained-evidence checksums',async()=>{
  const sunday='2026-11-08T15:00:00.000Z',source={provider:'cfbd',sha256:sha('publication-bridge-source'),fetchedAt:'2026-11-08T14:59:00.000Z'};
  const season={year:2026,source,teams:[{id:'a',name:'A',division:'fbs',conference:'Example'},
    {id:'b',name:'B',division:'fbs',conference:'Example'},{id:'c',name:'C',division:'fcs',conference:'Other'}],games:[
    {id:'g1',home:'a',away:'b',homePoints:21,awayPoints:7,neutral:false,completed:true,week:10,seasonType:'regular',startDate:'2026-11-01T18:00:00Z'},
    {id:'g2',home:'b',away:'c',homePoints:35,awayPoints:0,neutral:true,completed:true,week:10,seasonType:'regular',startDate:'2026-11-01T18:00:00Z'},
    {id:'future',home:'a',away:'c',homePoints:null,awayPoints:null,neutral:false,completed:false,week:11,seasonType:'regular',startDate:'2026-11-14T18:00:00Z'}]};
  const snapshot=publishDivisionSnapshot({...rankSeason(season),asOf:sunday},policy,{publishedAt:'2026-11-08T15:00:01.000Z'});
  const normalizedBytes=Buffer.from(JSON.stringify(season)),snapshotBytes=Buffer.from(JSON.stringify(snapshot));
  const sourceEvidence={status:'validated',snapshotHash:snapshot.snapshotHash,files:[
    {name:'normalized-season.json',sha256:sha(normalizedBytes)},{name:'snapshot.json',sha256:sha(snapshotBytes)},
    {name:'provider-responses.json',sha256:sha('fixture-provider-body')}]};
  const common={season,snapshot,sourceEvidence,normalizedBytes,snapshotBytes,recordedAt:'2026-11-08T15:00:02.000Z'};
  const hashes=paths=>Promise.all(paths.map(async path=>[path,sha(await readFile(new URL(`../${path}`,import.meta.url)))]));
  const legacyProtocol=JSON.parse(await readFile(new URL('../research/frozen-comparison.json',import.meta.url),'utf8'));
  const divisionProtocol=JSON.parse(await readFile(new URL(`../${policy.candidateProtocolPath}`,import.meta.url),'utf8'));
  const legacy=makeObservation({...common,protocol:legacyProtocol,implementationHashes:Object.fromEntries(await hashes(LEGACY_IMPLEMENTATION_PATHS))});
  const division=makeDivisionObservation({...common,protocol:divisionProtocol,implementationHashes:Object.fromEntries(await hashes(DIVISION_IMPLEMENTATION_PATHS))});
  assert.equal(legacy.rows.length,2);assert.equal(division.rows.length,2);
  assert.equal(legacy.phase,'post-freeze-publication');assert.equal(division.phase,'post-freeze-publication');
  for(const row of snapshot.rankings) {
    assert.equal(legacy.rows.find(r=>r.id===row.id).colleyRank,row.rank);
    assert.equal(division.rows.find(r=>r.id===row.id).colleyRank,row.rank);
    assert.equal(division.rows.find(r=>r.id===row.id).sorRank,row.displayRank);
    assert.ok(Math.abs(division.rows.find(r=>r.id===row.id).sor-row.sor)<1e-10);
  }
  assert.deepEqual(division.forecasts.map(f=>f.gameId),['future']);
  assert.equal(division.forecasts[0].phase,'post-freeze-saved-before-kickoff');
  const corrupted={...common,sourceEvidence:{...sourceEvidence,files:sourceEvidence.files.map(f=>f.name==='snapshot.json'?{...f,sha256:sha('wrong-snapshot')}:f)},
    protocol:divisionProtocol,implementationHashes:Object.fromEntries(await hashes(DIVISION_IMPLEMENTATION_PATHS))};
  assert.throws(()=>makeDivisionObservation(corrupted),/checksums/);
});

test('active publication policy verifies numerical implementation and frozen protocol checksums before use',async()=>{
  assert.deepEqual(await readPublicationPolicy(),policy);
  const directory=await mkdtemp(join(tmpdir(),'fbs-publication-policy-')),path=join(directory,'policy.json');
  const badImplementation=structuredClone(policy);badImplementation.implementationSha256['src/engine.js']=sha('changed-implementation');
  await writeFile(path,JSON.stringify(badImplementation));
  await assert.rejects(readPublicationPolicy(path),/Publication implementation changed/);
  const badProtocol={...policy,candidateProtocolSha256:sha('changed-protocol')};
  await writeFile(path,JSON.stringify(badProtocol));
  await assert.rejects(readPublicationPolicy(path),/Publication candidate protocol changed/);
});
