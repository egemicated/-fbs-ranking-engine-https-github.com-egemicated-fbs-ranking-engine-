const minute = 60_000;
const day = 24 * 60 * minute;
const mountain = 'America/Denver';

// Each conference page links directly to the same public report widget.
export const availabilitySources = {
  ACC: { code: 'ACC', zone: 'America/New_York', deadline: 120,
    url: 'https://theacc.com/sports/2025/8/28/availability-reporting-football.aspx' },
  'Big Ten': { code: 'B10', zone: 'America/Chicago', deadline: 120,
    url: 'https://bigten.org/sports/2026/9/10/FB_Availability_Reports.aspx' },
  'Big 12': { code: 'B12', zone: 'America/Chicago', deadline: 90,
    url: 'https://big12sports.com/sports/2025/8/14/FBreporting.aspx' },
  SEC: { code: 'SEC', zone: 'America/Chicago', deadline: 90, url: 'https://www.secsports.com/fbreports' },
};

const statuses = new Map([
  ['Available', 'Available'], ['Probable', 'Probable'], ['Questionable', 'Questionable'], ['Doubtful', 'Doubtful'],
  ['Game Time Decision', 'Game Time Decision'], ['Out', 'Out'], ['Out - (1st Half)', 'Out (1st Half)'],
  ['Out (1st Half)', 'Out (1st Half)'], ['Out (Season)', 'Out (Season)'],
]);
const finalLabel = /^(?:Game Day|Gameday Report|Game Day Report)$/i;
const preliminaryLabel = /^(?:Initial(?: Report)?|Update(?: [123])?|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?: Update)?)$/i;
const zoneByLabel = { ET: 'America/New_York', CT: 'America/Chicago' };
const formatters = new Map(Object.values(zoneByLabel).concat(mountain).map(zone => [zone, new Intl.DateTimeFormat('en-CA', {
  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hourCycle: 'h23',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})]));
const normalizeName = name => typeof name === 'string' ? name.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') : '';
const validId = value => typeof value === 'string' && /^\d+$/.test(value);
const validInstant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));

function wallClock(time, zone) {
  const parts = Object.fromEntries(formatters.get(zone).formatToParts(time).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function sourceInstant(date, time, zone) {
  const match = /^([0-9]{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(`${date} ${time}`);
  if (!match || !zone) return null;
  const [year, month, d, hour, m, second] = match.slice(1).map(Number);
  if (year < 2024 || year > 2100 || month < 1 || month > 12 || d < 1 || d > 31 || hour > 23 || m > 59 || second > 59) return null;
  const wall = Date.UTC(year, month - 1, d, hour, m, second);
  if (new Date(wall).getUTCDate() !== d) return null;
  const guess = wall + (wall - wallClock(wall, zone));
  const corrected = guess + (wall - wallClock(guess, zone));
  if (wallClock(corrected, zone) !== wall || wallClock(corrected + 60 * minute, zone) === wall ||
      wallClock(corrected - 60 * minute, zone) === wall) return null;
  return corrected;
}

export function buildAvailabilitySchedule(picks) {
  if (picks?.schemaVersion !== 1 || !Number.isInteger(picks.season) ||
      !Array.isArray(picks.teams) || !Array.isArray(picks.games)) throw new Error('Availability requires a published weekly schedule');
  const teams = new Map(picks.teams.map(team => [team.id, team]));
  const counts = new Map();
  for (const game of picks.games) counts.set(game.id, (counts.get(game.id) ?? 0) + 1);
  return picks.games.flatMap(game => {
    const home = teams.get(game.home);
    const away = teams.get(game.away);
    if (!validId(game.id) || counts.get(game.id) !== 1 || !validId(home?.id) || !validId(away?.id) ||
        home.id === away.id || home.division !== 'fbs' || away.division !== 'fbs' ||
        home.conference !== away.conference || !Object.hasOwn(availabilitySources, home.conference) ||
        !validInstant(game.startDate) || game.startTimeTbd !== false || !['scheduled', 'pending', 'final'].includes(game.status)) return [];
    return [{ id: game.id, season: picks.season, home, away, conference: home.conference,
      kickoff: new Date(game.startDate).toISOString(), status: game.status, neutral: game.neutral === true }];
  });
}

function reportFor(previous, teamId, game) {
  const artifact = previous.get(teamId);
  if (artifact?.season !== game.season || artifact.teamId !== teamId || !Array.isArray(artifact.reports)) return null;
  return artifact.reports.find(report => report.gameId === game.id && report.kickoff === game.kickoff) ?? null;
}

export function planAvailabilityChecks(schedule, previous, { now, mode }) {
  const time = Date.parse(now);
  if (!validInstant(now) || !['overnight', 'nightly', 'game-day', 'bootstrap'].includes(mode)) throw new Error('Invalid availability run mode or time');
  const today = Math.floor(wallClock(time, mountain) / day);
  const jobs = new Map();
  for (const game of schedule) {
    const kickoff = Date.parse(game.kickoff);
    const kickoffDay = Math.floor(wallClock(kickoff, mountain) / day);
    const daysUntil = kickoffDay - today;
    const alreadyFinal = [game.home, game.away].every(team => reportFor(previous, team.id, game)?.final);
    const lead = (availabilitySources[game.conference].deadline - 15) * minute;
    const first = kickoff - lead;
    const backup = kickoff - 30 * minute;
    const upcoming = game.status !== 'final' && daysUntil <= 3 && (
      (mode === 'nightly' && daysUntil >= 1) || (mode === 'overnight' && daysUntil >= 0 && time < kickoff));
    // An overnight schedule can archive final reports posted after the previous pull.
    const recent = mode === 'overnight' && daysUntil === -1;
    const deadlineWindow = mode === 'game-day' && ((time >= first && time < first + 15 * minute) ||
      (time >= backup && time < backup + 15 * minute));
    const due = mode === 'bootstrap' ? daysUntil >= -7 && daysUntil <= 3
      : !alreadyFinal && (upcoming || recent || (game.status !== 'final' && deadlineWindow));
    if (!due) continue;
    const group = jobs.get(game.conference) ?? [];
    group.push(game);
    jobs.set(game.conference, group);
  }
  return jobs;
}

function rosterPlayers(rosters, team, season) {
  const artifact = rosters.get(team.id);
  if (artifact?.schemaVersion !== 1 || artifact.season !== season || artifact.teamId !== team.id || !Array.isArray(artifact.players)) return [];
  return artifact.players;
}

function matchPlayerId(players, name, jersey) {
  const key = normalizeName(name);
  if (!key) return null;
  const matches = players.filter(player => validId(player.id) && normalizeName(player.name) === key &&
    (jersey === null || player.jersey == null || String(player.jersey) === String(jersey)));
  return matches.length === 1 ? matches[0].id : null;
}

function reportPlayer(row, roster, previouslyListed) {
  if (row.status === 'Exempt') return null;
  const text = row.name.trim();
  const parts = /^([\p{L}\d/-]+)\s+#(\d{1,2})\s+(.+)$/u.exec(text);
  const jersey = parts ? Number(parts[2]) : null;
  const [name, position] = parts ? [parts[3].trim(), parts[1]] : [text, null];
  const key = normalizeName(name);
  if (!key || (row.status === 'Available' && !previouslyListed.has(key))) return null;
  return { playerId: matchPlayerId(roster, name, jersey), name, position, jersey, status: statuses.get(row.status) };
}

function validTeamRows(rows) {
  return rows.length > 0 && rows.every(row => typeof row?.name === 'string' && row.name.length <= 160 &&
    !/[<>\u0000-\u001f]/.test(row.name) && normalizeName(row.name) &&
    (statuses.has(row.status) || row.status === 'Exempt'));
}

function matchingGame(row, schedule, source) {
  if (!Array.isArray(row?.games) || row.games.length !== 2 || zoneByLabel[row.conferenceTimeZone] !== source.zone ||
      !row.games.every(team => Array.isArray(team?.rows) && normalizeName(team.teamDisplayName))) return null;
  const sourceKickoff = sourceInstant(row.footer?.date, row.footer?.time, source.zone);
  if (sourceKickoff === null) return null;
  const [away, home] = row.games.map(team => normalizeName(team.teamDisplayName));
  const matches = schedule.filter(game => Date.parse(game.kickoff) === sourceKickoff && (
    normalizeName(game.away.name) === away && normalizeName(game.home.name) === home ||
    (game.neutral && normalizeName(game.away.name) === home && normalizeName(game.home.name) === away)
  ));
  return matches.length === 1 ? matches[0] : null;
}

export function parseOfficialAvailability(payload, scheduledGames, conference, { checkedAt, rosters = new Map(), previous = new Map() }) {
  const source = availabilitySources[conference];
  if (!source || !validInstant(checkedAt) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid availability report source or response');
  }
  const schedule = scheduledGames.filter(game => game.conference === conference);
  const output = [];
  for (const row of Object.values(payload)) {
    const game = matchingGame(row, schedule, source);
    if (!game || typeof row.ReportType !== 'string') continue;
    const final = finalLabel.test(row.ReportType);
    if (!final && !preliminaryLabel.test(row.ReportType)) continue;
    const reportTime = sourceInstant(row.publishDate, row.postedTime, source.zone);
    const kickoff = Date.parse(game.kickoff);
    if (reportTime === null || reportTime > Date.parse(checkedAt) || reportTime >= kickoff || reportTime < kickoff - 4 * day) continue;
    for (const teamRow of row.games) {
      if (!validTeamRows(teamRow.rows)) continue;
      const [team, opponent] = normalizeName(teamRow.teamDisplayName) === normalizeName(game.home.name)
        ? [game.home, game.away] : [game.away, game.home];
      const existing = reportFor(previous, team.id, game);
      // The public widget hides unlisted/available rows. Carry explicit recoveries for players we previously surfaced.
      const previouslyListed = new Set((existing?.players ?? []).map(player => normalizeName(player.name)));
      const roster = rosterPlayers(rosters, team, game.season);
      const players = teamRow.rows.map(player => reportPlayer(player, roster, previouslyListed)).filter(Boolean);
      const unique = new Set(players.map(player => `${normalizeName(player.name)}:${player.jersey}`));
      if (unique.size !== players.length) continue;
      output.push({ teamId: team.id, season: game.season, report: {
        gameId: game.id, kickoff: game.kickoff, opponentId: opponent.id, opponentName: opponent.name, source: conference,
        sourceUrl: source.url, reportAt: new Date(reportTime).toISOString(), checkedAt, final,
        players: players.sort((a, b) => a.name.localeCompare(b.name) || (a.jersey ?? -1) - (b.jersey ?? -1)),
      } });
    }
  }
  return output;
}

export function mergeAvailability(previous, additions) {
  const result = new Map(previous);
  for (const { teamId, season, report } of additions) {
    const existing = result.get(teamId);
    const reports = existing?.season === season && Array.isArray(existing.reports) ? existing.reports : [];
    const prior = reports.find(item => item.gameId === report.gameId && item.kickoff === report.kickoff);
    if (prior && (Date.parse(prior.reportAt) > Date.parse(report.reportAt) || (prior.final && !report.final))) continue;
    if (prior && JSON.stringify({ ...prior, checkedAt: null }) === JSON.stringify({ ...report, checkedAt: null })) continue;
    const updated = [report, ...reports.filter(item => item.gameId !== report.gameId)]
      .sort((a, b) => b.kickoff.localeCompare(a.kickoff) || a.gameId.localeCompare(b.gameId)).slice(0, 8);
    result.set(teamId, { schemaVersion: 1, season, teamId, reports: updated });
  }
  return result;
}

export async function fetchOfficialAvailability(conference, fetcher = fetch) {
  const { code } = availabilitySources[conference];
  // This anonymous read-only POST is the endpoint called by the public conference report embed.
  const response = await fetcher('https://app.hdintelligence.com/api/get-publish-public', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sport: 'Football', organization: code, conference: code }),
    signal: AbortSignal.timeout(25_000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`${conference} availability returned HTTP ${response.status}`);
  return response.json();
}
