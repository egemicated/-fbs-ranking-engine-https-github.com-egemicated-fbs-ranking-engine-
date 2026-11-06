import { createCipheriv, createHash, createPublicKey, constants, publicEncrypt, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const YEARS = [2014, 2015, 2016, 2017, 2018, 2019, 2023, 2024, 2025, 2026];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function validatedKey(request) {
  if (!request || request.id !== 'success-rate-training-v1-nov06' || request.maxRequests !== 10 ||
      request.excludeGarbageTime !== false || request.seasonType !== 'both' ||
      !Array.isArray(request.years) || JSON.stringify(request.years) !== JSON.stringify(YEARS) ||
      typeof request.publicKey !== 'string' || !request.publicKey.startsWith('-----BEGIN PUBLIC KEY-----') ||
      (request.protocolSha256 !== undefined && !/^[a-f0-9]{64}$/.test(request.protocolSha256)))
    throw new Error('Invalid fixed training request');
  let key;
  try { key = createPublicKey(request.publicKey); } catch { throw new Error('Invalid training public key'); }
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength < 2048)
    throw new Error('Training requires an RSA public key of at least 2048 bits');
  return key;
}

function encryptedEnvelope(raw, year, publicKey) {
  const key = randomBytes(32), iv = randomBytes(12);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const payload = Buffer.concat([cipher.update(gzipSync(raw)), cipher.final()]);
    const encryptedKey = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256' }, key);
    return { version: 1, year, encryptedKey: encryptedKey.toString('base64'),
      iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), payload: payload.toString('base64') };
  } finally { key.fill(0); }
}

/** Fixed, sequential private-source collector. Importing this module never fetches. */
export async function fetchAdvancedTraining({ request, apiKey, fetchImpl = fetch,
  outputDir, now = () => new Date().toISOString() }) {
  const publicKey = validatedKey(request);
  if (typeof apiKey !== 'string' || !apiKey) throw new Error('CFBD_API_KEY is missing');
  if (typeof outputDir !== 'string' || !outputDir) throw new Error('Training output directory is required');
  await mkdir(outputDir, { recursive: true });
  const lock = await open(join(outputDir, 'attempt-started.json'), 'wx');
  try { await lock.writeFile(JSON.stringify({ id: request.id, startedAt: now() }) + '\n'); }
  finally { await lock.close(); }

  const manifest = { version: 1, id: request.id, provider: 'CollegeFootballData', protocolSha256: request.protocolSha256 ?? null,
    status: 'started', startedAt: now(), completedAt: null, maxRequests: 10,
    requestsAttempted: 0, retries: 0, remainingCalls: null,
    encryption: { scheme: 'RSA-OAEP-SHA256 + AES-256-GCM', compression: 'gzip',
      recipientPublicKeySha256: sha(publicKey.export({ type: 'spki', format: 'der' })) },
    rawPolicy: 'Raw response bytes exist only in memory; durable files are encrypted envelopes and derived provenance metadata.',
    files: [] };
  const save = () => writeFile(join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await save();
  let failure = null;
  for (const year of YEARS) {
    const endpoint = `https://api.collegefootballdata.com/stats/game/advanced?year=${year}&seasonType=both&excludeGarbageTime=false`;
    const entry = { year, endpoint, startedAt: now(), completedAt: null,
      status: 'requesting', httpStatus: null, remainingCalls: null,
      rawBytes: null, rawSha256: null, file: null, encryptedSha256: null };
    manifest.files.push(entry); manifest.requestsAttempted++;
    await save();
    try {
      let response;
      try {
        response = await fetchImpl(endpoint, { headers: { Authorization: `Bearer ${apiKey}` },
          redirect: 'error', signal: AbortSignal.timeout(60000) });
      } catch {
        entry.status = 'request-failed';
        throw new Error('Training request failed; no retry was made');
      }
      entry.httpStatus = response.status;
      const quota = response.headers.get('x-calllimit-remaining');
      if (quota !== null && /^\d+$/.test(quota) && Number.isSafeInteger(Number(quota))) {
        entry.remainingCalls = Number(quota); manifest.remainingCalls = entry.remainingCalls;
      }
      if (!response.ok) {
        entry.status = 'http-failed';
        throw new Error(`Training returned HTTP ${response.status}; no retry was made`);
      }
      let raw;
      try { raw = Buffer.from(await response.arrayBuffer()); }
      catch { entry.status = 'response-read-failed'; throw new Error('Training response could not be read; no retry was made'); }
      entry.rawBytes = raw.length; entry.rawSha256 = sha(raw);
      let rows;
      try { rows = JSON.parse(raw.toString('utf8')); }
      catch { entry.status = 'invalid-response'; throw new Error('Training response is not valid JSON; no retry was made'); }
      if (!Array.isArray(rows)) {
        entry.status = 'invalid-response'; throw new Error('Training response is not an array; no retry was made');
      }
      const envelope = encryptedEnvelope(raw, year, publicKey);
      const encoded = Buffer.from(JSON.stringify(envelope) + '\n');
      const filename = `${year}.envelope.json`;
      await writeFile(join(outputDir, filename), encoded, { flag: 'wx' });
      entry.file = filename; entry.encryptedSha256 = sha(encoded);
      entry.status = 'encrypted'; entry.completedAt = now();
      await save();
      const unfetched = YEARS.length - manifest.requestsAttempted;
      if (entry.remainingCalls !== null && entry.remainingCalls < unfetched) {
        manifest.status = 'quota-stopped';
        throw new Error('Remaining quota cannot cover the unfetched years; no extra request was made');
      }
    } catch (error) {
      entry.completedAt ||= now();
      if (entry.status === 'requesting') entry.status = 'processing-failed';
      manifest.status = manifest.status === 'quota-stopped' ? manifest.status : 'failed';
      // Never propagate provider/network exception details, body text or headers.
      failure = new Error(manifest.status === 'quota-stopped'
        ? 'Training stopped at the quota guard; no extra request was made'
        : `Training stopped after ${manifest.requestsAttempted} request attempt(s); no retries were made`);
      break;
    }
  }
  if (!failure) manifest.status = 'complete';
  manifest.completedAt = now();
  await save();
  if (failure) throw failure;
  return manifest;
}

async function main() {
  const request = JSON.parse(await readFile('research/advanced-training-request.json', 'utf8'));
  const manifest = await fetchAdvancedTraining({ request, apiKey: process.env.CFBD_API_KEY,
    outputDir: resolve('research/cache/advanced-training-export') });
  console.log(JSON.stringify({ id: manifest.id, status: manifest.status,
    requestsAttempted: manifest.requestsAttempted,
    encryptedSeasons: manifest.files.filter(f => f.status === 'encrypted').length,
    remainingCalls: manifest.remainingCalls }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Advanced training fetch stopped; inspect the derived manifest. No retries were made.'); process.exitCode = 1; });
}
