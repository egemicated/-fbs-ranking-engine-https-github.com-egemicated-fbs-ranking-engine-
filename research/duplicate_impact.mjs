// Identity-only duplicate overlay. Never writes canonical data or published ratings.
import { readFile } from 'node:fs/promises';
import { rankSeason, solveGraph } from '../src/engine.js';
const load=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const config=await load('../data/model.json');
const overlay=await load('./duplicate-adjudications.json');
let baseline=null,corrected=null;
const affected=[];
for(let year=2004;year<=2025;year++) {
  const data=await load(`../data/seasons/${year}.json`);
  baseline=rankSeason(data,{config,previous:baseline});
  const patch=overlay.seasons[year];
  let research=data;
  if(patch) {
    const ids=new Set(data.games.map(g=>g.id));
    if(![...patch.dropIds,...patch.keepIds].every(id=>ids.has(id))) throw Error('Overlay IDs missing');
    const drops=new Set(patch.dropIds);
    research={...data,games:data.games.filter(g=>!drops.has(g.id))};
  }
  corrected=rankSeason(research,{config,previous:corrected});
  if(patch) {
    const old=baseline.ratings.find(t=>t.name===patch.expectedTeam);
    const next=corrected.ratings.find(t=>t.name===patch.expectedTeam);
    if(next.games!==patch.expectedRepairedGames || `${next.wins}-${next.losses}`!==patch.expectedRepairedRecord) throw Error('Repaired record disagrees with official source');
    const byId=new Map(corrected.rankings.map(t=>[t.id,t]));
    affected.push({year,removedOccurrences:patch.dropIds.length,team:patch.expectedTeam,
      originalRecord:`${old.wins}-${old.losses}`,researchRecord:`${next.wins}-${next.losses}`,
      originalGames:old.games,researchGames:next.games,
      fbsAchievementRankChanges:baseline.rankings.filter(t=>t.rank!==byId.get(t.id)?.rank).length,
      maxFbsAchievementScoreChange:Math.max(...baseline.rankings.map(t=>Math.abs(t.achievement-byId.get(t.id).achievement))),
      caveat:overlay.limitation,source:patch.source});
  }
}
const publishedPrior=await load('../published/prior-2025.json');
const priorRows=new Map(publishedPrior.ratings.map(t=>[t.id,t]));
const baseRows=new Map(baseline.ratings.map(t=>[t.id,t]));
const nextRows=new Map(corrected.ratings.map(t=>[t.id,t]));
const priorError=Math.max(...baseline.ratings.map(t=>Math.abs(t.strength-priorRows.get(t.id).strength)));
if(priorError>1e-9) throw Error(`Baseline prior does not reproduce stored prior: ${priorError}`);
const current=await load('../published/latest.json');
const index=new Map(current.ratings.map((t,i)=>[t.id,i]));
const seen=new Set(),edges=[];
for(const team of current.ratings) for(const g of team.contributions) {
  if(seen.has(g.gameId)) continue;
  seen.add(g.gameId); edges.push([index.get(team.id),index.get(g.opponentId)]);
}
const rhs=current.ratings.map(t=>config.ridge*config.retention*((nextRows.get(t.id)?.strength??0)-(baseRows.get(t.id)?.strength??0)));
const delta=solveGraph(current.ratings.length,edges,rhs,config.ridge);
const originalRanks=new Map([...current.rankings].sort((a,b)=>b.strength-a.strength).map((t,i)=>[t.id,i+1]));
const nextRanks=new Map([...current.rankings].sort((a,b)=>(b.strength+delta[index.get(b.id)])-(a.strength+delta[index.get(a.id)])).map((t,i)=>[t.id,i+1]));
console.log(JSON.stringify({scope:overlay.status,affectedSeasons:affected,
  stored2025PriorMaxReproductionError:priorError,
  max2025FbsStrengthChange:Math.max(...baseline.rankings.map(t=>Math.abs(t.strength-nextRows.get(t.id).strength))),
  current2026:{maxFbsStrengthChange:Math.max(...current.rankings.map(t=>Math.abs(delta[index.get(t.id)]))),
    predictiveRankChanges:current.rankings.filter(t=>originalRanks.get(t.id)!==nextRanks.get(t.id)).length,
    achievementChanged:false,sorChanged:false,
    reason:'Only historical data changed. Current achievement and SOR use current-season games without historical team priors.'}}));
