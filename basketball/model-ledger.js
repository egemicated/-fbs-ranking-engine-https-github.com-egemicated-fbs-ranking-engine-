import { predictBasketball } from './model-forecast.js';

export const CAPTURE_HOURS = 72;
const confirmed = game => game.startTimeTbd === false && Number.isFinite(Date.parse(game.startDate));
const forecastKind = 'prospective';

export function captureBasketballForecasts(dataset, snapshot, existing = [], clock = Date.now()) {
  const now = new Date(clock), cutoff = Date.parse(snapshot.asOf);
  if (dataset.competition !== 'ncaam-d1' || dataset.competition !== snapshot.competition ||
      dataset.season !== snapshot.season || !Number.isFinite(cutoff) || !Number.isFinite(now.getTime()) || cutoff > now ||
      (snapshot.source?.sha256 && snapshot.source.sha256 !== dataset.source?.sha256)) {
    throw new Error('Forecast capture requires a current, matching basketball publication.');
  }
  const forecasts = [...existing];
  const published = new Set(existing.filter(row => row.season === snapshot.season && row.competition === snapshot.competition)
    .map(row => row.gameId));
  const due = dataset.games.filter(game => !game.completed && game.divisionOne === true && game.status === 'scheduled' &&
      confirmed(game) && Date.parse(game.startDate) > now && Date.parse(game.startDate) <= now.getTime() + CAPTURE_HOURS * 3_600_000 &&
      !published.has(game.id)).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
  for (const game of due) {
    const forecast = predictBasketball(snapshot, game);
    forecasts.push({
      kind: forecastKind, competition: snapshot.competition, season: snapshot.season, gameId: game.id,
      home: game.home, away: game.away, startDate: game.startDate, capturedAt: now.toISOString(),
      asOf: snapshot.asOf, snapshotHash: snapshot.snapshotHash, modelId: forecast.modelId,
      modelVersion: forecast.modelVersion, homeWinProbability: forecast.homeWinProbability, homeMargin: forecast.homeMargin,
    });
  }
  return forecasts;
}

function emptyReport(forecasts) {
  return { kind: forecastKind, forecasts, graded: 0, pending: 0, excluded: 0, missing: 0,
    right: 0, accuracy: null, brier: null, logLoss: null, calibrationError: null, confidence: [], games: [] };
}

export function reportBasketballForecasts(dataset, ledger) {
  const forecasts = ledger.filter(row => row.kind === forecastKind && row.competition === dataset.competition && row.season === dataset.season);
  const report = emptyReport(forecasts.length);
  const current = new Map(dataset.games.map(game => [game.id, game]));
  const accounted = new Set();
  const bands = Array.from({ length: 5 }, (_, i) => ({ lower: 0.5 + i / 10, count: 0, correct: 0, sumConfidence: 0 }));
  let squared = 0, logLoss = 0;
  for (const record of forecasts) {
    const game = current.get(record.gameId);
    const captured = Date.parse(record.capturedAt), original = Date.parse(record.startDate);
    const evidenceCutoff = Date.parse(record.asOf);
    if (accounted.has(record.gameId)) throw new Error('Duplicate immutable basketball forecast.');
    accounted.add(record.gameId);
    if (!game || game.divisionOne === false || !confirmed(game) || ![captured, original, evidenceCutoff].every(Number.isFinite) ||
        captured >= original || captured >= Date.parse(game.startDate) || evidenceCutoff > captured ||
        game.home !== record.home || game.away !== record.away || !Number.isFinite(record.homeWinProbability) ||
        record.homeWinProbability <= 0 || record.homeWinProbability >= 1 || game.status === 'cancelled') {
      report.excluded++;
      report.games.push({ ...record, status: 'excluded' });
      continue;
    }
    if (!game.completed) {
      report.pending++;
      report.games.push({ ...record, status: 'pending' });
      continue;
    }
    const won = Number(game.homePoints > game.awayPoints);
    const probability = record.homeWinProbability;
    const confidence = Math.max(probability, 1 - probability);
    const right = probability === 0.5 ? 0.5 : Number((probability > 0.5) === Boolean(won));
    const band = bands[Math.min(4, Math.floor((confidence - 0.5) * 10 + 1e-9))];
    report.graded++;
    report.right += right;
    squared += (probability - won) ** 2;
    logLoss -= won ? Math.log(probability) : Math.log1p(-probability);
    band.count++;
    band.correct += right;
    band.sumConfidence += confidence;
    report.games.push({ ...record, homePoints: game.homePoints, awayPoints: game.awayPoints, status: 'graded', right });
  }
  report.missing = dataset.games.filter(game => game.completed && game.divisionOne === true && confirmed(game) && !accounted.has(game.id)).length;
  if (report.graded) {
    report.accuracy = report.right / report.graded;
    report.brier = squared / report.graded;
    report.logLoss = logLoss / report.graded;
    report.confidence = bands.map(({ lower, count, correct, sumConfidence }) => ({
      lower, count, accuracy: count ? correct / count : null, meanConfidence: count ? sumConfidence / count : null,
    }));
    report.calibrationError = report.confidence.reduce((total, band) =>
      total + (band.count ? band.count * Math.abs(band.accuracy - band.meanConfidence) : 0), 0) / report.graded;
  }
  return report;
}
