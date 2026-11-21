import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { readPublicPerformance } from '../src/public-performance.js';
import { readFcsWeeklyPicks } from '../src/weekly-fcs-publication.js';
import { publishDivisionSnapshot, readPublicationPolicy } from '../src/publication.js';
import { publishFcsSnapshot } from '../src/fcs-publication.js';
import { buildUpcomingTeamSchedule, publicRankings, publicTeamDetails } from '../src/site-publication.js';
import { matchupValidation, snapshotCoverage } from '../src/site-validation.js';
import { readRankingMovement } from '../src/ranking-movement.js';
import { buildHomeHighlights } from '../src/home-highlights.js';
import { UPDATE_SCHEDULE } from '../src/refresh-schedule.js';
import { buildWeeklyTeamStats } from '../frontend/weekly-team-stats.js';
import { browserSorSource, buildScenarioPublication } from '../src/scenario-publication.js';
import { copyPlayerPages } from '../src/player-publication.js';
import { loadConferencePublications } from '../src/conference-publication.js';
import { requireRenderReleaseChecks } from './require-release-checks.mjs';
import { assertPublicationBundle } from '../src/publication-integrity.js';
import { applySecurityMetadata } from '../src/security-policy.js';

const root = resolve(import.meta.dirname, '..');
const { values: options } = parseArgs({ options: {
  'build-only': { type: 'boolean' }, 'basketball-publication': { type: 'string' }, 'output-dir': { type: 'string' },
} });
const releaseChecks = await requireRenderReleaseChecks();
// Render's existing build command invokes this file directly. Install the
// lockfile's build dependencies when the platform has not installed them.
try { await import('sharp'); }
catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  console.log('Installing pinned static-build dependencies');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const { stdout } = await promisify(execFile)(npm, ['ci', '--omit=dev'], {
    cwd: root, shell: process.platform === 'win32', timeout: 180_000, maxBuffer: 1024 * 1024,
  });
  console.log(stdout.trim());
}
const { prerenderPublicPages } = await import('./prerender-pages.js');
if (!releaseChecks && !options['build-only']) {
  console.log('Checking application and published-data integrity before building');
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ['--test'], {
      cwd: root, timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
    });
    console.log(stdout.trim().split('\n').slice(-8).join('\n'));
  } catch (error) {
    console.error(error.stdout?.trim().split('\n').slice(-45).join('\n') ?? error.message);
    throw Error('Application quality checks failed; static publication stopped');
  }
}
const frontend = join(root, 'frontend');
const published = join(root, 'published');
const output = resolve(root, options['output-dir'] ?? 'static-dist');
const data = join(output, 'data');
const teamDirectory = join(data, 'teams');
const basketballDirectory = resolve(root, options['basketball-publication'] ?? 'published/basketball-site');
const basketballExists = await access(join(basketballDirectory, 'manifest.json')).then(() => true, error => {
  if (error.code === 'ENOENT' && !options['basketball-publication']) return false;
  throw error;
});
// Clear retired asset paths from a reused local output directory.
const retiredAssets = [
  'assets/stadium.png', 'assets/fbs-intelligence-logo.svg', 'assets/fbs-intelligence-icon.png',
  'fonts/BarlowCondensed-Bold.ttf', 'fonts/BarlowCondensed-SemiBold.ttf',
];

// Build from committed results and use the same publication rules as the API.
const [policy, source, rawHtml, accountConfig] = await Promise.all([
  readPublicationPolicy(),
  readFile(join(published, 'latest.json'), 'utf8'),
  readFile(join(frontend, 'index.html'), 'utf8'),
  readFile(join(frontend, 'bracket-config.json'), 'utf8').then(JSON.parse),
]);
const html = applySecurityMetadata(rawHtml, { authUrl: accountConfig.url });
const marker = '<meta name="publication-data-root" content="">';
if (!html.includes(marker)) throw new Error('Missing publication data root in frontend/index.html');
const input = JSON.parse(source);
const fbsSnapshot = publishDivisionSnapshot(input, policy, {
  publishedAt: input.modelPublishedAt ?? policy.promotedAt,
});
const snapshot = publishFcsSnapshot(fbsSnapshot, policy);
const weeklySource = readFile(join(published, 'weekly-picks.json'), 'utf8').then(JSON.parse);
const [performance, fcsPicks, fbsPicks, movement] = await Promise.all([
  readPublicPerformance(published, snapshot),
  readFcsWeeklyPicks(published, snapshot),
  weeklySource.catch(() => null),
  readRankingMovement(join(frontend, 'ranking-history.json'), snapshot),
]);
const schedule = buildUpcomingTeamSchedule(snapshot, fbsPicks, fcsPicks);
const publicSnapshot = publicRankings(snapshot, '/data/teams', true);
if (movement) publicSnapshot.rankingMovement = movement;
const weekHighlights = buildHomeHighlights(snapshot, fbsPicks);
if (weekHighlights) publicSnapshot.weekHighlights = weekHighlights;
if (snapshot.update) publicSnapshot.update = { ...snapshot.update, schedule: UPDATE_SCHEDULE };
publicSnapshot.rankingMethod = { ...snapshot.rankingMethod, publicationStatus: 'official' };
publicSnapshot.coverageValidation = snapshotCoverage(snapshot);
publicSnapshot.matchupValidation = matchupValidation(snapshot);
delete publicSnapshot.performanceEndpoint;
if (performance) publicSnapshot.performanceEndpoint = '/data/performance.json';
if (fcsPicks) publicSnapshot.weeklyFcsPicksEndpoint = '/data/weekly-fcs-picks.json';

await cp(frontend, output, { recursive: true, filter: source => source !== join(frontend, 'index.html') });
await Promise.all(retiredAssets.map(file => rm(join(output, file), { force: true })));
await mkdir(teamDirectory, { recursive: true });
const teamFiles = new Set();
const publicTeams = [...snapshot.rankings, ...(snapshot.fcsRankings ?? [])];
await Promise.all(publicTeams.map(async row => {
  const filename = `${encodeURIComponent(row.id)}.json`;
  teamFiles.add(filename);
  const details = publicTeamDetails(snapshot, row, { upcomingGames: schedule.get(row.id), includeTeamSchedule: true });
  await writeFile(join(teamDirectory, filename), JSON.stringify(details));
}));
const staleTeamFiles = (await readdir(teamDirectory, { withFileTypes: true }))
  .filter(file => file.isFile() && file.name.endsWith('.json') && !teamFiles.has(file.name));
await Promise.all(staleTeamFiles.map(file => rm(join(teamDirectory, file.name), { force: true })));
const performanceFile = join(data, 'performance.json');
const picksFile = join(data, 'weekly-picks.json');
const fcsPicksFile = join(data, 'weekly-fcs-picks.json');
const statsFile = join(data, 'weekly-team-stats.json');
const scenarioFile = join(data, 'cfp-scenarios.json');
const conferenceDirectory = join(data, 'conferences');
const conferencePublication = loadConferencePublications({ root, snapshot, fbsPicks, performance });
assertPublicationBundle(snapshot, { fbsPicks, fcsPicks, conferences: await conferencePublication });
const weeklyStats = await weeklySource.then(buildWeeklyTeamStats)
  .catch(error => {
    if (error.code !== 'ENOENT') console.warn('Weekly team stats are unavailable:', error.message);
    return null;
  });
const scenario = await weeklySource.then(weekly => buildScenarioPublication(snapshot, weekly, policy)).catch(error => {
  if (error.code !== 'ENOENT') console.warn('CFP scenarios are unavailable:', error.message);
  return null;
});
await Promise.all([
  copyPlayerPages(published, data, publicTeams, snapshot.season),
  conferencePublication.then(async ({ manifest, datasets }) => {
    await mkdir(conferenceDirectory, { recursive: true });
    const files = new Map([['index.json', manifest], ...datasets.map(dataset => [`${dataset.season}.json`, dataset])]);
    const stale = (await readdir(conferenceDirectory)).filter(file => /^\d{4}\.json$/.test(file) && !files.has(file));
    await Promise.all([
      ...[...files].map(([file, contents]) => writeFile(join(conferenceDirectory, file), JSON.stringify(contents))),
      ...stale.map(file => rm(join(conferenceDirectory, file), { force: true })),
    ]);
  }),
  writeFile(join(data, 'rankings.json'), JSON.stringify(publicSnapshot)),
  performance ? writeFile(performanceFile, JSON.stringify(performance)) : rm(performanceFile, { force: true }),
  fcsPicks ? writeFile(fcsPicksFile, JSON.stringify(fcsPicks)) : rm(fcsPicksFile, { force: true }),
  weeklyStats ? writeFile(statsFile, JSON.stringify(weeklyStats)) : rm(statsFile, { force: true }),
  scenario ? writeFile(scenarioFile, JSON.stringify(scenario)) : rm(scenarioFile, { force: true }),
  browserSorSource().then(source => writeFile(join(output, 'scenario-sor.js'), source)),
  cp(join(published, 'weekly-picks.json'), picksFile).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return rm(picksFile, { force: true });
  }),
]);
const publicPages = await prerenderPublicPages({ root, output, snapshot, teams: publicTeams,
  html: html.replace(marker, '<meta name="publication-data-root" content="/data">'),
  fbsPicks, fcsPicks, conferenceDatasets: (await conferencePublication).datasets, multiSport: basketballExists });
console.log(`Prerendered ${publicPages.pages} public pages and social previews`);
if (basketballExists) {
  const {addBasketballSite} = await import('./prepare-basketball-static.mjs');
  const basketball = await addBasketballSite({root, output, publicationDirectory:basketballDirectory,
    football:publicSnapshot, authUrl:accountConfig.url});
  console.log(`Prerendered ${basketball.pages} basketball and shared pages from publication ${basketball.version}`);
}
console.log(`Ready: ${snapshot.season} static rankings for ${snapshot.fbsTeams} FBS and ${snapshot.fcsTeams ?? 0} FCS teams${performance ? ' with experimental Performance' : ''}`);
