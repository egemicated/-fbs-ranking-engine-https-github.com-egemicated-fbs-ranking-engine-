// Optional offline grading of genuinely saved cross-division probability pairs.
// No provider requests, fitting, public forecast edits, or publication writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual as same } from 'node:util';
import { observationHash } from './capture-cross-division-shadow.mjs';
import { crossProbability } from './cross-division-calibration.mjs';
import { atomicJson } from '../src/ingest.js';

const ROOT = resolve(import.meta.dirname, '..'), DAY = 86400000;
const FROZEN_PATH = 'research/frozen-cross-division-calibration-v1.json';
const EVALUATOR_PATH = 'research/frozen-cross-division-shadow-evaluation-v1.json';
const SELF = 'research/evaluate-cross-division-shadow.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const time = value => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && value.length > 0;
const probability = value => Number.isFinite(value) && value >= 0 && value <= 1;
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

function validateObservation(observation, frozen, frozenSha256, now) {
  assert.ok(observation?.schemaVersion === 1 && observation.protocolId === frozen.id && observation.frozenAt === frozen.frozenAt,
    'Observation must identify the exact frozen protocol');
  assert.equal(observationHash(observation), observation.resultSha256, 'Observation checksum mismatch');
  assert.ok(same(observation.model, frozen.model), 'Observation coefficients or family differ from the frozen model');
  assert.ok(Number.isInteger(observation.season) && observation.season >= 2004 && Array.isArray(observation.forecasts));
  assert.ok(hash(observation.snapshotHash) && hash(observation.sourceHash));
  assert.ok(hash(observation.inputSha256?.snapshot) && hash(observation.inputSha256?.weekly));
  assert.equal(observation.inputSha256.frozen, frozenSha256, 'Observation frozen-manifest hash mismatch');
  const captured = time(observation.capturedAt), sourceAt = time(observation.sourceFetchedAt), asOf = time(observation.sourceAsOf);
  assert.ok([captured, sourceAt, asOf].every(Number.isFinite) && captured >= time(frozen.frozenAt) && captured <= now &&
    sourceAt <= asOf && asOf <= captured, 'Invalid captured source chronology');
  const seen = new Set();
  return observation.forecasts.map(row => {
    assert.ok(id(row.gameId) && !seen.has(row.gameId) && id(row.home) && id(row.away) && row.home !== row.away,
      'Duplicate or invalid captured game identity');
    seen.add(row.gameId);
    assert.ok(typeof row.neutral === 'boolean' && Number.isInteger(row.week) && row.week >= 0 && ['regular', 'postseason'].includes(row.seasonType));
    assert.ok(['fbs', 'fcs'].includes(row.homeDivision) && ['fbs', 'fcs'].includes(row.awayDivision) && row.homeDivision !== row.awayDivision,
      'Captured forecast must have explicit cross-division labels');
    const kickoff = time(row.kickoff);
    assert.ok(Number.isFinite(kickoff) && captured < kickoff && kickoff <= captured + frozen.horizonDays * DAY,
      'Captured forecast must precede its confirmed kickoff within seven days');
    assert.ok(Number.isFinite(row.homeMargin) && probability(row.baselineHomeProbability) && probability(row.candidateHomeProbability), 'Invalid saved probability pair');
    const features = { homeMargin: row.homeMargin, fbsSign: row.homeDivision === 'fbs' ? 1 : -1 };
    assert.ok(Math.abs(crossProbability(features, null, frozen.strengthConfig.probabilityScale) - row.baselineHomeProbability) < 1e-12,
      'Saved baseline probability does not reconcile to the captured margin');
    assert.ok(Math.abs(crossProbability(features, frozen.model, frozen.strengthConfig.probabilityScale) - row.candidateHomeProbability) < 1e-12,
      'Saved candidate probability does not reconcile to the frozen coefficients');
    return { ...row, capturedAt: observation.capturedAt, sourceAsOf: observation.sourceAsOf, sourceFetchedAt: observation.sourceFetchedAt,
      snapshotHash: observation.snapshotHash, sourceHash: observation.sourceHash, observationSha256: observation.resultSha256 };
  });
}

function score(rows, field) {
  let correct = 0, incorrect = 0, probabilityTies = 0, brier = 0, logLoss = 0, fbsProbabilities = 0, fbsWins = 0;
  const bins = Array.from({ length: 10 }, (_, i) => ({ lower: i / 10, upper: (i + 1) / 10, games: 0, probabilitySum: 0, fbsWins: 0 }));
  for (const row of rows) {
    const p = row[field], y = row.outcome;
    if (p === 0.5) probabilityTies++;
    else if (Number(p > 0.5) === y) correct++;
    else incorrect++;
    brier += (p - y) ** 2;
    const safe = Math.min(1 - 1e-15, Math.max(1e-15, p));
    logLoss -= y * Math.log(safe) + (1 - y) * Math.log1p(-safe);
    const fbsP = row.homeDivision === 'fbs' ? p : 1 - p, fbsY = row.homeDivision === 'fbs' ? y : 1 - y;
    const bin = bins[Math.min(9, Math.floor(fbsP * 10))];
    bin.games++; bin.probabilitySum += fbsP; bin.fbsWins += fbsY; fbsProbabilities += fbsP; fbsWins += fbsY;
  }
  const n = rows.length;
  return { correct, incorrect, probabilityTies, accuracy: n ? (correct + 0.5 * probabilityTies) / n : null,
    brier: n ? brier / n : null, logLoss: n ? logLoss / n : null, meanFbsWinProbability: n ? fbsProbabilities / n : null,
    observedFbsWinRate: n ? fbsWins / n : null,
    reliability: bins.map(bin => ({ ...bin, meanFbsProbability: bin.games ? bin.probabilitySum / bin.games : null,
      observedFbsWinRate: bin.games ? bin.fbsWins / bin.games : null })) };
}

export function compareCrossShadowScores(rows) {
  const baseline = score(rows, 'baselineHomeProbability'), candidate = score(rows, 'candidateHomeProbability');
  return { games: rows.length, baseline, candidate,
    changedFavorites: rows.filter(row => Math.sign(row.baselineHomeProbability - 0.5) !== Math.sign(row.candidateHomeProbability - 0.5)).length,
    candidateMinusBaseline: { accuracy: rows.length ? candidate.accuracy - baseline.accuracy : null,
      brier: rows.length ? candidate.brier - baseline.brier : null, logLoss: rows.length ? candidate.logLoss - baseline.logLoss : null } };
}

export function evaluateCrossDivisionShadow({ observations, frozen, frozenSha256, snapshot, weekly, evaluatedAt = new Date().toISOString() }) {
  const now = time(evaluatedAt);
  assert.ok(frozen?.id === 'cross-division-calibration-shadow-v1' && frozen.horizonDays === 7 && Number.isFinite(time(frozen.frozenAt)) && hash(frozenSha256));
  assert.ok(frozen.model?.family === 'temperatureDivision' && frozen.model.coefficients?.length === 2 && frozen.model.coefficients.every(Number.isFinite) && frozen.model.coefficients[0] > 0);
  assert.ok(frozen.strengthConfig?.probabilityScale === 14 && Number.isFinite(now), 'Invalid frozen model or evaluation time');
  assert.ok(snapshot?.source?.provider === 'cfbd' && hash(snapshot.source.sha256) && hash(snapshot.snapshotHash) && Number.isInteger(snapshot.season));
  assert.ok(snapshot.modelVersion === frozen.modelVersion && same(snapshot.config, frozen.strengthConfig), 'Current baseline differs from the frozen experiment');
  assert.ok(Array.isArray(observations) && Array.isArray(snapshot.ratings) && weekly?.schemaVersion === 1 && weekly.season === snapshot.season &&
    Array.isArray(weekly.teams) && Array.isArray(weekly.games));
  assert.ok(weekly.source?.snapshotHash === snapshot.snapshotHash && weekly.source.rankingAsOf === snapshot.asOf &&
    weekly.source.scheduleAsOf === snapshot.source.fetchedAt && weekly.source.modelVersion === snapshot.modelVersion && weekly.source.crossDivisionProbabilityScale === 14,
    'Weekly results must align with the current published snapshot');
  const sourceAt = time(snapshot.source.fetchedAt), asOf = time(snapshot.asOf), weeklyAt = time(weekly.asOf);
  assert.ok([sourceAt, asOf, weeklyAt].every(Number.isFinite) && sourceAt <= asOf && asOf <= weeklyAt && weeklyAt <= now, 'Invalid current result chronology');
  const games = new Map(weekly.games.map(game => [game.id, game]));
  const sourceTeams = new Map(snapshot.ratings.map(team => [team.id, team])), publicTeams = new Map(weekly.teams.map(team => [team.id, team]));
  assert.equal(games.size, weekly.games.length, 'Duplicate current result identity');
  assert.equal(sourceTeams.size, snapshot.ratings.length, 'Duplicate current source team');
  assert.equal(publicTeams.size, weekly.teams.length, 'Duplicate current public team');
  assert.ok([...games.keys()].every(id), 'Missing current result identity');
  const selected = new Map(), byCapture = new Map();
  let duplicateCheckpoints = 0, otherSeasonObservations = 0;
  for (const observation of observations) {
    const forecasts = validateObservation(observation, frozen, frozenSha256, now);
    if (observation.season !== snapshot.season) { otherSeasonObservations++; continue; }
    for (const pair of forecasts) {
      const key = `${pair.gameId}:${pair.capturedAt}`, sameTime = byCapture.get(key);
      assert.ok(!sameTime || stable(sameTime) === stable(pair), 'Conflicting paired forecasts share a capture time');
      byCapture.set(key, pair);
      const old = selected.get(pair.gameId);
      if (old) duplicateCheckpoints++;
      if (!old || time(pair.capturedAt) < time(old.capturedAt)) selected.set(pair.gameId, pair);
    }
  }
  const canceled = new Set((snapshot.source.audit?.confirmedCanceledRecords ?? []).map(row => row.id));
  const evaluated = [], pending = [], excluded = [];
  for (const [gameId, pair] of [...selected].sort(([a], [b]) => a.localeCompare(b))) {
    const game = games.get(gameId);
    if (canceled.has(gameId) || ['canceled', 'cancelled'].includes(game?.status)) { excluded.push({ gameId, reason: 'confirmed-canceled' }); continue; }
    if (!game) { pending.push({ gameId, reason: 'missing-from-current-result-source' }); continue; }
    if (game.home !== pair.home || game.away !== pair.away || game.neutral !== pair.neutral) {
      excluded.push({ gameId, reason: 'participants-or-venue-changed' }); continue;
    }
    const home = sourceTeams.get(game.home), away = sourceTeams.get(game.away), publicHome = publicTeams.get(game.home), publicAway = publicTeams.get(game.away);
    if (![home?.division, away?.division, publicHome?.division, publicAway?.division].every(value => ['fbs', 'fcs'].includes(value))) {
      pending.push({ gameId, reason: 'current-subdivision-label-unavailable' }); continue;
    }
    if (home.division !== pair.homeDivision || away.division !== pair.awayDivision || publicHome.division !== pair.homeDivision || publicAway.division !== pair.awayDivision) {
      excluded.push({ gameId, reason: 'current-subdivision-label-changed' }); continue;
    }
    const kickoff = time(game.startDate), captured = time(pair.capturedAt);
    if (game.startTimeTbd !== false || !Number.isFinite(kickoff)) { pending.push({ gameId, reason: 'current-kickoff-unconfirmed' }); continue; }
    if (captured >= kickoff) { excluded.push({ gameId, reason: 'corrected-kickoff-not-after-capture', resultKickoff: game.startDate }); continue; }
    if (kickoff > captured + frozen.horizonDays * DAY) { excluded.push({ gameId, reason: 'rescheduled-outside-seven-day-window', resultKickoff: game.startDate }); continue; }
    if (['postponed', 'suspended'].includes(game.status)) { pending.push({ gameId, reason: game.status }); continue; }
    if (game.status !== 'final' || kickoff > sourceAt || kickoff > asOf || kickoff > now || captured > sourceAt) {
      pending.push({ gameId, reason: 'awaiting-confirmed-final' }); continue;
    }
    if ([game.homePoints, game.awayPoints].some(value => value === null || value === undefined)) { pending.push({ gameId, reason: 'final-scores-not-reported' }); continue; }
    assert.ok([game.homePoints, game.awayPoints].every(value => Number.isSafeInteger(value) && value >= 0), 'Invalid final score in aligned result source');
    if (game.homePoints === game.awayPoints) { excluded.push({ gameId, reason: 'no-decisive-winner' }); continue; }
    evaluated.push({ ...pair, resultKickoff: game.startDate, correctedKickoff: kickoff !== time(pair.kickoff),
      resultSourceHash: snapshot.source.sha256, resultSnapshotHash: snapshot.snapshotHash,
      homePoints: game.homePoints, awayPoints: game.awayPoints, outcome: Number(game.homePoints > game.awayPoints) });
  }
  const report = { schemaVersion: 1, protocolId: frozen.id, frozenManifestSha256: frozenSha256, frozenAt: frozen.frozenAt,
    season: snapshot.season, evaluatedAt, asOf: snapshot.asOf, resultScheduleAsOf: snapshot.source.fetchedAt,
    resultSourceHash: snapshot.source.sha256, resultSnapshotHash: snapshot.snapshotHash,
    status: evaluated.length ? 'collecting-prospective-evidence' : 'awaiting-first-scored-game', observationsRead: observations.length,
    otherSeasonObservations, selectedForecasts: selected.size, duplicateCheckpoints, pending, excluded,
    selectionRule: 'First valid immutable capture per current-season game, selected independently of outcomes. Subsequent identity or eligibility failures exclude that first capture; later captures do not replace it.',
    scores: compareCrossShadowScores(evaluated), evaluated,
    interpretation: 'Only confirmed decisive finals with matching identity, subdivision, venue and a corrected kickoff strictly after capture within seven days are graded. Both models retain the same captured Strength graph. No graded games means evidence is pending, not success. Saved public picks and retrospective replays are not included; no automatic promotion.' };
  return { ...report, reportSha256: sha(JSON.stringify(report)) };
}

export async function runCrossShadowEvaluation() {
  assert.equal(process.argv.length, 2, 'No arguments supported');
  const frozenBytes = await readFile(join(ROOT, FROZEN_PATH)), frozen = JSON.parse(frozenBytes), frozenSha256 = sha(frozenBytes);
  const evaluatorBytes = await readFile(join(ROOT, EVALUATOR_PATH)), evaluator = JSON.parse(evaluatorBytes);
  assert.ok(evaluator.schemaVersion === 1 && evaluator.id === 'cross-division-calibration-shadow-evaluation-v1' &&
    evaluator.frozenManifestSha256 === frozenSha256 && evaluator.implementationSha256?.[SELF], 'Evaluator companion manifest or implementation pin missing');
  for (const pins of [frozen.implementationSha256, evaluator.implementationSha256]) for (const [file, expected] of Object.entries(pins)) {
    assert.equal(sha(await readFile(join(ROOT, file))), expected, `Frozen implementation changed: ${file}`);
  }
  const summaryBytes = await readFile(join(ROOT, 'research/results/division-calibration-v1/cross-division-summary.json'));
  assert.equal(sha(summaryBytes), frozen.researchSummarySha256, 'Frozen selection summary changed');
  assert.ok(same({ family: JSON.parse(summaryBytes).selectedModel.family, coefficients: JSON.parse(summaryBytes).selectedModel.coefficients }, frozen.model));
  const protocolBytes = await readFile(join(ROOT, 'research/division-calibration-protocol-v1.json'));
  assert.equal(sha(protocolBytes), frozen.researchProtocolSha256, 'Frozen research protocol changed');
  const snapshotBytes = await readFile(join(ROOT, 'published/latest.json')), weeklyBytes = await readFile(join(ROOT, 'published/weekly-picks.json'));
  const directory = join(ROOT, 'research/cross-division-calibration-observations');
  const names = await readdir(directory).catch(error => { if (error.code !== 'ENOENT') throw error; return []; });
  const observations = await Promise.all(names.filter(name => name.endsWith(`-${frozen.id}.json`)).sort().map(async name => JSON.parse(await readFile(join(directory, name)))));
  const report = evaluateCrossDivisionShadow({ observations, frozen, frozenSha256, snapshot: JSON.parse(snapshotBytes), weekly: JSON.parse(weeklyBytes) });
  report.inputSha256 = { snapshot: sha(snapshotBytes), weekly: sha(weeklyBytes), evaluatorManifest: sha(evaluatorBytes) };
  const { reportSha256: _old, ...withoutHash } = report;
  report.reportSha256 = sha(JSON.stringify(withoutHash));
  const output = join(ROOT, 'research/cross-division-calibration-evaluations');
  await atomicJson(join(output, 'latest.json'), report);
  console.log(JSON.stringify({ graded: report.scores.games, pending: report.pending.length, excluded: report.excluded.length, status: report.status }));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runCrossShadowEvaluation();
