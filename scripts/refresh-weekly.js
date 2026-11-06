import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { importSeason, atomicJson } from '../src/ingest.js';
import { buildWeeklySnapshot } from '../src/weekly.js';
import { saveEvidence } from '../src/evidence.js';
import { readPublicationPolicy, publishDivisionSnapshot } from '../src/publication.js';

if (!process.env.CFBD_API_KEY) throw new Error('Add the CFBD_API_KEY GitHub Actions repository secret; no data was published');
const year = Number(process.env.RANKING_SEASON || 2026);
if (!Number.isInteger(year) || year < 2004 || year > 2100) throw new Error('Invalid RANKING_SEASON');
const prior = JSON.parse(await readFile(`published/prior-${year - 1}.json`, 'utf8'));
const config = JSON.parse(await readFile('data/model.json', 'utf8'));
const publicationPolicy = await readPublicationPolicy();
// Exactly two CFBD calls: season results and that season's FBS membership.
let snapshot;
const attemptStartedAt = new Date().toISOString();
try {
  const season = await importSeason(year, resolve('data'), { provider: 'cfbd', refresh: true });
  snapshot = publishDivisionSnapshot(buildWeeklySnapshot(season, prior, config), publicationPolicy);
  let existing;
  try { existing = JSON.parse(await readFile('published/latest.json', 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (existing?.season === year && snapshot.fbsTeams < existing.fbsTeams) throw new Error('FBS membership unexpectedly shrank; preserving the published snapshot');
  await saveEvidence({ year, dataDir: resolve('data'), outputDir: resolve('evidence/weekly'), snapshot, attemptStartedAt });
  await atomicJson(join('published', 'latest.json'), snapshot);
} catch (error) {
  await saveEvidence({ year, dataDir: resolve('data'), outputDir: resolve('evidence/weekly'), error, attemptStartedAt });
  throw error;
}
console.log(`Published ${snapshot.season}: ${snapshot.fbsTeams} FBS teams, ${snapshot.gamesUsed} completed games, 2 CFBD calls`);
