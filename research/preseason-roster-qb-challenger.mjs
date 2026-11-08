/** Paired preseason test of QB evidence documented before the season opens. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayPreseason } from './preseason-team-baseline.mjs';

const root = new URL('../', import.meta.url);
const trainYears = [2023];
const testYears = [2024, 2025];
const years = [...trainYears, ...testYears];
const minimum = { trainingGames: 30, trainingTeams: 8, reportingGamesPerTestYear: 20 };
const roles = {
  mediaDay: 'conference-media-day-attendee',
  starter: 'school-confirmed-starter',
  room: 'school-dated-qb-roster',
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = path => readFile(new URL(path, root));
const json = async path => JSON.parse(await bytes(path));
const usePilotShrinkage = process.argv.includes('--pilot-shrinkage');
const argumentsForEvidence = process.argv.slice(2).filter(arg => arg !== '--pilot-shrinkage');

function availableTime(value) {
  if (typeof value !== 'string') return NaN;
  if (/^\d{4}-\d\d-\d\d$/.test(value)) {
    // Treat a date with unknown timezone as known by the end of that date even
    // in UTC−12. An exact source timestamp can establish earlier availability.
    const end = Date.parse(`${value}T23:59:59.999Z`);
    if (!Number.isFinite(end) || new Date(end).toISOString().slice(0, 10) !== value) return NaN;
    return end + 12 * 3_600_000;
  }
  return /^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
}

function citedBefore(record, cutoff) {
  const known = availableTime(record.knownBy ?? record.availableAt);
  if (!Number.isFinite(known) || known >= cutoff) return false;
  return Array.isArray(record.sources) && record.sources.length > 0 && record.sources.every(source => {
    try {
      const published = availableTime(source.publishedAt ?? source.publishedOn);
      return new URL(source.url).protocol === 'https:' && Number.isFinite(published) && published < cutoff;
    } catch {
      return false;
    }
  });
}

function earlierPassing(source, archive, target) {
  const players = new Map();
  let yards = 0;
  let attempts = 0;
  for (let year = target - 4; year < target; year++) {
    const fbs = new Set(archive.get(year).teams.filter(team => team.division === 'fbs').map(team => team.id));
    assert.ok(Array.isArray(source.seasons[year]), `Missing prior passing season ${year}`);
    const seen = new Set();
    for (const row of source.seasons[year]) {
      if (!fbs.has(row.teamId)) continue;
      const key = `${row.teamId}:${row.athleteId}`;
      assert.ok(!seen.has(key) && typeof row.athleteId === 'string' && row.athleteId.length);
      assert.ok(Number.isInteger(row.attempts) && row.attempts >= 0 && Number.isInteger(row.yards));
      seen.add(key);
      if (!row.attempts) continue;
      const player = players.get(row.athleteId) ?? { yards: 0, attempts: 0 };
      player.yards += row.yards;
      player.attempts += row.attempts;
      players.set(row.athleteId, player);
      yards += row.yards;
      attempts += row.attempts;
    }
  }
  assert.ok(attempts > 0, `No earlier FBS passing counts for ${target}`);
  return { players, mean: yards / attempts };
}

function teamEvidence(records, pending, checkpoint, prior, role, year, shrinkage) {
  const cutoff = Date.parse(checkpoint.cutoff);
  const groups = new Map();
  let recordsOutsideCutoffOrUndated = 0;
  for (const record of records) {
    if (record.season !== year || record.roleEvidence !== roles[role] || record.position !== 'QB') continue;
    const teamId = String(record.teamId);
    if (!citedBefore(record, cutoff)) {
      recordsOutsideCutoffOrUndated++;
      continue;
    }
    if (!groups.has(teamId)) groups.set(teamId, []);
    groups.get(teamId).push(record);
  }
  const ratings = new Map();
  const unsupported = {};
  const reject = reason => { unsupported[reason] = (unsupported[reason] ?? 0) + 1; };
  for (const team of checkpoint.teams) {
    const group = groups.get(team.id);
    if (!group?.length) { reject('missing-dated-role-evidence'); continue; }
    const identified = new Map(group.filter(row => row.athleteId).map(row => [row.name?.trim().toLowerCase(), row.athleteId]));
    const candidates = new Set(group.map(row => row.athleteId ?? identified.get(row.name?.trim().toLowerCase()) ?? `unresolved:${row.name}`));
    for (const record of pending) if (record.season === year && String(record.teamId) === team.id &&
        record.roleEvidence === roles[role] && citedBefore(record, cutoff)) {
      // Unresolved names can make the documented role ambiguous. They never
      // count as a verified player or create a passing estimate themselves.
      candidates.add(identified.get(record.name?.trim().toLowerCase()) ?? `unresolved:${record.name}`);
    }
    if (role !== 'room' && candidates.size !== 1) { reject('multiple-named-candidates'); continue; }
    if (role === 'room' && !group.every(row => row.roomComplete === true && row.roomSize === candidates.size)) {
      reject('room-completeness-unverified');
      continue;
    }
    if ([...candidates].some(id => typeof id !== 'string' || !/^\d+$/.test(id))) { reject('unresolved-player-identity'); continue; }
    const observed = [...candidates].map(id => prior.players.get(id)).filter(Boolean);
    if (!observed.length) { reject('no-recorded-prior-fbs-attempts'); continue; }
    // A room rates only observed members. This carries no assumed snap shares.
    ratings.set(team.id, observed.reduce((sum, player) =>
      sum + (player.yards + shrinkage * prior.mean) / (player.attempts + shrinkage), 0) / observed.length);
  }
  return { ratings, scope: { season: year, cutoff: checkpoint.cutoff, fbsTeams: checkpoint.teams.length,
    supportedTeams: ratings.size, unsupported, recordsOutsideCutoffOrUndated } };
}

function sigmoid(logOdds) {
  const tail = Math.exp(-Math.abs(logOdds));
  return logOdds >= 0 ? 1 / (1 + tail) : tail / (1 + tail);
}

function fitAddedSlope(rows) {
  const scale = Math.sqrt(rows.reduce((sum, row) => sum + row.qbDifference ** 2, 0) / rows.length);
  if (!Number.isFinite(scale) || scale <= 1e-12 || new Set(rows.map(row => row.outcome)).size < 2) return null;
  const gradient = slope => rows.reduce((sum, row) => {
    const x = row.qbDifference / scale;
    return sum + x * (sigmoid(row.baselineLogOdds + slope * x) - row.outcome);
  }, 0.01 * slope);
  let low = -1;
  let high = 1;
  while (gradient(low) > 0) low *= 2;
  while (gradient(high) < 0) high *= 2;
  for (let step = 0; step < 60; step++) {
    const mid = (low + high) / 2;
    if (gradient(mid) > 0) high = mid;
    else low = mid;
  }
  const slope = (low + high) / 2;
  assert.ok(Math.abs(gradient(slope)) < 1e-8);
  return slope / scale;
}

function score(rows, slope) {
  if (!rows.length) return null;
  let brier = 0;
  let logLoss = 0;
  for (const row of rows) {
    const adjustment = row.qbDifference === null ? 0 : slope * row.qbDifference;
    const p = sigmoid(row.baselineLogOdds + adjustment);
    brier += (p - row.outcome) ** 2;
    logLoss -= Math.log(Math.max(1e-12, row.outcome ? p : 1 - p));
  }
  return { games: rows.length, brier: brier / rows.length, logLoss: logLoss / rows.length };
}

function compare(rows, slope) {
  const baseline = score(rows, 0);
  const challenger = slope === null ? null : score(rows, slope);
  return { baseline, challenger, delta: challenger ? { brier: challenger.brier - baseline.brier,
    logLoss: challenger.logLoss - baseline.logLoss } : null };
}

const defaults = ['research/preseason-roster-evidence.json', 'research/preseason-big12-qb-evidence.json',
  'research/preseason-sec-qb-evidence.json'];
const inputs = argumentsForEvidence.length ? argumentsForEvidence.map(path => resolve(path)) : defaults.map(path => new URL(path, root));
const documents = [];
for (const input of inputs) {
  try {
    const raw = await readFile(input);
    const document = JSON.parse(raw);
    assert.ok(Array.isArray(document.evidence), 'Evidence document requires an evidence array');
    const path = input instanceof URL ? fileURLToPath(input) : input;
    documents.push({ document, sha256: hash(raw), path: relative(fileURLToPath(root), path).replaceAll('\\', '/') });
  } catch (error) {
    if (error.code !== 'ENOENT' || argumentsForEvidence.length) throw error;
  }
}

const isMediaDay = document => /media[ -]?days?/i.test(document.scope ?? '');
const records = documents.flatMap(({ document }) => document.evidence.map(record =>
  isMediaDay(document) && record.roleEvidence === 'named-candidate' ? { ...record, roleEvidence: roles.mediaDay } : record));
const pending = documents.flatMap(({ document }) => (document.unresolved ?? []).filter(record => record.name).map(record => {
  const sameList = document.evidence.find(row => row.season === record.season && String(row.teamId) === String(record.teamId) &&
    row.roleEvidence === roles.mediaDay);
  return { ...record, roleEvidence: record.roleEvidence ?? (isMediaDay(document) || sameList ? roles.mediaDay : null),
    knownBy: record.knownBy ?? record.availableAt ?? sameList?.knownBy, sources: record.sources ?? sameList?.sources };
}));
const passingBytes = await bytes('research/cache/preseason-player/passing-seasons.json');
const passing = JSON.parse(passingBytes);
let shrinkage = 100;
let shrinkageEvidence = null;
if (usePilotShrinkage) {
  const pilotBytes = await bytes('research/cache/preseason-player/quarterback-replay.json');
  const pilot = JSON.parse(pilotBytes);
  assert.equal(pilot.sourceSha256, hash(passingBytes), 'Player pilot uses different passing input');
  assert.ok(pilot.trainingYears.every(year => year < testYears[0]), 'Player pilot overlaps the evaluation years');
  assert.ok(Number.isFinite(pilot.weights.four) && pilot.weights.four > 0);
  shrinkage = pilot.weights.four;
  shrinkageEvidence = { sourceSha256: hash(pilotBytes), playerCalibrationYears: pilot.trainingYears };
}
const config = await json('data/model.json');
const baselineBytes = await bytes('research/cache/preseason-team-baseline/result.json');
const baseline = JSON.parse(baselineBytes);
assert.deepEqual(baseline.config, config);
assert.ok(baseline.models.fourYears.trainingYears.every(year => year < trainYears[0]));
for (const path of ['src/engine.js', 'research/preseason-team-baseline.mjs']) {
  assert.equal(hash(await bytes(path)), baseline.sourceHashes[path], `Baseline code changed: ${path}`);
}
const baselineScale = baseline.models.fourYears.scale;
assert.ok(Number.isFinite(baselineScale) && baselineScale > 0);
const seasons = await Promise.all(Array.from({ length: 22 }, async (_, index) => {
  const path = `data/seasons/${2004 + index}.json`;
  const raw = await bytes(path);
  assert.equal(hash(raw), baseline.sourceHashes[path], `Baseline archive changed: ${path}`);
  return JSON.parse(raw);
}));
const archive = new Map(seasons.map(season => [season.year, season]));
const { rows, checkpoints } = replayPreseason(seasons, config, years);
const priors = new Map(years.map(year => [year, earlierPassing(passing, archive, year)]));
const results = {};
const temporalChecks = [];
for (const role of Object.keys(roles)) {
  const evidence = new Map(years.map(year => [year, teamEvidence(records, pending, checkpoints[year], priors.get(year), role, year, shrinkage)]));
  for (const [year, original] of evidence) {
    const checkpoint = checkpoints[year];
    const cutoff = Date.parse(checkpoint.cutoff);
    const existing = records.find(record => record.season === year && record.roleEvidence === roles[role] &&
      original.ratings.has(String(record.teamId)) && citedBefore(record, cutoff));
    if (!existing) continue;
    // A synthetic late candidate would otherwise make the role ambiguous.
    // Keep it in memory for this check only, including the unresolved path.
    const late = { ...existing, athleteId: '0', name: 'Timing regression fixture', knownBy: new Date(cutoff + 1).toISOString() };
    const checked = teamEvidence([...records, late], [...pending, late], checkpoint, priors.get(year), role, year, shrinkage);
    assert.deepEqual(checked.ratings, original.ratings, 'After-cutoff evidence changed paired forecast inputs');
    assert.equal(checked.scope.recordsOutsideCutoffOrUndated, original.scope.recordsOutsideCutoffOrUndated + 1);
    temporalChecks.push({ role, season: year, passed: true });
  }
  const paired = rows.map(game => {
    const ratings = evidence.get(game.season).ratings;
    const supported = ratings.has(game.home) && ratings.has(game.away);
    return { ...game, baselineLogOdds: game.edges.fourYears / baselineScale,
      qbDifference: supported ? ratings.get(game.home) - ratings.get(game.away) : null };
  });
  const train = paired.filter(game => trainYears.includes(game.season) && game.qbDifference !== null);
  const trainingTeams = new Set(train.flatMap(game => [game.home, game.away])).size;
  const slope = train.length >= minimum.trainingGames && trainingTeams >= minimum.trainingTeams ? fitAddedSlope(train) : null;
  const evaluate = games => {
    const supported = games.filter(game => game.qbDifference !== null);
    const conditional = compare(supported, slope);
    const fullScheduleWithFallback = compare(games, slope);
    if (conditional.delta) for (const metric of ['brier', 'logLoss']) {
      assert.ok(Math.abs(fullScheduleWithFallback.delta[metric] - conditional.delta[metric] * supported.length / games.length) < 1e-12);
    }
    return { games: games.length, supportedGames: supported.length,
      supportedTeamsInGames: new Set(supported.flatMap(game => [game.home, game.away])).size,
      meetsReportingMinimum: supported.length >= minimum.reportingGamesPerTestYear,
      conditional, fullScheduleWithFallback };
  };
  results[role] = { roleEvidence: roles[role], fitted: slope !== null, addedLogOddsPerYardPerAttempt: slope,
    trainingGames: train.length, trainingTeams, coverage: [...evidence.values()].map(value => value.scope),
    evaluation: evaluate(paired.filter(game => testYears.includes(game.season))),
    byYear: Object.fromEntries(years.map(year => [year, { split: trainYears.includes(year) ? 'fit' : 'evaluation',
      ...evaluate(paired.filter(game => game.season === year)) }])) };
}
const report = { trainYears, testYears, minimum, baselineScale, shrinkage, shrinkageEvidence,
  baselineSha256: hash(baselineBytes), passingSha256: hash(passingBytes),
  evidenceDocuments: documents.map(({ path, sha256 }) => ({ path, sha256 })),
  scope: 'Recorded archive regular-tagged FBS–FBS games. Features use dated preseason evidence and four earlier seasons of FBS passing production.',
  policy: 'One verified media-day participant or one explicitly confirmed starter. Room estimates require a documented complete room and average members with earlier recorded attempts. Each unsupported matchup keeps the baseline probability.',
  limitation: 'Media-day selection and source coverage can favor particular teams and players. Compare results both among supported fixtures and across the full paired schedule.',
  results, temporalChecks, cfbdCalls: 0 };
const filename = usePilotShrinkage ? 'roster-qb-challenger.pilot-shrinkage.json' : 'roster-qb-challenger.json';
await writeFile(new URL(`research/cache/preseason-player/${filename}`, root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([role, result]) => [role, {
  fitted: result.fitted, trainingGames: result.trainingGames, evaluation: result.evaluation,
  yearCoverage: Object.fromEntries(years.map(year => [year, result.byYear[year].supportedGames])),
}])), null, 2));
