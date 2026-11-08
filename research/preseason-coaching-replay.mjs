/** Preseason research with dated SEC coaching announcements and frozen Strength. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { replayPreseason } from './preseason-team-baseline.mjs';

const root = new URL('../', import.meta.url);
const baselinePath = 'research/cache/preseason-team-baseline/result.json';
const evidencePath = 'research/preseason-coaching-evidence.json';
const trainYears = [2022, 2023];
const testYears = [2024, 2025];
const years = [2021, ...trainYears, ...testYears];
const penalty = 1;

const read = path => readFile(new URL(path, root));
const load = async path => JSON.parse(await read(path));
const sha = raw => createHash('sha256').update(raw).digest('hex');
const sigmoid = logOdds => 1 / (1 + Math.exp(-logOdds));

function datedCoaches(evidence, cutoff) {
  const rows = Object.entries(evidence.coaches).map(([school, coach]) =>
    [school, { coach, source: evidence.source, published: evidence.published }]);
  rows.push(...Object.entries(evidence.additionalCoaches ?? {}));
  for (const [school, row] of rows) {
    // Treat dates as public by the end of their UTC calendar day.
    const available = Date.parse(row.published) + 86_400_000;
    assert.ok(row.coach && row.source.startsWith('https://') && available <= Date.parse(cutoff),
      `Invalid or late preseason evidence for ${school}`);
  }
  assert.equal(new Map(rows).size, rows.length, 'Conflicting coach evidence');
  return new Map(rows.map(([school, row]) => [school,
    row.coach === 'Eli Drinkwitz' ? 'Eliah Drinkwitz' : row.coach]));
}

function fitContinuity(rows) {
  // Baseline log odds stay fixed. One signed coefficient captures the net
  // difference in coach continuity without refitting Strength or venue.
  const gradient = beta => rows.reduce((sum, row) => sum + row.continuity *
    (sigmoid(row.baseLogOdds + beta * row.continuity) - row.outcome), penalty * beta);
  assert.ok(rows.some(row => row.continuity !== 0), 'No coaching contrast in training');
  let low = -rows.length;
  let high = rows.length;
  for (let step = 0; step < 60; step++) {
    const middle = (low + high) / 2;
    if (gradient(middle) < 0) low = middle;
    else high = middle;
  }
  const beta = (low + high) / 2;
  assert.ok(Math.abs(gradient(beta)) < 1e-8, 'Continuity fit failed to converge');
  return beta;
}

function score(rows, beta) {
  const sums = { brier: 0, logLoss: 0, accuracy: 0 };
  for (const row of rows) {
    const p = sigmoid(row.baseLogOdds + beta * row.continuity);
    const y = row.outcome;
    sums.brier += (p - y) ** 2;
    sums.logLoss -= Math.log(y ? p : 1 - p);
    sums.accuracy += p === .5 ? .5 : Number((p > .5) === Boolean(y));
  }
  return Object.fromEntries(Object.entries(sums).map(([name, sum]) => [name, sum / rows.length]));
}

function compare(rows, beta) {
  if (!rows.length) return { games: 0 };
  const strength = score(rows, 0);
  const continuity = score(rows, beta);
  return { games: rows.length, strength, continuity,
    deltas: Object.fromEntries(Object.keys(strength).map(name => [name, continuity[name] - strength[name]])) };
}

const [evidence, baseline, seasons, config] = await Promise.all([
  load(evidencePath), load(baselinePath),
  Promise.all(Array.from({ length: 22 }, (_, i) => load(`data/seasons/${2004 + i}.json`))),
  load('data/model.json'),
]);
assert.deepEqual(config, baseline.config);
const baselineSourcePaths = ['research/preseason-team-baseline.mjs', 'src/engine.js',
  ...Array.from({ length: 22 }, (_, i) => `data/seasons/${2004 + i}.json`)];
for (const [path, raw] of await Promise.all(baselineSourcePaths.map(async path => [path, await read(path)]))) {
  assert.equal(sha(raw), baseline.sourceHashes[path], `Rebuild the baseline after changes to ${path}`);
}
const { scale, trainingYears: baselineTrainingYears } = baseline.models.fourYears;
assert.ok(Number.isFinite(scale) && scale > 0 && Math.max(...baselineTrainingYears) < trainYears[0]);
const { rows, checkpoints } = replayPreseason(seasons, config, years);
const byYear = new Map(seasons.map(season => [season.year, season]));
const dated = new Map(years.map(year => [year, datedCoaches(evidence[year], checkpoints[year].cutoff)]));
const matched = {};
const coverage = {};
for (const year of [...trainYears, ...testYears]) {
  const current = dated.get(year);
  const prior = dated.get(year - 1);
  const sec = byYear.get(year).teams.filter(team => team.division === 'fbs' && team.conference === 'SEC');
  const ids = new Set(sec.map(team => team.id));
  const coachContinuity = new Map(sec.filter(team => current.has(team.name) && prior.has(team.name)).map(team =>
    [team.id, Number(current.get(team.name) === prior.get(team.name))]));
  const teamNames = new Map(sec.map(team => [team.id, team.name]));
  const target = rows.filter(game => game.season === year && ids.has(game.home) && ids.has(game.away));
  matched[year] = target.filter(game => coachContinuity.has(game.home) && coachContinuity.has(game.away)).map(game => {
    const continuity = coachContinuity.get(game.home) - coachContinuity.get(game.away);
    const changedSchool = continuity === 0 ? null : teamNames.get(continuity === 1 ? game.away : game.home);
    return { outcome: game.outcome, continuity, changedSchool, baseLogOdds: game.edges.fourYears / scale };
  });
  coverage[year] = { openingCutoff: checkpoints[year].cutoff, secTeams: sec.length,
    knownTeamPairs: coachContinuity.size, targetGames: target.length, matchedGames: matched[year].length,
    gamesWithContrast: matched[year].filter(row => row.continuity !== 0).length,
    changedSchools: sec.filter(team => coachContinuity.get(team.id) === 0).map(team => team.name).sort() };
}
const training = trainYears.flatMap(year => matched[year]);
const test = testYears.flatMap(year => matched[year]);
const beta = fitContinuity(training);
const contrast = test.filter(row => row.continuity !== 0);
const contrastSchools = [...new Set(contrast.map(row => row.changedSchool))].sort();
const report = {
  status: 'retrospective research only',
  scope: 'Decided regular-tagged matchups between two then-SEC schools. Includes some conference title games.',
  evidence: 'Public preseason coaching names from dated media-day announcements. Texas and Oklahoma 2023 names come from their schools before joining the SEC. Season-open labels remain frozen through the schedule, so later changes do not enter.',
  limitation: 'The source records announced preseason identity. Changes after announcements and interim or temporary game assignments are outside the input. The test measures continuity, and is confined to one conference.',
  protocol: { trainYears, testYears, penalty, baselineTrainingYears, baselineScale: scale,
    feature: '1 for the same announced head coach as the prior preseason, 0 for a change. Add beta times the home-minus-away difference to frozen Strength log odds.' },
  coverage, fit: { trainingGames: training.length,
    gamesWithContrast: training.filter(row => row.continuity !== 0).length,
    continuityLogOdds: beta },
  test: { pooled: compare(test, beta), withContrast: compare(contrast, beta),
    contrastByChangedSchool: Object.fromEntries(contrastSchools.map(school =>
      [school, compare(contrast.filter(row => row.changedSchool === school), beta)])),
    byYear: Object.fromEntries(testYears.map(year => [year, compare(matched[year], beta)])) },
  nationalSourceAudit: evidence.nationalSourceAudit,
  sourceHashes: { evidence: sha(await read(evidencePath)), baseline: sha(await read(baselinePath)),
    code: sha(await readFile(new URL(import.meta.url))) },
  cfbdCalls: 0,
};
const outputDir = new URL('research/results/preseason-coaching/', root);
await mkdir(outputDir, { recursive: true });
await writeFile(new URL('results.json', outputDir), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
