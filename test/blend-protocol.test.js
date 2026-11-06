import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { IMPLEMENTATION_PATHS } from '../scripts/record-blend-comparison.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('committed prospective protocol pins the actual models, capture, scorer and older-only calibration',async()=>{
  const protocol=JSON.parse(await readFile('research/frozen-blend-prospective-v1.json','utf8'));
  assert.equal(protocol.forecastHorizonDays,7);
  assert.equal(protocol.minimumPrimaryGames,4);
  assert.equal(protocol.tieTolerance,1e-10);
  for(const path of IMPLEMENTATION_PATHS) assert.ok(protocol.implementationSha256[path],path);
  for(const [path,expected] of Object.entries({...protocol.implementationSha256,...protocol.evaluationImplementationSha256})) {
    assert.equal(sha(await readFile(path)),expected,path);
  }
  const historicalBytes=gunzipSync(await readFile(protocol.calibration.historicalResultsPath));
  assert.equal(sha(historicalBytes),protocol.calibration.uncompressedHistoricalResultsSha256);
  const historical=JSON.parse(historicalBytes);
  assert.deepEqual(protocol.calibration.trainingYears,[2018,2019]);
  assert.deepEqual(protocol.calibration.models,historical.calibration);
  assert.equal(protocol.calibration.trainingGames,historical.calibration.triple.games);
  assert.equal(protocol.calibration.historicalFingerprint,historical.fingerprint);
  assert.equal(protocol.weights.triple.sor,1/3);
  assert.equal(protocol.weights.triple.strength,1/3);
  assert.equal(protocol.weights.triple.performance,1/3);
});
