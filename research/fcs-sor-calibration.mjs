// Offline only. Preserve production SOR, data, publications and observations.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { publishFcsSnapshot } from '../src/fcs-publication.js';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT = join(ROOT, 'research/results/division-calibration-v1');
const PROTOCOL_SHA = 'd155cd2829f73752281e9d0cf6ed5d891c612084ea62cb193978d6d4467c7790';
const CLARIFICATION_SHA = '2cb0b795694a62ed3b7d4dc8888a25ec90d1d56508a5c0bd1001cfd0c44d6da0';
const DIAGNOSTIC_AMENDMENT_SHA = '7af297dcc74e1905be35c1f6cfaa0734e0472ddc882311f05e9f07da6dbff810';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
export const sigmoid = z => z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
const softplus = z => Math.max(z, 0) + Math.log1p(Math.exp(-Math.abs(z)));
const PARAMETERS = ['slope', 'homeLogOdds', 'divisionLogOdds'];

function solve(matrix, vector) {
  const a = matrix.map((row, i) => [...row, vector[i]]), n = a.length;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    assert.ok(Math.abs(a[i][i]) > 1e-12, 'Singular calibration Hessian');
    const divisor = a[i][i];
    for (let k = i; k <= n; k++) a[i][k] /= divisor;
    for (let j = 0; j < n; j++) if (j !== i) {
      const factor = a[j][i];
      for (let k = i; k <= n; k++) a[j][k] -= factor * a[i][k];
    }
  }
  return a.map(row => row[n]);
}

export function fitFcs(rows, family, transferred, penalty = .01) {
  assert.ok(['transferred', 'fcsSlopeHome', 'fcsAll'].includes(family));
  assert.ok(rows.length && penalty > 0);
  const full = PARAMETERS.map(key => transferred[key]);
  assert.ok(full.every(Number.isFinite));
  assert.ok(rows.every(row => row.x.length === 3 && row.x.every(Number.isFinite) && [0, 1].includes(row.y)));
  if (family === 'transferred') return { family, coefficients: full, fittedCoefficients: 0, maxGradient: null, iterations: 0 };
  const dimensions = family === 'fcsAll' ? 3 : 2;
  let beta = full.slice(0, dimensions), gradient;
  const offset = row => dimensions === 2 ? full[2] * row.x[2] : 0;
  const objective = b => rows.reduce((sum, row) => {
    const z = dot(row.x.slice(0, dimensions), b) + offset(row);
    return sum + softplus(z) - row.y * z;
  }, .5 * penalty * dot(b, b));
  let iterations = 0;
  for (; iterations < 100; iterations++) {
    gradient = beta.map(value => penalty * value);
    const hessian = beta.map((_, i) => beta.map((__, j) => i === j ? penalty : 0));
    for (const row of rows) {
      const p = sigmoid(dot(row.x.slice(0, dimensions), beta) + offset(row));
      for (let i = 0; i < dimensions; i++) {
        gradient[i] += row.x[i] * (p - row.y);
        for (let j = 0; j < dimensions; j++) hessian[i][j] += row.x[i] * row.x[j] * p * (1 - p);
      }
    }
    if (Math.max(...gradient.map(Math.abs)) < 1e-8) break;
    const step = solve(hessian, gradient), old = objective(beta);
    let amount = 1, next;
    do {
      next = beta.map((value, i) => value - amount * step[i]);
      if (objective(next) <= old + 1e-10) break;
      amount /= 2;
    } while (amount > 1e-12);
    assert.ok(objective(next) <= old + 1e-9, 'Calibration objective increased');
    beta = next;
  }
  gradient = beta.map(value => penalty * value);
  for (const row of rows) {
    const p = sigmoid(dot(row.x.slice(0, dimensions), beta) + offset(row));
    for (let i = 0; i < dimensions; i++) gradient[i] += row.x[i] * (p - row.y);
  }
  const maxGradient = Math.max(...gradient.map(Math.abs));
  assert.ok(beta.every(Number.isFinite) && beta[0] > 0 && maxGradient < 1e-6, 'Invalid or unconverged FCS calibration fit');
  return { family, coefficients: dimensions === 2 ? [...beta, full[2]] : beta,
    fittedCoefficients: dimensions, maxGradient, iterations, objective: objective(beta), penalty };
}

export function probability(row, model) { return sigmoid(dot(row.x, model.coefficients)); }

export function scoreFcs(rows, model) {
  if (!rows.length) return { games: 0, accuracy: null, brier: null, logLoss: null, meanProbability: null,
    observedWinRate: null, calibrationError10Bins: null, reliability: [] };
  const crossOnly = rows.every(row => row.group === 'FBS-FCS');
  const bins = Array.from({ length: 10 }, (_, i) => ({ lower: i / 10, upper: (i + 1) / 10, games: 0, probabilitySum: 0, wins: 0 }));
  let brier = 0, logLoss = 0, accuracy = 0, predicted = 0, observed = 0;
  for (const row of rows) {
    let p = probability(row, model), y = row.y;
    if (crossOnly && row.homeDivision === 'fcs') { p = 1 - p; y = 1 - y; }
    const clipped = Math.max(1e-12, Math.min(1 - 1e-12, p));
    brier += (p - y) ** 2;
    logLoss += -y * Math.log(clipped) - (1 - y) * Math.log1p(-clipped);
    accuracy += p === .5 ? .5 : Number((p > .5) === Boolean(y));
    predicted += p; observed += y;
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.games++; bin.probabilitySum += p; bin.wins += y;
  }
  return { games: rows.length, accuracy: accuracy / rows.length, brier: brier / rows.length, logLoss: logLoss / rows.length,
    meanProbability: predicted / rows.length, observedWinRate: observed / rows.length,
    reliabilityOrientation: crossOnly ? 'FBS win regardless of venue' : 'Home/listed-A win',
    calibrationError10Bins: bins.reduce((sum, bin) => sum + Math.abs(bin.probabilitySum - bin.wins), 0) / rows.length,
    reliability: bins.filter(bin => bin.games).map(({ probabilitySum, wins, ...bin }) => ({ ...bin, meanProbability: probabilitySum / bin.games, observedWinRate: wins / bin.games })) };
}

export function selectFcs(rows, models, tolerance = .000001) {
  const candidates = models.map((model, index) => ({ model, index, score: scoreFcs(rows, model) }));
  assert.ok(candidates.every(candidate => candidate.score.games > 0));
  const minimum = Math.min(...candidates.map(candidate => candidate.score.logLoss));
  return candidates.filter(candidate => candidate.score.logLoss <= minimum + tolerance)
    .sort((a, b) => a.model.fittedCoefficients - b.model.fittedCoefficients || a.index - b.index)[0].model.family;
}

function slices(rows, model) {
  return Object.fromEntries(Object.entries({ all: () => true, 'FCS-FCS': r => r.group === 'FCS-FCS',
    'FBS-FCS': r => r.group === 'FBS-FCS',
    'FBS-home': r => r.group === 'FBS-FCS' && r.homeDivision === 'fbs' && r.x[1] !== 0,
    'FCS-home': r => r.group === 'FBS-FCS' && r.homeDivision === 'fcs' && r.x[1] !== 0,
    neutralCrossDivision: r => r.group === 'FBS-FCS' && r.x[1] === 0,
    fewerThanFourNetworkGames: r => r.early, atLeastFourNetworkGames: r => !r.early,
  }).map(([label, predicate]) => [label, scoreFcs(rows.filter(predicate), model)]));
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * q;
  return sorted[Math.floor(position)] + (position % 1) * (sorted[Math.ceil(position)] - sorted[Math.floor(position)]);
}

export function pairedBlocks(rows, baseline, candidate, replicates = 2000, seed = 20261118) {
  if (!rows.length) return { games: 0, blocks: 0, intervals: null };
  const groups = new Map();
  for (const row of rows) {
    const entry = groups.get(row.block) ?? { n: 0, brier: 0, logLoss: 0, accuracy: 0 };
    const old = probability(row, baseline), next = probability(row, candidate), y = row.y;
    const loss = p => -y * Math.log(Math.max(1e-12, p)) - (1 - y) * Math.log(Math.max(1e-12, 1 - p));
    const correct = p => p === .5 ? .5 : Number((p > .5) === Boolean(y));
    entry.n++; entry.brier += (next - y) ** 2 - (old - y) ** 2;
    entry.logLoss += loss(next) - loss(old); entry.accuracy += correct(next) - correct(old);
    groups.set(row.block, entry);
  }
  const blocks = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
  let state = seed >>> 0;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const samples = { brier: [], logLoss: [], accuracy: [] };
  for (let i = 0; i < replicates; i++) {
    const sum = { n: 0, brier: 0, logLoss: 0, accuracy: 0 };
    for (let j = 0; j < blocks.length; j++) {
      const selected = blocks[Math.floor(random() * blocks.length)];
      for (const key of Object.keys(sum)) sum[key] += selected[key];
    }
    for (const key of Object.keys(samples)) samples[key].push(sum[key] / sum.n);
  }
  return { games: rows.length, blocks: blocks.length, replicates, seed,
    intervals: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, [quantile(values, .025), quantile(values, .975)]])),
    orientation: 'Candidate minus transferred baseline; negative Brier/logLoss is better',
    interpretation: 'Descriptive paired competition-week resampling sensitivity. Shared teams and prior historical inspection preclude definitive prospective confidence claims.' };
}

async function protectedHashes() {
  const paths = ['src', 'frontend', 'published', '.github', 'data/model.json', 'data/publication-model.json',
    'data/matchup-validation.json', 'data/fcs-matchup-validation.json', 'research/observations', 'research/division-observations',
    'research/lib/division_candidate.mjs', 'research/frozen-division-comparison-v2.json'];
  const files = [];
  async function walk(path) {
    try { for (const entry of await readdir(path, { withFileTypes: true })) {
      const target = join(path, entry.name); if (entry.isDirectory()) await walk(target); else if (entry.isFile()) files.push(target);
    } } catch (error) { if (error.code !== 'ENOTDIR') throw error; files.push(path); }
  }
  for (const path of paths) await walk(join(ROOT, path));
  return Object.fromEntries(await Promise.all(files.sort().map(async path => [relative(ROOT, path).replaceAll('\\', '/'), sha(await readFile(path))])));
}

export function rankImpact(snapshot, coefficients, transferred, publishedReference = snapshot) {
  const baseline = publishFcsSnapshot(snapshot, { parameters: transferred });
  assert.equal(publishedReference.snapshotHash, snapshot.snapshotHash);
  const expected = new Map(publishedReference.fcsRankings.map(row => [row.id, row]));
  let maxScoreError = 0;
  for (const row of baseline.fcsRankings) {
    const old = expected.get(row.id); assert.ok(old, 'Missing current FCS row');
    assert.equal(row.displayRank, old.displayRank); assert.equal(row.sorGames, old.sorGames);
    assert.equal(row.sorWins, old.sorWins); assert.equal(row.wins, old.wins); assert.equal(row.losses, old.losses);
    if (row.sor !== null) maxScoreError = Math.max(maxScoreError, Math.abs(row.sor - old.sor));
    else assert.equal(old.sor, null);
  }
  assert.ok(maxScoreError < 1e-9, 'FCS production baseline did not reproduce');
  const parameters = Object.fromEntries(PARAMETERS.map((key, i) => [key, coefficients[i]]));
  const alternative = publishFcsSnapshot(snapshot, { parameters });
  const old = new Map(baseline.fcsRankings.map(row => [row.id, row]));
  const rows = alternative.fcsRankings.map(row => {
    const before = old.get(row.id);
    return { id: row.id, team: row.name, conference: row.conference, record: `${row.wins}-${row.losses}`,
      scoredRecord: `${row.sorWins}-${row.sorGames - row.sorWins}`, excludedGames: row.sorExcludedGames,
      baselineRank: before.displayRank, candidateRank: row.displayRank,
      rankChange: Number.isInteger(before.displayRank) && Number.isInteger(row.displayRank) ? before.displayRank - row.displayRank : null,
      baselineSor: before.sor, candidateSor: row.sor, baselineReferenceProbability: before.sorTailProbability,
      candidateReferenceProbability: row.sorTailProbability, baselineExpectedWins: before.sorExpectedWins, candidateExpectedWins: row.sorExpectedWins };
  });
  const old25 = new Set(rows.filter(row => row.baselineRank !== null && row.baselineRank <= 25).map(row => row.id));
  const new25 = new Set(rows.filter(row => row.candidateRank !== null && row.candidateRank <= 25).map(row => row.id));
  return { asOf: snapshot.asOf, snapshotHash: snapshot.snapshotHash, maxScoreReproductionError: maxScoreError,
    teams: rows.length, top25Overlap: [...old25].filter(id => new25.has(id)).length,
    entrants: rows.filter(row => new25.has(row.id) && !old25.has(row.id)).map(row => row.team),
    departures: rows.filter(row => old25.has(row.id) && !new25.has(row.id)).map(row => row.team),
    largestMovements: [...rows].filter(row => row.rankChange !== null).sort((a, b) => Math.abs(b.rankChange) - Math.abs(a.rankChange) || a.team.localeCompare(b.team)).slice(0, 10), rows,
    interpretation: 'Current snapshot illustration only. Same production graph, reference population, scored games and outcomes. Better outcome-link scores alone do not prove a fairer SOR order.' };
}

export async function main() {
  const before = await protectedHashes();
  const protocolBytes = await readFile(join(ROOT, 'research/division-calibration-protocol-v1.json'));
  const clarificationBytes = await readFile(join(ROOT, 'research/division-calibration-protocol-v1-clarification.json'));
  assert.equal(sha(protocolBytes), PROTOCOL_SHA); assert.equal(sha(clarificationBytes), CLARIFICATION_SHA);
  const amendmentBytes = await readFile(join(ROOT, 'research/division-calibration-protocol-v1-diagnostic-amendment.json'));
  assert.equal(sha(amendmentBytes), DIAGNOSTIC_AMENDMENT_SHA);
  const amendment = JSON.parse(amendmentBytes);
  const protocol = JSON.parse(protocolBytes), metadata = JSON.parse(await readFile(join(OUTPUT, 'fcs-features.metadata.json')));
  const packed = await readFile(join(OUTPUT, 'fcs-features.json.gz')); assert.equal(sha(packed), metadata.fixtureSha256);
  const unpacked = gunzipSync(packed); assert.equal(sha(unpacked), metadata.uncompressedSha256);
  const features = JSON.parse(unpacked), transferred = protocol.fcsSor.transferredCoefficients;
  const parentBytes = await readFile(join(ROOT, 'research/results/round2/6489ccaec521/round2.json.gz'));
  const frozen = JSON.parse(await readFile(join(ROOT, 'research/frozen-division-comparison-v2.json')));
  assert.equal(sha(gunzipSync(parentBytes)), frozen.researchReportSha256);
  assert.equal(features.parentReportSha256, sha(parentBytes));
  assert.equal(features.parentUncompressedSha256, frozen.researchReportSha256);
  assert.equal(features.exporterSha256, sha(await readFile(join(ROOT, 'research/export_fcs_sor_features.py'))));
  const parent = JSON.parse(gunzipSync(parentBytes));
  assert.deepEqual(features.sourceHashes, parent.inputSha256);
  const releaseBytes = await readFile(join(ROOT, 'research/releases/fcs-coverage-v1.json.gz'));
  const releaseMetadata = JSON.parse(await readFile(join(ROOT, 'research/releases/fcs-coverage-v1.metadata.json')));
  assert.equal(sha(releaseBytes), releaseMetadata.sha256); assert.equal(features.releaseSha256, releaseMetadata.sha256);
  assert.equal(features.repairManifestSha256, parent.repairManifestSha256);
  assert.equal(features.parentManifestSha256, JSON.parse(gunzipSync(releaseBytes)).manifest.parentManifestSha256);
  assert.equal(releaseMetadata.datasetFingerprint, frozen.datasetFingerprint);
  const contexts = {};
  for (const [context, rows] of Object.entries(features.contexts)) {
    assert.equal(new Set(rows.map(row => `${row.season}:${row.gameId}`)).size, rows.length);
    assert.ok(rows.every(row => row.group === 'FCS-FCS' || row.group === 'FBS-FCS'));
    if (context === 'prior-week-only') assert.ok(rows.every(row => Date.parse(row.cutoff) <= Date.parse(row.startDate) &&
      (!row.latestTrainingKickoff || Date.parse(row.latestTrainingKickoff) + 86400000 <= Date.parse(row.cutoff))));
    const years = list => rows.filter(row => list.includes(row.season));
    const training = years(protocol.fitYears), selection = years(protocol.selectionYears), refit = years(protocol.refitYears);
    const candidates = protocol.fcsSor.candidatesInTieOrder.map(family => fitFcs(training, family, transferred, protocol.selection.penalty));
    const family = selectFcs(selection, candidates, protocol.selection.tieTolerance);
    // This family is selected before any later-season scoring below.
    const model = fitFcs(refit, family, transferred, protocol.selection.penalty);
    const baseline = fitFcs(refit, 'transferred', transferred, protocol.selection.penalty);
    const evaluation = years(protocol.evaluationYears);
    const stability = protocol.refitYears.map(year => ({ excludedYear: year, ...fitFcs(refit.filter(row => row.season !== year), family, transferred, protocol.selection.penalty) }));
    const allFamilyStability = Object.fromEntries(protocol.fcsSor.candidatesInTieOrder.map(candidateFamily => [candidateFamily,
      protocol.refitYears.map(year => ({ excludedYear: year, ...fitFcs(refit.filter(row => row.season !== year), candidateFamily, transferred, protocol.selection.penalty) }))]));
    // Explicit amendment, declared after primary results were inspected. These
    // scores cannot reselect the primary family or justify production promotion.
    const diagnosticModels = protocol.fcsSor.candidatesInTieOrder.map(candidateFamily => fitFcs(refit, candidateFamily, transferred, protocol.selection.penalty));
    contexts[context] = { trainingGames: training.length, selectionGames: selection.length, refitGames: refit.length,
      selection: candidates.map(candidate => ({ ...candidate, selectionScore: scoreFcs(selection, candidate) })), selectedFamily: family, model,
      evaluation: { baseline: slices(evaluation, baseline), selected: slices(evaluation, model) },
      byYear: Object.fromEntries(protocol.evaluationYears.map(year => [year, { baseline: slices(years([year]), baseline), selected: slices(years([year]), model) }])),
      pandemicStress: { baseline: slices(years([protocol.stressYear]), baseline), selected: slices(years([protocol.stressYear]), model) },
      pairedSensitivity: Object.fromEntries(['all', 'FCS-FCS', 'FBS-FCS'].map(group => [group, pairedBlocks(evaluation.filter(row => group === 'all' || row.group === group), baseline, model)])),
      leaveOneRefitSeasonOut: stability,
      allFamilyLeaveOneRefitSeasonOut: allFamilyStability,
      postSelectionDiagnostic: { amendmentSha256: sha(amendmentBytes), timing: amendment.timing,
        models: Object.fromEntries(diagnosticModels.map(fitted => [fitted.family, { model: fitted,
          evaluation: slices(evaluation, fitted), byYear: Object.fromEntries(protocol.evaluationYears.map(year => [year, slices(years([year]), fitted)])),
          pairedSensitivity: Object.fromEntries(['all', 'FCS-FCS', 'FBS-FCS'].map(group => [group,
            pairedBlocks(evaluation.filter(row => group === 'all' || row.group === group), baseline, fitted)])) }])) },
      evaluationPredictions: evaluation.map(row => ({ ...row, baselineProbability: probability(row, baseline), selectedProbability: probability(row, model),
        diagnosticProbabilities: Object.fromEntries(diagnosticModels.map(fitted => [fitted.family, probability(row, fitted)])) })) };
  }
  const snapshotBytes = await readFile(join(ROOT, 'published/latest.json')), snapshot = JSON.parse(snapshotBytes);
  const publicReferenceBytes = await readFile(join(OUTPUT, 'fcs-current-publication-reference.json.gz'));
  const publicReference = JSON.parse(gunzipSync(publicReferenceBytes));
  // The protocol's primaryContext field is explanatory prose, not a cache key.
  const primary = contexts['excluded-game-final-network'];
  const impact = rankImpact(snapshot, primary.model.coefficients, transferred, publicReference);
  const after = await protectedHashes(); assert.deepEqual(after, before, 'Protected production file changed');
  const report = { id: 'fcs-sor-calibration-v1', protocolSha256: sha(protocolBytes), clarificationSha256: sha(clarificationBytes),
    diagnosticAmendmentSha256: sha(amendmentBytes),
    implementationSha256: { 'research/fcs-sor-calibration.mjs': sha(await readFile(new URL(import.meta.url))),
      'research/export_fcs_sor_features.py': sha(await readFile(join(ROOT, 'research/export_fcs_sor_features.py'))) },
    featureFixtureSha256: sha(packed), featureVerification: features.verification, inputSourceHashes: features.sourceHashes,
    contexts, currentSnapshotSha256: sha(snapshotBytes), currentPublicReferenceSha256: sha(publicReferenceBytes), currentRankImpact: impact, protectedHashes: before,
    productionUnchanged: true, cfbdCalls: 0, status: 'Offline retrospective research; FCS SOR stays Experimental. No production promotion.',
    limitations: [protocol.historicalEvidenceStatus, protocol.fcsSor.interpretation,
      'The transferred FBS baseline was originally fitted on 2014-2019, including 226 direct FBS-FCS selection targets in 2018-2019 and indirect FCS-FCS graph context. New FCS candidates use only 2014-2017 before selection. The unequal baseline exposure means retention is conservative, not independent proof the baseline is superior.',
      'Final-network leave-one-game-out features include other later results; they are descriptive reconstructions, never pregame forecasts.',
      'Source season labels and incomplete FCS/lower-division schedules remain coverage limits. Independent feature reproduction does not certify every historical input.',
      'Cross-division venues are highly selected. Coefficients are not a causal estimate of a neutral-field subdivision talent gap.',
      'Twenty-twenty is a tiny partial spring/fall source stress slice, not a full FCS season.'] };
  const encoded = Buffer.from(JSON.stringify(report, null, 2) + '\n'), compressed = gzipSync(encoded, { level: 9 });
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(join(OUTPUT, 'fcs-results.json.gz'), compressed);
  const { protectedHashes: _protected, contexts: _contexts, ...summary } = report;
  summary.contexts = Object.fromEntries(Object.entries(contexts).map(([context, value]) => { const { evaluationPredictions, ...rest } = value; return [context, rest]; }));
  summary.detail = 'Full per-game probabilities, reliability bins and protected hashes are retained in fcs-results.json.gz.';
  await writeFile(join(OUTPUT, 'fcs-summary.json'), JSON.stringify(summary, (key, value) => key === 'reliability' ? undefined : value, 2) + '\n');
  await writeFile(join(OUTPUT, 'fcs-results.metadata.json'), JSON.stringify({ compressedSha256: sha(compressed), uncompressedSha256: sha(encoded),
    compressedBytes: compressed.length, uncompressedBytes: encoded.length, protocolSha256: sha(protocolBytes), productionUnchanged: true, cfbdCalls: 0 }, null, 2) + '\n');
  const compact = ({ games, accuracy, brier, logLoss }) => ({ games, accuracy, brier, logLoss });
  console.log(JSON.stringify({ selected: Object.fromEntries(Object.entries(contexts).map(([key, value]) => [key, { family: value.selectedFamily, model: value.model,
    baseline: compact(value.evaluation.baseline.all), selected: compact(value.evaluation.selected.all) }])), impact: { teams: impact.teams, overlap: impact.top25Overlap,
      entrants: impact.entrants, departures: impact.departures, parity: impact.maxScoreReproductionError } }, null, 2));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
