// Targeted free public team schedules. Research only; no CFBD, keys or publish.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const snapshot=JSON.parse(await readFile(new URL('../published/latest.json',import.meta.url),'utf8'));
const byId=new Map(snapshot.ratings.map(t=>[t.id,t]));
const ids=new Set(snapshot.rankings.map(t=>t.id));
for(const t of snapshot.rankings)for(const g of t.contributions)if(byId.get(g.opponentId).division==='fcs')ids.add(g.opponentId);
const directory=new URL(`./cache/opponents/${snapshot.snapshotHash.slice(0,12)}/teams/`,import.meta.url);
await mkdir(directory,{recursive:true});
const queue=[...ids].sort();let cursor=0;
const sources=[];
async function worker() {
  while(cursor<queue.length) {
    const id=queue[cursor++],name=`${id}.json`;
    const url=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${id}/schedule?season=${snapshot.season}&seasontype=2`;
    const path=new URL(name,directory),metaPath=new URL(`${name}.metadata.json`,directory);
    let raw,meta;
    try{raw=await readFile(path,'utf8');meta=JSON.parse(await readFile(metaPath,'utf8'));}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw Error(`Public team schedule ${id}: HTTP ${response.status}`);
      raw=await response.text();meta={url,retrievedAt:new Date().toISOString(),sha256:createHash('sha256').update(raw).digest('hex')};
      await writeFile(path,raw);await writeFile(metaPath,JSON.stringify(meta,null,2)+'\n');
    }
    const data=JSON.parse(raw);
    if(!Array.isArray(data.events)||String(data.team?.id)!==id)throw Error(`Unexpected team schedule identity/schema ${id}`);
    if(createHash('sha256').update(raw).digest('hex')!==meta.sha256||meta.url!==url)throw Error('Schedule evidence mismatch');
    sources.push({...meta,file:name,id,name:byId.get(id).name,division:byId.get(id).division,events:data.events.length});
  }
}
await Promise.all(Array.from({length:4},worker));
sources.sort((a,b)=>a.id.localeCompare(b.id));
await writeFile(new URL('manifest.json',directory),JSON.stringify({snapshotHash:snapshot.snapshotHash,asOf:snapshot.asOf,season:snapshot.season,sources},null,2)+'\n');
console.log(JSON.stringify({teams:sources.length,fbs:sources.filter(s=>s.division==='fbs').length,fcs:sources.filter(s=>s.division==='fcs').length,totalEventReferences:sources.reduce((n,s)=>n+s.events,0),minEvents:Math.min(...sources.map(s=>s.events)),maxEvents:Math.max(...sources.map(s=>s.events))},null,2));
