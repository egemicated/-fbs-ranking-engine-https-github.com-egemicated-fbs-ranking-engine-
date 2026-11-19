import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSorHistoryEdition } from '../src/ranking-history.js';
import { addSorPublication, compactSorPublication } from '../src/sor-history-publications.js';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const repository = 'https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-';

export function recoverSorObservation({ snapshotBytes, scheduleBytes, commit, recordedAt }) {
  const snapshot = JSON.parse(snapshotBytes), schedule = JSON.parse(scheduleBytes);
  const edition = buildSorHistoryEdition(snapshot, schedule);
  if (!edition) throw Error('Saved SOR publication has no modeled results');
  return compactSorPublication(edition, { recordedAt, source:{ basis:'repository-recorded snapshot', commit,
    url:`${repository}/blob/${commit}/published/latest.json`,
    snapshotFileSha256:sha256(snapshotBytes), scheduleFileSha256:sha256(scheduleBytes) } });
}

export async function recoverSorPublications({ root = process.cwd(), write = false } = {}) {
  const git = (...args) => execFileSync('git', ['-c',`safe.directory=${resolve(root)}`,...args],
    { cwd:root, encoding:'utf8', maxBuffer:32*1024*1024 });
  const historyPath = resolve(root,'frontend/ranking-history.json');
  const original = await readFile(historyPath,'utf8'), history = JSON.parse(original);
  const protectedPaths = ['published/latest.json','published/weekly-picks.json','published/performance-latest.json',
    'data/model.json','data/publication-model.json','published/conference-archives/2025.json'];
  const protectedHashes = Object.fromEntries(await Promise.all(protectedPaths.map(async path => [path,sha256(await readFile(resolve(root,path)))])));
  const previousEditionsHash = sha256(JSON.stringify(history.editions));
  let publications = history.publications ?? [];
  const captures = [], excluded = [];
  const revisions = git('log','--reverse','--format=%H','--','published/latest.json').trim().split('\n').filter(Boolean);
  for (const commit of revisions) {
    const snapshotBytes = git('show',`${commit}:published/latest.json`), snapshot = JSON.parse(snapshotBytes);
    if (snapshot.season !== history.season || snapshot.rankingMethod?.id !== 'division-sor-v2') {
      excluded.push({commit,reason:'Not a retained SOR publication for this season'}); continue;
    }
    const scheduleBytes = git('show',`${commit}:published/weekly-picks.json`);
    const recordedAt = git('show','-s','--format=%cI',commit).trim();
    const publication = recoverSorObservation({snapshotBytes,scheduleBytes,commit,recordedAt});
    publications = addSorPublication(publications,publication);
    captures.push({commit,recordedAt,asOf:publication.asOf,publicationHash:publication.publicationHash,rows:publication.rows.length});
  }
  const updated = {...history,publications};
  if (sha256(JSON.stringify(updated.editions)) !== previousEditionsHash) throw Error('Recovery changed a weekly display edition');
  for (const path of protectedPaths) if (sha256(await readFile(resolve(root,path))) !== protectedHashes[path]) throw Error('Recovery changed a protected publication');
  const report = {schemaVersion:1,season:history.season,checkedAt:new Date().toISOString(),source:'Local committed Git objects; no API requests',
    sourceCaptures:captures,excluded,uniquePublications:publications.length,
    weeklySavedEditions:history.editions.filter(row=>row.kind==='saved').length,
    replayEditions:history.editions.filter(row=>row.kind==='replay').length,
    weeklyEditionsHashBefore:previousEditionsHash,weeklyEditionsHashAfter:sha256(JSON.stringify(updated.editions)),protectedHashes,
    availability:'After the whole Mountain day of the repository record. Repository-recorded is not an asserted website deployment instant.',
    originalHistoryFileSha256:sha256(original),modified:JSON.stringify(history)!==JSON.stringify(updated)};
  if(write) {
    await writeFile(historyPath,JSON.stringify(updated,null,2)+'\n');
    await writeFile(resolve(root,'reports/sor-publication-recovery-2026-11-19.json'),JSON.stringify(report,null,2)+'\n');
  }
  return report;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  if(process.argv.slice(2).some(value=>value!=='--write'))throw Error('Usage: node scripts/recover-sor-publications.js [--write]');
  console.log(JSON.stringify(await recoverSorPublications({write:process.argv.includes('--write')}),null,2));
}
