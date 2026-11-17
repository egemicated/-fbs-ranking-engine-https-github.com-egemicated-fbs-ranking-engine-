import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlayerPublications, normalizePlayerData, playerSchedule } from '../src/player-data.js';
import { playerRefreshWeeks } from '../scripts/refresh-team-players.js';

const source = { provider: 'cfbd', snapshotHash: 'test-snapshot', scheduleAsOf: '2026-11-15T18:00:00Z' };
const fbs = { id: '102', name: 'Home State', division: 'fbs' };
const fcs = { id: '103', name: 'Visiting College', division: 'fcs' };
const game = { id: '301', home: fbs.id, away: fcs.id, status: 'final', seasonType: 'regular',
  week: 11, startDate: '2026-11-14T17:00:00Z', homePoints: 24, awayPoints: 14 };
const weekly = { source, season: 2026, teams: [fbs], games: [game] };
const weeklyFcs = { source, season: 2026, teams: [fcs], games: [game] };

test('joining published FBS and FCS schedule data requires a shared cutoff and game identity', () => {
  assert.throws(() => playerSchedule(weekly, { ...weeklyFcs, source: { ...source, snapshotHash: 'wrong' } }), /does not align/);
  assert.throws(() => playerSchedule(weekly, { ...weeklyFcs, games: [{ ...game, awayPoints: 21 }] }), /Conflicting scheduled game/);
  const schedule = playerSchedule(weekly, weeklyFcs);
  assert.equal(schedule.games.size, 1);
  assert.equal(schedule.teams.get(fcs.id).division, 'fcs');
});

test('publication keeps exact player identity per team and season and validates the box-score side', () => {
  const row = (id, team, rest = {}) => ({ id, team, firstName: 'Taylor', lastName: 'Martin', ...rest });
  const total = (playerId, team, rest = {}) => ({ playerId, team, player: 'Taylor Martin', season: 2026,
    category: 'passing', statType: 'TD', stat: '0', ...rest });
  const passing = { name: 'passing', types: [{ name: 'C/ATT', athletes: [{ id: '500', name: 'Taylor Martin', stat: '14-25' }] }] };
  const wrongTeam = { homeAway: 'home', team: fcs.name, points: 24, categories: [passing] };
  const wrongScore = { homeAway: 'home', team: fbs.name, points: 14, categories: [passing] };
  const rightBox = { homeAway: 'home', team: fbs.name, points: 24, categories: [passing] };
  const cache = { schemaVersion: 1, source: 'cfbd', season: 2026, asOf: '2026-11-15T18:01:00Z',
    roster: { rows: [row('500', fbs.name, { jersey: '0', position: 'QB' }), row('500', fcs.name),
      row('501', fbs.name), row('502', fbs.name, { season: 2025 })] },
    totals: { rows: [total('500', fbs.name), total('500', fcs.name, { season: 2025 }), total('999', 'Another School')] },
    weeks: [{ week: 11, rows: [{ id: '301', teams: [wrongTeam, wrongScore, rightBox, rightBox] }] }] };
  const schedule = playerSchedule(weekly, weeklyFcs);
  assert.throws(() => normalizePlayerData({ ...cache, season: 2025 }, schedule), /does not match/);
  const normalized = normalizePlayerData(cache, schedule);
  assert.equal(normalized.evidence.unmatchedBoxes, 2);
  assert.equal(normalized.evidence.duplicateBoxes, 1);
  assert.equal(normalized.evidence.unmatchedTotals, 2);
  assert.equal(normalized.evidence.unmatchedRoster, 1);
  assert.equal(normalized.observations[0].opponentDivision, 'fcs');
  const pages = buildPlayerPublications(normalized);
  const startingQb = pages.get(fbs.id).players.find(player => player.id === '500');
  assert.equal(startingQb.jersey, 0);
  assert.equal(startingQb.height, null);
  assert.deepEqual(startingQb.stats, { passing: { touchdowns: 0 } });
  assert.deepEqual(startingQb.gameLogs[0].stats, { passing: { completions: 14, attempts: 25 } });
  assert.equal(pages.get(fbs.id).coverage.boxGames, 1);
  assert.deepEqual(pages.get(fbs.id).players.find(player => player.id === '501').stats, {});
  assert.equal(pages.get(fcs.id).coverage.boxGames, 0);
  assert.deepEqual(pages.get(fcs.id).players[0].stats, {});
});

test('an earlier cache must verify every scheduled team-game without changing its source timestamp', () => {
  const schedule = playerSchedule(weekly, weeklyFcs);
  const categories = [{ name: 'rushing', types: [{ name: 'YDS', athletes: [{ id: '500', name: 'Taylor Martin', stat: '70' }] }] }];
  const home = { homeAway: 'home', team: fbs.name, points: 24, categories };
  const away = { homeAway: 'away', team: fcs.name, points: 14, categories };
  const cache = { schemaVersion: 1, source: 'cfbd', season: 2026, asOf: '2026-11-15T17:00:00Z',
    roster: { rows: [] }, totals: { rows: [] } };
  const withBoxes = (...boxes) => ({
    ...cache, weeks: [{ week: 11, rows: [{ id: '301', teams: boxes }] }],
  });
  const pages = buildPlayerPublications(normalizePlayerData(withBoxes(home, away), schedule));
  assert.equal(pages.get(fbs.id).asOf, cache.asOf);
  assert.equal(pages.get(fcs.id).scheduleAsOf, schedule.scheduleAsOf);
  assert.equal(pages.get(fcs.id).coverage.boxGames, 1);

  for (const invalidAway of [{ ...away, points: undefined }, { ...away, points: 17 }, { ...away, team: fbs.name },
    { ...away, categories: [] }]) {
    assert.throws(() => normalizePlayerData(withBoxes(home, invalidAway), schedule), /1 missing team-game boxes/);
  }
  assert.throws(() => normalizePlayerData(withBoxes(home), schedule), /1 missing team-game boxes/);
  assert.throws(() => normalizePlayerData(withBoxes(home, away, away), schedule), /1 duplicates/);
  const beforeKickoff = { ...withBoxes(home, away), asOf: '2026-11-14T16:30:00Z' };
  assert.throws(() => normalizePlayerData(beforeKickoff, schedule), /2 missing team-game boxes/);

  const freshCache = { ...withBoxes({ ...home, points: undefined }), asOf: '2026-11-15T18:01:00Z' };
  assert.equal(normalizePlayerData(freshCache, schedule).groups.get(fbs.id).matched.size, 1);
});

test('weekly source request includes the latest week and stays within three game-week batches', () => {
  const games = new Map([7, 8, 9, 10, 11].map(week => [String(week), {
    id: String(week), week, startDate: `2026-11-${week < 10 ? '0' : ''}${week}T18:00:00Z`,
  }]));
  const previous = { weeks: [{ week: 11, rows: [{ id: 11 }] }, { week: 9, rows: [{ id: 9 }] }] };
  assert.deepEqual(playerRefreshWeeks({ games }, previous), [11, 10, 8]);
  assert.deepEqual(playerRefreshWeeks({ games }, null, true), [11, 10, 9, 8, 7]);
});
