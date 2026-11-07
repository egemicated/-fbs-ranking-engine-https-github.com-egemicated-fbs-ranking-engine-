// Reproduce the historical final-margin range for the public Strength configuration.
// No network or publication writes. Run: node research/strength_margin_interval_experiment.mjs
import { readFileSync } from 'node:fs';
import { backtest } from '../src/history.js';
const read=(p)=>JSON.parse(readFileSync(new URL(`../${p}`,import.meta.url),'utf8'));
const snapshot=read('published/latest.json');
const seasons=Array.from({length:22},(_,i)=>read(`data/seasons/${2004+i}.json`));
const evaluateYears=[2023,2024,2025];
const forecasts=backtest(seasons,{config:snapshot.config,evaluateYears}).predictions;
const context=new Map();
for(const season of seasons.filter(season=>evaluateYears.includes(season.year))){
  const groups=new Map();
  for(const game of season.games.filter(game=>game.completed)){
    const key=`${game.seasonType}:${game.week}`;
    const bucket=groups.get(key)||[];
    bucket.push(game);
    groups.set(key,bucket);
  }
  const seen=[];
  const kickoff=game=>Date.parse(game.startDate);
  const ordered=[...groups.values()].sort((a,b)=>Math.min(...a.map(kickoff))-Math.min(...b.map(kickoff)));
  for(const group of ordered){
    const start=Math.min(...group.map(kickoff));
    const counts=new Map();
    for(const game of seen.filter(game=>kickoff(game)+86400000<=start)){
      for(const id of [game.home,game.away])counts.set(id,(counts.get(id)||0)+1);
    }
    for(const game of group){
      context.set(`${season.year}:${game.id}`,{neutral:game.neutral,established:Math.min(counts.get(game.home)||0,counts.get(game.away)||0)>=4});
    }
    seen.push(...group);
  }
}
const rows=forecasts.map(r=>({...r,...context.get(`${r.season}:${r.gameId}`),absError:Math.abs(r.actualMargin-r.homeMargin),favoredChance:Math.max(r.homeWinProbability,1-r.homeWinProbability),favoredWon:r.homeWinProbability>=.5?r.outcome:1-r.outcome}));
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const q=(rows,level)=>{
  const errors=rows.map(r=>r.absError).sort((a,b)=>a-b);
  return errors[Math.min(errors.length,Math.ceil((errors.length+1)*level))-1];
};
const stats=(rows,width)=>({
  n:rows.length,
  covered:rows.filter(r=>r.absError<=width).length,
  coverage:mean(rows.map(r=>Number(r.absError<=width))),
  MAE:mean(rows.map(r=>r.absError)),
  maxAbsoluteModelMargin:Math.max(...rows.map(r=>Math.abs(r.homeMargin)))
});
const bins=(rows)=>[[.5,.6],[.6,.7],[.7,.8],[.8,.9],[.9,1]].map(([low,high])=>{
  const bin=rows.filter(r=>r.favoredChance>=low&&r.favoredChance<high);
  return {low,high,n:bin.length,meanForecast:mean(bin.map(r=>r.favoredChance)),observedWins:mean(bin.map(r=>r.favoredWon))};
});
const results={inputSnapshot:snapshot.snapshotHash,config:snapshot.config,recipe:'Production strength backtest, fit absolute-margin-error quantile on 2023 only and apply it without fitting to 2024/2025; disjoint years but all outcomes previously inspected. Integer outward rounding shown separately.',established:'Both teams have at least four usable previous games, matching dashboard provisional rule.',scopes:{}};
for(const scope of ['all','established']){
  const available=rows.filter(r=>scope==='all'||r.established);
  const calibration=available.filter(r=>r.season===2023);
  const quantiles=Object.fromEntries([.8,.9,.95].map(level=>[String(level),q(calibration,level)]));
  const width=quantiles['0.8'];
  const future=available.filter(r=>r.season>2023);
  const rowsByYear=Object.fromEntries([2023,2024,2025].map(y=>[y,stats(available.filter(r=>r.season===y),width)]));
  results.scopes[scope]={calibrationN:calibration.length,quantiles,width,rowsByYear,pooled:stats(future,width),roundedOutward:stats(future,Math.ceil(width)),roundedByYear:Object.fromEntries([2023,2024,2025].map(y=>[y,stats(available.filter(r=>r.season===y),Math.ceil(width))])),postseason:stats(future.filter(r=>r.seasonType==='postseason'),width),neutral:stats(future.filter(r=>r.neutral),width),nonNeutral:stats(future.filter(r=>!r.neutral),width),edgeBands:Object.fromEntries([[0,7],[7,14],[14,Infinity]].map(([l,h])=>[`${l}-${h}`,stats(future.filter(r=>Math.abs(r.homeMargin)>=l&&Math.abs(r.homeMargin)<h),width)])),favoredChanceCalibration:bins(future)};
}
console.log(JSON.stringify(results,null,2));
