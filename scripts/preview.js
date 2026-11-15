import { createApi } from '../src/server.js';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { atomicJson } from '../src/ingest.js';
import { readPublicationPolicy, publishDivisionSnapshot } from '../src/publication.js';
import { publishFcsSnapshot } from '../src/fcs-publication.js';
import { publicPerformanceForSnapshot } from '../src/public-performance.js';
const port = Number(process.env.PREVIEW_PORT || 3100);
// The preview serves the committed publication, with no CFBD calls or secrets.
const policy=await readPublicationPolicy();
const snapshot=publishFcsSnapshot(publishDivisionSnapshot(JSON.parse(await readFile('published/latest.json','utf8')),policy),policy);
const previewDirectory=resolve('review/promotion-preview');
await atomicJson(resolve(previewDirectory,'latest.json'),snapshot);
try {
  const performance=publicPerformanceForSnapshot(JSON.parse(await readFile('published/performance-latest.json','utf8')),snapshot);
  if(performance)await atomicJson(resolve(previewDirectory,'performance-latest.json'),performance);
}catch(error){if(error.code!=='ENOENT')throw error;}
createApi(previewDirectory).listen(port, '127.0.0.1', () => console.log(`Frontend preview: http://127.0.0.1:${port}`));
