import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { VERSION } from './engine.js';
import { UPDATE_SCHEDULE } from './weekly.js';
import publicationPolicy from '../data/publication-model.json' with { type: 'json' };
import { readPerformance } from './performance-publication.js';
import { matchupValidation, snapshotCoverage } from './site-validation.js';

const directory = resolve(process.env.DATA_DIR || 'data', 'snapshots');
// Read-only API. No login to view public sports ratings; no write/admin routes.
export function createApi(snapshotDirectory = directory, frontendDirectory = resolve('frontend')) {
  const staticFiles = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/assets/stadium.png', ['assets/stadium.png', 'image/png']],
    ['/assets/stadium.webp', ['assets/stadium.webp', 'image/webp']],
    ['/fonts/BarlowCondensed-Bold.ttf', ['fonts/BarlowCondensed-Bold.ttf', 'font/ttf']],
    ['/fonts/BarlowCondensed-SemiBold.ttf', ['fonts/BarlowCondensed-SemiBold.ttf', 'font/ttf']]
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
      endpoints: ['/health', '/rankings', '/rankings/2025', '/performance'] });
    if (path === '/performance') {
      try {
        const snapshot = JSON.parse(await readFile(join(snapshotDirectory, 'latest.json'), 'utf8'));
        const performance = await readPerformance(snapshotDirectory, snapshot);
        return performance ? send(200, performance) : send(503, { error: 'Experimental Performance is unavailable for this snapshot' });
      } catch { return send(503, { error: 'Experimental Performance is unavailable for this snapshot' }); }
    }
    if (path === '/weekly-picks') {
      try {
        return send(200, JSON.parse(await readFile(new URL('../published/weekly-picks.json', import.meta.url), 'utf8')));
      } catch (error) {
        return send(error.code === 'ENOENT' ? 404 : 503, { error: 'Weekly picks are unavailable' });
      }
    }
    const match = /^\/rankings(?:\/(\d{4}))?$/.exec(path);
    if (!match) return send(404, { error: 'Not found' });
    try {
      const snapshot = JSON.parse(await readFile(join(snapshotDirectory, `${match[1] || 'latest'}.json`), 'utf8'));
      const { ratings, ...publicSnapshot } = snapshot;
      if (snapshot.rankingMethod?.id === publicationPolicy.id) {
        publicSnapshot.rankingMethod = { ...snapshot.rankingMethod, publicationStatus: 'official' };
        publicSnapshot.coverageValidation = snapshotCoverage(snapshot);
        publicSnapshot.matchupValidation = matchupValidation(snapshot);
      }
      if (await readPerformance(snapshotDirectory, snapshot)) publicSnapshot.performanceEndpoint = '/performance';
      return send(200, publicSnapshot);
    } catch (e) { return send(e.code === 'ENOENT' ? 503 : 500, { error: e.code === 'ENOENT' ? 'Rankings have not been built for this season' : 'Could not read rankings' }); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  createApi().listen(Number(process.env.PORT || 3000), process.env.RENDER ? '0.0.0.0' : '127.0.0.1', () => console.log('Ranking API started'));
}
