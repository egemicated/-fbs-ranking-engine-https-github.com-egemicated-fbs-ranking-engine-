// Read-only offline comparison. No fetch, coefficient fitting or publication.
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { backtest, buildHistory } from '../src/history.js';
import { validateSeason, solveGraph } from '../src/engine.js';

const { values } = parseArgs({ options: {
  'data-dir': { type: 'string', default: 'data' },
  'repaired-dir': { type: 'string', default: 'research/datasets/historical-coverage-v1/seasons' },
} });
const root = resolve(import.meta.dirname, '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const json = async path => JSON.parse(await readFile(path));
const config = await json(join(root,'data/model.json'));
const metadata = await json(join(root,'research/releases/historical-coverage-v1.metadata.json'));
const releaseBytes = await readFile(join(root,'research/releases',metadata.file));
if (hash(releaseBytes) !== metadata.sha256) throw Error('Historical release checksum differs');
const release = JSON.parse(gunzipSync(releaseBytes));
const old = [], repaired = [];
const lineage = [];
for (let year=2004; year<=2025; year++) {
  const parentBytes=await readFile(join(resolve(values['data-dir']),'seasons',year+'.json'));
  const outputBytes=await readFile(join(resolve(values['repaired-dir']),year+'.json'));
  const patch=release.seasons[year];
  if (!patch || hash(parentBytes)!==patch.parentSha256 || hash(outputBytes)!==patch.outputSha256) {
    throw Error('Unverified historical input for '+year);
  }
  old.push(validateSeason(JSON.parse(parentBytes)));
  repaired.push(validateSeason(JSON.parse(outputBytes)));
  lineage.push({year,parentSha256:hash(parentBytes),repairedSha256:hash(outputBytes)});
}
const baseline=backtest(old,{config,evaluateYears:[2023,2024,2025]});
const corrected=backtest(repaired,{config,evaluateYears:[2023,2024,2025]});
const originalHistory=buildHistory(old,config);
const correctedHistory=buildHistory(repaired,config);
const prior=await json(join(root,'published/prior-2025.json'));
const current=await json(join(root,'published/latest.json'));
const stored=new Map(prior.ratings.map(team=>[team.id,team]));
const originalPrior=originalHistory.at(-1);
if (originalPrior.ratings.length !== prior.ratings.length || originalPrior.ratings.some(team=>
  !Number.isFinite(stored.get(team.id)?.strength) || Math.abs(team.strength-stored.get(team.id).strength)>1e-9)) {
  throw Error('Original archived prior does not reproduce the committed prior');
}
const correctedPrior=new Map(correctedHistory.at(-1).ratings.map(team=>[team.id,team]));
const indices=new Map(current.ratings.map((team,index)=>[team.id,index]));
const seen=new Set(), edges=[];
for (const team of current.ratings) for (const game of team.contributions) {
  if (seen.has(game.gameId)) continue;
  seen.add(game.gameId);
  edges.push([indices.get(team.id),indices.get(game.opponentId)]);
}
const rhs=current.ratings.map(team=>config.ridge*config.retention*
  ((correctedPrior.get(team.id)?.strength??0)-(stored.get(team.id)?.strength??0)));
const delta=solveGraph(current.ratings.length,edges,rhs,config.ridge);
const oldOrder=[...current.rankings].sort((a,b)=>b.strength-a.strength||a.id.localeCompare(b.id));
const newOrder=[...current.rankings].sort((a,b)=>
  b.strength+delta[indices.get(b.id)]-a.strength-delta[indices.get(a.id)]||a.id.localeCompare(b.id));
const oldRanks=new Map(oldOrder.map((team,index)=>[team.id,index+1]));
const newRanks=new Map(newOrder.map((team,index)=>[team.id,index+1]));
console.log(JSON.stringify({
  status:'Offline historical coverage sensitivity. Production inputs, publications and model parameters were not changed.',
  release:{sha256:metadata.sha256,addedGames:metadata.addedGames,removedDuplicates:metadata.removedDuplicates},
  config,evaluationYears:[2023,2024,2025],baseline:baseline.overall,repaired:corrected.overall,
  currentScenario:{asOf:current.asOf,snapshotHash:current.snapshotHash,
    maximumFbsStrengthChange:Math.max(...current.rankings.map(team=>Math.abs(delta[indices.get(team.id)]))),
    predictivePositionsChanged:current.rankings.filter(team=>oldRanks.get(team.id)!==newRanks.get(team.id)).length,
    changed:current.rankings.filter(team=>oldRanks.get(team.id)!==newRanks.get(team.id)).map(team=>({team:team.name,
      originalRank:oldRanks.get(team.id),sensitivityRank:newRanks.get(team.id),strengthChange:delta[indices.get(team.id)]})),
    sorDependsOnHistoricalPrior:false},
  sourceLineage:lineage,
  limitations:[
    'Previously inspected retrospective seasons. The score differences do not establish prospective superiority.',
    'The baseline probability scale here is the frozen engine scale14 so the comparison isolates only data coverage.',
    'The current sensitivity replaces only the earlier-season prior in the same current game graph.',
    'Lower-division coverage, spring2020 membership and older venue ambiguities remain.',
  ],
},null,2));
