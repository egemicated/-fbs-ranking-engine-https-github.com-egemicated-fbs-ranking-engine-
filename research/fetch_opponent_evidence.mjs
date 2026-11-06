// Public, unauthenticated research reads only. No CFBD calls or publishing.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const snapshot=JSON.parse(await readFile(new URL('../published/latest.json',import.meta.url),'utf8'));
const year=snapshot.season;
const directory=new URL(`./cache/opponents/${snapshot.snapshotHash.slice(0,12)}/`,import.meta.url);
await mkdir(directory,{recursive:true});
const sources=[];
for(const group of [80,81]) for(const month of [8,9,10,11]) {
  const date=`${year}${String(month).padStart(2,'0')}`;
  const url=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${date}&groups=${group}&limit=1000`;
  const name=`g${group}-${date}.json`,path=new URL(name,directory),metadataPath=new URL(`${name}.metadata.json`,directory);
  let raw,metadata;
  try {raw=await readFile(path,'utf8');metadata=JSON.parse(await readFile(metadataPath,'utf8'));}
  catch(error) {
    if(error.code!=='ENOENT')throw error;
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(`Public scoreboard ${date} group ${group}: HTTP ${response.status}`);
    raw=await response.text();
    metadata={url,retrievedAt:new Date().toISOString(),sha256:createHash('sha256').update(raw).digest('hex')};
    await writeFile(path,raw);await writeFile(metadataPath,JSON.stringify(metadata,null,2)+'\n');
  }
  const data=JSON.parse(raw);
  if(!Array.isArray(data.events)||data.events.length>=1000)throw Error(`Invalid or potentially truncated scoreboard ${name}`);
  if(createHash('sha256').update(raw).digest('hex')!==metadata.sha256||metadata.url!==url)throw Error('Evidence metadata mismatch');
  sources.push({...metadata,file:name,group,month,events:data.events.length});
}
await writeFile(new URL('manifest.json',directory),JSON.stringify({snapshotHash:snapshot.snapshotHash,asOf:snapshot.asOf,year,sources},null,2)+'\n');
console.log(JSON.stringify({directory:directory.pathname,files:sources.length,eventsBeforeDeduplication:sources.reduce((s,x)=>s+x.events,0),snapshotAsOf:snapshot.asOf},null,2));
