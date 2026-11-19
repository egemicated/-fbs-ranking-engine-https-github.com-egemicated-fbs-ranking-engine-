import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { compactSorPublication, addSorPublication, validateSorPublication, sorPublicationAvailability } from '../src/sor-history-publications.js';
import { buildConferenceDataset } from '../src/conference-publication.js';
import { conferenceFilterCoverage } from '../frontend/conference-metrics.js';

const edition = {kind:'saved',asOf:'2026-11-08T15:00:00Z',modelId:'division-sor-v2',snapshotHash:'a'.repeat(64),
  publicationHash:'b'.repeat(64),rows:[{id:'one',rank:1},{id:'two',rank:2}]};
const capture = (value=edition,recordedAt='2026-11-08T16:00:00Z') => compactSorPublication(value,{recordedAt,source:{basis:'pipeline-recorded snapshot'}});

test('saved SOR availability follows the actual recording day, including Mountain daylight saving changes',()=>{
  assert.equal(sorPublicationAvailability('2026-11-01T08:30:00Z'),'2026-11-02T07:00:00.000Z');
  assert.equal(sorPublicationAvailability('2026-03-08T07:30:00Z'),'2026-03-09T06:00:00.000Z');
  assert.equal(capture().availableBefore,'2026-11-09T07:00:00.000Z');
  const late=capture(edition,'2026-11-12T16:00:00Z');
  assert.equal(late.availableBefore,'2026-11-13T07:00:00.000Z','an older source cutoff cannot backdate a late capture');
  assert.throws(()=>sorPublicationAvailability('2026-11-08'),/explicit timestamp/);
  assert.throws(()=>capture(edition,'2026-11-07T16:00:00Z'),/recorded saved/);
  assert.throws(()=>capture({...edition,kind:'replay'}),/recorded saved/);
});

test('the compact saved-publication ledger is idempotent and rejects conflicting ranks, time bounds and identity claims',()=>{
  const first=capture();
  const ledger=addSorPublication([],first);
  assert.deepEqual(addSorPublication(ledger,capture(edition,'2026-11-09T16:00:00Z')),ledger);
  const changed=capture({...edition,rows:[{id:'one',rank:2},{id:'two',rank:1}]});
  assert.throws(()=>addSorPublication(ledger,changed),/Conflicting saved/);
  assert.throws(()=>addSorPublication([first,first],capture()),/Duplicate saved/);
  assert.throws(()=>validateSorPublication({...first,availableBefore:'2026-11-08T00:00:00Z'}),/hash or availability/);
  assert.throws(()=>validateSorPublication({...first,rows:[{id:'one',rank:1}]}),/hash or availability/);
  assert.throws(()=>capture({...edition,rows:[{id:'one',rank:1},{id:'one',rank:2}]}),/identities/);
  assert.throws(()=>compactSorPublication(edition,{recordedAt:'2026-11-08T16:00:00Z',source:{basis:'repository-recorded snapshot',commit:'invalid'}}),/repository SOR/);
});

const read=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));
const inputs=Promise.all(['published/latest.json','published/weekly-picks.json','published/performance-latest.json','frontend/ranking-history.json','frontend/ranking-editions.json'].map(read))
  .then(([snapshot,fbsPicks,performance,rankingHistory,rankingEditions])=>({snapshot,fbsPicks,performance,rankingHistory,rankingEditions}));

test('recovered repository observations preserve genuine coverage and distinguish the pre-archive gap from lost rankings',async t=>{
  const input=await inputs;
  if(input.snapshot.season!==2026)return t.skip('Retained November 2026 publication fixture');
  const proof=await read('reports/sor-publication-recovery-2026-11-19.json');
  const hashes=new Set(proof.sourceCaptures.map(row=>row.publicationHash));
  const recovered=input.rankingHistory.publications.filter(row=>hashes.has(row.publicationHash));
  assert.equal(recovered.length,8);
  assert.ok(recovered.every(row=>row.source.basis==='repository-recorded snapshot'&&row.rows.length===138));
  const data=buildConferenceDataset({...input,fbsPicks:{...input.fbsPicks,games:input.fbsPicks.games.filter(game=>Date.parse(game.startDate)<=Date.parse('2026-11-18T12:30:09.923Z'))}}),coverage=conferenceFilterCoverage(data,{method:'sor'});
  assert.deepEqual([coverage.games,coverage.pregame,coverage.beforeArchive,coverage.missing],[179,2,177,0]);
  const target=data.games.find(game=>game.id==='401861967');
  assert.equal(target.pregameAsOf.sor,'2026-11-13T18:30:36.573Z','uses a retained later weekday capture, not the overwritten weekly edition');
  assert.equal(target.pregameEdition.sor.provenance,'repository-recorded snapshot');
  for(const game of data.games)if(game.pregameEdition?.sor)assert.ok(Date.parse(game.pregameEdition.sor.availableBefore)<Date.parse(game.startDate));
});

test('same-boundary and unconfirmed kickoffs cannot use later saved SOR evidence',async t=>{
  const input=await inputs;
  if(input.snapshot.season!==2026)return t.skip('Retained November 2026 publication fixture');
  const first=input.rankingHistory.publications.find(row=>row.publicationHash==='7f16a93d77c5cd85a164718615c089b95edc5c392542205eeb111953fd26d34b');
  const changed=(startDate,startTimeTbd=false)=>buildConferenceDataset({...input,fbsPicks:{...input.fbsPicks,games:input.fbsPicks.games.map(game=>
    game.id==='401861967'?{...game,startDate,startTimeTbd}:game)}}).games.find(game=>game.id==='401861967');
  assert.equal(changed(first.availableBefore).pregame.sor,undefined);
  assert.ok(changed(new Date(Date.parse(first.availableBefore)+60000).toISOString()).pregame.sor);
  assert.equal(changed(new Date(Date.parse(first.availableBefore)+60000).toISOString(),true).pregame.sor,undefined);
});
