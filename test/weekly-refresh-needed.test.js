import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyRefreshNeeded } from '../scripts/weekly-refresh-needed.js';

// The midnight run starts in daylight time; the catch-up runs after the clock changes.
const catchUpTime = '2026-11-01T11:11:00Z';
const snapshot = {
  season: 2026, asOf: '2026-11-01T06:01:01Z', snapshotHash: 'current',
  source: { provider: 'cfbd', fetchedAt: '2026-11-01T06:01:00Z' },
};
const lateGame = {
  id: 'late', startDate: '2026-11-01T03:59:00Z', home: 'fbs', away: 'fcs', status: 'pending',
};
const picks = {
  season: 2026,
  source: { provider: 'cfbd', scheduleAsOf: snapshot.source.fetchedAt, rankingAsOf: snapshot.asOf, snapshotHash: 'current' },
  teams: [{ id: 'fbs', division: 'fbs' }, { id: 'fcs', division: 'fcs' }],
  games: [{ ...lateGame, status: 'final' }],
};

test('primary uses the Mountain calendar and skips after a same-Sunday refresh', () => {
  const saturdayMountain = { ...snapshot, source: { ...snapshot.source, fetchedAt: '2026-11-01T05:59:00Z' } };
  assert.equal(weeklyRefreshNeeded(saturdayMountain, null, catchUpTime), true);
  assert.equal(weeklyRefreshNeeded(snapshot, null, catchUpTime), false);
  assert.equal(weeklyRefreshNeeded(snapshot, null, '2026-11-02T08:00:00Z'), false);
});

test('catch-up retries a missed or unaligned midnight publication', () => {
  assert.equal(weeklyRefreshNeeded(null, picks, catchUpTime, true), true);
  assert.equal(weeklyRefreshNeeded(snapshot, null, catchUpTime, true), true);
  const stalePicks = { ...picks, source: { ...picks.source, rankingAsOf: '2026-10-25T06:01:00Z' } };
  assert.equal(weeklyRefreshNeeded(snapshot, stalePicks, catchUpTime, true), true);
  assert.equal(weeklyRefreshNeeded(snapshot, picks, catchUpTime, true), false);
});

test('catch-up checks Saturday games involving at least one FBS team', () => {
  assert.equal(weeklyRefreshNeeded(snapshot, { ...picks, games: [lateGame] }, catchUpTime, true), true);
  const canceledSnapshot = {
    ...snapshot, source: { ...snapshot.source, audit: { confirmedCanceledRecords: [{ id: 'canceled' }] } },
  };
  const ignored = [
    { ...lateGame, id: 'canceled' },
    { ...lateGame, status: 'postponed' },
    { ...lateGame, startTimeTbd: true },
    { ...lateGame, startDate: '2026-10-31T03:59:00Z' }, // Friday in Mountain Time
    { ...lateGame, startDate: '2026-11-01T07:00:00Z' }, // Sunday in Mountain Time
    { ...lateGame, home: 'other-fcs' },
  ];
  assert.equal(weeklyRefreshNeeded(canceledSnapshot, { ...picks, games: ignored }, catchUpTime, true), false);
});
