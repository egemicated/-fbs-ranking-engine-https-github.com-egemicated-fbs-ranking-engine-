const easternParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hourCycle: 'h23',
});
const dayMs = 24 * 60 * 60 * 1000;

function easternTime(value) {
  const { year, month, day, hour } = Object.fromEntries(easternParts.formatToParts(value)
    .map(part => [part.type, part.value]));
  return { date: `${year}-${month}-${day}`, year: Number(year), month: Number(month), hour: Number(hour) };
}

export const footballPollDay = value => easternTime(value).date;
export function footballPollSeason(value) {
  const { year, month } = easternTime(value);
  return month === 1 ? year - 1 : month >= 8 ? year : null;
}

export function footballWeekendPollWindow(now, slate, releaseAt) {
  if (releaseAt && now.getTime() > releaseAt.getTime() + 36 * 60 * 60_000) return null;
  const { date, hour } = easternTime(releaseAt ?? now);
  const calendar = new Date(date + 'T00:00:00Z');
  const weekday = calendar.getUTCDay();
  if (!releaseAt && weekday > 1) return null;
  const sunday = new Date(calendar.getTime() - weekday * dayMs);
  const firstDay = new Date(sunday.getTime() - 7 * dayMs).toISOString().slice(0, 10);
  const sundayDay = sunday.toISOString().slice(0, 10);
  const weeks = new Map();
  for (const game of slate.games) {
    if (game.seasonType !== 'regular' || !Number.isInteger(game.week) || game.week < 1 ||
        !Number.isFinite(Date.parse(game.startDate))) continue;
    const kickoffDay = footballPollDay(new Date(game.startDate));
    if (kickoffDay < firstDay || kickoffDay >= sundayDay) continue;
    weeks.set(game.week, (weeks.get(game.week) ?? 0) + 1);
  }
  // An isolated makeup game, Army-Navy, or a bowl slate does not establish a
  // regular weekly poll. A later special edition still needs explicit evidence.
  const week = [...weeks].filter(([, games]) => games >= 2).map(([week]) => week).sort((a, b) => b - a)[0];
  if (week == null) return null;
  return { week, expectedAfter: releaseAt ? date : sundayDay,
    open: releaseAt ? now >= releaseAt : weekday === 1 || hour >= 14 };
}
