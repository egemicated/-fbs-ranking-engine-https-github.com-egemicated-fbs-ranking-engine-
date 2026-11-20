const mountain = 'America/Denver';
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const clocks = new Map();

export const refreshTimetable = Object.freeze({
  football: Object.freeze({ primary: '01:45', recovery: '03:45', resultDelay: 210, resultCalls: 3, metadataCalls: 0 }),
  basketball: Object.freeze({ primary: '04:15', recovery: '06:15', forecastOnly: '10:15', tournamentFinals: '22:45',
    resultDelay: 160, resultCalls: 2, metadataCalls: 1 }),
});
const recordedStatuses = new Set(['scheduled', 'pending', 'incomplete', 'in_progress']);

function localParts(at, zone) {
  if (!clocks.has(zone)) clocks.set(zone, new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }));
  return Object.fromEntries(clocks.get(zone).formatToParts(at).map(({ type, value }) => [type, value]));
}

export function localRefreshDay(at, zone = mountain) {
  const { year, month, day: d } = localParts(at instanceof Date ? at : new Date(at), zone);
  return `${year}-${month}-${d}`;
}

function zoneOffset(at, zone) {
  const { year, month, day: d, hour: h, minute: m, second } = localParts(new Date(at), zone);
  return Date.UTC(+year, +month - 1, +d, +h, +m, +second) - at;
}

export function localRefreshSlot(date, time, zone = mountain) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Invalid refresh slot');
  const wall = Date.parse(`${date}T${time}:00.000Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 10) !== date) throw new Error('Invalid refresh date');
  const offsets = new Set([zoneOffset(wall - day, zone), zoneOffset(wall, zone), zoneOffset(wall + day, zone)]);
  for (let advance = 0; advance <= 120; advance++) {
    const candidate = wall + advance * minute;
    const exact = [...offsets].map(offset => candidate - offset)
      .filter(at => at + zoneOffset(at, zone) === candidate).sort((a, b) => a - b);
    if (exact.length) return new Date(exact[0]); // First occurrence in a fall-back overlap.
  }
  throw new Error('No representable local refresh slot');
}

const instant = at => at instanceof Date ? at.getTime() : Date.parse(at);

function inFlight(attempts) {
  return attempts.some(attempt => ['queued', 'active'].includes(attempt.status));
}

export function planSportRefresh({
  sport, slot = 'primary', scheduledAt, now, games, observation,
  attempts = [], budget, sharedLockActive = false, changedSchedule = false, offseasonProbe = false,
  officialTournamentDue = false, resultDelayMinutes,
}) {
  const config = refreshTimetable[sport];
  const at = instant(now);
  const triggerTime = instant(scheduledAt);
  if (!config || !Number.isFinite(at) || !Number.isFinite(triggerTime) || !Array.isArray(games) ||
    !['primary', 'recovery', 'forecast-only', 'probe', 'tournament-results'].includes(slot) || at < triggerTime) {
    throw new Error('Invalid private refresh check');
  }
  const localDay = localRefreshDay(triggerTime);
  const checkId = `${sport}:${localDay}:${slot}`;
  const pendingResults = [];
  const forecastCandidates = [];
  const resultDelay = resultDelayMinutes ?? config.resultDelay;
  if (!Number.isFinite(resultDelay) || resultDelay < 0) throw new Error('Invalid result readiness delay');
  for (const game of games) {
    if (!game.id || game.startTimeTbd !== false || !recordedStatuses.has(game.status)) continue;
    const start = instant(game.startDate);
    if (start <= at - resultDelay * minute && start >= at - 7 * day &&
      (slot !== 'tournament-results' || game.tournament === 'NCAA')) pendingResults.push(game.id);
    if (game.status === 'scheduled' && game.divisionOne !== false && start > at + 10 * minute && start <= at + 72 * hour) {
      forecastCandidates.push(game.id);
    }
  }
  const finish = (reason, calls = 0, operation = 'skip') =>
    ({ checkId, reason, operation, calls, pendingResults, forecastCandidates });

  if (at - triggerTime > 12 * hour) return finish('slot-expired');
  if (sharedLockActive || inFlight(attempts)) return finish('defer-active-reservation');
  const sameDay = attempts.filter(attempt => attempt.checkId?.startsWith(`${sport}:${localDay}:`));
  if (sameDay.some(attempt => attempt.checkId === checkId && attempt.status === 'complete')) return finish('duplicate-check');
  if (slot === 'forecast-only') return finish(forecastCandidates.length ? 'saved-slate' : 'no-confirmed-upcoming-games',
    0, forecastCandidates.length ? 'capture-cached-forecasts' : 'skip');
  if (slot === 'recovery' && sameDay.some(attempt => attempt.checkId.endsWith(':primary') &&
    attempt.status === 'complete' && !attempt.incompleteCoverage)) {
    return finish('primary-complete');
  }
  if (slot === 'tournament-results') {
    if (sport !== 'basketball' || !officialTournamentDue || !pendingResults.length) return finish('no-verified-tournament-finals-due');
    if (!Number.isInteger(budget) || budget < config.resultCalls) return finish('protected-quota');
    return finish('tournament-tipoff-elapsed', config.resultCalls, 'fetch-core');
  }
  const metadataAt = instant(observation?.scheduleAsOf);
  const weekDue = Number.isFinite(metadataAt) && at - metadataAt >= 7 * day;
  const metadataDue = changedSchedule || !Number.isFinite(metadataAt) ||
    (sport === 'football' && new Date(localDay + 'T00:00:00Z').getUTCDay() === 0 && weekDue) ||
    (sport === 'basketball' && weekDue);
  if (slot === 'probe') {
    const date = new Date(localDay + 'T00:00:00Z');
    const scheduleReleaseProbe = sport === 'basketball' && date.getUTCDay() === 2 &&
      date.getUTCDate() <= 7 && [7, 8, 9].includes(date.getUTCMonth());
    if (!offseasonProbe || !metadataDue || !scheduleReleaseProbe) return finish('offseason-slate-current');
    if (!Number.isInteger(budget) || budget < 1) return finish('protected-quota');
    return finish('scheduled-metadata-probe', 1, 'metadata-only');
  }
  const slateRelevant = pendingResults.length > 0 || games.some(game => {
    const start = instant(game.startDate);
    return Number.isFinite(start) && start >= at - 7 * day && start <= at + 14 * day;
  });
  if (!slateRelevant) return finish('offseason-no-games');
  if (!pendingResults.length && !metadataDue) return finish('no-newly-eligible-results');
  const results = pendingResults.length > 0;
  const requestCost = sport === 'football' ? config.resultCalls
    : (results ? config.resultCalls : 1) + (metadataDue ? config.metadataCalls : 0);
  if (!Number.isInteger(budget) || budget < requestCost) return finish('protected-quota');
  return finish(results ? 'verified-tipoffs-elapsed' : 'scheduled-metadata-due', requestCost, 'fetch-core');
}

export function shouldPublishRefresh({ oldDigest, newDigest, validationPassed }) {
  return validationPassed === true && /^[a-f\d]{64}$/.test(newDigest ?? '') && oldDigest !== newDigest;
}
