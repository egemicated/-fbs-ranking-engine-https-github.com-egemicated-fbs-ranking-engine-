import { createApi } from '../src/server.js';
import { resolve } from 'node:path';
const port = Number(process.env.PREVIEW_PORT || 3100);
// The preview serves the committed publication, with no CFBD calls or secrets.
createApi(resolve('published')).listen(port, '127.0.0.1', () => console.log(`Frontend preview: http://127.0.0.1:${port}`));
