import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { buildHistory, backtest } from '../src/history.js';
import { validateSeason, solveGraph } from '../src/engine.js';
import { assertNoLogicalDuplicates } from '../src/data-quality.js';
const load=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const config=await load('../data/model.json');
const old=[],repaired=[];
for(let year=2004;year<=2025;year++) {
  old.push(await load(`../data/seasons/${year}.json`));
  const data=validateSeason(await load(`./datasets/historical-coverage-v1/seasons/${year}.json`));
  assertNoLogicalDuplicates(data.games);
  repaired.push(data);
}
const baseline=backtest(old,{config,evaluateYears:[2023,2024,2025]});
const next=backtest(repaired,{config,evaluateYears:[2023,2024,2025]});
const publishedMetrics=await load('../reports/validation.json');
if(Math.abs(baseline.overall.logLoss-publishedMetrics.overall.logLoss)>1e-9) throw Error('Original benchmark did not reproduce');
const oldHistory=buildHistory(old,config),newHistory=buildHistory(repaired,config);
const before=oldHistory.at(-1),after=newHistory.at(-1);
const current=await load('../published/latest.json');
const originalPrior=await load('../published/prior-2025.json');
const priorRows=new Map(originalPrior.ratings.map(t=>[t.id,t]));
if(Math.max(...before.ratings.map(t=>Math.abs(t.strength-priorRows.get(t.id).strength)))>1e-9)throw Error('Original prior mismatch');
const byOld=new Map(before.ratings.map(t=>[t.id,t])),byNew=new Map(after.ratings.map(t=>[t.id,t]));
const index=new Map(current.ratings.map((t,i)=>[t.id,i]));
const seen=new Set(),edges=[];
for(const t of current.ratings) for(const g of t.contributions) {
  if(seen.has(g.gameId))continue;
  seen.add(g.gameId);edges.push([index.get(t.id),index.get(g.opponentId)]);
}
const rhs=current.ratings.map(t=>config.ridge*config.retention*((byNew.get(t.id)?.strength??0)-(byOld.get(t.id)?.strength??0)));
const delta=solveGraph(current.ratings.length,edges,rhs,config.ridge);
const oldOrder=[...current.rankings].sort((a,b)=>b.strength-a.strength),newOrder=[...current.rankings].sort((a,b)=>(b.strength+delta[index.get(b.id)])-(a.strength+delta[index.get(a.id)]));
const oldRanks=new Map(oldOrder.map((t,i)=>[t.id,i+1])),newRanks=new Map(newOrder.map((t,i)=>[t.id,i+1]));
const differences=current.rankings.map(t=>({team:t.name,oldPredictiveRank:oldRanks.get(t.id),researchPredictiveRank:newRanks.get(t.id),strengthDelta:delta[index.get(t.id)]})).sort((a,b)=>Math.abs(b.strengthDelta)-Math.abs(a.strengthDelta));
const examples=[];
for(const [year,name] of [[2019,'LSU'],[2021,'Georgia'],[2022,'Georgia']]) {
  const a=oldHistory.find(s=>s.season===year).rankings.find(t=>t.name===name);
  const b=newHistory.find(s=>s.season===year).rankings.find(t=>t.name===name);
  examples.push({year,team:name,originalRecord:`${a.wins}-${a.losses}`,repairedRecord:`${b.wins}-${b.losses}`});
}
const report={status:'Offline data-repair experiment; no parameter tuning or production publication',config,
  evaluationYears:[2023,2024,2025],baseline:{overall:baseline.overall,bySeason:baseline.bySeason},
  repaired:{overall:next.overall,bySeason:next.bySeason},examples,
  currentScenario:{asOf:current.asOf,achievementChanged:false,sorChanged:false,
    maxFbsStrengthChange:Math.max(...differences.map(t=>Math.abs(t.strengthDelta))),
    predictivePositionsChanged:differences.filter(t=>t.oldPredictiveRank!==t.researchPredictiveRank).length,differences},
  limits:['Previously consumed retrospective evaluation years, not untouched prospective evidence.','Lower-division schedules, 2020 roster gaps and old venue questions remain.','The same fixed predictive parameters are used before and after repair.','Only historical inputs changed in the current scenario; no actual current snapshot was rewritten.']};
const directory=new URL('./results/repairs/',import.meta.url);await mkdir(directory,{recursive:true});
await writeFile(new URL('historical-impact.json',directory),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({baseline:baseline.overall,repaired:next.overall,examples,currentScenario:{maxStrengthChange:report.currentScenario.maxFbsStrengthChange,positionsChanged:report.currentScenario.predictivePositionsChanged}},null,2));
