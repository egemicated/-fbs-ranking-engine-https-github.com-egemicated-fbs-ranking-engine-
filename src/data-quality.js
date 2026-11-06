// Identity safeguards, independent of ranking formulas.
export class DataQualityError extends Error {
  constructor(message, audit) { super(message); this.name = 'DataQualityError'; this.audit = audit; }
}

export function logicalDuplicateGroups(games) {
  const groups = new Map();
  for (const g of games) {
    if (!g.completed) continue;
    const date = new Date(g.startDate);
    if (!Number.isFinite(date.getTime())) throw new Error(`Invalid game date ${g.id}`);
    const key = JSON.stringify([[g.home, g.away].sort(), date.toISOString().slice(0, 10)]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  return [...groups.values()].filter(rows => rows.length > 1).map(rows => ({
    ids: rows.map(g => g.id), teams: [rows[0].home, rows[0].away].sort(),
    date: new Date(rows[0].startDate).toISOString().slice(0, 10),
    scoreConflict: new Set(rows.map(g => {
      const order = [g.home, g.away].sort();
      return JSON.stringify(order.map(id => id === g.home ? g.homePoints : g.awayPoints));
    })).size > 1,
    venueConflict: new Set(rows.map(g => g.neutral)).size > 1
  }));
}

export function assertNoLogicalDuplicates(games) {
  const groups = logicalDuplicateGroups(games);
  if (groups.length) throw new DataQualityError('Ambiguous duplicate games; preserving the previous publication', { logicalDuplicates: groups });
  return games;
}
