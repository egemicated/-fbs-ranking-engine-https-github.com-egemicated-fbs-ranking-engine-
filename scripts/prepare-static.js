import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readPerformance } from '../src/performance-publication.js';
import { publishDivisionSnapshot, readPublicationPolicy } from '../src/publication.js';
import { matchupValidation, snapshotCoverage } from '../src/site-validation.js';

const root = resolve(import.meta.dirname, '..');
const frontend = join(root, 'frontend');
const published = join(root, 'published');
const output = join(root, 'static-dist');
const data = join(output, 'data');
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
const { ratings, ...publicSnapshot } = snapshot;
publicSnapshot.rankingMethod = { ...snapshot.rankingMethod, publicationStatus: 'official' };
publicSnapshot.coverageValidation = snapshotCoverage(snapshot);
publicSnapshot.matchupValidation = matchupValidation(snapshot);
delete publicSnapshot.performanceEndpoint;
if (performance) publicSnapshot.performanceEndpoint = '/data/performance.json';

await cp(frontend, output, { recursive: true, filter: source => source !== legacyHero });
await mkdir(data, { recursive: true });
const performanceFile = join(data, 'performance.json');
await Promise.all([
  writeFile(join(output, 'index.html'), html.replace(marker, '<meta name="publication-data-root" content="/data">')),
  writeFile(join(data, 'rankings.json'), JSON.stringify(publicSnapshot)),
  performance ? writeFile(performanceFile, JSON.stringify(performance)) : rm(performanceFile, { force: true }),
]);
console.log(`Ready: ${snapshot.season} static rankings for ${snapshot.fbsTeams} FBS teams${performance ? ' with experimental Performance' : ''}`);
