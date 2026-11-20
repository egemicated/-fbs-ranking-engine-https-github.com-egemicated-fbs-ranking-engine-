import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  localRefreshDay, localRefreshSlot, planSportRefresh, refreshTimetable, shouldPublishRefresh,
} from '../basketball/refresh-orchestration.js';

const hour = 60 * 60_000;
const day = 24 * hour;
const minute = 60_000;
const zone = 'America/Denver';
const read = async name => JSON.parse(await readFile(name, 'utf8'));

const strategies = {
  currentFootball: { timing: 'current', eventAware: true, hashGate: false, retry: true, resultDelay: 180 },
  fixed: { timing: 'same', eventAware: false, hashGate: false, retry: false },
  separate: { timing: 'separate', eventAware: false, hashGate: true, retry: false },
  event: { timing: 'frequent', eventAware: true, hashGate: true, retry: false },
  hybrid: { timing: 'separate', eventAware: true, hashGate: true, retry: true },
};

function calendarDates(start, end) {
  const dates = [];
  for (let at = Date.parse(start); at <= Date.parse(end); at += day) dates.push(new Date(at).toISOString().slice(0, 10));
  return dates;
}

function dailySlots(date, sport, strategy) {
  const { primary, recovery } = refreshTimetable[sport];
  if (strategy.timing === 'current') {
    return [['primary', '02:45'], ['recovery', '04:45']].map(([type, time]) =>
      [type, localRefreshSlot(date, time, 'America/New_York')]);
  }
  if (strategy.timing === 'frequent') {
    return ['02:15', '06:15', '10:15', '14:15', '18:15', '22:15'].map(time =>
      ['primary', localRefreshSlot(date, time, zone)]);
  }
  if (strategy.timing === 'same') return [['primary', localRefreshSlot(date, '02:45', zone)]];
  return [['primary', localRefreshSlot(date, primary, zone)],
    ...(strategy.retry ? [['recovery', localRefreshSlot(date, recovery, zone)]] : [])];
}

function percentile(values, share) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * share) - 1]);
}

function simulate({ gameSet, sport, start, end, strategy, delay, missedPrimaryDate }) {
  const during = game => {
    const d = localRefreshDay(game.startDate);
    return start <= d && d <= end;
  };
  const games = gameSet.filter(g => g.startDate && g.status === 'final' && g.startTimeTbd === false && during(g));
  const fixtures = games.map(game => ({
    ...game, status: 'scheduled',
    ended: Date.parse(game.startDate) + (sport === 'basketball' ? 130 : 195) * minute
      + (game.overtimeMinutes ?? 0) * minute,
  }));
  const completed = new Set();
  const lags = [];
  let checks = 0, requests = 0, fetches = 0, builds = 0, resolved = 0, missed = 0, empty = 0;
  let metadata = localRefreshSlot(start, '00:00').getTime();
  let digest = '0'.repeat(64);
  const generation = n => n.toString(16).padStart(64, '0');
  for (const date of calendarDates(start, end)) {
    const attempts = [];
    for (const [index, [slot, at]] of dailySlots(date, sport, strategy).entries()) {
      checks++;
      if (date === missedPrimaryDate && index === 0) {
        missed++;
        continue;
      }
      const visible = fixtures.filter(game => !completed.has(game.id) && Date.parse(game.startDate) < at.getTime() + 14 * day);
      const observation = { scheduleAsOf: new Date(metadata).toISOString() };
      const plan = planSportRefresh({
        sport, slot, scheduledAt: at, now: at, games: visible, observation, attempts,
        budget: 1000, resultDelayMinutes: strategy.resultDelay,
      });
      const due = strategy.eventAware ? plan.operation === 'fetch-core' : true;
      if (!due) {
        // A completed zero-cost probe cannot trigger duplicate metered work.
        if (strategy.retry) attempts.push({ checkId: plan.checkId, status: 'complete',
          incompleteCoverage: strategy.hashGate && visible.some(game => {
            const tipoff = Date.parse(game.startDate);
            return tipoff <= at.getTime() && tipoff + refreshTimetable[sport].resultDelay * minute <= at.getTime() + 2 * hour;
          }), });
        continue;
      }
      const newResults = visible.filter(game => game.ended + delay * minute <= at.getTime());
      const changed = newResults.length > 0;
      const weekly = at.getTime() - metadata >= 7 * day;
      const cost = strategy.eventAware ? plan.calls : refreshTimetable[sport].resultCalls
        + (sport === 'basketball' && weekly ? 1 : 0);
      fetches++;
      requests += cost;
      if (!changed) empty++;
      const nextDigest = changed ? generation(resolved + newResults.length) : digest;
      if (!strategy.hashGate || shouldPublishRefresh({ oldDigest: digest, newDigest: nextDigest, validationPassed: true })) builds++;
      digest = nextDigest;
      if (weekly) metadata = at.getTime();
      for (const game of newResults) {
        completed.add(game.id);
        lags.push((at.getTime() + 5 * minute - game.ended) / minute);
      }
      resolved += newResults.length;
      if (strategy.retry) attempts.push({ checkId: plan.checkId, status: 'complete', incompleteCoverage:
        strategy.hashGate && plan.pendingResults.some(id => !completed.has(id)) });
    }
  }
  return {
    games: fixtures.length, resolved, notYetResolvedAtWindowEnd: fixtures.length - resolved,
    checks, missedPrimary: missed, fetches, meteredCalls: requests, noNewFinalsFetches: empty, builds,
    medianMinutesAfterAssumedFinish: percentile(lags, 0.5), p95MinutesAfterAssumedFinish: percentile(lags, 0.95),
  };
}

const { values } = parseArgs({ options: { 'delay-minutes': { type: 'string' }, 'miss-primary': { type: 'boolean' } } });
const delay = Number(values['delay-minutes'] ?? 20);
if (!Number.isFinite(delay) || delay < 0 || delay > 240) throw new Error('Simulation delay must be 0–240 minutes');
const [fbs, fcs, basketball] = await Promise.all([
  read('published/weekly-picks.json'), read('published/weekly-fcs-picks.json'), read('data/seasons/basketball/2026.json'),
]);
const football = [...new Map([...fbs.games, ...fcs.games].map(game => [game.id, game])).values()];
const samples = [
  { profile: 'football regular season', sport: 'football', gameSet: football, start: '2026-10-25', end: '2026-11-20', outage: '2026-11-08' },
  { profile: 'basketball regular season', sport: 'basketball', gameSet: basketball.games,
    start: '2025-12-01', end: '2025-12-31', outage: '2025-12-07' },
  { profile: 'basketball conference and national tournaments', sport: 'basketball', gameSet: basketball.games,
    start: '2026-03-01', end: '2026-04-08', outage: '2026-03-22' },
];
const comparisons = samples.map(({ profile, sport, gameSet, start, end, outage }) => ({
  profile, start, end, results: Object.fromEntries(Object.entries(strategies)
    .filter(([name]) => sport === 'football' || name !== 'currentFootball')
    .map(([name, strategy]) => [name, simulate({
      gameSet, sport, start, end, strategy, delay, missedPrimaryDate: values['miss-primary'] && outage,
    })])),
}));
console.log(JSON.stringify({
  evidence: 'Retrospective simulation with assumed game durations and source delay. Observed scores ground the completed fixture dates. No network calls or workflow changes.',
  assumedDelayMinutes: delay, simulatedMissedPrimary: values['miss-primary'] === true, comparisons,
}, null, 2));
