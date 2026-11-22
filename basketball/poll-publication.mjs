export const BASKETBALL_POLLS = Object.freeze({
  ap: { name: 'AP Top 25', url: 'https://apnews.com/hub/ap-top-25-college-basketball-poll' },
  coaches: { name: 'USA TODAY Coaches Poll', url: 'https://www.ncaa.com/rankings/basketball-men/d1/usa-today-coaches' },
});
const seasonTypes = ['preseason', 'regular', 'postseason'];
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const easternDate = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const easternHour = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'});
const abbreviation = { 'associated press': 'ap', 'ap top 25': 'ap', 'coaches poll': 'coaches', 'usa today coaches poll': 'coaches', 'usa today coaches': 'coaches' };

function rankedTeams(rows, teams) {
  const ranked = [...rows].sort((a,b) => a.rank-b.rank || a.id.localeCompare(b.id));
  // Competition ranking has gaps immediately after tied places. All distinct
  // identities count toward the 25 places, including ties at the last place.
  if (ranked.length < 25 || ranked.length > 30 || new Set(ranked.map(row=>row.id)).size !== ranked.length ||
      ranked.some(({id,rank},i) => !teams.has(id) || !Number.isInteger(rank) || rank < 1 || rank > 25 ||
        (rank !== i+1 && rank !== ranked[i-1]?.rank)) ||
      ranked[25]?.rank !== undefined && ranked[25].rank !== ranked[24].rank) return null;
  return ranked;
}

export function readBasketballPolls(saved, teams, season) {
  if (saved == null || saved.season !== season) return { schema:1, season, polls:{} };
  if (saved.schema !== 1 || !saved.polls || typeof saved.polls !== 'object' || Array.isArray(saved.polls)) {
    throw Error('Invalid basketball poll publication');
  }
  for (const [type,poll] of Object.entries(saved.polls)) {
    if (!Object.hasOwn(BASKETBALL_POLLS,type) || !isoDate.test(poll?.pollDate) || !Number.isInteger(poll.week) ||
        !seasonTypes.includes(poll.seasonType) || !Number.isFinite(Date.parse(poll.observedAt)) ||
        poll.pollDate > easternDate.format(new Date(poll.observedAt)) || !Array.isArray(poll.ranks) ||
        !rankedTeams(poll.ranks,teams)) throw Error('Invalid basketball poll edition');
  }
  return saved;
}

export function updateBasketballPolls(saved, raw, {teams,season,observedAt}) {
  if (!Array.isArray(raw) || !Number.isFinite(Date.parse(observedAt))) throw Error('Invalid dated poll source');
  const prior = readBasketballPolls(saved,teams,season);
  const today = easternDate.format(new Date(observedAt));
  const groups = new Map();
  for (const row of raw) {
    const source = typeof row?.pollType === 'string' ? row.pollType.trim().toLowerCase() : '';
    const type = Object.hasOwn(BASKETBALL_POLLS,source) ? source : abbreviation[source];
    const date = typeof row?.pollDate === 'string' ? row.pollDate.slice(0,10) : '';
    if (!Object.hasOwn(BASKETBALL_POLLS,type) || row.season !== season || !isoDate.test(date) ||
        !Number.isFinite(Date.parse(row.pollDate)) || date > today || !seasonTypes.includes(row.seasonType) ||
        !Number.isInteger(row.week) || !Number.isInteger(row.ranking) || row.ranking < 1 || row.ranking > 25) continue;
    const key = [type,date,row.seasonType,row.week].join(':');
    if (!groups.has(key)) groups.set(key, {type,pollDate:date,seasonType:row.seasonType,week:row.week,ranks:[]});
    groups.get(key).ranks.push({id:Number.isSafeInteger(row.teamId) && row.teamId>0 ? 'ncaam-d1:'+row.teamId : '',rank:row.ranking});
  }
  const polls = {...prior.polls};
  for (const type of Object.keys(BASKETBALL_POLLS)) {
    const candidates = [...groups.values()].filter(row=>row.type===type).sort((a,b)=>b.pollDate.localeCompare(a.pollDate));
    const latest = candidates[0];
    if (!latest || candidates[1]?.pollDate===latest.pollDate || (polls[type] && polls[type].pollDate>=latest.pollDate)) continue;
    const ranks = rankedTeams(latest.ranks,teams);
    if (ranks) polls[type] = {pollDate:latest.pollDate,seasonType:latest.seasonType,week:latest.week,observedAt,ranks};
  }
  return Object.keys(polls).every(type=>polls[type]===prior.polls[type]) ? prior : {...prior,polls};
}

export function basketballPollWeek(clock) {
  const date = new Date(easternDate.format(clock) + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay()+6)%7);
  return date.toISOString().slice(0,10);
}

export function basketballPollCheckDue(clock, mode) {
  if (mode === 'manual') return true;
  const weekday = new Date(easternDate.format(clock) + 'T00:00:00Z').getUTCDay();
  const hour = Number(easternHour.format(clock));
  return (mode === 'primary' && weekday === 1 && hour >= 14) || (mode === 'recovery' && weekday === 2 && hour >= 9);
}
