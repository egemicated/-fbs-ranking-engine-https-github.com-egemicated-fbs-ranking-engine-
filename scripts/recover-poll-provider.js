// Deliberately bounded recovery: two CFBD requests, no publication or model mutation.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function recoverPollProvider({ request, key, output, fetcher = fetch }) {
if (request.schemaVersion !== 1 || JSON.stringify(request.seasons) !== '[2025,2026]' ||
    typeof request.id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(request.id)) throw Error('Invalid bounded poll recovery request');
if (!key) throw Error('CFBD_API_KEY repository secret is required');
await mkdir(output, { recursive: true });
const manifest = { schemaVersion: 1, requestId: request.id, fetchedAt: new Date().toISOString(),
  providerCalls: 0, remainingCalls: null, provider: 'CollegeFootballData', purpose: 'Offline AP/CFP recovery; release times must be independently verified', seasons: [] };
try { for (const year of request.seasons) {
  if (manifest.remainingCalls !== null && manifest.remainingCalls < 1) throw Error('CFBD quota cannot cover another recovery request');
  const url = `https://api.collegefootballdata.com/rankings?year=${year}&seasonType=both`;
  let response;
  manifest.providerCalls++;
  try { response = await fetcher(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) }); }
  catch { throw Error(`CFBD rankings connection failed for ${year}`); }
  const remaining = response.headers?.get('x-calllimit-remaining');
  if (typeof remaining === 'string' && /^\d+$/.test(remaining) && Number.isSafeInteger(Number(remaining))) manifest.remainingCalls = Number(remaining);
  if (!response.ok) throw Error(`CFBD rankings returned HTTP ${response.status} for ${year}`);
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw Error(`CFBD rankings returned invalid JSON for ${year}`); }
  if (!Array.isArray(data)) throw Error(`Invalid CFBD rankings response for ${year}`);
  const editions = data.map(week => ({ season: week.season, seasonType: week.seasonType, week: week.week,
    // A provider week is an identity only. It does not establish a release date.
    polls: (week.polls ?? []).filter(poll => ['AP Top 25', 'Playoff Committee Rankings'].includes(poll.poll))
      .map(poll => ({ poll: poll.poll, ...(typeof poll.isFinal === 'boolean' ? { isFinal: poll.isFinal } : {}),
        ranks: (poll.ranks ?? []).map(row => ({ rank: row.rank, school: row.school,
        ...(row.teamId != null ? { teamId: row.teamId } : {}),
        ...(row.schoolId != null ? { schoolId: row.schoolId } : {}),
        ...(row.id != null ? { id: row.id } : {}) })) })) })).filter(week => week.polls.length);
  if (editions.some(week => week.season !== year || !Number.isInteger(week.week))) throw Error(`Invalid CFBD season/week for ${year}`);
  const normalized = JSON.stringify({ schemaVersion: 1, year, editions }, null, 2) + '\n';
  const file = `${year}-provider-editions.json`;
  await writeFile(join(output, file), normalized);
  manifest.seasons.push({ year, url, responseSha256: createHash('sha256').update(raw).digest('hex'),
    normalizedSha256: createHash('sha256').update(normalized).digest('hex'), file, editionWeeks: editions.length });
} manifest.status = 'complete'; }
catch (error) { manifest.status = 'failed'; manifest.failure = error.message; throw error; }
finally {
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const request = JSON.parse(await readFile('published/poll-archive-request.json', 'utf8'));
  const manifest = await recoverPollProvider({ request, key: process.env.CFBD_API_KEY,
    output: process.env.POLL_RECOVERY_OUTPUT || 'evidence/poll-recovery' });
  console.log(`Recovered ${manifest.seasons.length} season summaries using exactly ${manifest.providerCalls} CFBD calls; no publication changed`);
}
