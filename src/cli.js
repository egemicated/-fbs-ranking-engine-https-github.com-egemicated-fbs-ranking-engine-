import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { importSeason, atomicJson } from './ingest.js';
import { buildHistory, backtest } from './history.js';
import { DEFAULT_CONFIG } from './engine.js';

const [command, ...args] = process.argv.slice(2);
const dataDir = resolve(process.env.DATA_DIR || 'data');
const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
const load = async () => {
  const files = (await readdir(join(dataDir, 'seasons'))).filter(f => /^\d{4}\.json$/.test(f)).sort();
  if (!files.length) throw new Error('Import historical seasons first');
  return Promise.all(files.map(f => readFile(join(dataDir, 'seasons', f), 'utf8').then(JSON.parse)));
};
try {
  if (command === 'import') {
    const from = Number(option('--from', 2004)), to = Number(option('--to', 2025));
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) throw new Error('Invalid season range');
    for (let year = from; year <= to; year++) {
      const s = await importSeason(year, dataDir, { refresh: args.includes('--refresh'), provider: option('--provider', 'sportsdataverse') });
      console.log(`${year}: ${s.teams.filter(t => t.division === 'fbs').length} FBS teams; ${s.games.filter(g => g.completed).length} completed games`);
    }
  } else if (command === 'build') {
    const config = JSON.parse(await readFile(join(dataDir, 'model.json'), 'utf8').catch(e => { if (e.code === 'ENOENT') return JSON.stringify(DEFAULT_CONFIG); throw e; }));
    const explicitCutoff = option('--before', null);
    const before = explicitCutoff ?? new Date().toISOString();
    for (const snapshot of buildHistory(await load(), config, before)) {
      const name = explicitCutoff ? `${snapshot.season}-before-${before.replace(/[^0-9TZ-]/g, '')}` : `${snapshot.season}`;
      await atomicJson(join(dataDir, 'snapshots', `${name}.json`), snapshot);
      if (!explicitCutoff) await atomicJson(join(dataDir, 'snapshots', 'latest.json'), snapshot);
      console.log(`${snapshot.season}: ${snapshot.fbsTeams} FBS teams; ${snapshot.gamesUsed} games; ${snapshot.snapshotHash.slice(0, 12)}`);
    }
  } else if (command === 'backtest') {
    const seasons = await load(); const mode = option('--mode', 'evaluate');
    let config = { ...DEFAULT_CONFIG };
    if (mode === 'tune') {
      const validationYears = [2019, 2020, 2021, 2022];
      const candidates = [];
      // Holdout seasons 2023–2025 are excluded from parameter selection.
      for (const ridge of [3, 5, 8]) for (const retention of [0, 0.5, 0.75]) {
        const candidate = { ...DEFAULT_CONFIG, ridge, retention };
        const report = backtest(seasons.filter(s => s.year <= 2022), { config: candidate, evaluateYears: validationYears });
        if (!validationYears.every(y => report.bySeason[y]?.games > 0)) throw new Error('Import all validation seasons 2019–2022 before tuning');
        candidates.push({ config: candidate, ...report.overall });
        console.log(`ridge=${ridge} retention=${retention} logLoss=${report.overall.logLoss.toFixed(5)}`);
      }
      candidates.sort((a, b) => a.logLoss - b.logLoss); config = candidates[0].config;
      await atomicJson(join(dataDir, 'model.json'), config);
      await atomicJson(join(dataDir, 'reports', 'selection.json'), { validationYears, selectionMetric: 'logLoss', candidates, selected: config });
    } else if (mode !== 'evaluate') throw new Error('Mode must be tune or evaluate');
    else config = JSON.parse(await readFile(join(dataDir, 'model.json'), 'utf8').catch(e => { if (e.code === 'ENOENT') return JSON.stringify(DEFAULT_CONFIG); throw e; }));
    const report = backtest(seasons, { config, evaluateYears: [2023, 2024, 2025] });
    await atomicJson(join(dataDir, 'reports', 'holdout.json'), report);
    console.log(JSON.stringify({ config, overall: report.overall, bySeason: report.bySeason }, null, 2));
  } else throw new Error('Use: import [--from 2004 --to 2025 --refresh --provider sportsdataverse|cfbd], build [--before ISO_DATE], backtest [--mode tune|evaluate]');
} catch (e) { console.error(e.message); process.exitCode = 1; }
