import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyRefreshNeeded, sundayNightRefreshNeeded } from '../scripts/weekly-refresh-needed.js';

// The saved Sunday publication below precedes the clock change that morning.
const sundayMorning = '2026-11-01T10:45:00Z';
const mondayMorning = '2026-11-02T10:45:00Z';
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

test('daily check refreshes the new weekly slate on Sunday or after a missed Sunday run', () => {
  const saturdayMountain = { ...snapshot, source: { ...snapshot.source, fetchedAt: '2026-11-01T05:59:00Z' } };
  const saturdayPicks = { ...picks, source: { ...picks.source, scheduleAsOf: saturdayMountain.source.fetchedAt } };
  assert.equal(dailyRefreshNeeded(saturdayMountain, saturdayPicks, sundayMorning), true);
  assert.equal(dailyRefreshNeeded(saturdayMountain, saturdayPicks, mondayMorning), true);
  assert.equal(dailyRefreshNeeded(snapshot, picks, sundayMorning), false);
  assert.equal(dailyRefreshNeeded(snapshot, picks, mondayMorning), false);
});

const wednesday = '2026-11-04T10:45:00Z';
const tuesdayGame = { ...lateGame, id: 'tuesday', startDate: '2026-11-04T00:00:00Z', status: 'scheduled' };

test('daily check skips when aligned picks have no elapsed unresolved kickoff', () => {
  const canceledSnapshot = { ...snapshot, source: { ...snapshot.source, audit: { confirmedCanceledRecords: [{ id: 'canceled' }] } } };
  const ignored = [
    { ...tuesdayGame, status: 'final' },
    { ...tuesdayGame, status: 'postponed' },
    { ...tuesdayGame, startDate: '2026-11-04T09:00:00Z' },
    { ...tuesdayGame, startDate: '2026-11-05T00:00:00Z' },
    { ...tuesdayGame, startDate: '2026-10-25T00:00:00Z' },
    { ...tuesdayGame, startTimeTbd: true },
    { ...tuesdayGame, home: 'other-fcs' },
    { ...tuesdayGame, id: 'canceled' },
  ];
  assert.equal(dailyRefreshNeeded(canceledSnapshot, { ...picks, games: ignored }, wednesday), false);
});

test('daily check catches a new kickoff or a recent final still unresolved at the previous refresh', () => {
  assert.equal(dailyRefreshNeeded(snapshot, { ...picks, games: [tuesdayGame] }, wednesday), true);
  assert.equal(dailyRefreshNeeded(snapshot, { ...picks, games: [lateGame] }, wednesday), true);
});

test('daily check refreshes if the snapshot or schedule cannot establish coverage', () => {
  assert.equal(dailyRefreshNeeded(null, picks, wednesday), true);
  assert.equal(dailyRefreshNeeded(snapshot, null, wednesday), true);
  assert.equal(dailyRefreshNeeded(snapshot, { ...picks, source: { ...picks.source, snapshotHash: 'old' } }, wednesday), true);
});

test('daily check deduplicates on the Mountain date and checks new results the next day', () => {
  const refreshed = { ...snapshot, asOf: '2026-11-04T10:30:01Z', source: { ...snapshot.source, fetchedAt: '2026-11-04T10:30:00Z' } };
  const aligned = { ...picks, source: { ...picks.source, scheduleAsOf: refreshed.source.fetchedAt, rankingAsOf: refreshed.asOf }, games: [tuesdayGame] };
  assert.equal(dailyRefreshNeeded(refreshed, picks, wednesday), true);
  assert.equal(dailyRefreshNeeded(refreshed, aligned, wednesday), false);
  assert.equal(dailyRefreshNeeded(refreshed, aligned, '2026-11-05T06:59:00Z'), false);
  assert.equal(dailyRefreshNeeded(refreshed, aligned, '2026-11-05T10:45:00Z'), true);
});

// The scheduled Sunday evening check lands on Monday in UTC.
const sundayNight = '2026-11-02T03:11:00Z';
const sundayGame = { ...lateGame, id: 'sunday', startDate: '2026-11-01T18:00:00Z', status: 'scheduled' };

test('Sunday night catches an unresolved Sunday kickoff after the morning refresh and after three hours', () => {
  const schedule = { ...picks, games: [sundayGame] };
  assert.equal(sundayNightRefreshNeeded(snapshot, schedule, '2026-11-01T20:59:59Z'), false);
  assert.equal(sundayNightRefreshNeeded(snapshot, schedule, '2026-11-01T21:00:00Z'), true);
  assert.equal(sundayNightRefreshNeeded(snapshot, schedule, sundayNight), true);
  assert.equal(dailyRefreshNeeded(snapshot, schedule, mondayMorning), true);
});

test('Sunday night skips ordinary Saturdays, undated or canceled games, and unavailable or finished results', () => {
  const canceledSnapshot = { ...snapshot, source: { ...snapshot.source, audit: { confirmedCanceledRecords: [{ id: 'canceled' }] } } };
  const games = [
    lateGame,
    { ...sundayGame, status: 'final' },
    { ...sundayGame, startTimeTbd: true },
    { ...sundayGame, home: 'other-fcs' },
    { ...sundayGame, id: 'canceled' },
    { ...sundayGame, startDate: '2026-11-02T01:00:00Z' },
    { ...sundayGame, startDate: '2026-11-08T18:00:00Z' },
  ];
  assert.equal(sundayNightRefreshNeeded(canceledSnapshot, { ...picks, games }, sundayNight), false);
  assert.equal(sundayNightRefreshNeeded(snapshot, null, sundayNight), false);
  assert.equal(sundayNightRefreshNeeded(null, picks, sundayNight), false);
});

test('Sunday night does not repeat an aligned evening pull even if a game has no final yet', () => {
  const refreshed = { ...snapshot, asOf: '2026-11-02T03:11:42Z', source: { ...snapshot.source, fetchedAt: '2026-11-02T03:11:40Z' } };
  const schedule = { ...picks, source: { ...picks.source, scheduleAsOf: refreshed.source.fetchedAt, rankingAsOf: refreshed.asOf }, games: [sundayGame] };
  assert.equal(sundayNightRefreshNeeded(refreshed, schedule, '2026-11-02T03:18:00Z'), false);
});

test('FCS-only kickoffs can trigger either check without adding games to FBS Weekly Picks', () => {
  const fcsSaturday = { ...snapshot, pendingFcsKickoffs: [lateGame.startDate] };
  const fcsSunday = { ...snapshot, pendingFcsKickoffs: [sundayGame.startDate] };
  const fcsMidweek = { ...snapshot, pendingFcsKickoffs: [tuesdayGame.startDate] };
  assert.equal(dailyRefreshNeeded(fcsSaturday, picks, mondayMorning), true);
  assert.equal(dailyRefreshNeeded(fcsMidweek, picks, wednesday), true);
  assert.equal(sundayNightRefreshNeeded(fcsSunday, picks, sundayNight), true);
  assert.equal(sundayNightRefreshNeeded(fcsSunday, null, sundayNight), true);
  assert.equal(sundayNightRefreshNeeded(fcsSaturday, picks, sundayNight), false);
  assert.equal(sundayNightRefreshNeeded({ ...snapshot, pendingFcsKickoffs: ['no time supplied'] }, picks, sundayNight), false);
});
