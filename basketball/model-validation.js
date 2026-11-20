import {
  basketballModelEvidence, basketballResultAvailableAt, basketballSeasonRows, buildBasketballSnapshot, eligibleBasketballFinal,
} from './model-engine.js';
import { basketballLogistic, basketballVenue, matchupFeatures, weightedFeatures } from './model-forecast.js';

const dayMilliseconds = 86_400_000;
const candidateFeatures = {
  coin: [],
  venue: ['venue'],
  colley: ['venue', 'colley'],
  elo: ['venue', 'elo'],
  margin: ['venue', 'margin'],
  efficiency: ['venue', 'efficiency'],
  combined: ['venue', 'margin', 'efficiency'],
  context: ['venue', 'margin', 'efficiency', 'recent', 'rest'],
};
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const dateNumber = value => Date.parse(value);
const trueNCAA = game => game.tournament === true || /^(?:ncaa\b|national championship\b)/i.test(game.tournament ?? '');
const safeProbability = p => Math.min(1 - 1e-9, Math.max(1e-9, p));

export function basketballReplayFeatures(dataset) {
  const { teams, games, teamIds } = basketballSeasonRows(dataset);
  const eligible = games.filter(game => eligibleBasketballFinal(game, teamIds));
  const known = eligible.slice().sort((a, b) => basketballResultAvailableAt(a) - basketballResultAvailableAt(b) || a.id.localeCompare(b.id));
  const chronology = eligible.filter(game => game.startTimeTbd !== true && Number.isFinite(dateNumber(game.startDate)))
    .sort((a, b) => dateNumber(a.startDate) - dateNumber(b.startDate) || a.id.localeCompare(b.id));
  const allPriorGames = [];
  const results = [];
  let previousCutoff, model, rows, cursor = 0;
  for (const game of chronology) {
    // Refit once per UTC day. All games on that day see the same information,
    // including for evening slates with overlapping, unverified completion times.
    const cutoff = Math.floor(dateNumber(game.startDate) / dayMilliseconds) * dayMilliseconds;
    if (cutoff !== previousCutoff) {
      while (cursor < known.length && basketballResultAvailableAt(known[cursor]) <= cutoff) allPriorGames.push(known[cursor++]);
      model = basketballModelEvidence(teams, allPriorGames, { details: false });
      rows = new Map(model.teams.map(row => [row.id, row]));
      previousCutoff = cutoff;
    }
    const home = rows.get(game.home), away = rows.get(game.away);
    const features = matchupFeatures(home, away, game, model.leagueEfficiency, model.meanTempo);
    results.push({
      id: game.id,
      season: dataset.season,
      tipoff: new Date(game.startDate).toISOString(),
      cutoff: new Date(cutoff).toISOString(),
      features,
      won: Number(game.homePoints > game.awayPoints),
      actualMargin: game.homePoints - game.awayPoints,
      tournament: trueNCAA(game),
      site: game.neutral === null || game.neutral === undefined ? 'unknown site' : game.neutral ? 'neutral' : 'home court',
      conferenceGame: game.conferenceGame === true,
      datePhase: Math.min(home.games, away.games) < 5 ? 'early-season' : 'established',
      scheduleQuality: Math.abs(features.colley) < 0.10 ? 'similar records' : 'separated records',
    });
  }
  return results;
}

function linearSolution(matrix, rhs) {
  const system = matrix.map((row, i) => [...row, rhs[i]]);
  for (let i = 0; i < system.length; i++) {
    let pivot = i;
    for (let j = i + 1; j < system.length; j++) {
      if (Math.abs(system[j][i]) > Math.abs(system[pivot][i])) pivot = j;
    }
    [system[i], system[pivot]] = [system[pivot], system[i]];
    const base = system[i][i];
    if (Math.abs(base) < 1e-12) throw new Error('Basketball regression is singular.');
    for (let j = i; j <= system.length; j++) system[i][j] /= base;
    for (let row = 0; row < system.length; row++) {
      if (row === i) continue;
      const factor = system[row][i];
      for (let j = i; j <= system.length; j++) system[row][j] -= factor * system[i][j];
    }
  }
  return system.map(row => row.at(-1));
}

function fitWeights(rows, keys, outcome) {
  if (keys.length === 0) return {};
  const dimensions = keys.length;
  const scale = keys.map(key => Math.max(1e-5, Math.sqrt(mean(rows.map(row => row.features[key] ** 2)))));
  const samples = rows.map(row => ({ x: keys.map((key, i) => row.features[key] / scale[i]), y: row[outcome] }));
  let beta = Array(dimensions).fill(0);
  const binary = outcome === 'won';
  // Weak zero-centering is applied after scaling the covariates. There is no
  // intercept: swapping teams and reversing venue must complement the forecast.
  const ridge = binary ? 3 : 5;
  for (let turn = 0; turn < (binary ? 20 : 1); turn++) {
    const information = Array.from({ length: dimensions }, (_, i) => Array.from({ length: dimensions }, (_, j) => i === j ? ridge : 0));
    const rhs = beta.map(weight => -ridge * weight);
    for (const { x, y } of samples) {
      const estimate = x.reduce((sum, value, i) => sum + value * beta[i], 0);
      const p = binary ? basketballLogistic(estimate) : estimate;
      const info = binary ? p * (1 - p) : 1;
      for (let i = 0; i < dimensions; i++) {
        rhs[i] += x[i] * (y - p);
        for (let j = 0; j < dimensions; j++) information[i][j] += info * x[i] * x[j];
      }
    }
    const step = linearSolution(information, rhs);
    beta = beta.map((weight, i) => weight + step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
  }
  return Object.fromEntries(keys.map((key, i) => [key, beta[i] / scale[i]]));
}

function accumulator() {
  return { games: 0, accuracy: 0, brier: 0, brierSquare: 0, log: 0, absoluteMargin: 0,
    confidence: 0, averageHomeProbability: 0, actualHomeWinRate: 0 };
}

function accumulate(total, row, p, margin) {
  const error = (p - row.won) ** 2;
  const correct = p === 0.5 ? 0.5 : Number((p > 0.5) === Boolean(row.won));
  total.games++;
  total.accuracy += correct;
  total.brier += error;
  total.brierSquare += error ** 2;
  total.log -= row.won ? Math.log(p) : Math.log1p(-p);
  total.absoluteMargin += Math.abs(margin - row.actualMargin);
  total.confidence += Math.max(p, 1 - p);
  total.averageHomeProbability += p;
  total.actualHomeWinRate += row.won;
}

function finish(total) {
  const { games, brierSquare, ...sums } = total;
  if (!games) return { games: 0, accuracy: null, brier: null, logLoss: null, marginMae: null };
  const brier = sums.brier / games;
  const error = games > 1 ? Math.sqrt(Math.max(0, (brierSquare - games * brier ** 2) / (games - 1)) / games) : null;
  return {
    games,
    accuracy: sums.accuracy / games,
    brier,
    logLoss: sums.log / games,
    marginMae: sums.absoluteMargin / games,
    meanConfidence: sums.confidence / games,
    averageHomeProbability: sums.averageHomeProbability / games,
    actualHomeWinRate: sums.actualHomeWinRate / games,
    brierApprox95: error === null ? null : [Math.max(0, brier - 1.96 * error), Math.min(1, brier + 1.96 * error)],
  };
}

export function basketballPredictionMetrics(rows, probability, margin = {}, { detailed = true } = {}) {
  const total = accumulator(), slices = new Map();
  const bands = ['50–59%', '60–69%', '70–79%', '80–89%', '90–100%'].map(label => ({ label, total: accumulator() }));
  for (const row of rows) {
    const p = safeProbability(basketballLogistic(weightedFeatures(row.features, probability)));
    const score = weightedFeatures(row.features, margin);
    accumulate(total, row, p, score);
    if (!detailed) continue;
    const band = Math.min(4, Math.floor((Math.max(p, 1 - p) - 0.5) * 10 + 1e-9));
    accumulate(bands[band].total, row, p, score);
    for (const key of [row.site, row.datePhase, row.scheduleQuality, row.features.hasBox ? 'box-feature coverage' : 'margin fallback',
      row.conferenceGame ? 'conference' : 'nonconference', row.tournament ? 'NCAA tournament' : 'other games',
      p > 0.5 ? 'home side favored' : p < 0.5 ? 'away side favored' : 'pick’em', String(row.season)]) {
      if (!slices.has(key)) slices.set(key, accumulator());
      accumulate(slices.get(key), row, p, score);
    }
  }
  const summary = finish(total);
  if (!detailed) return summary;
  const confidence = bands.map(({ label, total: entries }) => ({ label, ...finish(entries) }));
  const calibrationError = total.games
    ? confidence.reduce((sum, bin) => sum + (bin.games ? bin.games * Math.abs(bin.meanConfidence - bin.accuracy) : 0), 0) / total.games : null;
  return { ...summary, calibrationError, confidence, slices: Object.fromEntries([...slices].map(([key, totals]) => [key, finish(totals)])) };
}

function rankAgreement(referenceTeams, comparisonTeams) {
  const rankings = new Map(comparisonTeams.map(team => [team.id, team.sorRank]));
  const changes = referenceTeams.filter(team => team.sorRank !== null && rankings.get(team.id) != null)
    .map(team => Math.abs(team.sorRank - rankings.get(team.id)));
  const original25 = referenceTeams.filter(team => team.sorRank <= 25 && team.sorRank !== null);
  return {
    teams: changes.length,
    meanAbsoluteRankChange: mean(changes),
    retainedTop25: original25.filter(team => rankings.get(team.id) != null && rankings.get(team.id) <= 25).length,
    originalTop25: original25.length,
  };
}

function testReferenceSensitivity(season, config) {
  const eligible = season.games.filter(game => game.completed);
  const observedDates = eligible.map(game => dateNumber(game.startDate)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!observedDates.length) return [];
  const tournament = eligible.filter(trueNCAA).map(game => dateNumber(game.startDate)).filter(Number.isFinite);
  const cutoffs = [
    ['midseason', observedDates[Math.floor(observedDates.length / 2)]],
    ['selection-window', tournament.length ? Math.min(...tournament) - 1 : observedDates.at(-1) + dayMilliseconds],
  ];
  return cutoffs.map(([period, cutoff]) => {
    const snapshot = buildBasketballSnapshot(season, { asOf: cutoff, config, retrospective: true, compareReferences: true });
    const alternatives = Object.fromEntries(Object.entries(snapshot.reference.alternatives).map(([name, variant]) => [
      name, { colley: variant.reference, ...rankAgreement(snapshot.teams, variant.teams) },
    ]));
    return { season: season.season, period, cutoff: snapshot.asOf, gamesUsed: snapshot.gamesUsed, alternatives };
  });
}

export function validateBasketball(seasons, { includeSorSensitivity = true } = {}) {
  const ordered = seasons.slice().sort((a, b) => a.season - b.season);
  if (ordered.length < 3 || new Set(ordered.map(season => season.season)).size !== ordered.length) {
    throw new Error('Provide at least three complete seasons for distinct training, tuning, and holdout sets.');
  }
  const trainingSeasons = ordered.slice(0, -2), tuningSeason = ordered.at(-2), testSeason = ordered.at(-1);
  const seasonRows = new Map(ordered.map(season => [season.season, basketballReplayFeatures(season)]));
  const train = trainingSeasons.flatMap(season => seasonRows.get(season.season));
  const tune = seasonRows.get(tuningSeason.season), test = seasonRows.get(testSeason.season);
  if ([train, tune, test].some(rows => rows.length < 1000)) {
    throw new Error('Training, tuning, and test splits each require at least 1,000 eligible Division I games.');
  }
  const candidates = Object.entries(candidateFeatures).map(([id, keys]) => {
    const probability = fitWeights(train, keys, 'won'), scoreMargin = fitWeights(train, keys, 'actualMargin');
    return { id, keys, probability, scoreMargin,
      tuning: basketballPredictionMetrics(tune, probability, scoreMargin, { detailed: false }),
      holdout: basketballPredictionMetrics(test, probability, scoreMargin, { detailed: false }) };
  });
  // Each candidate must clear a small tuning Brier improvement over the
  // practical current selection. The holdout is reported once, never selected on.
  const selected = candidates.reduce((best, current) => current.tuning.brier < best.tuning.brier - 0.0002 ? current : best);
  const colley = candidates.find(candidate => candidate.id === 'colley');
  const modelConfig = {
    id: selected.id, calibrated: true,
    probability: selected.probability, scoreMargin: selected.scoreMargin,
    sor: { venue: colley.probability.venue, colley: colley.probability.colley },
  };
  const rows = ordered.map(season => ({
    season: season.season,
    sourceSha256: season.source?.sha256 ?? null,
    teams: season.teams.length,
    replayGames: seasonRows.get(season.season).length,
  }));
  return {
    kind: 'historical-replay',
    protocol: 'gd-basketball-chronological-v1',
    methodology: 'One as-of refit per UTC day. Results with no measured availability receive a 24-hour buffer, or 48 hours when tipoff is unconfirmed. Unknown tipoffs are excluded from grading. Training, tuning, and holdout use separate entire seasons. No own prospective outcomes were scored here.',
    cohorts: { training: trainingSeasons.map(season => season.season), tuning: [tuningSeason.season], holdout: [testSeason.season] },
    sources: rows,
    modelConfig,
    selected: selected.id,
    candidates,
    holdout: basketballPredictionMetrics(test, selected.probability, selected.scoreMargin),
    sorSensitivity: includeSorSensitivity ? [tuningSeason, testSeason].flatMap(season => testReferenceSensitivity(season, modelConfig)) : [],
  };
}
