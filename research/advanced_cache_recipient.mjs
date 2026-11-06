// Local-only cache recipient. No user password or service credential is created.
import { generateKeyPairSync, createHash, privateDecrypt, constants, createDecipheriv } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const cache = resolve('research/cache/advanced-training-v1');
const privatePath = join(cache, 'recipient-private.pem');
await mkdir(cache, { recursive: true });
if (process.argv[2] === 'generate') {
  let privateKey, publicKey;
  try { privateKey = await readFile(privatePath, 'utf8'); publicKey = await readFile(join(cache, 'recipient-public.pem'), 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    ({ privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }));
    await writeFile(privatePath, privateKey, { flag: 'wx', mode: 0o600 });
    await writeFile(join(cache, 'recipient-public.pem'), publicKey, { flag: 'wx' });
  }
  const protocol = await readFile('research/advanced-performance-protocol.json');
  const parsed = JSON.parse(protocol);
  await writeFile('research/advanced-training-request.json', JSON.stringify({
    id: 'success-rate-training-v1-nov06', years: parsed.sources.years, maxRequests: 10,
    excludeGarbageTime: false, seasonType: 'both', publicKey,
    protocolSha256: createHash('sha256').update(protocol).digest('hex')
  }, null, 2) + '\n');
  console.log('Created public recipient request; private key stays in the ignored local cache.');
} else if (process.argv[2] === 'decrypt') {
  const privateKey = await readFile(privatePath, 'utf8');
  const folder = join(cache, 'encrypted');
  const manifestBytes = await readFile(join(folder, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes); let files = 0;
  for (const file of manifest.files) {
    if (!Number.isInteger(file.year) || !/^\d{4}\.envelope\.json$/.test(file.file)) throw new Error('Invalid encrypted file identity');
    const encrypted = await readFile(join(folder, file.file));
    if (createHash('sha256').update(encrypted).digest('hex') !== file.encryptedSha256) throw new Error('Encrypted source checksum differs');
    const envelope = JSON.parse(encrypted);
    if (envelope.year !== file.year || envelope.version !== 1) throw new Error('Invalid encrypted source year/version');
    const aesKey = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(envelope.encryptedKey, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', aesKey, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const compressed = Buffer.concat([decipher.update(Buffer.from(envelope.payload, 'base64')), decipher.final()]);
    const raw = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 });
    if (raw.length !== file.rawBytes || createHash('sha256').update(raw).digest('hex') !== file.rawSha256) throw new Error('Private source checksum differs');
    if (!Array.isArray(JSON.parse(raw))) throw new Error('Source is not an array');
    await writeFile(join(cache, `${file.year}.json`), raw, { mode: 0o600 }); files++;
  }
  await writeFile(join(cache, 'manifest.json'), manifestBytes);
  console.log(JSON.stringify({ decryptedFiles: files, privateCache: 'research/cache/advanced-training-v1', cfbdCalls: 0 }));
} else throw new Error('Use generate or decrypt');
