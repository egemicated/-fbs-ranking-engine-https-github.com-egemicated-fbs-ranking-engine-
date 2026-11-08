// Rate recorded FBS passing production and evaluate future player seasons.
// Target-year participation is used only to decide which outcomes can be scored.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const cache = new URL('research/cache/preseason-player/', root);
const trainingYears = [2022, 2023];
const testYears = [2024, 2025];
const minimumOutcomeAttempts = 100;
const shrinkageCandidates = [25, 50, 100, 200, 400];

function add(counts, row) {
  counts.attempts += row.attempts;
  counts.yards += row.yards;
}

async function loadPlayerSeasons(source) {
  const playersByYear = new Map();
  for (let year = 2018; year <= 2025; year++) {
    const season = JSON.parse(await readFile(new URL(`data/seasons/${year}.json`, root)));
    const fbs = new Set(season.teams.filter(team => team.division === 'fbs').map(team => team.id));
    const players = new Map();
    const identities = new Set();
    assert.ok(Array.isArray(source.seasons[year]), `Missing player counts for ${year}`);
    for (const row of source.seasons[year]) {
      if (!fbs.has(String(row.teamId))) continue;
      assert.ok(typeof row.athleteId === 'string' && row.athleteId.length);
      assert.ok(Number.isInteger(row.attempts) && row.attempts >= 0 && Number.isInteger(row.yards));
      const key = `${row.athleteId}:${row.teamId}`;
      assert.ok(!identities.has(key), `Duplicate player/team season: ${key}`);
      identities.add(key);
      if (row.attempts === 0) continue;
      const counts = players.get(row.athleteId) ?? { name: row.name, attempts: 0, yards: 0, teams: [] };
      add(counts, row);
      counts.teams.push({ id: String(row.teamId), attempts: row.attempts });
      players.set(row.athleteId, counts);
    }
    playersByYear.set(year, players);
  }
  return playersByYear;
}

function priorEvidence(seasons, year) {
  const league = { attempts: 0, yards: 0 };
  const previous = new Map();
  for (let prior = year - 4; prior < year; prior++) {
    for (const [id, counts] of seasons.get(prior)) {
      add(league, counts);
      const evidence = previous.get(id) ?? { attempts: 0, yards: 0, name: counts.name, teams: [] };
      add(evidence, counts);
      evidence.teams.push(...counts.teams);
      evidence.name = counts.name;
      previous.set(id, evidence);
    }
  }
  assert.ok(league.attempts > 0, `No prior passing counts for ${year}`);
  return { previous, last: seasons.get(year - 1), mean: league.yards / league.attempts };
}

function estimate(counts, mean, weight) {
  return counts ? (counts.yards + weight * mean) / (counts.attempts + weight) : mean;
}

function targetRows(seasons, year) {
  const prior = priorEvidence(seasons, year);
  return [...seasons.get(year)].filter(([, counts]) => counts.attempts >= minimumOutcomeAttempts)
    .map(([id, counts]) => ({ year, actual: counts.yards / counts.attempts, four: prior.previous.get(id),
      one: prior.last.get(id), mean: prior.mean }));
}

function meanError(rows, predict) {
  return rows.length ? rows.reduce((sum, row) => sum + Math.abs(predict(row) - row.actual), 0) / rows.length : null;
}

function chooseShrinkage(rows, window) {
  return shrinkageCandidates.map(weight => ({ weight, error: meanError(rows, row => estimate(row[window], row.mean, weight)) }))
    .sort((a, b) => a.error - b.error || a.weight - b.weight)[0];
}

function compare(rows, weights) {
  return {
    players: rows.length,
    withPriorFbsAttempts: rows.filter(row => row.four).length,
    baselineError: meanError(rows, row => row.mean),
    oneYearError: meanError(rows, row => estimate(row.one, row.mean, weights.one)),
    ratingError: meanError(rows, row => estimate(row.four, row.mean, weights.four)),
  };
}

const sourceBytes = await readFile(new URL('passing-seasons.json', cache));
const seasons = await loadPlayerSeasons(JSON.parse(sourceBytes));
const training = trainingYears.flatMap(year => targetRows(seasons, year));
const later = testYears.flatMap(year => targetRows(seasons, year));
assert.ok(training.length && later.length, 'No training or test player-seasons');
const weights = { one: chooseShrinkage(training, 'one').weight, four: chooseShrinkage(training, 'four').weight };
const profile = priorEvidence(seasons, 2025);
const result = {
  sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
  trainingYears, testYears, minimumOutcomeAttempts, shrinkageCandidates, weights,
  method: 'Own estimate of yards per pass attempt from four previous seasons, shrunk toward the prior FBS passing average.',
  limitation: 'This replay scores players who later logged at least 100 observed FBS pass attempts. It measures conditional efficiency, not the likelihood of starting or playing.',
  training: compare(training, weights),
  evaluation: compare(later, weights),
  byYear: Object.fromEntries(testYears.map(year => [year, compare(later.filter(row => row.year === year), weights)])),
  examplePool2025: [...profile.previous].map(([id, counts]) => ({ id, ...counts, rating: estimate(counts, profile.mean, weights.four) })),
  cfbdCalls: 0,
};
await mkdir(cache, { recursive: true });
await writeFile(new URL('quarterback-replay.json', cache), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ weights, evaluation: result.evaluation, byYear: result.byYear }, null, 2));
