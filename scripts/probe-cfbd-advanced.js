import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditAdvanced } from '../research/lib/advanced_audit.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// One controlled request, no retries or extra usage/roster queries. The public
// output is an audit of coverage/schema, never the provider's source records.
export async function runAdvancedProbe({ request, snapshotBytes, apiKey,
  fetchImpl = fetch, outputDir, privateDir, now = () => new Date().toISOString() }) {
  if (!apiKey || typeof apiKey !== 'string') throw new Error('CFBD_API_KEY is missing');
  if (!request || !/^advanced-2026-[a-z0-9-]+$/.test(request.id) || request.year !== 2026 ||
      request.maxRequests !== 1 || request.excludeGarbageTime !== false || request.seasonType !== 'both') {
    throw new Error('Invalid fixed probe request');
  }
  if (digest(snapshotBytes) !== request.snapshotFileSha256) throw new Error('Probe baseline checksum changed');
  const snapshot = JSON.parse(snapshotBytes.toString('utf8'));
  if (snapshot.season !== request.year) throw new Error('Probe baseline season changed');
  await mkdir(privateDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  // Refuse a second request in the same workspace, even after a failed attempt.
  const lock = await open(join(privateDir, 'attempt-started.json'), 'wx');
  await lock.writeFile(JSON.stringify({ id: request.id, startedAt: now() }) + '\n');
  await lock.close();
  const url = `https://api.collegefootballdata.com/stats/game/advanced?year=${request.year}&seasonType=both&excludeGarbageTime=false`;
  const report = {
    id: request.id, status: 'started', startedAt: now(),
    source: { provider: 'CollegeFootballData', endpoint: url, requestsAttempted: 0,
      retries: 0, responseBytes: null, responseSha256: null, httpStatus: null,
      remainingCalls: null, serverDate: null },
    baseline: { season: snapshot.season, asOf: snapshot.asOf,
      snapshotHash: snapshot.snapshotHash, snapshotFileSha256: request.snapshotFileSha256 },
    rawRetention: 'Raw response is private to this temporary runner workspace; only derived audit JSON is uploaded. No durable raw archive is claimed.',
    scope: 'One-time research probe; no live ranking, refresh schedule or model settings changed.',
    interpretation: [
      'excludeGarbageTime=false retains all provider PPA-eligible plays, not necessarily every box-score scrimmage play.',
      'Provider aggregation can convert unavailable conditional metrics to zero; finite fields alone do not prove valid opportunities.',
      'PPA and explosiveness are provider-model outputs; no upstream model version/training window is supplied by this endpoint.',
      'Rows outside the saved completed-game graph are not assumed final and do not change its coverage denominator.'
    ]
  };
  let failure = null;
  try {
    report.source.requestsAttempted = 1;
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: 'error', signal: AbortSignal.timeout(60000)
    });
    report.source.httpStatus = response.status;
    const remaining = response.headers.get('x-calllimit-remaining');
    if (remaining !== null && /^\d+$/.test(remaining)) report.source.remainingCalls = Number(remaining);
    const date = response.headers.get('date');
    if (date && Number.isFinite(Date.parse(date))) report.source.serverDate = new Date(date).toISOString();
    if (!response.ok) {
      report.status = 'http-failed'; failure = new Error(`CFBD probe returned HTTP ${response.status}; no retry was made`);
    } else {
      const bytes = Buffer.from(await response.arrayBuffer());
      report.source.responseBytes = bytes.length; report.source.responseSha256 = digest(bytes);
      await writeFile(join(privateDir, 'response.json'), bytes, { flag: 'wx', mode: 0o600 });
      let rows;
      try { rows = JSON.parse(bytes.toString('utf8')); }
      catch { report.status = 'invalid-json'; failure = new Error('CFBD probe did not return valid JSON; no retry was made'); }
      if (!failure) {
        try { report.audit = auditAdvanced(rows, snapshot); report.status = 'audited'; }
        catch { report.status = 'audit-failed'; failure = new Error('CFBD probe response could not be audited; raw data remains private'); }
      }
    }
  } catch {
    report.status = 'request-failed';
    failure = new Error('CFBD probe request failed; no retry was made');
  }
  report.completedAt = now();
  await writeFile(join(outputDir, 'audit.json'), JSON.stringify(report, null, 2) + '\n');
  if (failure) throw failure;
  return report;
}

async function main() {
  const request = JSON.parse(await readFile('research/advanced-probe-request.json', 'utf8'));
  const report = await runAdvancedProbe({ request, snapshotBytes: await readFile('published/latest.json'),
    apiKey: process.env.CFBD_API_KEY,
    outputDir: resolve('research/results/advanced-probe', request.id),
    privateDir: resolve('research/cache/advanced-probe', request.id) });
  console.log(JSON.stringify({ id: report.id, status: report.status,
    requestsAttempted: report.source.requestsAttempted,
    responseBytes: report.source.responseBytes, remainingCalls: report.source.remainingCalls }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Advanced probe failed; inspect the derived audit artifact. No retry was made.'); process.exitCode = 1; });
}
