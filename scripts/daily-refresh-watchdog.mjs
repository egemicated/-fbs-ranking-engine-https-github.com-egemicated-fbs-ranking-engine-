// Runs inside the existing availability job. This script never calls CFBD.
// A recovery dispatch uses the weekly workflow's serialized same-day guard.
import {readFile,appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {dailyRefreshNeeded} from './weekly-refresh-needed.js';
import {UPDATE_SCHEDULE} from '../src/refresh-schedule.js';
import {RELEASE_REPOSITORY} from './require-release-checks.mjs';

const workflow='weekly.yml';
const endpoint=`https://api.github.com/repos/${RELEASE_REPOSITORY}/actions/workflows/${workflow}`;
const activeStatuses=new Set(['queued','in_progress','waiting','pending','requested']);
const completedConclusions=new Set(['success','failure','cancelled','timed_out','action_required','neutral','skipped','stale','startup_failure']);
const localClock=new Intl.DateTimeFormat('en-CA',{timeZone:UPDATE_SCHEDULE.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const isoTime=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))?Date.parse(value):NaN;
const safeCutoff=value=>Number.isFinite(isoTime(value))?new Date(isoTime(value)).toISOString():null;

export function refreshWatchdogClock(value) {
  if(!(value instanceof Date)&&typeof value!=='number'&&!Number.isFinite(isoTime(value)))return null;
  const time=new Date(value).getTime();
  if(!Number.isFinite(time))return null;
  const parts=Object.fromEntries(localClock.formatToParts(time).map(p=>[p.type,p.value]));
  return{day:`${parts.year}-${parts.month}-${parts.day}`,minutes:Number(parts.hour)*60+Number(parts.minute),time};
}

function validPublication(snapshot,picks,now) {
  const fetched=isoTime(snapshot?.source?.fetchedAt),asOf=isoTime(snapshot?.asOf);
  return snapshot?.source?.provider==='cfbd'&&Number.isInteger(snapshot.season)&&
    Number.isFinite(fetched)&&Number.isFinite(asOf)&&fetched<=asOf&&asOf<=now&&
    picks?.source?.provider==='cfbd'&&picks.season===snapshot.season&&
    picks.source.scheduleAsOf===snapshot.source.fetchedAt&&picks.source.rankingAsOf===snapshot.asOf&&
    typeof snapshot.snapshotHash==='string'&&picks.source.snapshotHash===snapshot.snapshotHash&&
    Array.isArray(picks.games)&&Array.isArray(picks.teams);
}

export function planDailyRefreshRecovery({snapshot,picks,now=new Date(),runs,totalRuns}={}) {
  const current=refreshWatchdogClock(now);
  const base={checkedAt:current?new Date(current.time).toISOString():null,mountainDay:current?.day??null,
    sourceCutoff:safeCutoff(snapshot?.source?.fetchedAt),rankingCutoff:safeCutoff(snapshot?.asOf),cfbdCalls:0};
  const result=(status,reason,extra={})=>({...base,status,reason,...extra});
  if(!current||!validPublication(snapshot,picks,current.time))return result('attention','publication-evidence-invalid');
  if(!dailyRefreshNeeded(snapshot,picks,new Date(current.time)))return result('current','daily-refresh-not-needed');
  const graceEnd=UPDATE_SCHEDULE.hour*60+UPDATE_SCHEDULE.minute+180;
  if(current.minutes<graceEnd)return result('waiting','daily-window-grace-period');
  if(current.time-Date.parse(snapshot.source.fetchedAt)<3*60*60_000)return result('waiting','source-refreshed-recently');
  if(!Array.isArray(runs))return result('check-runs','run-evidence-required');
  if(!Number.isSafeInteger(totalRuns)||totalRuns<runs.length)return result('attention','run-evidence-incomplete');
  const relevant=[];
  const seenIds=new Set();
  for(const run of runs){
    if(run.head_branch!=='main'||!Number.isSafeInteger(run.id)||run.id<=0||run.path!=='.github/workflows/weekly.yml'||run.head_repository?.full_name!==RELEASE_REPOSITORY||
      !refreshWatchdogClock(run.created_at)||(!activeStatuses.has(run.status)&&run.status!=='completed')||
      (run.status==='completed'&&!completedConclusions.has(run.conclusion))||seenIds.has(run.id))return result('attention','run-evidence-invalid');
    seenIds.add(run.id);
    relevant.push(run);
  }
  const active=relevant.find(run=>activeStatuses.has(run.status));
  if(active)return result('waiting','weekly-run-active',{relatedRunId:active.id});
  const today=relevant.find(run=>refreshWatchdogClock(run.created_at).day>=current.day);
  if(today)return result('attention',today.conclusion==='success'?'weekly-run-finished-check-publication':'weekly-run-already-attempted',{relatedRunId:today.id,relatedConclusion:today.conclusion});
  // If the response could omit more runs from today, absence is not evidence.
  if(totalRuns>runs.length&&(!runs.length||!relevant.length||relevant.every(run=>refreshWatchdogClock(run.created_at).day>=current.day)))return result('attention','run-evidence-incomplete');
  return result('recover','daily-run-missing-after-grace');
}

export async function checkDailyRefresh({snapshot,picks,now=new Date(),token,fetcher=fetch,recoveryRunId}={}) {
  let result=planDailyRefreshRecovery({snapshot,picks,now});
  if(result.status!=='check-runs')return result;
  const authorizing=recoveryRunId!==undefined;
  if(authorizing&&(!Number.isSafeInteger(recoveryRunId)||recoveryRunId<=0))return{...result,status:'attention',reason:'recovery-run-identity-invalid'};
  if(typeof token!=='string'||!token)return{...result,status:'attention',reason:'github-access-unavailable'};
  const headers={Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2026-03-10'};
  try{
    const response=await fetcher(`${endpoint}/runs?branch=main&per_page=100`,{headers,redirect:'error',signal:AbortSignal.timeout(20_000)});
    if(!response.ok)return{...result,status:'attention',reason:'github-run-check-failed'};
    const body=await response.json();
    let runs=body.workflow_runs,totalRuns=body.total_count;
    if(authorizing){
      const ownMatches=Array.isArray(runs)?runs.filter(run=>run.id===recoveryRunId):[];
      const own=ownMatches[0];
      if(ownMatches.length!==1||!own||own.head_branch!=='main'||own.path!=='.github/workflows/weekly.yml'||own.head_repository?.full_name!==RELEASE_REPOSITORY||
        own.event!=='workflow_dispatch'||!activeStatuses.has(own.status)||!Number.isSafeInteger(totalRuns)||totalRuns<1)
        return{...result,status:'attention',reason:'recovery-run-identity-unconfirmed'};
      runs=runs.filter(run=>run.id!==recoveryRunId);totalRuns--;
    }
    result=planDailyRefreshRecovery({snapshot,picks,now,runs,totalRuns});
  }catch{return{...result,status:'attention',reason:'github-run-check-unavailable'};}
  if(result.status!=='recover')return result;
  if(authorizing)return{...result,status:'authorized',reason:'guarded-daily-recovery-authorized'};
  // No retries: an ambiguous response may already have created a run.
  try{
    const response=await fetcher(`${endpoint}/dispatches`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify({ref:'main',inputs:{recover_missing_daily:true}}),redirect:'error',signal:AbortSignal.timeout(20_000)});
    if(!response.ok)return{...result,status:'attention',reason:'recovery-dispatch-not-confirmed'};
    const body=await response.json().catch(()=>null);
    if(!Number.isSafeInteger(body?.workflow_run_id)||body.workflow_run_id<=0)return{...result,status:'attention',reason:'recovery-dispatch-receipt-unavailable'};
    return{...result,status:'requested',reason:'guarded-daily-recovery-requested',relatedRunId:body.workflow_run_id};
  }catch{return{...result,status:'attention',reason:'recovery-dispatch-outcome-unknown'};}
}

export async function writeRefreshWatchdogSummary(result,path) {
  if(!path)return;
  const run=Number.isSafeInteger(result.relatedRunId)?`\n- Related run: https://github.com/${RELEASE_REPOSITORY}/actions/runs/${result.relatedRunId}`:'';
  await appendFile(path,`\n### Daily result-refresh check\n\n- Mountain date: ${result.mountainDay??'Unavailable'}\n- Status: ${result.status}\n- Finding: ${result.reason}\n- CFBD source cutoff: ${result.sourceCutoff??'Unavailable'}\n- Model snapshot cutoff: ${result.rankingCutoff??'Unavailable'}${run}\n- CFBD calls made by this check: 0\n\nA requested recovery is not a completed data update. Existing weekly concurrency and same-day source checks still apply.\n`);
}

async function main(){
  const authorization=process.argv.slice(2)[0]==='--authorize-recovery';
  if(process.argv.slice(2).length>(authorization?1:0))throw Error('Unrecognized refresh diagnostic mode');
  if(authorization){
    if(process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'||process.env.RECOVER_MISSING_DAILY!=='true')throw Error('Recovery authorization requires the guarded manual input');
  }else if(process.env.GITHUB_EVENT_NAME!=='schedule'){console.log('Daily refresh watchdog only runs within existing scheduled availability checks.');return;}
  const [snapshot,picks]=await Promise.all(['latest','weekly-picks'].map(name=>readFile(new URL(`../published/${name}.json`,import.meta.url),'utf8').then(JSON.parse).catch(()=>null)));
  const result=await checkDailyRefresh({snapshot,picks,token:process.env.GH_TOKEN,...(authorization?{recoveryRunId:Number(process.env.GITHUB_RUN_ID)}:{})});
  await writeRefreshWatchdogSummary(result,process.env.GITHUB_STEP_SUMMARY);
  if(authorization){
    if(result.status==='attention')throw Error('Recovery run evidence could not authorize a provider refresh');
    console.log(result.status==='authorized');return;
  }
  console.log(JSON.stringify(result));
  if(result.status==='attention')console.warn(`::warning::Daily result-refresh check requires attention: ${result.reason}. See the job summary; no automatic retry was made.`);
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)main().catch(()=>{console.error('Daily result-refresh diagnostics could not complete; no retry was made.');process.exitCode=1;});
