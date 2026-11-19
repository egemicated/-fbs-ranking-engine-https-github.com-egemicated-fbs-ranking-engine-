// Offline probability-link research. Never writes model, prior, publication or forecast files.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { replay } from './historical_foundation.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const sigmoid = value => value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
export const FAMILIES = ['baseline', 'temperature', 'divisionOffset', 'temperatureDivision'];
const PARAMS = { baseline: 0, temperature: 1, divisionOffset: 1, temperatureDivision: 2 };

export function crossFeatures(row, family, scale = 14) {
  assert.ok(Number.isFinite(row.homeMargin));
  assert.ok(row.fbsSign === 1 || row.fbsSign === -1, 'A cross-division row needs a source-verified FBS orientation');
  assert.ok(FAMILIES.includes(family));
  if (family === 'temperature') return [row.homeMargin / scale];
  if (family === 'divisionOffset') return [row.fbsSign];
  if (family === 'temperatureDivision') return [row.homeMargin / scale, row.fbsSign];
  return [];
}

export function crossProbability(row, model, scale = 14) {
  const family = model?.family ?? 'baseline';
  if (family === 'baseline') return sigmoid(row.homeMargin / scale);
  const features = crossFeatures(row, family, scale);
  const fixed = family === 'divisionOffset' ? row.homeMargin / scale : 0;
  return sigmoid(fixed + features.reduce((sum, x, i) => sum + x * model.coefficients[i], 0));
}

export function fitCross(rows, family, { penalty = 0.01, scale = 14 } = {}) {
  assert.ok(rows.length && FAMILIES.includes(family));
  if (family === 'baseline') return { family, coefficients: [], trainingGames: rows.length };
  const dimension = PARAMS[family], positiveSlope = family !== 'divisionOffset';
  const x = rows.map(row => crossFeatures(row, family, scale));
  const fixed = rows.map(row => family === 'divisionOffset' ? row.homeMargin / scale : 0);
  rows.forEach(row => assert.ok(row.outcome === 0 || row.outcome === 1));
  const objective = coefficients => x.reduce((sum, values, i) => {
    const z = fixed[i] + values.reduce((total, value, j) => total + value * coefficients[j], 0);
    return sum + Math.max(z, 0) + Math.log1p(Math.exp(-Math.abs(z))) - rows[i].outcome * z;
  }, penalty * coefficients.reduce((sum, value) => sum + value * value, 0) / 2);
  let beta = family === 'divisionOffset' ? [0] : dimension === 1 ? [1] : [1, 0];
  let projectedGradient = Infinity, iterations = 0;
  for (; iterations < 200; iterations++) {
    const gradient = beta.map(value => penalty * value);
    const hessian = beta.map((_, a) => beta.map((_, b) => a === b ? penalty : 0));
    for (let i = 0; i < rows.length; i++) {
      const z = fixed[i] + x[i].reduce((sum, value, j) => sum + value * beta[j], 0);
      const p = sigmoid(z), variance = p * (1 - p);
      for (let a = 0; a < dimension; a++) {
        gradient[a] += x[i][a] * (p - rows[i].outcome);
        for (let b = 0; b < dimension; b++) hessian[a][b] += x[i][a] * x[i][b] * variance;
      }
    }
    projectedGradient = Math.max(...gradient.map(Math.abs));
    if (projectedGradient < 1e-7) break;
    let step;
    if (dimension === 1) step = [gradient[0] / hessian[0][0]];
    else {
      const [[a, b], [, d]] = hessian, determinant = a * d - b * b;
      assert.ok(determinant > 0, 'Positive definite calibration Hessian');
      step = [(d * gradient[0] - b * gradient[1]) / determinant, (a * gradient[1] - b * gradient[0]) / determinant];
    }
    const previous = objective(beta);
    let amount = 1, candidate;
    do {
      candidate = beta.map((value, i) => value - amount * step[i]);
      if (objective(candidate) <= previous + 1e-11) break;
      amount /= 2;
    } while (amount > 1e-12);
    assert.ok(objective(candidate) <= previous + 1e-10, 'Calibration objective increased');
    beta = candidate;
  }
  assert.ok(projectedGradient < 1e-6, 'Calibration optimization failed to converge');
  assert.ok(!positiveSlope || beta[0] > 0, 'Calibration slope must be positive; reject this family under the frozen protocol');
  return { family, coefficients: beta, trainingGames: rows.length, penalty, projectedGradient, iterations,
    equivalentScale: positiveSlope ? scale / beta[0] : scale,
    signedDivisionLogOdds: family === 'divisionOffset' ? beta[0] : dimension === 2 ? beta[1] : 0 };
}

export function crossMetrics(rows, model = null, scale = 14) {
  const bins = Array.from({ length: 10 }, (_, i) => ({ lower: i / 10, upper: (i + 1) / 10, games: 0, probabilitySum: 0, fbsWins: 0 }));
  if (!rows.length) return { games: 0, accuracy: null, brier: null, logLoss: null, fbsWinRate: null, meanFbsWinProbability: null,
    fbsProbabilityBias: null, calibrationError10Bins: null, correct: null, incorrect: null, probabilityTies: null, winnerChanges: null, reliability: bins };
  let accuracy = 0, brier = 0, logLoss = 0, pSum = 0, ySum = 0, correct = 0, incorrect = 0, ties = 0, changed = 0;
  for (const row of rows) {
    const ph = crossProbability(row, model, scale), p = row.fbsSign === 1 ? ph : 1 - ph;
    const y = row.fbsSign === 1 ? row.outcome : 1 - row.outcome;
    assert.ok(Number.isFinite(p) && p >= 0 && p <= 1);
    const clipped = Math.min(1 - 1e-15, Math.max(1e-15, p));
    brier += (p - y) ** 2; logLoss -= y * Math.log(clipped) + (1 - y) * Math.log(1 - clipped);
    if (p === 0.5) { ties++; accuracy += 0.5; } else if ((p > 0.5) === Boolean(y)) { correct++; accuracy++; } else incorrect++;
    changed += Number(Math.sign(ph - 0.5) !== Math.sign(crossProbability(row, null, scale) - 0.5));
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.games++; bin.probabilitySum += p; bin.fbsWins += y;
    pSum += p; ySum += y;
  }
  const reliability = bins.map(bin => ({ ...bin, meanFbsProbability: bin.games ? bin.probabilitySum / bin.games : null,
    observedFbsWinRate: bin.games ? bin.fbsWins / bin.games : null }));
  return { games: rows.length, accuracy: accuracy / rows.length, brier: brier / rows.length, logLoss: logLoss / rows.length,
    fbsWinRate: ySum / rows.length, meanFbsWinProbability: pSum / rows.length, fbsProbabilityBias: (pSum - ySum) / rows.length,
    calibrationError10Bins: reliability.reduce((sum, bin) => sum + (bin.games ? Math.abs(bin.probabilitySum - bin.fbsWins) : 0), 0) / rows.length,
    correct, incorrect, probabilityTies: ties, winnerChanges: changed, reliability };
}

export function selectCrossFamily(selectionRows, models, { tolerance = 1e-6, scale = 14 } = {}) {
  assert.ok(selectionRows.length);
  const scores = {};
  for (const family of FAMILIES) {
    if (!models[family]) continue;
    scores[family] = crossMetrics(selectionRows, models[family], scale);
  }
  const minimum = Math.min(...Object.values(scores).map(score => score.logLoss));
  const selected = Object.keys(scores).filter(family => scores[family].logLoss <= minimum + tolerance)
    .sort((a, b) => PARAMS[a] - PARAMS[b] || FAMILIES.indexOf(a) - FAMILIES.indexOf(b))[0];
  assert.ok(selected, 'A valid scored calibration family is required');
  return { selectedFamily: selected, scores };
}

export function pairedCrossInterval(rows, model, { replicates = 2000, seed = 20261118, scale = 14 } = {}) {
  assert.ok(rows.length && replicates > 0);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.group)) grouped.set(row.group, []);
    grouped.get(row.group).push(row);
  }
  const blocks = [...grouped.values()].map(block => {
    const baseline = crossMetrics(block, null, scale), candidate = crossMetrics(block, model, scale);
    return { games: block.length, brier: (candidate.brier - baseline.brier) * block.length,
      logLoss: (candidate.logLoss - baseline.logLoss) * block.length, accuracy: (candidate.accuracy - baseline.accuracy) * block.length };
  });
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const draws = { brier: [], logLoss: [], accuracy: [] };
  for (let i = 0; i < replicates; i++) {
    const sum = { games: 0, brier: 0, logLoss: 0, accuracy: 0 };
    for (let j = 0; j < blocks.length; j++) {
      const block = blocks[Math.floor(random() * blocks.length)];
      for (const key of Object.keys(sum)) sum[key] += block[key];
    }
    for (const key of Object.keys(draws)) draws[key].push(sum[key] / sum.games);
  }
  const interval = values => { values.sort((a, b) => a - b); return [values[Math.floor(values.length * 0.025)], values[Math.min(values.length - 1, Math.floor(values.length * 0.975))]]; };
  return { blocks: blocks.length, replicates, seed, unit: 'season/competition-week', interpretation: 'Paired block resampling sensitivity intervals; shared teams and previously examined seasons prevent a prospective significance claim.',
    candidateMinusBaseline: Object.fromEntries(Object.entries(draws).map(([key, values]) => [key, interval(values)])) };
}

export async function loadCrossSource(sourceRoot) {
  const metadata = JSON.parse(await readFile(join(ROOT, 'research/results/historical-foundation-v1/audit.metadata.json')));
  const seasons = [], sourceHashes = {};
  for (let year = 2004; year <= 2025; year++) {
    const path = join(sourceRoot, 'data/seasons', `${year}.json`), bytes = await readFile(path);
    assert.equal(sha(bytes), metadata.sourceLineage[year].originalSha256, `Original season ${year} source checksum`);
    seasons.push(JSON.parse(bytes)); sourceHashes[year] = sha(bytes);
  }
  for (const path of ['src/engine.js', 'src/history.js', 'data/model.json']) assert.equal(sha(await readFile(join(ROOT, path))), metadata.protectedHashes[path], `Frozen ${path}`);
  assert.equal(sha(await readFile(join(ROOT, 'research/historical_foundation.mjs'))), metadata.implementationHashes['research/historical_foundation.mjs'], 'Frozen preweek replay implementation');
  return { seasons, sourceHashes, metadata };
}

async function protectedHashes() {
  const files = ['src/engine.js', 'src/history.js', 'src/publication.js', 'src/fcs-publication.js', 'research/lib/division_candidate.mjs',
    'data/model.json', 'data/publication-model.json', 'data/matchup-validation.json', 'data/fcs-matchup-validation.json'];
  for (const directory of ['published', 'research/observations', 'research/division-observations', 'research/blend-observations']) {
    for (const entry of await readdir(join(ROOT, directory), { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) files.push(join(entry.parentPath, entry.name).slice(ROOT.length + 1).replaceAll('\\', '/'));
    }
  }
  return Object.fromEntries(await Promise.all(files.sort().map(async path => [path, sha(await readFile(join(ROOT, path)))])));
}

export async function runCrossResearch({ sourceRoot = resolve(ROOT, '../fbs-ranking-engine'), output = join(ROOT, 'research/results/division-calibration-v1') } = {}) {
  const protocolBytes = await readFile(join(ROOT, 'research/division-calibration-protocol-v1.json'));
  const clarificationBytes = await readFile(join(ROOT, 'research/division-calibration-protocol-v1-clarification.json'));
  assert.equal(sha(protocolBytes), 'd155cd2829f73752281e9d0cf6ed5d891c612084ea62cb193978d6d4467c7790');
  assert.equal(sha(clarificationBytes), '2cb0b795694a62ed3b7d4dc8888a25ec90d1d56508a5c0bd1001cfd0c44d6da0');
  const protocol = JSON.parse(protocolBytes), before = await protectedHashes();
  assert.deepEqual(protocol.crossDivision.candidatesInTieOrder, FAMILIES);
  const { seasons, sourceHashes, metadata } = await loadCrossSource(sourceRoot), config = JSON.parse(await readFile(join(ROOT, 'data/model.json')));
  const years = [...new Set([...protocol.refitYears, protocol.stressYear, ...protocol.evaluationYears])];
  console.log('Replaying fixed original Strength graph; no provider requests.');
  const replayed = replay(seasons, config, years);
  const seasonTeams = new Map(seasons.map(season => [season.year, new Map(season.teams.map(team => [team.id, team]))]));
  const rows = replayed.predictions.filter(row => row.division === 'FBS-FCS').map(row => {
    const teams = seasonTeams.get(row.season), homeDivision = teams.get(row.home).division, awayDivision = teams.get(row.away).division;
    assert.deepEqual([homeDivision, awayDivision].sort(), ['fbs', 'fcs']);
    return { ...row, homeDivision, awayDivision, fbsSign: homeDivision === 'fbs' ? 1 : -1 };
  });
  assert.equal(new Set(rows.map(row => `${row.season}:${row.gameId}`)).size, rows.length, 'Unique target identities');
  for (const row of rows) {
    const point = replayed.checkpoints.find(point => `${point.season}:${point.group}` === row.group);
    assert.ok(point && Date.parse(point.cutoff) <= Date.parse(row.startDate));
    if (point.latestTrainingKickoff) assert.ok(Date.parse(point.latestTrainingKickoff) + 86400000 <= Date.parse(point.cutoff));
  }
  const auditBytes = await readFile(join(ROOT, 'research/results/historical-foundation-v1/audit.json.gz'));
  assert.equal(sha(auditBytes), metadata.compressedSha256, 'Retained source audit checksum');
  const audit = JSON.parse(gunzipSync(auditBytes));
  const evaluationRows = rows.filter(row => protocol.evaluationYears.includes(row.season));
  const retained = audit.predictions.original.filter(row => row.division === 'FBS-FCS');
  assert.equal(retained.length, 602); assert.equal(evaluationRows.length, retained.length);
  const retainedMap = new Map(retained.map(row => [`${row.season}:${row.gameId}`, row]));
  for (const row of evaluationRows) for (const key of Object.keys(retainedMap.get(`${row.season}:${row.gameId}`) ?? {})) {
    assert.deepEqual(row[key], retainedMap.get(`${row.season}:${row.gameId}`)[key], `Exact retained audit forecast ${row.gameId} ${key}`);
  }
  assert.ok(evaluationRows.every(row => retainedMap.has(`${row.season}:${row.gameId}`)), 'Exact retained cohort identity');
  const fitRows = rows.filter(row => protocol.fitYears.includes(row.season)), selectionRows = rows.filter(row => protocol.selectionYears.includes(row.season));
  const options = { penalty: protocol.selection.penalty, scale: config.probabilityScale };
  const earlierModels = {}, invalidEarlierFits = {};
  for (const family of FAMILIES) {
    try { earlierModels[family] = fitCross(fitRows, family, options); }
    catch (error) { invalidEarlierFits[family] = error.message; }
  }
  assert.ok(earlierModels.baseline, 'The unfitted baseline must always remain eligible');
  const selection = selectCrossFamily(selectionRows, earlierModels, { tolerance: protocol.selection.tieTolerance, scale: config.probabilityScale });
  const refitRows = rows.filter(row => protocol.refitYears.includes(row.season));
  // The selected family and its refit coefficients are locked before final-period metrics are calculated.
  const selectedModel = fitCross(refitRows, selection.selectedFamily, options);
  const lock = { family: selection.selectedFamily, coefficients: selectedModel.coefficients, refitSeasons: protocol.refitYears,
    protocolSha256: sha(protocolBytes), selectionCriterion: protocol.selection.criterion };
  const lockSha256 = sha(Buffer.from(JSON.stringify(lock)));
  const compare = selected => ({ baseline: crossMetrics(selected), candidate: crossMetrics(selected, selectedModel) });
  const venue = row => row.neutral ? 'neutral' : row.fbsSign === 1 ? 'fbsHome' : 'fcsHome';
  const early = row => row.group.split(':')[1] === 'regular' && Number(row.group.split(':')[2]) <= 4;
  const byYear = Object.fromEntries(protocol.evaluationYears.map(year => [year, compare(evaluationRows.filter(row => row.season === year))]));
  const byVenue = Object.fromEntries(['fbsHome', 'fcsHome', 'neutral'].map(name => [name, compare(evaluationRows.filter(row => venue(row) === name))]));
  const bySeasonPart = { definition: 'Early = source regular weeks 1–4; later = remaining source weeks, including postseason.',
    early: compare(evaluationRows.filter(early)), later: compare(evaluationRows.filter(row => !early(row))) };
  const sensitivity = protocol.refitYears.map(year => {
    try { return { omittedRefitSeason: year, model: fitCross(refitRows.filter(row => row.season !== year), selection.selectedFamily, options) }; }
    catch (error) { return { omittedRefitSeason: year, model: null, invalidReason: error.message }; }
  });
  const diagnosticRate = refitRows.reduce((sum, row) => sum + (row.fbsSign === 1 ? row.outcome : 1 - row.outcome), 0) / refitRows.length;
  const diagnosticModel = { family: 'temperatureDivision', coefficients: [0, Math.log(diagnosticRate / (1 - diagnosticRate))] };
  const fbsWon = row => (row.fbsSign === 1 ? row.outcome : 1 - row.outcome) === 1;
  const fbsProbability = row => row.fbsSign === 1 ? crossProbability(row, selectedModel) : 1 - crossProbability(row, selectedModel);
  const forecastFavorites = { fbs: evaluationRows.filter(row => fbsProbability(row) > 0.5).length,
    fcs: evaluationRows.filter(row => fbsProbability(row) < 0.5).length, tied: evaluationRows.filter(row => fbsProbability(row) === 0.5).length };
  const mostSignificantMisses = evaluationRows.filter(row => (fbsProbability(row) > 0.5) !== fbsWon(row))
    .map(row => {
      const game = seasons.find(season => season.year === row.season).games.find(game => game.id === row.gameId);
      const teams = seasonTeams.get(row.season), probability = fbsProbability(row);
      return { season: row.season, gameId: row.gameId, startDate: row.startDate,
        home: { id: row.home, name: teams.get(row.home).name, points: game.homePoints },
        away: { id: row.away, name: teams.get(row.away).name, points: game.awayPoints }, neutral: row.neutral,
        predictedFbsProbability: probability, actualFbsWin: Number(fbsWon(row)),
        logLoss: -Math.log(fbsWon(row) ? probability : 1 - probability) };
    }).sort((a, b) => b.logLoss - a.logLoss || a.gameId.localeCompare(b.gameId)).slice(0, 5);
  const predictions = rows.map(row => ({ ...row, candidateHomeProbability: crossProbability(row, selectedModel),
    candidateFbsProbability: row.fbsSign === 1 ? crossProbability(row, selectedModel) : 1 - crossProbability(row, selectedModel) }));
  const after = await protectedHashes();
  assert.deepEqual(after, before, 'Protected production inputs, snapshots, and saved forecasts are unchanged');
  const result = { status: 'Offline experimental research; no production change', protocolSha256: sha(protocolBytes), clarificationSha256: sha(clarificationBytes),
    protocolId: protocol.id, historicalEvidenceStatus: protocol.historicalEvidenceStatus, selectedLock: lock, selectedLockSha256: lockSha256,
    primarySource: protocol.crossDivision.primarySource, sourceHashes, sourceAuditSha256: sha(auditBytes), protectedHashesBefore: before, protectedHashesAfter: after,
    implementationHashes: { 'research/cross-division-calibration.mjs': sha(await readFile(join(ROOT, 'research/cross-division-calibration.mjs'))),
      'research/historical_foundation.mjs': sha(await readFile(join(ROOT, 'research/historical_foundation.mjs'))) },
    strengthConfig: config, originalEvaluationForecastsReproduced: retained.length, fitGames: fitRows.length, selectionGames: selectionRows.length, refitGames: refitRows.length,
    earlierModels, invalidEarlierFits, selection, selectedModel, retrospectiveEvaluation: compare(evaluationRows), byYear, byVenue, bySeasonPart,
    pairedSensitivity: pairedCrossInterval(evaluationRows, selectedModel), leaveOneRefitSeasonOut: sensitivity,
    stress2020: compare(rows.filter(row => row.season === protocol.stressYear)),
    diagnosticOlderFbsWinRate: { note: 'Historical unconditional FBS win-rate-only comparator; not eligible for family selection or promotion.', refitGames: refitRows.length,
      fbsWinRate: diagnosticRate, retrospectiveEvaluation: crossMetrics(evaluationRows, diagnosticModel),
      byYear: Object.fromEntries(protocol.evaluationYears.map(year => [year, crossMetrics(evaluationRows.filter(row => row.season === year), diagnosticModel)])) },
    postfitDescriptiveDiagnostics: { note: 'Conditioning on realized outcomes and inspecting misses are descriptive postfit checks; neither changed selection or coefficients.',
      forecastFavorites, alwaysFbsWinnerAccuracy: evaluationRows.filter(fbsWon).length / evaluationRows.length,
      fcsUpsets: compare(evaluationRows.filter(row => !fbsWon(row))), fbsVictories: compare(evaluationRows.filter(fbsWon)), mostSignificantMisses },
    comparisonOrientation: 'All reliability bins and mean bias use FBS win probability, regardless of nominal home label. Brier, log loss, and winner accuracy are orientation-invariant.',
    interpretation: ['A division offset can change predicted winners; temperature alone with positive slope cannot. Strength points and predicted margins remain unchanged.',
      'These selected cross-division schedules mostly place FBS teams at home. The fitted division term is an empirical correction in this population, not a causal neutral-field subdivision advantage.',
      'Proper-score improvement does not establish improved winner accuracy, ranking fairness, or prospective calibration. Fixed-width calibration error depends on binning.',
      'All final-period seasons were previously inspected, and historical source information availability cannot be independently certified.',
      'No repaired historical prior is promoted. Genuine future validation requires an immutable before-kickoff forecast collection.'],
    cfbdCalls: 0, productionChanges: false };
  await mkdir(output, { recursive: true });
  const predictionBytes = Buffer.from(JSON.stringify({ protocolId: protocol.id, selectedLock: lock, predictions, checkpoints: replayed.checkpoints }) + '\n');
  const compressed = gzipSync(predictionBytes);
  result.predictionsArtifact = { file: 'cross-division-predictions.json.gz', sha256: sha(compressed), uncompressedSha256: sha(predictionBytes), games: predictions.length };
  await writeFile(join(output, 'cross-division-predictions.json.gz'), compressed);
  await writeFile(join(output, 'cross-division-summary.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ selectedFamily: selection.selectedFamily, selectedModel, fitGames: fitRows.length, selectionGames: selectionRows.length, refitGames: refitRows.length,
    evaluationGames: evaluationRows.length, retrospectiveEvaluation: { baseline: Object.fromEntries(Object.entries(result.retrospectiveEvaluation.baseline).filter(([key]) => key !== 'reliability')),
      candidate: Object.fromEntries(Object.entries(result.retrospectiveEvaluation.candidate).filter(([key]) => key !== 'reliability')) }, pairedSensitivity: result.pairedSensitivity }, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runCrossResearch();
