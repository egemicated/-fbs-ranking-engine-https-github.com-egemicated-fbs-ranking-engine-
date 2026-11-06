// Read-only verification of our own deployed service. No CFBD endpoint.
import { readFile, writeFile } from 'node:fs/promises';
const local=JSON.parse(await readFile(new URL('../published/latest.json',import.meta.url),'utf8'));
const paths=['/health','/rankings','/'];
const responses=await Promise.all(paths.map(async path=>{
  const response=await fetch(`https://fbs-ranking-engine.onrender.com${path}`,{signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error(`Public ${path}: HTTP ${response.status}`);
  return {path,status:response.status,body:await response.text()};
}));
const remote=JSON.parse(responses.find(r=>r.path==='/rankings').body);
if(remote.snapshotHash!==local.snapshotHash)throw Error('Published ranking snapshot unexpectedly changed');
const view=rows=>rows.map(t=>[t.id,t.rank,t.wins,t.losses,t.achievement,t.strength]);
if(JSON.stringify(view(remote.rankings))!==JSON.stringify(view(local.rankings)))throw Error('Ranking rows changed');
if(responses.find(r=>r.path==='/').body!==await readFile(new URL('../frontend/index.html',import.meta.url),'utf8'))throw Error('Frontend changed unexpectedly');
const report={commit:process.argv[2]||'afe5736a994e3eaf47c57440973f9dd3d1fded61',renderDeploy:process.argv[3]||'dep-dbmnk07avr4c738v1r6g',
  endpoints:responses.map(({path,status})=>({path,status})),publishedSnapshotHash:remote.snapshotHash,
  publishedAsOf:remote.asOf,fbsTeams:remote.rankings.length,rankingsAndPredictiveStrengthUnchanged:true,frontendUnchanged:true};
await writeFile(new URL(process.argv[2]?'../review/opponent-live-verification.json':'../review/safeguards-live-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
