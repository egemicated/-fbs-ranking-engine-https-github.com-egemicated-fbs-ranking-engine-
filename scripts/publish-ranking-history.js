import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { saveSorHistory } from '../src/ranking-history.js';

export async function publishRankingHistory(args = []) {
  const flags = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const [key, value] = args.slice(i, i + 2);
    if (!['--snapshot', '--season', '--picks', '--history', '--comparisons'].includes(key) || !value || value.startsWith('--') || flags.has(key)) {
      throw new Error('Usage: node scripts/publish-ranking-history.js [--snapshot path] [--season path | --picks path] [--history path] [--comparisons path]');
    }
    flags.set(key, value);
  }
  if (flags.has('--season') && flags.has('--picks')) throw new Error('Provide a season or Weekly Picks schedule');
  const snapshot = JSON.parse(await readFile(flags.get('--snapshot') ?? 'published/latest.json', 'utf8'));
  const schedule = JSON.parse(await readFile(flags.get('--picks') ?? flags.get('--season') ?? `data/seasons/${snapshot.season}.json`, 'utf8'));
  return saveSorHistory(snapshot, schedule, {
    historyPath: flags.get('--history') ?? 'frontend/ranking-history.json',
    comparisonPath: flags.get('--comparisons') ?? 'frontend/ranking-editions.json'
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(await publishRankingHistory(process.argv.slice(2)) ? 'Saved weekly SOR history' : 'Weekly SOR history is already current');
}
