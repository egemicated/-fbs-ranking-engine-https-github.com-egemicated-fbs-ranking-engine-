import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadPreviewStore } from '../basketball/preview-store.mjs';
import { buildBasketballSitePublication, readBasketballSitePublication } from '../basketball/site-publication.mjs';

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({ options: {
  season: { type:'string' }, 'state-dir': { type:'string' },
  'output-dir': { type:'string' }, 'no-capture': { type:'boolean' },
} });
const year = Number(values.season);
if (!/^\d{4}$/.test(values.season ?? '')) throw Error('Specify the four-digit basketball season ending year');
const output = resolve(root, values['output-dir'] ?? 'published/basketball-site');
const stateDir = resolve(root, values['state-dir'] ?? 'research/cache/basketball/publication');
const clock = Date.now();
const store = await loadPreviewStore(root, clock, { stateDir, capture: !values['no-capture'] });
if (store.activeYear !== year) throw Error('The publication season must be active');
const { files, manifest } = buildBasketballSitePublication(store, clock);
const parent = dirname(output);
await mkdir(parent, { recursive: true });
const temporary = await mkdtemp(join(parent, '.basketball-site-'));
const staged = join(temporary, 'next');
const previous = join(temporary, 'previous');
try {
  for (const [path, bytes] of [...files, ['manifest.json', JSON.stringify(manifest)]]) {
    const file = join(staged,path);
    await mkdir(dirname(file), {recursive:true});
    await writeFile(file,bytes);
  }
  await readBasketballSitePublication(staged);
  const backedUp = await rename(output,previous).then(()=>true,error=>{
    if (error.code !== 'ENOENT') throw error;
    return false;
  });
  try {
    await rename(staged,output);
  } catch(error) {
    if (backedUp) await rename(previous,output);
    throw error;
  }
} finally {
  await rm(staged,{recursive:true,force:true});
}
await rm(temporary,{recursive:true,force:true});
console.log('Basketball site display ' + manifest.version + ' · ' + manifest.generatedAt + ' · ' + files.size + ' assets');
