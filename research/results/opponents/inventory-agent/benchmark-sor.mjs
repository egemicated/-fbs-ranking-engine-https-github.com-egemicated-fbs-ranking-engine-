// Offline benchmark/cross-check, separate from the pure calculator and portable tests.
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { calculateSor } from '../../../lib/sor_candidate.mjs';

const raw = await readFile(new URL('../../../../published/latest.json',import.meta.url));
const snapshot = JSON.parse(raw);
const expected = JSON.parse(await readFile(new URL('../../merit-comparison.json',import.meta.url),'utf8'));
if (snapshot.snapshotHash !== expected.source.snapshotHash) throw Error('Benchmark/reference snapshots differ');
const byId = new Map(snapshot.ratings.map(t=>[t.id,t]));
const seen = new Set(), games = [];
for (const team of snapshot.ratings) for (const detail of team.contributions) {
  if (seen.has(detail.gameId)) continue;
  seen.add(detail.gameId);
  const reverse = byId.get(detail.opponentId).contributions.filter(g=>g.gameId===detail.gameId);
  if (reverse.length!==1 || reverse[0].finalMargin!==-detail.finalMargin || Math.abs(reverse[0].adjustedMargin+detail.adjustedMargin)>1e-9) throw Error('Contribution symmetry failed');
  const outcome = Math.sign(detail.finalMargin), candidates = new Set();
  for (const base of new Set([detail.finalMargin,outcome])) for (const venue of [-1,0,1]) {
    const adjusted = snapshot.config.marginCap*Math.tanh(base/snapshot.config.marginCap)-venue*snapshot.config.homeAdvantage;
    if (Math.abs(adjusted-detail.adjustedMargin)<1e-8) candidates.add(venue);
  }
  if(candidates.size!==1)throw Error('Venue recovery ambiguous');
  games.push({id:detail.gameId,a:team.id,b:detail.opponentId,outcome,venue:[...candidates][0]});
}
const dataset = {teams:snapshot.ratings.map(({id,name,division})=>({id,name,division})),games};
const start = performance.now(), result = calculateSor(dataset), elapsedMs = performance.now()-start;
const reference = new Map(expected.current.map(t=>[t.id,t]));
const maxError = {colley:0,sor:0,tail:0,expectedWins:0};
for (const row of result.rows) {
  const old=reference.get(row.id);
  if (!old || row.wins!==old.wins || row.losses!==old.losses || row.colleyRank!==old.colleyRank || row.sorRank!==old.sorRank) throw Error(`Row/rank mismatch ${row.team}`);
  for (const key of Object.keys(maxError)) maxError[key]=Math.max(maxError[key],Math.abs(row[key]-old[key]));
}
if (maxError.colley>1e-9 || maxError.sor>1e-8 || maxError.tail>1e-9 || maxError.expectedWins>1e-8) throw Error('Numerical deviation from Python reference');
const report={snapshotHash:snapshot.snapshotHash,sourceFileSha256:createHash('sha256').update(raw).digest('hex'),
  teams:dataset.teams.length,completedGames:games.length,fbsRows:result.rows.length,allRecordsAndRanksMatch:true,
  elapsedMs,maxAbsoluteError:maxError,nonFbsTieContextIds:games.filter(g=>g.outcome===0).map(g=>g.id).sort(),
  note:'One local warm filesystem/current snapshot run; portable tests use synthetic inputs and have no current-file dependency. Lower-division tie context is preserved for reproduction, not source certification.'};
await writeFile(new URL('./sor-benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
