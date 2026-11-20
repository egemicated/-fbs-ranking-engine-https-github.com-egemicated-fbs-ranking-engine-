import { readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { validateBasketball } from '../basketball/model-validation.js';

const [, , output, ...inputs] = process.argv;
if (!output || inputs.length < 3) {
  throw new Error('Usage: node scripts/basketball-model-replay.js <report.json> <normalized historical season.json> ... (minimum 3)');
}
const data = await Promise.all(inputs.map(path => readFile(path, 'utf8').then(JSON.parse)));
const report = validateBasketball(data);
const target = resolve(output);
const temporary = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`);
await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
await rename(temporary, target);
console.log(JSON.stringify({ selected: report.selected, cohorts: report.cohorts, holdout: report.holdout }));
