import { appendFile, readFile } from 'node:fs/promises';
import { atomicJson } from '../src/ingest.js';
import { fetchKickoffBoards, reconcilePublishedKickoffs } from '../src/kickoff-times.js';

if (process.argv.length !== 2) throw new Error('Usage: node scripts/refresh-published-kickoffs.js');
const latestPath = 'published/latest.json';
const weeklyPath = 'published/weekly-picks.json';
const json = path => readFile(path, 'utf8').then(JSON.parse);
const [snapshot, weekly] = await Promise.all([json(latestPath), json(weeklyPath)]);
const before = new Date().toISOString();
const boards = await fetchKickoffBoards(weekly.games, weekly.teams, { season: weekly.season, observedAt: before });
const result = reconcilePublishedKickoffs(snapshot, weekly, { boards, observedAt: new Date().toISOString() });
const updated = result.weekly !== weekly;
if (updated) {
  await atomicJson(weeklyPath, result.weekly);
  await atomicJson(latestPath, result.snapshot);
}
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `updated=${updated}\n`);
console.log(`Kickoff check: ${result.corrected.length} confirmed updates, ${result.unresolved.length} TBD. No CFBD calls.`);
