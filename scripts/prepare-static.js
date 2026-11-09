import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readPerformance } from '../src/performance-publication.js';
import { publishDivisionSnapshot, readPublicationPolicy } from '../src/publication.js';
import { publicRankings, publicTeamDetails } from '../src/site-publication.js';
import { matchupValidation, snapshotCoverage } from '../src/site-validation.js';
import { UPDATE_SCHEDULE } from '../src/weekly.js';

const root = resolve(import.meta.dirname, '..');
const frontend = join(root, 'frontend');
const published = join(root, 'published');
const output = join(root, 'static-dist');
const data = join(output, 'data');
const teamDirectory = join(data, 'teams');
const legacyHero = join(frontend, 'assets', 'stadium.png');

// Build from committed results and use the same publication rules as the API.
const [policy, source, html] = await Promise.all([
  readPublicationPolicy(),
  readFile(join(published, 'latest.json'), 'utf8'),
  readFile(join(frontend, 'index.html'), 'utf8'),
]);
const marker = '<meta name="publication-data-root" content="">';
if (!html.includes(marker)) throw new Error('Missing publication data root in frontend/index.html');
const input = JSON.parse(source);
const snapshot = publishDivisionSnapshot(input, policy, {
  publishedAt: input.modelPublishedAt ?? policy.promotedAt,
});
const performance = await readPerformance(published, snapshot);
const publicSnapshot = publicRankings(snapshot, '/data/teams');
if (snapshot.update) publicSnapshot.update = { ...snapshot.update, schedule: UPDATE_SCHEDULE };
publicSnapshot.rankingMethod = { ...snapshot.rankingMethod, publicationStatus: 'official' };
publicSnapshot.coverageValidation = snapshotCoverage(snapshot);
publicSnapshot.matchupValidation = matchupValidation(snapshot);
delete publicSnapshot.performanceEndpoint;
if (performance) publicSnapshot.performanceEndpoint = '/data/performance.json';

await cp(frontend, output, { recursive: true, filter: source => source !== legacyHero });
await mkdir(teamDirectory, { recursive: true });
const teamFiles = new Set();
await Promise.all(snapshot.rankings.map(async row => {
  const filename = `${encodeURIComponent(row.id)}.json`;
  teamFiles.add(filename);
  await writeFile(join(teamDirectory, filename), JSON.stringify(publicTeamDetails(snapshot, row)));
}));
const staleTeamFiles = (await readdir(teamDirectory, { withFileTypes: true }))
  .filter(file => file.isFile() && file.name.endsWith('.json') && !teamFiles.has(file.name));
await Promise.all(staleTeamFiles.map(file => rm(join(teamDirectory, file.name), { force: true })));
const performanceFile = join(data, 'performance.json');
const picksFile = join(data, 'weekly-picks.json');
await Promise.all([
  writeFile(join(output, 'index.html'), html.replace(marker, '<meta name="publication-data-root" content="/data">')),
  writeFile(join(data, 'rankings.json'), JSON.stringify(publicSnapshot)),
  performance ? writeFile(performanceFile, JSON.stringify(performance)) : rm(performanceFile, { force: true }),
  cp(join(published, 'weekly-picks.json'), picksFile).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return rm(picksFile, { force: true });
  }),
]);
console.log(`Ready: ${snapshot.season} static rankings for ${snapshot.fbsTeams} FBS teams${performance ? ' with experimental Performance' : ''}`);
