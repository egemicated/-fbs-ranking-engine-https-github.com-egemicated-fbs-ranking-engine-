import { createDecipheriv, createHash, createPublicKey, generateKeyPairSync, privateDecrypt, constants } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { encryptedEnvelope } from '../scripts/fetch-advanced-training.js';

const cacheRoot = resolve('research/cache/player-inputs');
const requestPath = 'research/player-data-request.json';
const keyPath = join(cacheRoot, 'recipient-local.pem');
const readJson = path => readFile(path, 'utf8').then(JSON.parse);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function playerSourceRequests(season, weeks) {
  if (!Number.isInteger(season) || season < 2004 || season > 2100 || !Array.isArray(weeks) || !weeks.length ||
      weeks.length > 14 || new Set(weeks).size !== weeks.length || weeks.some(week => !Number.isInteger(week) || week < 0 || week > 30)) {
    throw new Error('Invalid player evidence scope');
  }
  return [
    { name: 'roster', path: `/roster?year=${season}` },
    { name: 'totals', path: `/stats/player/season?year=${season}&endWeek=${Math.max(...weeks)}&seasonType=both` },
    ...[...weeks].sort((a, b) => a - b).map(week => ({ name: 'week', week, path: `/games/players?year=${season}&week=${week}&seasonType=both` })),
  ];
}

export async function collectPlayerSources({ season, weeks, apiKey, fetcher = fetch, now = () => new Date().toISOString() }) {
  const requests = playerSourceRequests(season, weeks);
  if (!apiKey) throw new Error('CFBD_API_KEY is required');
  const facts = { schemaVersion: 1, season, source: 'cfbd', asOf: null, roster: null, totals: null, weeks: [] };
  const evidence = { season, requestsAttempted: 0, requestsComplete: 0, quotaRemaining: null };
  for (const { name, path, week } of requests) {
    evidence.requestsAttempted++;
    let response;
    try { response = await fetcher(new URL(path, 'https://api.collegefootballdata.com'), {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(55_000),
    }); } catch { throw new Error(`Player source request ${evidence.requestsAttempted} did not complete`); }
    if (!response.ok) throw new Error(`Player source request ${evidence.requestsAttempted} returned HTTP ${response.status}`);
    const quota = response.headers.get('x-calllimit-remaining');
    if (quota && /^\d+$/.test(quota)) evidence.quotaRemaining = Number(quota);
    let rows;
    try { rows = await response.json(); } catch { throw new Error('Player source response was not valid JSON'); }
    if (!Array.isArray(rows)) throw new Error('Player source response did not contain an array');
    const batch = { asOf: now(), rows };
    if (name === 'week') facts.weeks.push({ week, ...batch });
    else facts[name] = batch;
    evidence.requestsComplete++;
    if (evidence.quotaRemaining !== null && evidence.quotaRemaining < requests.length - evidence.requestsComplete) {
      throw new Error('Remaining CFBD quota cannot cover this player batch');
    }
  }
  facts.asOf = now();
  return { facts, evidence };
}

async function command() {
  const [operation, argument, ...rest] = process.argv.slice(2);
  await mkdir(cacheRoot, { recursive: true });
  if (operation === 'request') {
    const season = Number(argument);
    const weeks = rest.map(Number);
    const requests = playerSourceRequests(season, weeks);
    let publicKey;
    try { publicKey = await readFile(join(cacheRoot, 'recipient-public.pem'), 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const keys = generateKeyPairSync('rsa', { modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
      await writeFile(keyPath, keys.privateKey, { flag: 'wx', mode: 0o600 });
      await writeFile(join(cacheRoot, 'recipient-public.pem'), keys.publicKey, { flag: 'wx' });
      publicKey = keys.publicKey;
    }
    await writeFile(requestPath, JSON.stringify({ season, weeks, maxRequests: requests.length, publicKey }, null, 2) + '\n');
    console.log(`Prepared ${requests.length} requests. The recipient key remains local.`);
  } else if (operation === 'collect') {
    const request = await readJson(requestPath);
    const requests = playerSourceRequests(request.season, request.weeks);
    if (request.maxRequests !== requests.length) throw new Error('Declared budget is invalid');
    const recipient = createPublicKey(request.publicKey);
    if (recipient.asymmetricKeyType !== 'rsa' || recipient.asymmetricKeyDetails.modulusLength < 2048) throw new Error('Invalid encrypted-cache recipient');
    const { facts, evidence } = await collectPlayerSources({ ...request, apiKey: process.env.CFBD_API_KEY });
    const raw = Buffer.from(JSON.stringify(facts));
    const envelope = Buffer.from(JSON.stringify(encryptedEnvelope(raw, request.season, recipient)));
    await writeFile(join(cacheRoot, 'player-input.envelope.json'), envelope);
    await writeFile(join(cacheRoot, 'manifest.json'), JSON.stringify({ ...evidence, encryptedSha256: sha(envelope), rawSha256: sha(raw), asOf: facts.asOf }));
    console.log(JSON.stringify(evidence));
  } else if (operation === 'decrypt') {
    const folder = resolve(argument);
    const [manifest, bytes, key] = await Promise.all([
      readJson(join(folder, 'manifest.json')), readFile(join(folder, 'player-input.envelope.json')), readFile(keyPath, 'utf8'),
    ]);
    const envelope = JSON.parse(bytes);
    if (sha(bytes) !== manifest.encryptedSha256 || envelope.version !== 1 || envelope.year !== manifest.season) throw new Error('Invalid player envelope');
    const secret = privateDecrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(envelope.encryptedKey, 'base64'));
    try {
      const cipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(envelope.iv, 'base64'));
      cipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const raw = gunzipSync(Buffer.concat([cipher.update(Buffer.from(envelope.payload, 'base64')), cipher.final()]), { maxOutputLength: 100 * 1024 * 1024 });
      if (sha(raw) !== manifest.rawSha256) throw new Error('Player cache checksum mismatch');
      await writeFile(join(cacheRoot, `${manifest.season}.json`), raw, { mode: 0o600 });
      console.log(JSON.stringify({ season: manifest.season, requestsComplete: manifest.requestsComplete, quotaRemaining: manifest.quotaRemaining }));
    } finally { secret.fill(0); }
  } else throw new Error('Expected request, collect or decrypt');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  command().catch(error => { console.error(error.message); process.exitCode = 1; });
}
