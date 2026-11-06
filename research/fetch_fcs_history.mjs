// Free unauthenticated public evidence. No CFBD, account keys, polls or live writes.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory=new URL('./cache/fcs-history/',import.meta.url);
await mkdir(directory,{recursive:true});
const requests=[];
for(let year=2014;year<=2025;year++) for(const date of [`${year}11`,`${year}12`,`${year+1}01`]) requests.push({year,date});
// The pandemic championship moved to spring. The repair will still require
// season.year=2020 and identities already present in that year's parent dataset.
for(const date of ['202104','202105']) requests.push({year:2020,date});
const sources=[];let next=0,newRequests=0;
const sha=raw=>createHash('sha256').update(raw).digest('hex');
// The group filter is not exhaustive: nationally televised FCS games can appear
// in the group80 window while absent from group81. Reuse already cached public
// Dec/Jan evidence instead of spending additional requests on those bytes.
const legacy=JSON.parse(await readFile(new URL('./cache/espn-postseason-sources.json',import.meta.url),'utf8'));
for(const source of legacy){
  const date=String(source.year),month=Number(date.slice(-2));
  const year=Number(date.slice(0,4))-(month===1?1:0);
  if(year<2014||year>2022)continue;
  const raw=await readFile(new URL(`./cache/espn-month-${date}.json`,import.meta.url),'utf8');
  if(sha(raw)!==source.sha256)throw Error(`Legacy checksum mismatch ${date}`);
  const name=`fbs-window-${date}.json`,metadata={url:source.url,sha256:source.sha256,bytes:Buffer.byteLength(raw),
    retrievedAt:null,retrievalNote:'Reused prior verified cache; original source manifest did not record a retrieval timestamp.'};
  await writeFile(new URL(name,directory),raw);await writeFile(new URL(`${name}.metadata.json`,directory),JSON.stringify(metadata,null,2)+'\n');
  sources.push({...metadata,file:name,targetSeason:year,date,events:JSON.parse(raw).events.length});
}
async function worker(){
  for(;;){
    const request=requests[next++];if(!request)return;
    const {year,date}=request,name=`fcs-${date}.json`;
    const url=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${date}&groups=81&limit=1000`;
    const path=new URL(name,directory),metaPath=new URL(`${name}.metadata.json`,directory);
    let raw,metadata;
    try{raw=await readFile(path,'utf8');metadata=JSON.parse(await readFile(metaPath,'utf8'));}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      const response=await fetch(url,{signal:AbortSignal.timeout(30000)});newRequests++;
      if(!response.ok)throw Error(`Public source ${date}: HTTP ${response.status}`);
      raw=await response.text();
      metadata={url,retrievedAt:new Date().toISOString(),sha256:sha(raw),bytes:Buffer.byteLength(raw)};
      await writeFile(path,raw);await writeFile(metaPath,JSON.stringify(metadata,null,2)+'\n');
    }
    if(metadata.url!==url||metadata.sha256!==sha(raw))throw Error(`Cache integrity mismatch ${name}`);
    const payload=JSON.parse(raw);
    if(!Array.isArray(payload.events)||payload.events.length>=1000)throw Error(`Invalid or potentially truncated source ${name}`);
    sources.push({...metadata,file:name,targetSeason:year,date,events:payload.events.length});
  }
}
await Promise.all([worker(),worker(),worker()]);
sources.sort((a,b)=>a.date.localeCompare(b.date)||a.file.localeCompare(b.file));
const manifest={version:'fcs-history-source-v1',provider:'ESPN public scoreboard',cfbdCalls:0,
  caution:'Group filters and monthly responses do not independently certify completeness; seasonType can follow FBS calendar rather than FCS playoff round.',sources};
await writeFile(new URL('manifest.json',directory),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({sources:sources.length,newPublicRequests:newRequests,eventsBeforeDeduplication:sources.reduce((n,s)=>n+s.events,0),cfbdCalls:0}));
