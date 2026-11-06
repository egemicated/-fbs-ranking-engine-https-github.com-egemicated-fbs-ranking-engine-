// Evaluate immutable, actually saved-before-kickoff research forecasts only.
// No provider access, model fitting, historical forecast invention or rank writes.
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { atomicJson } from '../src/ingest.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const validTime=value=>Number.isFinite(Date.parse(value));

export function evaluateForecasts({observations,season,asOf}) {
  if(!validTime(asOf)||!season?.source?.sha256||!Array.isArray(season.games))throw Error('Evaluation requires a dated normalized source');
  const selected=new Map(),excluded=[];
  for(const observation of observations) {
    const {resultSha256,recordedAt,runtime,...data}=observation;
    if(resultSha256!==sha(JSON.stringify(data)))throw Error('Forecast observation checksum mismatch');
    const capturedAt=observation.forecastCapturedAt;
    if(!validTime(capturedAt))throw Error('Forecast observation lacks a checksummed capture timestamp');
    if(Date.parse(capturedAt)>Date.parse(asOf))continue;
    for(const forecast of observation.forecasts??[]) {
      if(forecast.phase!=='post-freeze-saved-before-kickoff')continue;
      if(forecast.season!==season.year)continue;
      if(forecast.modelId!==observation.protocolId||!validTime(observation.frozenAt)||Date.parse(capturedAt)<=Date.parse(observation.frozenAt))throw Error('Forecast model or freeze timestamp does not match its observation');
      if(!validTime(forecast.asOf)||forecast.asOf!==observation.asOf||forecast.sourceHash!==observation.sourceHash||forecast.snapshotHash!==observation.snapshotHash||!validTime(observation.sourceFetchedAt)||Date.parse(forecast.asOf)<=Date.parse(observation.frozenAt)||Date.parse(observation.sourceFetchedAt)<=Date.parse(observation.frozenAt)||Date.parse(observation.sourceFetchedAt)>Date.parse(capturedAt))throw Error('Forecast source or cutoff does not match its observation');
      if(![forecast.homeDivision,forecast.awayDivision].every(d=>['fbs','fcs'].includes(d))||![forecast.homeDivision,forecast.awayDivision].includes('fbs'))throw Error('Forecast subdivisions are not eligible');
      if(!validTime(forecast.kickoff)||Date.parse(capturedAt)>=Date.parse(forecast.kickoff)||Date.parse(forecast.asOf)>=Date.parse(forecast.kickoff))throw Error('Forecast was not saved before kickoff');
      for(const p of [forecast.homeWinProbability,forecast.controlHomeWinProbability])if(typeof p!=='number'||!Number.isFinite(p)||p<0||p>1)throw Error('Invalid saved forecast probability');
      const key=`${forecast.modelId}:${forecast.gameId}`;
      const old=selected.get(key);
      if(!old||Date.parse(capturedAt)<Date.parse(old.forecastCapturedAt))selected.set(key,{...forecast,forecastCapturedAt:capturedAt,resultSha256});
      else if(capturedAt===old.forecastCapturedAt&&(forecast.homeWinProbability!==old.homeWinProbability||forecast.controlHomeWinProbability!==old.controlHomeWinProbability))throw Error('Conflicting forecasts share capture time');
    }
  }
  const ids=new Map();
  for(const game of season.games){if(ids.has(game.id))throw Error('Duplicate result identity');ids.set(game.id,game);}
  const evaluated=[],pending=[];
  for(const saved of selected.values()) {
    const game=ids.get(saved.gameId);
    if(!game||!game.completed||Date.parse(game.startDate)>Date.parse(asOf)){pending.push(saved.gameId);continue;}
    if(game.home!==saved.home||game.away!==saved.away||game.neutral!==saved.neutral){excluded.push({gameId:game.id,reason:'participants-or-venue-changed'});continue;}
    if(!validTime(game.startDate)||Date.parse(saved.forecastCapturedAt)>=Date.parse(game.startDate)){excluded.push({gameId:game.id,reason:'corrected-kickoff-not-after-capture'});continue;}
    if(Date.parse(game.startDate)>Date.parse(saved.forecastCapturedAt)+7*86400000){excluded.push({gameId:game.id,reason:'rescheduled-outside-seven-day-window'});continue;}
    if(!Number.isInteger(game.homePoints)||!Number.isInteger(game.awayPoints)||game.homePoints<0||game.awayPoints<0||game.homePoints===game.awayPoints)throw Error('Eligible result needs decisive valid final scores');
    evaluated.push({...saved,outcome:Number(game.homePoints>game.awayPoints),resultSourceHash:season.source.sha256,resultKickoff:game.startDate});
  }
  const score=rows=>{
    if(!rows.length)return {games:0};
    const measure=field=>{
      let loss=0,brier=0,correct=0;
      for(const r of rows){const p=Math.max(1e-12,Math.min(1-1e-12,r[field]));loss-=r.outcome*Math.log(p)+(1-r.outcome)*Math.log(1-p);brier+=(p-r.outcome)**2;correct+=Number((p>=.5)===Boolean(r.outcome));}
      return {logLoss:loss/rows.length,brier:brier/rows.length,accuracy:correct/rows.length};
    };
    return {games:rows.length,candidate:measure('homeWinProbability'),control:measure('controlHomeWinProbability')};
  };
  const modelIds=[...new Set(evaluated.map(r=>r.modelId))].sort();
  const subgroup=rows=>({overall:score(rows),fbsVsFbs:score(rows.filter(r=>r.homeDivision==='fbs'&&r.awayDivision==='fbs')),fbsVsFcs:score(rows.filter(r=>r.homeDivision!==r.awayDivision))});
  return {schemaVersion:1,asOf,season:season.year,resultSourceHash:season.source.sha256,selectionRule:'First eligible immutable seven-day-window forecast per model/game; no selection by eventual outcome',
    observationsRead:observations.length,eligibleForecasts:selected.size,pending:pending.length,excluded,
    scoresByModel:Object.fromEntries(modelIds.map(id=>[id,subgroup(evaluated.filter(r=>r.modelId===id))])),evaluated,
    interpretation:'Prospective probability evidence only after checksummed forecastCapturedAt precedes actual kickoff. No games evaluated means evidence is pending, not success. No achievement-order superiority claim.'};
}

async function main(){
  const protocol=JSON.parse(await readFile('research/frozen-division-comparison.json','utf8'));
  const self='research/evaluate_division_forecasts.mjs';
  if(protocol.evaluationImplementationSha256?.[self]!==sha(await readFile(self)))throw Error('Frozen forecast evaluator changed; create a new protocol version');
  const year=Number(process.env.RANKING_SEASON||2026),directory='research/division-observations';
  let names=[];try{names=(await readdir(directory)).filter(n=>n.endsWith('.json')&&n!=='evaluation.json').sort();}catch(e){if(e.code!=='ENOENT')throw e;}
  const observations=await Promise.all(names.map(n=>readFile(join(directory,n),'utf8').then(JSON.parse)));
  const normalizedBytes=await readFile(`data/seasons/${year}.json`),snapshotBytes=await readFile('published/latest.json');
  const season=JSON.parse(normalizedBytes),snapshot=JSON.parse(snapshotBytes);
  const evidence=JSON.parse(await readFile('evidence/weekly/manifest.json','utf8'));
  if(evidence.status!=='validated'||evidence.snapshotHash!==snapshot.snapshotHash||evidence.files.find(f=>f.name==='normalized-season.json')?.sha256!==sha(normalizedBytes)||evidence.files.find(f=>f.name==='snapshot.json')?.sha256!==sha(snapshotBytes))throw Error('Forecast results do not match validated retained evidence');
  if(snapshot.source?.sha256!==season.source?.sha256||snapshot.season!==year)throw Error('Evaluation results must match the latest published input source');
  const report=evaluateForecasts({observations,season,asOf:snapshot.asOf});
  await atomicJson('research/division-observations/evaluation.json',report);
  console.log(`Evaluated ${report.evaluated.length} saved-before-kickoff division forecasts; ${report.pending} pending`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
