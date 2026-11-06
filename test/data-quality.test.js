import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { logicalDuplicateGroups, assertNoLogicalDuplicates, DataQualityError,quarantineConfirmedCancellations } from '../src/data-quality.js';
import { normalizeCfbd, normalizeCsv } from '../src/ingest.js';
import { saveEvidence } from '../src/evidence.js';

const game = (id, date = '2026-09-05T12:00:00Z') => ({ id, home: 'a', away: 'b', homePoints: 21, awayPoints: 7, completed: true, neutral: false, startDate: date });

test('confirmed canceled zero-zero slots are quarantined while ties, rematches and uncertain records survive',()=>{
  const canceled={...game('401908594','2026-10-10T18:00:00Z'),home:'2967',away:'2972',homePoints:0,awayPoints:0};
  assert.equal(quarantineConfirmedCancellations([canceled],2026).games[0].completed,false);
  for(const valid of [{...canceled,id:'401907138',home:'2146',away:'2687',homePoints:16,awayPoints:16},
                     {...canceled,startDate:'2026-10-31T18:00:00Z'},
                     {...canceled,id:'401908619',home:'110',away:'2909'},
                     {...canceled,homePoints:14,awayPoints:0}]) {
    assert.equal(quarantineConfirmedCancellations([valid],2026).games[0].completed,true);
  }
  assert.equal(quarantineConfirmedCancellations([canceled],2025).games[0].completed,true);
});

test('CFBD ingestion records the narrow cancellation correction in its source audit',()=>{
  const raw={id:401907150,season:2026,week:1,seasonType:'regular',startDate:'2026-08-29T18:00:00Z',completed:true,neutralSite:false,
    homeId:2911,awayId:2237,homeTeam:'William Jewell',awayTeam:'Fort Lewis',homePoints:0,awayPoints:0,homeClassification:'ii',awayClassification:'ii'};
  const season=normalizeCfbd([raw],[],2026);
  assert.equal(season.games[0].completed,false);
  assert.equal(season.source.audit.confirmedCanceledRecords[0].id,'401907150');
  assert.equal(season.source.audit.inputPolicyVersion,'quality-1.1');
});

test('logical duplicate detection ignores provider IDs, kickoff offsets and home/away encoding', () => {
  const first = game('one'), other = { ...game('two', '2026-09-05T13:00:00-06:00'), home: 'b', away: 'a', homePoints: 7, awayPoints: 21 };
  const groups = logicalDuplicateGroups([first, other]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].scoreConflict, false);
  assert.throws(() => assertNoLogicalDuplicates([first, other]), DataQualityError);
});

test('conflicting duplicate scores and venues require review; rematches on later dates survive', () => {
  const first = game('one'), conflict = { ...game('two'), homePoints: 28, neutral: true };
  const [group] = logicalDuplicateGroups([first, conflict]);
  assert.equal(group.scoreConflict, true); assert.equal(group.venueConflict, true);
  assert.deepEqual(logicalDuplicateGroups([first, game('three', '2026-12-05T12:00:00Z')]), []);
  assert.deepEqual(logicalDuplicateGroups([first, { ...conflict, completed: false }]), []);
});

test('CFBD normalizer blocks ambiguous duplicates before they can reach a ranking', () => {
  const raw = [game(1), game(2, '2026-09-05T19:00:00Z')].map(g => ({ ...g, season: 2026, seasonType: 'regular', week: 1,
    homeId: g.home, awayId: g.away, homeTeam: 'A', awayTeam: 'B', homeClassification: 'fbs', awayClassification: 'fbs', neutralSite: false }));
  assert.throws(() => normalizeCfbd(raw, [], 2026), error => error instanceof DataQualityError && error.audit.logicalDuplicates[0].ids.length === 2);
});

test('historical CSV audit exposes timestamp-shifted duplicates without silently adjudicating venue', () => {
  const header = 'game_id,season,week,season_type,start_date,completed,neutral_site,home_id,home_team,home_division,home_conference,home_points,away_id,away_team,away_division,away_conference,away_points';
  const row = 'one,2026,1,regular,2026-09-05T12:00:00Z,TRUE,FALSE,a,A,fbs,X,21,b,B,fbs,Y,7';
  const other = row.replace(/^one,/, 'two,').replace('12:00:00Z', '19:00:00Z');
  const data = normalizeCsv([header,row,other].join('\n'), 2026);
  assert.equal(data.source.audit.logicalDuplicates.length, 1);
});

test('evidence contains only allowlisted responses, hashes and data; failed attempts clear stale snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fbs-evidence-'));
  const data = join(root, 'data'), output = join(root, 'evidence');
  await mkdir(join(data,'raw'),{recursive:true}); await mkdir(join(data,'seasons'),{recursive:true});
  await writeFile(join(data,'raw','cfbd-2026.json'), JSON.stringify([[],[]]));
  await writeFile(join(data,'seasons','2026.json'), '{}');
  await writeFile(join(root,'.env'), 'PRIVATE_TOKEN=sentinel-never-export');
  const snapshot = { season:2026,snapshotHash:'test',source:{provider:'cfbd'} };
  const manifest = await saveEvidence({year:2026,dataDir:data,outputDir:output,snapshot});
  assert.equal(manifest.files.length,3);
  for(const file of manifest.files) {
    const bytes=await readFile(join(output,file.name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
    assert.ok(!bytes.includes('sentinel-never-export'));
  }
  const rejected=await saveEvidence({year:2026,dataDir:data,outputDir:output,error:new Error('Do not copy this private error text')});
  assert.deepEqual((await readdir(output)).sort(),['manifest.json','provider-responses.json']);
  assert.equal(rejected.status,'rejected');
  assert.ok(!(await readFile(join(output,'manifest.json'),'utf8')).includes('private error text'));
});

test('an older cached response is not attributed to a new failed fetch', async () => {
  const root=await mkdtemp(join(tmpdir(),'fbs-evidence-stale-'));
  const data=join(root,'data'); await mkdir(join(data,'raw'),{recursive:true});
  await writeFile(join(data,'raw','cfbd-2026.json'),'[[],[]]');
  const manifest=await saveEvidence({year:2026,dataDir:data,outputDir:join(root,'out'),error:new Error('failed'),attemptStartedAt:'2099-01-01T00:00:00Z'});
  assert.equal(manifest.files.length,0);
});

async function runRefresh(duplicate) {
  const root=await mkdtemp(join(tmpdir(),'fbs-refresh-quality-'));
  await mkdir(join(root,'published'),{recursive:true}); await mkdir(join(root,'data'),{recursive:true});
  await writeFile(join(root,'data','model.json'),JSON.stringify({ridge:3,retention:.75,homeAdvantage:2.5,marginCap:28,probabilityScale:14}));
  await writeFile(join(root,'published','prior-2025.json'),JSON.stringify({season:2025,ratings:[],snapshotHash:'prior'}));
  const old=JSON.stringify({season:2026,fbsTeams:2,marker:'previous-good-publication'});
  await writeFile(join(root,'published','latest.json'),old);
  const raw=[{id:1,season:2026,week:1,seasonType:'regular',startDate:'2026-09-05T12:00:00Z',completed:true,neutralSite:false,
    homeId:1,awayId:2,homeTeam:'A',awayTeam:'B',homePoints:21,awayPoints:7,homeClassification:'fbs',awayClassification:'fbs'}];
  if(duplicate) raw.push({...raw[0],id:2,startDate:'2026-09-05T19:00:00Z'});
  const responses=[raw,[{id:1,school:'A'},{id:2,school:'B'}]];
  const mock=`import {writeFileSync} from 'node:fs';let calls=0;const responses=${JSON.stringify(responses)};globalThis.fetch=async()=>{const value=responses[calls++];writeFileSync('mock-calls.json',JSON.stringify({calls}));if(value===undefined)throw Error('Unexpected extra provider call');return new Response(JSON.stringify(value));};`;
  const hook=join(root,'mock-fetch.mjs'); await writeFile(hook,mock);
  const result=spawnSync(process.execPath,['--import',pathToFileURL(hook).href,resolve('scripts/refresh-weekly.js')],{cwd:root,encoding:'utf8',env:{...process.env,CFBD_API_KEY:'test-fixture-only',RANKING_SEASON:'2026'}});
  return {root,result,old};
}

test('rejected refresh preserves published bytes and captures source evidence using two mocked calls', async () => {
  const {root,result,old}=await runRefresh(true);
  assert.notEqual(result.status,0);
  assert.equal(await readFile(join(root,'published','latest.json'),'utf8'),old);
  assert.equal(JSON.parse(await readFile(join(root,'mock-calls.json'),'utf8')).calls,2);
  const manifest=JSON.parse(await readFile(join(root,'evidence','weekly','manifest.json'),'utf8'));
  assert.equal(manifest.status,'rejected'); assert.equal(manifest.rejection.type,'data-quality');
  assert.equal(manifest.files[0].name,'provider-responses.json');
});

test('successful refresh captures reproducible evidence without extra provider requests', async () => {
  const {root,result}=await runRefresh(false);
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(await readFile(join(root,'mock-calls.json'),'utf8')).calls,2);
  const manifest=JSON.parse(await readFile(join(root,'evidence','weekly','manifest.json'),'utf8'));
  const snapshot=JSON.parse(await readFile(join(root,'published','latest.json'),'utf8'));
  assert.equal(manifest.status,'validated'); assert.equal(manifest.files.length,3);
  assert.equal(manifest.snapshotHash,snapshot.snapshotHash);
});
