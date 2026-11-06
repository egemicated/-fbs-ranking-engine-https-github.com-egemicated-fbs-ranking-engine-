// Publication layer: the frozen Colley/predictive core remains reproducible.
// This promotes the separately validated SOR ordering without changing its math.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { calculateDivisionSor } from '../research/lib/division_candidate.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const compareIds=(a,b)=>a<b?-1:a>b?1:0;

export async function readPublicationPolicy(path=new URL('../data/publication-model.json',import.meta.url)) {
  const policy=JSON.parse(await readFile(path,'utf8'));
  for(const [file,expected] of Object.entries(policy.implementationSha256??{})) {
    if(hash(await readFile(new URL(`../${file}`,import.meta.url)))!==expected)throw Error(`Publication implementation changed: ${file}; version the publication policy`);
  }
  const protocolBytes=await readFile(new URL(`../${policy.candidateProtocolPath}`,import.meta.url));
  if(hash(protocolBytes)!==policy.candidateProtocolSha256)throw Error('Publication candidate protocol changed');
  const protocol=JSON.parse(protocolBytes);
  if(policy.id!==protocol.id||JSON.stringify(policy.parameters)!==JSON.stringify(protocol.parameters))throw Error('Publication parameters differ from the frozen candidate');
  return policy;
}

export function outcomeDataset(snapshot) {
  if(!Array.isArray(snapshot.ratings)||!snapshot.ratings.length||!Number.isInteger(snapshot.gamesUsed)||snapshot.gamesUsed<0)throw Error('Publication requires the full opponent snapshot');
  const cap=snapshot.config?.marginCap,home=snapshot.config?.homeAdvantage;
  if(!finite(cap)||cap<=0||!finite(home)||home<=0)throw Error('Snapshot venue recovery requires positive margin and home settings');
  const teams=snapshot.ratings.map(t=>({id:t.id,name:t.name,division:t.division,conference:t.conference}));
  const ids=new Set();const pairs=new Map();
  for(const t of snapshot.ratings) {
    if(typeof t.id!=='string'||!t.id||ids.has(t.id)||!Array.isArray(t.contributions)||t.contributions.length!==t.games)throw Error('Invalid team or incomplete paired evidence');
    ids.add(t.id);
    for(const d of t.contributions) {
      if(typeof d.gameId!=='string'||!d.gameId||typeof d.opponentId!=='string'||d.opponentId===t.id||!Number.isInteger(d.finalMargin)||!finite(d.adjustedMargin))throw Error('Invalid outcome evidence');
      const outcome=Math.sign(d.finalMargin),expected=outcome>0?'W':outcome<0?'L':'T';
      if(d.result!==expected)throw Error('Result disagrees with its final margin');
      const list=pairs.get(d.gameId)??[];list.push({team:t.id,detail:d});pairs.set(d.gameId,list);
    }
  }
  const games=[];
  for(const [id,entries] of pairs) {
    if(entries.length!==2)throw Error('A completed game must have exactly two paired occurrences');
    const [left,right]=entries,a=left.team,b=right.team,d=left.detail,e=right.detail;
    if(a===b||!ids.has(d.opponentId)||d.opponentId!==b||e.opponentId!==a||d.finalMargin!==-e.finalMargin||Math.abs(d.adjustedMargin+e.adjustedMargin)>1e-8)throw Error('Asymmetric paired game evidence');
    const outcome=Math.sign(d.finalMargin),venues=new Set();
    // OT uses a one-point outcome signal when regulation is confirmed tied.
    // Require one unique venue across both documented margin interpretations.
    for(const margin of new Set([d.finalMargin,outcome])) {
      const bounded=cap*Math.tanh(margin/cap);
      for(const venue of [-1,0,1])if(Math.abs(bounded-venue*home-d.adjustedMargin)<1e-8)venues.add(venue);
    }
    if(venues.size!==1)throw Error('Snapshot does not uniquely identify game venue');
    games.push({id,a,b,outcome,venue:[...venues][0]});
  }
  if(games.length!==snapshot.gamesUsed)throw Error('Publication completed-game count differs from snapshot evidence');
  return {year:snapshot.season,teams,games:games.sort((a,b)=>compareIds(a.id,b.id))};
}

export function publishDivisionSnapshot(snapshot,policy,{publishedAt}={}) {
  if(typeof policy?.id!=='string'||!policy.id||!policy.parameters||typeof policy.name!=='string')throw Error('Invalid publication policy');
  if(snapshot.source?.provider!=='cfbd'||!Number.isFinite(Date.parse(snapshot.asOf)))throw Error('Live SOR publication requires a dated CFBD snapshot');
  publishedAt??=snapshot.rankingMethod?.id===policy.id&&snapshot.modelPublishedAt?snapshot.modelPublishedAt:new Date().toISOString();
  if(!Number.isFinite(Date.parse(publishedAt)))throw Error('Invalid model publication timestamp');
  const dataset=outcomeDataset(snapshot),result=calculateDivisionSor(dataset,policy.parameters);
  const base=new Map(snapshot.rankings.map(t=>[t.id,t])),scores=new Map(result.rows.map(t=>[t.id,t]));
  if(base.size!==snapshot.rankings.length||scores.size!==base.size)throw Error('Publication FBS population differs from its baseline');
  for(const r of result.rows) {
    const t=base.get(r.id);
    if(!t||t.rank!==r.colleyRank||t.wins!==r.wins||t.losses!==r.losses||t.games!==r.games||Math.abs(t.achievement-r.colley)>1e-8)throw Error('SOR publication does not reproduce its Colley baseline');
  }
  const add=row=>{
    const r=scores.get(row.id);if(!r)return structuredClone(row);
    return {...structuredClone(row),colleyRank:row.rank??null,displayRank:r.sorRank,sorRank:r.sorRank,sor:r.sor,
      sorTailProbability:r.tail,sorExpectedWins:r.expectedWins,
      strengthOfRecord:{score:r.sor,tailProbability:r.tail,expectedWins:r.expectedWins,reference:'mean FBS',modelId:policy.id}};
  };
  const rankings=snapshot.rankings.map(add).sort((a,b)=>Number(b.games>0)-Number(a.games>0)||b.sor-a.sor||compareIds(a.id,b.id));
  for(const conference of new Set(rankings.map(t=>t.conference))) {
    let last=null,rank=null;
    rankings.filter(t=>t.conference===conference).forEach((t,i)=>{
      if(t.games&&(last===null||Math.abs(t.sor-last)>1e-9))rank=i+1;
      t.displayConferenceRank=t.games?rank:null;last=t.sor;
    });
  }
  const displayed=new Map(rankings.map(t=>[t.id,t]));
  const ratings=snapshot.ratings.map(row=>displayed.has(row.id)?{...add(row),displayConferenceRank:displayed.get(row.id).displayConferenceRank}:structuredClone(row));
  const rankingMethod={id:policy.id,name:policy.name,status:'experimental-live',publicationVersion:policy.publicationVersion,
    parameters:{...policy.parameters},reference:'mean source-designated FBS',opponentNetwork:'Colley; current-season outcomes; exact excluded-game reference and opponent ratings',
    score:'-log10(probability an average FBS reference team earns at least this many wins)',
    rankField:'displayRank',scoreField:'sor',baselineRankField:'rank',baselineScoreField:'achievement',
    sosMethod:'Mean opponent Colley achievement, ranked among FBS teams',historicalArchives:'Retain their explicitly labeled Colley methodology',
    frozenCandidate:policy.candidateProtocolPath,promotedAt:policy.promotedAt};
  const numeric=rankings.map(t=>({id:t.id,rank:t.displayRank,sor:t.sor,tail:t.sorTailProbability,expectedWins:t.sorExpectedWins,conferenceRank:t.displayConferenceRank}));
  const publicationHash=hash(JSON.stringify({baseSnapshotHash:snapshot.snapshotHash,modelId:policy.id,publicationVersion:policy.publicationVersion,parameters:policy.parameters,rows:numeric}));
  return {...snapshot,rankings,ratings,rankingMethod,modelPublishedAt:publishedAt,publicationHash};
}
