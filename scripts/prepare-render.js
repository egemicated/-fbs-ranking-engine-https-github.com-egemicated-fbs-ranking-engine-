import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { importSeason, atomicJson } from '../src/ingest.js';
import { buildHistory } from '../src/history.js';

// Build artifacts are carried into Render's runtime filesystem. A fresh build
// reconstructs the ratings without requiring a database or persistent disk.
const checks = spawnSync(process.execPath, ['--test'], { stdio: 'inherit' });
if (checks.status !== 0) process.exit(checks.status || 1);
const data = resolve(process.env.DATA_DIR || 'data');
const year = Number(process.env.RANKING_SEASON || 2026);
if (!Number.isInteger(year) || year < 2004 || year > 2100) throw new Error('Invalid RANKING_SEASON');
const config = JSON.parse(await readFile(join(data, 'model.json'), 'utf8'));
const seasons = [];
for (let season = 2004; season <= year; season++) {
  seasons.push(await importSeason(season, data, { refresh: true }));
  console.log(`Imported ${season}`);
}
const before = new Date().toISOString();
let latest;
for (const snapshot of buildHistory(seasons, config, before)) {
  await atomicJson(join(data, 'snapshots', `${snapshot.season}.json`), snapshot);
  latest = snapshot;
}
if (!latest?.rankings.length || !latest.gamesUsed) throw new Error('Build produced no rankings');
await atomicJson(join(data, 'snapshots', 'latest.json'), latest);
console.log(`Ready: ${latest.season}, ${latest.fbsTeams} FBS teams, ${latest.gamesUsed} completed games`);
