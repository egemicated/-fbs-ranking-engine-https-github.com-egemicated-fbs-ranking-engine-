import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicJson } from '../src/ingest.js';
const data = resolve(process.env.DATA_DIR || 'data');
const report = JSON.parse(await readFile(join(data, 'reports', 'holdout.json'), 'utf8'));
const selection = JSON.parse(await readFile(join(data, 'reports', 'selection.json'), 'utf8'));
const quality = [];
for (const file of (await readdir(join(data, 'seasons'))).filter(f => /^\d{4}\.json$/.test(f)).sort()) {
  const s = JSON.parse(await readFile(join(data, 'seasons', file), 'utf8'));
  const fbs = new Set(s.teams.filter(t => t.division === 'fbs').map(t => t.id));
  const counts = new Map([...fbs].map(id => [id, 0]));
  for (const g of s.games.filter(g => g.completed)) for (const id of [g.home, g.away]) if (fbs.has(id)) counts.set(id, counts.get(id) + 1);
  quality.push({ season: s.year, fbsTeams: fbs.size, modeledTeams: s.teams.length,
    completedGames: s.games.filter(g => g.completed).length, fbsWithoutCompletedGames: [...counts].filter(([, count]) => !count).map(([id]) => id),
    sha256: s.source.sha256, fetchedAt: s.source.fetchedAt, ...s.source.audit });
}
await atomicJson('reports/validation.json', { status: 'experimental', validationYears: selection.validationYears,
  holdoutYears: Object.keys(report.bySeason).map(Number), config: report.config, overall: report.overall,
  bySeason: report.bySeason, limitations: report.limitations, selection: selection.candidates });
await atomicJson('reports/data-quality.json', quality);
console.log('Saved compact validation and coverage reports (no raw game dataset).');
