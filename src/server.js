import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { VERSION } from './engine.js';
import { UPDATE_SCHEDULE } from './weekly.js';
import publicationPolicy from '../data/publication-model.json' with { type: 'json' };
import { readPublicPerformance } from './public-performance.js';
import { readFcsWeeklyPicks } from './weekly-fcs-publication.js';
import { buildUpcomingTeamSchedule, publicRankings, publicTeamDetails } from './site-publication.js';
import { matchupValidation, snapshotCoverage } from './site-validation.js';
import { readRankingMovement } from './ranking-movement.js';
import { buildHomeHighlights } from './home-highlights.js';
import { buildWeeklyTeamStats } from '../frontend/weekly-team-stats.js';
import { browserSorSource, buildScenarioPublication } from './scenario-publication.js';
import { readTeamPage } from './player-publication.js';

const directory = resolve(process.env.DATA_DIR || 'data', 'snapshots');
const publications = resolve(import.meta.dirname, '../published');
// Read-only API. No login to view public sports ratings; no write/admin routes.
export function createApi(snapshotDirectory = directory, frontendDirectory = resolve('frontend'), publicationDirectory = publications) {
  const staticFiles = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/scoreboard.js', ['scoreboard.js', 'text/javascript; charset=utf-8']],
    ['/scoreboard.css', ['scoreboard.css', 'text/css; charset=utf-8']],
    ['/my-team.js', ['my-team.js', 'text/javascript; charset=utf-8']],
    ['/my-team-updates.js', ['my-team-updates.js', 'text/javascript; charset=utf-8']],
    ['/my-team-colors.js', ['my-team-colors.js', 'text/javascript; charset=utf-8']],
    ['/my-team.css', ['my-team.css', 'text/css; charset=utf-8']],
    ['/rooting-guide.js', ['rooting-guide.js', 'text/javascript; charset=utf-8']],
    ['/rooting-guide-model.js', ['rooting-guide-model.js', 'text/javascript; charset=utf-8']],
    ['/rooting-guide-worker.js', ['rooting-guide-worker.js', 'text/javascript; charset=utf-8']],
    ['/rooting-guide.css', ['rooting-guide.css', 'text/css; charset=utf-8']],
    ['/share-card.js', ['share-card.js', 'text/javascript; charset=utf-8']],
    ['/game-calendar.js', ['game-calendar.js', 'text/javascript; charset=utf-8']],
    ['/share-calendar.css', ['share-calendar.css', 'text/css; charset=utf-8']],
    ['/team-players.js', ['team-players.js', 'text/javascript; charset=utf-8']],
    ['/team-players.css', ['team-players.css', 'text/css; charset=utf-8']],
    ['/bracket.js', ['bracket.js', 'text/javascript; charset=utf-8']],
    ['/bracket-board.js', ['bracket-board.js', 'text/javascript; charset=utf-8']],
    ['/bracket-auth.js', ['bracket-auth.js', 'text/javascript; charset=utf-8']],
    ['/bracket.css', ['bracket.css', 'text/css; charset=utf-8']],
    ['/bracket-config.json', ['bracket-config.json', 'application/json; charset=utf-8']],
    ['/bracket-demo.json', ['bracket-demo.json', 'application/json; charset=utf-8']],
    ['/cfp-scenario.js', ['cfp-scenario.js', 'text/javascript; charset=utf-8']],
    ['/cfp-scenario-model.js', ['cfp-scenario-model.js', 'text/javascript; charset=utf-8']],
    ['/cfp-scenario-field.js', ['cfp-scenario-field.js', 'text/javascript; charset=utf-8']],
    ['/cfp-scenario-worker.js', ['cfp-scenario-worker.js', 'text/javascript; charset=utf-8']],
    ['/cfp-scenario.css', ['cfp-scenario.css', 'text/css; charset=utf-8']],
    ['/ranking-editions.json', ['ranking-editions.json', 'application/json; charset=utf-8']],
    ['/weekly-picks-score.js', ['weekly-picks-score.js', 'text/javascript; charset=utf-8']],
    ['/weekly-team-stats.js', ['weekly-team-stats.js', 'text/javascript; charset=utf-8']],
    ['/weekly-contest.js', ['weekly-contest.js', 'text/javascript; charset=utf-8']],
    ['/weekly-contest-score.js', ['weekly-contest-score.js', 'text/javascript; charset=utf-8']],
    ['/weekly-contest.css', ['weekly-contest.css', 'text/css; charset=utf-8']],
    ['/ranking-history.js', ['ranking-history.js', 'text/javascript; charset=utf-8']],
    ['/ranking-history.css', ['ranking-history.css', 'text/css; charset=utf-8']],
    ['/ranking-history.json', ['ranking-history.json', 'application/json; charset=utf-8']],
    ['/assets/stadium.png', ['assets/stadium.png', 'image/png']],
    ['/assets/stadium.webp', ['assets/stadium.webp', 'image/webp']],
    ['/assets/stadium-mobile.webp', ['assets/stadium-mobile.webp', 'image/webp']],
    ['/assets/fbs-intelligence-logo.svg', ['assets/fbs-intelligence-logo.svg', 'image/svg+xml']],
    ['/assets/fbs-intelligence-icon.png', ['assets/fbs-intelligence-icon.png', 'image/png']],
    ['/fonts/BarlowCondensed-Bold.ttf', ['fonts/BarlowCondensed-Bold.ttf', 'font/ttf']],
    ['/fonts/BarlowCondensed-SemiBold.ttf', ['fonts/BarlowCondensed-SemiBold.ttf', 'font/ttf']],
    ['/fonts/BarlowCondensed-Bold.woff2', ['fonts/BarlowCondensed-Bold.woff2', 'font/woff2']],
    ['/fonts/BarlowCondensed-SemiBold.woff2', ['fonts/BarlowCondensed-SemiBold.woff2', 'font/woff2']]
  ]);
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=60');
    const send = (status, value) => { res.writeHead(status); res.end(JSON.stringify(value)); };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return send(405, { error: 'Read-only API' }); }
    const path = new URL(req.url, 'http://localhost').pathname;
    if (staticFiles.has(path)) {
      const [file, type] = staticFiles.get(path);
      try {
        const body = await readFile(join(frontendDirectory, file));
        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', path.startsWith('/fonts/') || path.startsWith('/assets/') ? 'public, max-age=3600' : 'no-cache');
        res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : body); return;
      } catch (e) { return send(e.code === 'ENOENT' ? 404 : 500, { error: 'Page unavailable' }); }
    }
    if (path === '/health') return send(200, { status: 'ok', modelVersion: VERSION, rankingMethod: publicationPolicy.id });
    if (path === '/api') return send(200, { service: 'Independent FBS Ranking Engine', modelVersion: VERSION, status: 'experimental',
      rankingMethod: { id: publicationPolicy.id, name: publicationPolicy.name, publicationStatus: 'official', rankField: 'displayRank', scoreField: 'sor', baselineRankField: 'rank', baselineScoreField: 'achievement' },
      historicalMethod: 'Colley; inspect the selected snapshot metadata', updateSchedule: UPDATE_SCHEDULE,
      experimentalPerformance: { endpoint: '/performance', name: 'Scrimmage consistency', status: 'experimental', providerCallsPerPageView: 0 },
      endpoints: ['/health', '/rankings', '/rankings/2025', '/performance', '/weekly-fcs-picks'] });
    if (path === '/performance') {
      try {
        const snapshot = JSON.parse(await readFile(join(snapshotDirectory, 'latest.json'), 'utf8'));
        const performance = await readPublicPerformance(snapshotDirectory, snapshot);
        return performance ? send(200, performance) : send(503, { error: 'Experimental Performance is unavailable for this snapshot' });
      } catch { return send(503, { error: 'Experimental Performance is unavailable for this snapshot' }); }
    }
    if (path === '/weekly-picks' || path === '/weekly-team-stats') {
      try {
        const picks = JSON.parse(await readFile(join(publicationDirectory, 'weekly-picks.json'), 'utf8'));
        return send(200, path === '/weekly-picks' ? picks : buildWeeklyTeamStats(picks));
      } catch (error) {
        return send(error.code === 'ENOENT' ? 404 : 503, { error: 'Weekly picks are unavailable' });
      }
    }
    if (path === '/weekly-fcs-picks') {
      res.setHeader('Cache-Control', 'no-cache');
      try {
        const snapshot = JSON.parse(await readFile(join(snapshotDirectory, 'latest.json'), 'utf8'));
        const picks = await readFcsWeeklyPicks(publicationDirectory, snapshot);
        return picks ? send(200, picks) : send(404, { error: 'FCS weekly picks are unavailable for this snapshot' });
      } catch { return send(503, { error: 'FCS weekly picks are unavailable for this snapshot' }); }
    }
    if (path === '/scenario-sor.js') {
      try {
        const source = await browserSorSource();
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : source); return;
      } catch { return send(503, { error: 'Scenario calculator unavailable' }); }
    }
    if (path === '/cfp-scenarios') {
      try {
        const [snapshot, weekly] = await Promise.all([
          readFile(join(snapshotDirectory, 'latest.json'), 'utf8').then(JSON.parse),
          readFile(join(publicationDirectory, 'weekly-picks.json'), 'utf8').then(JSON.parse),
        ]);
        const scenario = buildScenarioPublication(snapshot, weekly, publicationPolicy);
        return scenario ? send(200, scenario) : send(503, { error: 'CFP scenarios are unavailable' });
      } catch { return send(503, { error: 'CFP scenarios are unavailable' }); }
    }
    const playerPage = /^\/(team-players|team-availability)\/(\d{1,24})(?:\.json)?$/.exec(path);
    if (playerPage) {
      try {
        const snapshot = JSON.parse(await readFile(join(snapshotDirectory, 'latest.json'), 'utf8'));
        const page = await readTeamPage(publicationDirectory, playerPage[1], playerPage[2], snapshot.season);
        return page ? send(200, page) : send(404, { error: 'No player report for this season' });
      } catch { return send(503, { error: 'Player report unavailable' }); }
    }
    const match = /^\/rankings(?:\/(\d{4}))?(?:\/teams\/([^/]+)\.json)?$/.exec(path);
    if (!match) return send(404, { error: 'Not found' });
    const [, year, teamId] = match;
    try {
      const snapshot = JSON.parse(await readFile(join(snapshotDirectory, `${year || 'latest'}.json`), 'utf8'));
      if (teamId) {
        const team = snapshot.rankings.find(row => encodeURIComponent(row.id) === teamId) ??
          snapshot.fcsRankings?.find(row => encodeURIComponent(row.id) === teamId);
        if (!team) return send(404, { error: 'Team not found' });
        if (year) return send(200, publicTeamDetails(snapshot, team));
        const [fbsPicks, fcsPicks] = await Promise.all([
          readFile(join(publicationDirectory, 'weekly-picks.json'), 'utf8').then(JSON.parse).catch(() => null),
          readFcsWeeklyPicks(publicationDirectory, snapshot),
        ]);
        const schedule = buildUpcomingTeamSchedule(snapshot, fbsPicks, fcsPicks);
        return send(200, publicTeamDetails(snapshot, team, { upcomingGames: schedule.get(team.id), includeTeamSchedule: true }));
      }
      const publicSnapshot = publicRankings(snapshot, `/rankings${year ? `/${year}` : ''}/teams`, !year);
      if (!year && snapshot.update) publicSnapshot.update = { ...snapshot.update, schedule: UPDATE_SCHEDULE };
      if (snapshot.rankingMethod?.id === publicationPolicy.id) {
        publicSnapshot.rankingMethod = { ...snapshot.rankingMethod, publicationStatus: 'official' };
        publicSnapshot.coverageValidation = snapshotCoverage(snapshot);
        publicSnapshot.matchupValidation = matchupValidation(snapshot);
      }
      const [performance, fcsPicks, movement, fbsPicks] = await Promise.all([
        readPublicPerformance(snapshotDirectory, snapshot),
        !year && readFcsWeeklyPicks(publicationDirectory, snapshot),
        !year && readRankingMovement(join(frontendDirectory, 'ranking-history.json'), snapshot),
        !year && readFile(join(publicationDirectory, 'weekly-picks.json'), 'utf8').then(JSON.parse).catch(() => null),
      ]);
      if (performance) publicSnapshot.performanceEndpoint = '/performance';
      if (fcsPicks) publicSnapshot.weeklyFcsPicksEndpoint = '/weekly-fcs-picks';
      if (movement) publicSnapshot.rankingMovement = movement;
      const weekHighlights = buildHomeHighlights(snapshot, fbsPicks);
      if (weekHighlights) publicSnapshot.weekHighlights = weekHighlights;
      return send(200, publicSnapshot);
    } catch (e) { return send(e.code === 'ENOENT' ? 503 : 500, { error: e.code === 'ENOENT' ? 'Rankings have not been built for this season' : 'Could not read rankings' }); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  createApi().listen(Number(process.env.PORT || 3000), process.env.RENDER ? '0.0.0.0' : '127.0.0.1', () => console.log('Ranking API started'));
}
