import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {planDailyRefreshRecovery,checkDailyRefresh,refreshWatchdogClock,writeRefreshWatchdogSummary} from '../scripts/daily-refresh-watchdog.mjs';
import {dailyRefreshNeeded} from '../scripts/weekly-refresh-needed.js';
import {RELEASE_REPOSITORY} from '../scripts/require-release-checks.mjs';

function publication(fetchedAt='2026-11-18T12:30:00Z',kickoff='2026-11-19T00:00:00Z'){
  const snapshot={season:2026,asOf:new Date(Date.parse(fetchedAt)+1000).toISOString(),snapshotHash:'fixture-hash',source:{provider:'cfbd',fetchedAt}};
  const picks={season:2026,source:{provider:'cfbd',scheduleAsOf:fetchedAt,rankingAsOf:snapshot.asOf,snapshotHash:snapshot.snapshotHash},
    teams:[{id:'home',division:'fbs'},{id:'away',division:'fbs'}],games:[{id:'game',home:'home',away:'away',startDate:kickoff,startTimeTbd:false,status:'scheduled'}]};
  return{snapshot,picks};
}
const input=publication(),now='2026-11-19T14:00:00Z';
const run=extra=>({id:1,head_branch:'main',head_repository:{full_name:RELEASE_REPOSITORY},path:'.github/workflows/weekly.yml',created_at:'2026-11-18T12:30:00Z',status:'completed',conclusion:'success',...extra});

test('missed-run recovery waits until 06:45 Mountain with standard/daylight transitions handled',()=>{
  for(const [publicationArgs,before,ready]of[
    [[], '2026-11-19T13:44:59Z','2026-11-19T13:45:00Z'],
    [['2026-03-07T13:00:00Z','2026-03-08T02:00:00Z'],'2026-03-08T12:44:59Z','2026-03-08T12:45:00Z'],
    [['2026-10-31T12:00:00Z','2026-11-01T02:00:00Z'],'2026-11-01T13:44:59Z','2026-11-01T13:45:00Z'],
  ]){
    const data=publication(...publicationArgs);
    assert.equal(planDailyRefreshRecovery({...data,now:before,runs:[],totalRuns:0}).reason,'daily-window-grace-period');
    assert.equal(planDailyRefreshRecovery({...data,now:ready,runs:[],totalRuns:0}).status,'recover');
    assert.equal(refreshWatchdogClock(ready).minutes,405);
  }
});

test('fresh same-Mountain-day data or no elapsed unresolved game makes no recovery necessary',async()=>{
  const fresh=publication('2026-11-19T12:00:00Z');
  const cases=[fresh,{...input,picks:{...input.picks,games:input.picks.games.map(g=>({...g,status:'final'}))}}];
  for(const data of cases){
    const result=await checkDailyRefresh({...data,now,token:'test-only',fetcher:()=>assert.fail('No GitHub or CFBD read needed')});
    assert.equal(result.status,'current');assert.equal(result.cfbdCalls,0);
  }
});

test('invalid or unaligned publication cannot trigger an automatic provider pull',()=>{
  for(const data of [{snapshot:null,picks:input.picks},{...input,picks:{...input.picks,source:{...input.picks.source,snapshotHash:'different'}}},publication('2026-11-20T12:00:00Z')]){
    assert.equal(planDailyRefreshRecovery({...data,now,runs:[],totalRuns:0}).reason,'publication-evidence-invalid');
  }
});

test('active, already-attempted, successful-but-stale, malformed or incomplete run evidence fails closed',()=>{
  for(const status of ['queued','in_progress','waiting','pending','requested'])assert.equal(planDailyRefreshRecovery({...input,now,runs:[run({status,conclusion:null})],totalRuns:1}).reason,'weekly-run-active');
  for(const conclusion of ['failure','cancelled','timed_out','skipped','action_required'])assert.equal(planDailyRefreshRecovery({...input,now,runs:[run({created_at:'2026-11-19T11:00:00Z',conclusion})],totalRuns:1}).reason,'weekly-run-already-attempted');
  assert.equal(planDailyRefreshRecovery({...input,now,runs:[run({created_at:'2026-11-19T11:00:00Z'})],totalRuns:1}).reason,'weekly-run-finished-check-publication');
  for(const extra of [{status:'unknown'},{created_at:'bad'},{head_branch:'other'},{head_repository:{full_name:'other/repo'}}])assert.equal(planDailyRefreshRecovery({...input,now,runs:[run(extra)],totalRuns:1}).status,'attention');
  assert.equal(planDailyRefreshRecovery({...input,now,runs:[],totalRuns:1}).reason,'run-evidence-incomplete');
  assert.equal(planDailyRefreshRecovery({...input,now,runs:[run()],totalRuns:100}).status,'recover');
});

test('a verified missing daily run dispatches only the guarded existing main workflow and never CFBD',async()=>{
  const calls=[];
  const result=await checkDailyRefresh({...input,now,token:'test-only',fetcher:async(url,options)=>{
    assert.ok(url.startsWith(`https://api.github.com/repos/${RELEASE_REPOSITORY}/actions/workflows/weekly.yml/`));
    calls.push({url,options});
    return options.method==='POST'?{ok:true,json:async()=>({workflow_run_id:123})}:{ok:true,json:async()=>({workflow_runs:[run()],total_count:1})};
  }});
  assert.equal(result.status,'requested');assert.equal(result.relatedRunId,123);assert.equal(result.cfbdCalls,0);
  assert.equal(calls.length,2);assert.deepEqual(JSON.parse(calls[1].options.body),{ref:'main',inputs:{recover_missing_daily:true}});
  assert.equal(calls[1].options.redirect,'error');
});

test('GitHub failures and ambiguous dispatch receipts never retry or claim a completed refresh',async()=>{
  for(const behavior of ['get-denied','get-bad-json','post-denied','post-ambiguous','post-throws']){
    let requests=0;
    const result=await checkDailyRefresh({...input,now,token:'test-only',fetcher:async(_url,options)=>{
      requests++;
      if(!options.method){if(behavior==='get-denied')return{ok:false};if(behavior==='get-bad-json')throw Error('Private diagnostic');return{ok:true,json:async()=>({workflow_runs:[],total_count:0})};}
      if(behavior==='post-throws')throw Error('Private diagnostic');
      return behavior==='post-denied'?{ok:false}:{ok:true,json:async()=>null};
    }});
    assert.equal(result.status,'attention');assert.ok(requests<=2);assert.doesNotMatch(JSON.stringify(result),/Private diagnostic|test-only/);
  }
});

test('a late scheduled run and guarded recovery cannot request two same-day pulls after publication',()=>{
  assert.equal(dailyRefreshNeeded(input.snapshot,input.picks,new Date(now)),true);
  const alreadyPublished=publication('2026-11-19T14:01:00Z');
  assert.equal(dailyRefreshNeeded(alreadyPublished.snapshot,alreadyPublished.picks,new Date('2026-11-19T14:02:00Z')),false);
  assert.equal(planDailyRefreshRecovery({...alreadyPublished,now:'2026-11-19T14:02:00Z',runs:[],totalRuns:0}).status,'current');
});

test('the serialized recovery job rechecks other runs before provider access, closing the late-run failure race',async()=>{
  const own=run({id:999,event:'workflow_dispatch',status:'in_progress',conclusion:null,created_at:'2026-11-19T14:00:00Z'});
  for(const other of [null,run({id:2,created_at:'2026-11-19T13:59:00Z',conclusion:'failure'}),run({id:2,created_at:'2026-11-19T14:00:00Z',status:'queued',conclusion:null})]){
    let calls=0;
    const runs=[own,other??run()];
    const result=await checkDailyRefresh({...input,now,token:'test-only',recoveryRunId:999,fetcher:async(_url,options)=>{
      calls++;assert.notEqual(options.method,'POST','Authorization must not dispatch another workflow');
      return{ok:true,json:async()=>({workflow_runs:runs,total_count:runs.length})};
    }});
    assert.equal(calls,1);assert.equal(result.cfbdCalls,0);
    assert.equal(result.status,other?(other.status==='queued'?'waiting':'attention'):'authorized');
  }
});

test('recovery cannot exclude an arbitrary or unconfirmed run to bypass the daily-attempt check',async()=>{
  for(const own of [null,run({id:999,event:'schedule',status:'in_progress',conclusion:null}),run({id:999,event:'workflow_dispatch',status:'completed'})]){
    const runs=own?[own]:[];
    const result=await checkDailyRefresh({...input,now,token:'test-only',recoveryRunId:999,fetcher:async()=>({ok:true,json:async()=>({workflow_runs:runs,total_count:runs.length})})});
    assert.equal(result.status,'attention');assert.equal(result.reason,'recovery-run-identity-unconfirmed');
  }
});

test('job summaries expose only fixed operational diagnostics and public run IDs',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fbs-refresh-summary-')),path=join(dir,'summary.md');
  try{
    await writeRefreshWatchdogSummary({status:'attention',reason:'weekly-run-already-attempted',mountainDay:'2026-11-19',sourceCutoff:input.snapshot.source.fetchedAt,rankingCutoff:input.snapshot.asOf,relatedRunId:123},path);
    const text=await readFile(path,'utf8');assert.match(text,/CFBD calls made by this check: 0/);assert.match(text,/actions\/runs\/123/);assert.doesNotMatch(text,/Authorization|Bearer|test-only/);
  }finally{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));await rm(dir,{recursive:true,force:true});}
});

test('existing schedules and permissions are retained; Sunday player refresh keeps its daily cache guards',async()=>{
  const weekly=await readFile(new URL('../.github/workflows/weekly.yml',import.meta.url),'utf8');
  const availability=await readFile(new URL('../.github/workflows/player-availability.yml',import.meta.url),'utf8');
  const players=await readFile(new URL('../.github/workflows/player-stats.yml',import.meta.url),'utf8');
  const playerCode=await readFile(new URL('../scripts/refresh-team-players.js',import.meta.url),'utf8');
  assert.match(weekly,/cron: '45 3 \* \* \*'/);assert.match(weekly,/cron: '11 20 \* \* 0'/);
  assert.match(weekly,/group: weekly-cfbd-rankings\s+cancel-in-progress: false/);
  assert.match(weekly,/EVENT_NAME.*workflow_dispatch.*RECOVER_MISSING_DAILY[\s\S]*?needed=\$\(node scripts\/weekly-refresh-needed\.js\)/);
  assert.match(weekly,/needed=\$\(node scripts\/daily-refresh-watchdog\.mjs --authorize-recovery\)/);
  assert.match(availability,/if: github\.event_name == 'schedule'\s+continue-on-error: true\s+env:\s+GH_TOKEN: \$\{\{ github.token \}\}/);
  assert.match(players,/workflow_run\.event == 'schedule' \|\| github\.event\.workflow_run\.event == 'workflow_dispatch'/);
  assert.match(players,/TZ=America\/Denver date \+%u.*== 7/);
  assert.match(playerCode,/weekday\.format\(now\) !== 'Sun'/);
  assert.match(playerCode,/dateOnly\.format\(now\) !== dateOnly\.format\(new Date\(schedule.scheduleAsOf\)\)/);
  assert.match(playerCode,/Today’s Sunday player pages are already published/);
  assert.match(playerCode,/This week’s player publication already refreshed/);
});
