import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

for (const mode of ['http-failure', 'empty-results']) {
  test(`failed ${mode} refresh preserves the prior verified publication byte-for-byte`, async () => {
    const parent = resolve(tmpdir());
    const directory = await mkdtemp(join(parent, 'forge-refresh-rollback-'));
    try {
      await mkdir(join(directory, 'published'));
      await mkdir(join(directory, 'data'));
      for (const file of ['published/latest.json', 'published/prior-2025.json', 'data/model.json']) await cp(file, join(directory, file));
      const before = await readFile(join(directory, 'published/latest.json'));
      const script = pathToFileURL(resolve('scripts/refresh-weekly.js')).href;
      const code = `globalThis.fetch=async url=>{
        if(!String(url).startsWith('https://api.collegefootballdata.com/'))throw Error('Unexpected network request blocked');
        if(${JSON.stringify(mode)}==='http-failure')return new Response('PRIVATE_PROVIDER_BODY',{status:503});
        return Response.json(String(url).includes('/games?')?[]:[{id:252,school:'BYU',conference:'Big 12'}]);
      }; await import(${JSON.stringify(script)});`;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        cwd: directory, env: { ...process.env, CFBD_API_KEY: 'fixture-only-not-a-real-key', RANKING_SEASON: '2026' },
        encoding: 'utf8', timeout: 15_000,
      });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, mode === 'http-failure' ? /CFBD returned 503/ : /CFBD has no completed games/);
      assert.doesNotMatch(result.stderr, /PRIVATE_PROVIDER_BODY|fixture-only-not-a-real-key/);
      assert.deepEqual(await readFile(join(directory, 'published/latest.json')), before);
    } finally {
      assert.equal(dirname(directory), parent, 'Cleanup stays within the explicit temporary directory');
      await rm(directory, { recursive: true, force: true });
    }
  });
}
