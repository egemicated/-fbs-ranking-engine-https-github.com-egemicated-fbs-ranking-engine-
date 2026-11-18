import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { atomicJson } from '../src/ingest.js';
import { buildArchivedConferenceDataset } from '../src/conference-publication.js';

const [seasonPath] = process.argv.slice(2);
if (!seasonPath || process.argv.length !== 3) {
  throw Error('Usage: node scripts/archive-conference-season.js PATH_TO_EXISTING_NORMALIZED_SEASON');
}
const root = resolve(import.meta.dirname, '..');
const season = JSON.parse(await readFile(seasonPath, 'utf8'));
if (!Number.isInteger(season.year)) throw Error('Invalid cached season');
const prior = JSON.parse(await readFile(resolve(root, 'published', `prior-${season.year}.json`), 'utf8'));
const archive = buildArchivedConferenceDataset({ season, prior });
await atomicJson(resolve(root, 'published', 'conference-archives', `${archive.season}.json`), archive, { spacing: 0 });
console.log(`Archived ${archive.games.length} conference results for ${archive.season}`);
