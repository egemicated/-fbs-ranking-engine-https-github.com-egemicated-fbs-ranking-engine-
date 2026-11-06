// Read-only replay of every stored CSV through the actual production normalizer.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalizeCsv } from '../src/ingest.js';
const rows=[];
for(let year=2004;year<=2026;year++) {
  const raw=await readFile(new URL(`../data/raw/${year}.csv`,import.meta.url),'utf8');
  const stored=JSON.parse(await readFile(new URL(`../data/seasons/${year}.json`,import.meta.url),'utf8'));
  const rebuilt=normalizeCsv(raw,year,stored.source);
  const same=JSON.stringify(stored.teams)===JSON.stringify(rebuilt.teams)&&JSON.stringify(stored.games)===JSON.stringify(rebuilt.games);
  const rawHash=createHash('sha256').update(raw).digest('hex');
  rows.push({year,normalizedMatches:same,rawHashMatches:rawHash===stored.source.sha256,
    sourceFbsTeams:stored.teams.filter(t=>t.division==='fbs').length,
    completedGames:stored.games.filter(g=>g.completed).length,
    completedPostseason:stored.games.filter(g=>g.completed&&g.seasonType==='postseason').length,
    unknownDivisionTeams:stored.teams.filter(t=>t.division==='unknown').length,
    sourceAudit:stored.source.audit});
}
console.log(JSON.stringify(rows));
