// Free public ESPN scoreboard evidence for gaps in the cached CFBD-derived CSVs.
// This script has no CFBD endpoint, API key, or publishing operation.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const directory=new URL('./cache/',import.meta.url);
await mkdir(directory,{recursive:true});
const archivePath=new URL('cfb_games_info.csv',directory);
try {await readFile(archivePath);}
catch(error) {
  if(error.code!=='ENOENT')throw error;
  const response=await fetch('https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/schedules/cfb_games_info.csv',{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Public game-info archive: HTTP ${response.status}`);
  await writeFile(archivePath,await response.text());
}
const manifest=[];
const months=Array.from({length:19},(_,i)=>2004+i).flatMap(year=>[year*100+12,(year+1)*100+1]);
for(const year of months) {
  const url=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${year}&groups=80&limit=1000`;
  const path=new URL(`espn-month-${year}.json`,directory);
  let text;
  try {text=await readFile(path,'utf8');}
  catch(error) {
    if(error.code!=='ENOENT')throw error;
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(`ESPN archive ${year}: HTTP ${response.status}: ${(await response.text()).slice(0,500)}`);
    text=await response.text();
    const data=JSON.parse(text);
    if(!Array.isArray(data.events))throw Error('Unexpected scoreboard schema');
    await writeFile(path,text);
  }
  const data=JSON.parse(text);
  manifest.push({year,url,sha256:createHash('sha256').update(text).digest('hex'),events:data.events.length,bytes:Buffer.byteLength(text)});
}
await writeFile(new URL('espn-postseason-sources.json',directory),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({months:manifest.length,events:manifest.reduce((n,x)=>n+x.events,0),bytes:manifest.reduce((n,x)=>n+x.bytes,0),sourceManifest:'research/cache/espn-postseason-sources.json'},null,2));
