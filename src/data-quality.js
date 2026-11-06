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

// Narrow, source-backed corrections. IDs alone never discard a future rematch:
// year, participant IDs, original date window and a zero-zero reported final
// must all match. Genuine nonzero ties and unresolved cases remain untouched.
export const CANCELLATION_RULES = Object.freeze([
  {id:'401906581',teams:['200','2927'],from:'2026-10-14',through:'2026-10-18',source:'https://swosuathletics.com/sports/football/schedule/2026?grid=true'},
  {id:'401907150',teams:['2237','2911'],from:'2026-08-29',through:'2026-08-30',source:'https://goskyhawks.com/sports/football/schedule/2026'},
  {id:'401873405',teams:['2843','2871'],from:'2026-09-26',through:'2026-09-27',source:'https://westconnathletics.com/news/2026/9/25/football-saturdays-westconn-athletic-events-canceled-and-postponed-due-to-pending-storm.aspx'},
  {id:'401908594',teams:['2967','2972'],from:'2026-10-10',through:'2026-10-11',source:'https://athletics.plymouth.edu/news/2026/9/25/football-fb-saturdays-game-at-mass-maritime-postponed.aspx'}
]);

export function quarantineConfirmedCancellations(games,year) {
  const audit=[];
  const corrected=games.map(g=>{
    if(year!==2026||!g.completed||g.homePoints!==0||g.awayPoints!==0)return g;
    const day=new Date(g.startDate).toISOString().slice(0,10);
    const rule=CANCELLATION_RULES.find(r=>r.id===g.id&&r.teams.includes(g.home)&&r.teams.includes(g.away)&&g.home!==g.away&&day>=r.from&&day<=r.through);
    if(!rule)return g;
    audit.push({id:g.id,reason:'confirmed-canceled-original-slot',source:rule.source,providerReportedCompleted:true});
    return {...g,completed:false};
  });
  return {games:corrected,audit};
}
