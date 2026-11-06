import { rankSeason, predict, DEFAULT_CONFIG } from './engine.js';

export function buildHistory(seasons, config = DEFAULT_CONFIG, before = null) {
  let previous = null; const snapshots = [];
  for (const season of [...seasons].sort((a, b) => a.year - b.year)) {
    if (before && season.year > Number(before.slice(0, 4))) continue;
    const snapshot = rankSeason(season, { config, previous, before }); snapshots.push(snapshot); previous = snapshot;
  }
  return snapshots;
}

export function backtest(seasons, { config = DEFAULT_CONFIG, evaluateYears = null } = {}) {
  const predictions = []; let previous = null;
  for (const season of [...seasons].sort((a, b) => a.year - b.year)) {
    const fbs = new Set(season.teams.filter(t => t.division === 'fbs').map(t => t.id));
    // Freeze predictions before an entire competition week. No game result in
    // this week is allowed to influence another prediction from the same week.
    const buckets = new Map();
    for (const g of season.games.filter(g => g.completed)) {
      const key = `${g.seasonType}:${g.week}`;
      if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(g);
    }
    const groups = [...buckets.values()].sort((a, b) => Math.min(...a.map(g => Date.parse(g.startDate))) - Math.min(...b.map(g => Date.parse(g.startDate))));
    const seen = new Set();
    for (const group of groups) {
      const start = Math.min(...group.map(g => Date.parse(g.startDate)));
      const available = new Set(season.games.filter(g => seen.has(g.id) && Date.parse(g.startDate) + 86400000 <= start).map(g => g.id));
      if (!evaluateYears || evaluateYears.includes(season.year)) {
        const snapshot = rankSeason(season, { config, previous, gameIds: available });
        for (const g of group) {
          if (!fbs.has(g.home) || !fbs.has(g.away) || g.homePoints === g.awayPoints) continue;
          predictions.push({ season: season.year, gameId: g.id, week: g.week, seasonType: g.seasonType,
            trainingGames: snapshot.gamesUsed, home: g.home, away: g.away, actualMargin: g.homePoints - g.awayPoints,
            outcome: g.homePoints > g.awayPoints ? 1 : 0, baselineProbability: g.neutral ? 0.5 : 0.58, ...predict(snapshot, g) });
        }
      }
      for (const g of group) seen.add(g.id);
    }
    previous = rankSeason(season, { config, previous });
  }
  const metrics = rows => {
    if (!rows.length) return { games: 0 };
    const mean = fn => rows.reduce((sum, r) => sum + fn(r), 0) / rows.length;
    const loss = (p, y) => -y * Math.log(Math.max(1e-12, p)) - (1 - y) * Math.log(Math.max(1e-12, 1 - p));
    return { games: rows.length, accuracy: mean(r => Number((r.homeWinProbability >= 0.5) === Boolean(r.outcome))),
      brier: mean(r => (r.homeWinProbability - r.outcome) ** 2), logLoss: mean(r => loss(r.homeWinProbability, r.outcome)),
      marginMAE: mean(r => Math.abs(r.homeMargin - r.actualMargin)),
      baselineAccuracy: mean(r => Number((r.baselineProbability >= 0.5) === Boolean(r.outcome))),
      baselineBrier: mean(r => (r.baselineProbability - r.outcome) ** 2), baselineLogLoss: mean(r => loss(r.baselineProbability, r.outcome)) };
  };
  return { config, overall: metrics(predictions), bySeason: Object.fromEntries([...new Set(predictions.map(r => r.season))].map(y => [y, metrics(predictions.filter(r => r.season === y))])),
    limitations: ['Retrospective corrected source, not historical as-published data.', '24-hour kickoff buffer approximates result availability.', 'Probabilities remain experimental and are not calibrated.', 'No OT correction when source omits period scores.', 'Fixed home-only baseline uses 0.58 at home and 0.50 on neutral fields.'], predictions };
}
