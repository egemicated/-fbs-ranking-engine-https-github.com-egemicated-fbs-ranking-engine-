import { createHash } from 'node:crypto';
import { mkdir, copyFile, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

// Explicit allowlist: never enumerate the environment or copy arbitrary paths.
export async function saveEvidence({ year, dataDir, outputDir, snapshot = null, error = null, attemptStartedAt = null }) {
  await mkdir(outputDir, { recursive: true });
  for (const name of ['provider-responses.json', 'normalized-season.json', 'snapshot.json', 'manifest.json']) {
    await rm(join(outputDir, name), { force: true });
  }
  const files = [];
  const inputs = [{ source: join(dataDir, 'raw', `cfbd-${year}.json`), name: 'provider-responses.json' }];
  if (snapshot) inputs.push({ source: join(dataDir, 'seasons', `${year}.json`), name: 'normalized-season.json' });
  for (const { source, name } of inputs) {
    try {
      if (attemptStartedAt && (await stat(source)).mtimeMs + 1 < Date.parse(attemptStartedAt)) continue;
      const bytes = await readFile(source);
      await copyFile(source, join(outputDir, name));
      files.push({ name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  if (snapshot) {
    const bytes = Buffer.from(JSON.stringify(snapshot, null, 2) + '\n');
    await writeFile(join(outputDir, 'snapshot.json'), bytes);
    files.push({ name: 'snapshot.json', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
  }
  const manifest = { schemaVersion: 1, season: year, status: error ? 'rejected' : 'validated', attemptStartedAt,
    snapshotHash: snapshot?.snapshotHash ?? null, source: snapshot?.source ?? null, files,
    // Error messages can contain provider-controlled text; retain only our own
    // fixed classification and structured quality audit.
    rejection: error ? { type: error.name === 'DataQualityError' ? 'data-quality' : 'refresh-failed', audit: error.audit ?? null } : null };
  await writeFile(join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
