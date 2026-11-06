// Frozen research observations only. Never fetches data or replaces public ranks.
import { createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { atomicJson } from '../src/ingest.js';
import { calculateSor } from '../research/lib/sor_candidate.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const IMPLEMENTATION_PATHS=['research/lib/sor_candidate.mjs','src/engine.js','scripts/record-research-comparison.js'];

export function makeObservation({season,snapshot,protocol,sourceEvidence,implementationHashes,normalizedBytes,snapshotBytes,recordedAt=new Date().toISOString()}) {
  if(!/^[a-zA-Z0-9_-]+$/.test(protocol.id)||!Number.isFinite(Date.parse(protocol.frozenAt)))throw Error('Invalid frozen comparison protocol');
  for(const path of IMPLEMENTATION_PATHS) if(!protocol.implementationSha256[path]||protocol.implementationSha256[path]!==implementationHashes[path])throw Error(`Frozen implementation changed: ${path}; create a new protocol version`);
  if(season.year!==snapshot.season||season.source?.provider!=='cfbd'||snapshot.source?.provider!=='cfbd'||season.source.sha256!==snapshot.source.sha256)throw Error('Research inputs do not share the published CFBD source');
  if(sourceEvidence.status!=='validated'||sourceEvidence.snapshotHash!==snapshot.snapshotHash)throw Error('Research observation requires matching validated source evidence');
  const evidenceHash=name=>sourceEvidence.files.find(f=>f.name===name)?.sha256;
  if(evidenceHash('normalized-season.json')!==hash(normalizedBytes)||evidenceHash('snapshot.json')!==hash(snapshotBytes))throw Error('Research source file checksums do not match retained evidence');
  if(!Number.isFinite(Date.parse(snapshot.asOf)))throw Error('Invalid snapshot cutoff');
  const gameIds=new Set(snapshot.ratings.flatMap(t=>t.contributions.map(g=>g.gameId)));
  const eligible=season.games.filter(g=>g.completed&&Date.parse(g.startDate)<=Date.parse(snapshot.asOf));
  if(gameIds.size!==snapshot.gamesUsed||eligible.length!==gameIds.size||eligible.some(g=>!gameIds.has(g.id)))throw Error('Research game set differs from published game set');
  const games=eligible.map(g=>({id:g.id,a:g.home,b:g.away,outcome:Math.sign(g.homePoints-g.awayPoints),venue:g.neutral?0:1}));
  const result=calculateSor({teams:season.teams,games},protocol.parameters);
  const published=new Map(snapshot.rankings.map(t=>[t.id,t]));
  if(result.rows.length!==published.size)throw Error('Research FBS population differs from publication');
  for(const row of result.rows) {
    const t=published.get(row.id);
    if(!t||t.wins!==row.wins||t.losses!==row.losses||t.rank!==row.colleyRank||Math.abs(t.achievement-row.colley)>1e-8)throw Error(`Research Colley baseline differs for ${row.id}`);
  }
  const phase=Date.parse(snapshot.asOf)>Date.parse(protocol.frozenAt)&&Date.parse(snapshot.source.fetchedAt)>Date.parse(protocol.frozenAt)?'post-freeze-publication':'retrospective-baseline';
  const data={schemaVersion:1,protocolId:protocol.id,protocolSha256:hash(JSON.stringify(protocol)),frozenAt:protocol.frozenAt,
    phase,season:snapshot.season,asOf:snapshot.asOf,snapshotHash:snapshot.snapshotHash,sourceHash:snapshot.source.sha256,
    normalizedInputSha256:hash(normalizedBytes),sourceResponseFileSha256:evidenceHash('provider-responses.json'),
    gamesUsed:games.length,referenceFbsCount:result.referenceFbsCount,parameters:protocol.parameters,inputPolicyVersion:season.source.audit?.inputPolicyVersion??'legacy',
    implementationSha256:implementationHashes,rows:result.rows,
    interpretation:'Research achievement comparisons; post-freeze publication is not a pregame forecast or proof of superior ranking quality. No public rank replacement.'};
  return {...data,resultSha256:hash(JSON.stringify(data)),recordedAt,runtime:process.version};
}

export async function persistObservation(observation,{directory,evidenceDirectory}) {
  await mkdir(directory,{recursive:true});
  const name=`${observation.asOf.replace(/[^0-9]/g,'')}-${observation.snapshotHash.slice(0,12)}-${observation.protocolId}.json`;
  const path=join(directory,name);
  let saved=observation;
  try {
    const existing=JSON.parse(await readFile(path,'utf8'));
    if(existing.resultSha256!==observation.resultSha256)throw Error('Existing observation differs; refusing to rewrite frozen history');
    saved=existing;
  } catch(error) {if(error.code!=='ENOENT')throw error;await atomicJson(path,observation);}
  await atomicJson(join(evidenceDirectory,'research-comparison.json'),saved);
  const manifestPath=join(evidenceDirectory,'manifest.json');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  const bytes=await readFile(join(evidenceDirectory,'research-comparison.json'));
  manifest.files=manifest.files.filter(f=>f.name!=='research-comparison.json');
  manifest.files.push({name:'research-comparison.json',bytes:bytes.length,sha256:hash(bytes)});
  manifest.researchComparison={protocolId:saved.protocolId,resultSha256:saved.resultSha256,phase:saved.phase};
  await atomicJson(manifestPath,manifest);
  return {path,observation:saved};
}

async function main() {
  const year=Number(process.env.RANKING_SEASON||2026);
  const normalizedBytes=await readFile(`data/seasons/${year}.json`),snapshotBytes=await readFile('published/latest.json');
  const protocol=JSON.parse(await readFile('research/frozen-comparison.json','utf8'));
  const sourceEvidence=JSON.parse(await readFile('evidence/weekly/manifest.json','utf8'));
  const implementationHashes=Object.fromEntries(await Promise.all(IMPLEMENTATION_PATHS.map(async path=>[path,hash(await readFile(path))])));
  const observation=makeObservation({season:JSON.parse(normalizedBytes),snapshot:JSON.parse(snapshotBytes),protocol,sourceEvidence,implementationHashes,normalizedBytes,snapshotBytes});
  const result=await persistObservation(observation,{directory:'research/observations',evidenceDirectory:'evidence/weekly'});
  console.log(`Recorded ${result.observation.rows.length} FBS research rows under ${protocol.id}; public rankings unchanged`);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
