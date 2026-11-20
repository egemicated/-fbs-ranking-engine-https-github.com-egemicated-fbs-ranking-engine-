import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  localRefreshDay, localRefreshSlot, planSportRefresh, shouldPublishRefresh,
} from '../basketball/refresh-orchestration.js';

const old = { id: 'ncaam-d1:1', home: 'ncaam-d1:2', away: 'ncaam-d1:3', divisionOne: true,
  startDate: '2026-11-20T23:00:00Z', startTimeTbd: false, status: 'scheduled' };
const upcoming = { ...old, id: 'ncaam-d1:2', startDate: '2026-11-21T19:00:00Z' };
const start = '2026-11-21T11:15:00Z';
const backup = '2026-11-21T13:15:00Z';
const snapshotHash = 'a'.repeat(64);
const defaults = { sport: 'basketball', scheduledAt: start, now: start, games: [old, upcoming], budget: 8,
  observation: { scheduleAsOf: '2026-11-20T12:00:00Z' } };

test('Denver and New York scheduling survives changes in daylight saving and overlapping local times', () => {
  assert.equal(localRefreshSlot('2026-03-08', '02:45').toISOString(), '2026-03-08T09:00:00.000Z');
  assert.equal(localRefreshSlot('2026-03-08', '02:45', 'America/New_York').toISOString(), '2026-03-08T07:00:00.000Z');
  assert.equal(localRefreshSlot('2026-11-01', '01:45').toISOString(), '2026-11-01T07:45:00.000Z');
  assert.equal(localRefreshDay('2026-11-01T06:15:00Z'), '2026-11-01');
  assert.equal(localRefreshDay('2026-11-01T05:59:00Z'), '2026-10-31');
  assert.equal(localRefreshSlot('2026-11-21', '04:15').toISOString(), start.replace(/00Z$/, '00.000Z'));
});

test('plans a single core acquisition and makes backup depend on the actual primary coverage', () => {
  const first = planSportRefresh(defaults);
  assert.equal(first.operation, 'fetch-core');
  assert.equal(first.calls, 2);
  assert.deepEqual(first.pendingResults, [old.id]);
  const same = { ...defaults, slot: 'recovery', scheduledAt: backup, now: backup };
  assert.equal(planSportRefresh({ ...same, attempts: [{ checkId: first.checkId, status: 'active' }] }).reason, 'defer-active-reservation');
  assert.equal(planSportRefresh({ ...same, sharedLockActive: true }).reason, 'defer-active-reservation');
  assert.equal(planSportRefresh({ ...same, attempts: [{ checkId: first.checkId, status: 'complete' }] }).reason, 'primary-complete');
  assert.equal(planSportRefresh({ ...same, attempts: [{ checkId: first.checkId, status: 'complete',
    incompleteCoverage: true }] }).operation, 'fetch-core');
  assert.equal(planSportRefresh({ ...same, attempts: [{ checkId: first.checkId, status: 'failed' }] }).operation, 'fetch-core');
  assert.equal(planSportRefresh(same).operation, 'fetch-core'); // Missed primary.
  assert.equal(planSportRefresh({ ...defaults, attempts: [{ checkId: first.checkId, status: 'complete' }] }).reason, 'duplicate-check');
  assert.equal(planSportRefresh({ ...same, budget: 1 }).reason, 'protected-quota');
});

test('avoids midgame pulls for late starts and accepts the backup once old scores can exist', () => {
  const late = { ...old, startDate: '2026-11-21T10:10:00Z' };
  assert.equal(planSportRefresh({ ...defaults, games: [late] }).calls, 0);
  assert.equal(planSportRefresh({ ...defaults, games: [late], slot: 'recovery', now: backup, scheduledAt: backup }).calls, 2);
  const gameDayBrief = planSportRefresh({ ...defaults, games: [upcoming], slot: 'forecast-only', budget: 0 });
  assert.equal(gameDayBrief.operation, 'capture-cached-forecasts');
  assert.equal(gameDayBrief.calls, 0);
  assert.equal(planSportRefresh({ ...defaults, games: [] }).reason, 'offseason-no-games');
  const releaseProbe = '2026-08-04T10:15:00Z';
  assert.equal(planSportRefresh({ ...defaults, games: [], now: releaseProbe, scheduledAt: releaseProbe,
    slot: 'probe', offseasonProbe: true, observation: { scheduleAsOf: '2026-07-01T13:00:00Z' } }).calls, 1);
  assert.equal(planSportRefresh({ ...defaults, games: [], slot: 'probe', offseasonProbe: true }).calls, 0);
  const tournament = { ...defaults, slot: 'tournament-results', officialTournamentDue: true };
  assert.equal(planSportRefresh(tournament).calls, 0);
  assert.equal(planSportRefresh({ ...tournament, games: [{ ...old, tournament: 'NCAA' }] }).calls, 2);
  assert.equal(planSportRefresh({ ...tournament, games: [{ ...old, tournament: 'NCAA' }], budget: null }).reason,
    'protected-quota');
});

test('plans only confirmed upcoming pre-tipoff candidates, preserving a ten-minute safety window', () => {
  const almost = { ...upcoming, id: 'ncaam-d1:4', startDate: '2026-11-21T11:22:00Z' };
  const tbd = { ...upcoming, id: 'ncaam-d1:5', startTimeTbd: true };
  const postponed = { ...upcoming, id: 'ncaam-d1:6', status: 'postponed' };
  const outOfHorizon = { ...upcoming, id: 'ncaam-d1:7', startDate: '2026-11-25T01:15:00Z' };
  const input = { ...defaults, slot: 'forecast-only', budget: 0, games: [old, upcoming, almost, tbd, postponed, outOfHorizon] };
  assert.deepEqual(planSportRefresh(input).forecastCandidates, [upcoming.id]);
  assert.equal(planSportRefresh({ ...input, now: '2026-11-22T00:00:00Z' }).reason, 'slot-expired');
});

test('publication gate checks changes rather than timestamps or prior workflow success', () => {
  const after = 'b'.repeat(64);
  assert.equal(shouldPublishRefresh({ oldDigest: snapshotHash, newDigest: after, validationPassed: true }), true);
  assert.equal(shouldPublishRefresh({ oldDigest: snapshotHash, newDigest: snapshotHash, validationPassed: true }), false);
  assert.equal(shouldPublishRefresh({ oldDigest: snapshotHash, newDigest: after, validationPassed: false }), false);
});
