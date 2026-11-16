import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadPlayerSchedule, publishPlayerPages } from '../src/player-publication.js';

const [input, output = 'published'] = process.argv.slice(2);
if (!input || process.argv.length > 4) throw new Error('Usage: node scripts/publish-team-players.js <private cache> [publication directory]');
const root = resolve(import.meta.dirname, '..');
const [cache, schedule] = await Promise.all([
  readFile(input, 'utf8').then(JSON.parse), loadPlayerSchedule(join(root, 'published')),
]);
const evidence = await publishPlayerPages({ cache, schedule, directory: output });
await writeFile(join(resolve(input, '..'), 'coverage.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
