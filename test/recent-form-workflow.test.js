import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('recent-form trial pins the numerical implementation and uses the existing results job', async () => {
  const protocol = JSON.parse(await readFile('research/frozen-recent-form-shadow-v1.json', 'utf8'));
  for (const [path, expected] of Object.entries(protocol.implementationSha256)) {
    assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), expected, path);
  }
  const workflow = await readFile('.github/workflows/weekly.yml', 'utf8');
  for (const [label, file] of [
    ['Record paired pregame forecasts for the recent-form trial', 'capture-recent-form-shadow'],
    ['Grade the recent-form trial against verified finals', 'evaluate-recent-form-shadow'],
  ]) {
    const step = workflow.split(/(?:^|\n)      - /).find(text => text.startsWith(`name: ${label}`));
    assert.ok(step, label);
    assert.match(step, /if: steps\.weekly-picks\.outcome == 'success'/);
    assert.match(step, /continue-on-error: true/);
    assert.ok(step.includes(`run: node research/${file}.mjs`));
    assert.doesNotMatch(step, /secrets\.|CFBD_API_KEY/);
  }
  const staged = [...workflow.matchAll(/git add (\S*recent-form\S*)/g)].map(match => match[1].replace(/;$/, ''));
  assert.deepEqual(staged, ['research/recent-form-observations/', 'research/recent-form-evaluations/latest.json']);
});
