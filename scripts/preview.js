import { createApi } from '../src/server.js';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { atomicJson } from '../src/ingest.js';
import { readPublicationPolicy, publishDivisionSnapshot } from '../src/publication.js';
const port = Number(process.env.PREVIEW_PORT || 3100);
// The preview serves the committed publication, with no CFBD calls or secrets.
const policy=await readPublicationPolicy();
const snapshot=publishDivisionSnapshot(JSON.parse(await readFile('published/latest.json','utf8')),policy);
const previewDirectory=resolve('review/promotion-preview');
await atomicJson(resolve(previewDirectory,'latest.json'),snapshot);
createApi(previewDirectory).listen(port, '127.0.0.1', () => console.log(`Frontend preview: http://127.0.0.1:${port}`));
