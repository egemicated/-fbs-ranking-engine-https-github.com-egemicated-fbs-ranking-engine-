import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { VERSION } from './engine.js';
import { UPDATE_SCHEDULE } from './weekly.js';

const directory = resolve(process.env.DATA_DIR || 'data', 'snapshots');
// Read-only API. No login to view public sports ratings; no write/admin routes.
export function createApi(snapshotDirectory = directory) {
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=60');
    const send = (status, value) => { res.writeHead(status); res.end(JSON.stringify(value)); };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return send(405, { error: 'Read-only API' }); }
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/health') return send(200, { status: 'ok', modelVersion: VERSION });
    if (path === '/') return send(200, { service: 'Independent FBS Ranking Engine', modelVersion: VERSION, status: 'experimental', updateSchedule: UPDATE_SCHEDULE, endpoints: ['/health', '/rankings', '/rankings/2025'], interface: 'API only; visual design comes later' });
    const match = /^\/rankings(?:\/(\d{4}))?$/.exec(path);
    if (!match) return send(404, { error: 'Not found' });
    try {
      const snapshot = JSON.parse(await readFile(join(snapshotDirectory, `${match[1] || 'latest'}.json`), 'utf8'));
      const { ratings, ...publicSnapshot } = snapshot;
      return send(200, publicSnapshot);
    } catch (e) { return send(e.code === 'ENOENT' ? 503 : 500, { error: e.code === 'ENOENT' ? 'Rankings have not been built for this season' : 'Could not read rankings' }); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  createApi().listen(Number(process.env.PORT || 3000), process.env.RENDER ? '0.0.0.0' : '127.0.0.1', () => console.log('Ranking API started'));
}
