import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateCandidates, eligibleGames, replay, metrics, sameSupport, pairedSensitivity, resolvePrimaryTeam, normalizeCachedEvent } from './historical_foundation.mjs';

const config = { ridge: 3, retention: 0.75, homeAdvantage: 2.5, marginCap: 28, probabilityScale: 14 };
const scales = { baseline: 14, 'FBS-FBS': 6.147406563247917, 'FBS-FCS': 14, 'FCS-FCS': 6.74434303402901 };
function fixture(year = 2024) {
  const game = (id, home, away, day, week, homePoints = 21, awayPoints = 7) => ({ id, home, away, week,
    startDate: `${year}-09-${day}T12:00:00.000Z`, completed: true, seasonType: 'regular', neutral: false, homePoints, awayPoints });
  return { year, teams: [
    { id: 'a', name: 'A', division: 'fbs', conference: 'One' }, { id: 'b', name: 'B', division: 'fbs', conference: 'Two' },
    { id: 'c', name: 'C', division: 'fcs', conference: 'Three' }, { id: 'd', name: 'D', division: 'fcs', conference: 'Three' }],
    games: [game('one', 'a', 'b', '01', 1), game('same-week', 'c', 'd', '03', 1),
      game('cross', 'a', 'c', '08', 2), game('future', 'b', 'd', '15', 3)] };
}

test('same-week and future outcomes cannot alter earlier checkpoints', () => {
  const original = fixture(), changed = structuredClone(original);
  changed.games[1].homePoints = 0; changed.games[1].awayPoints = 70;
  changed.games[3].homePoints = 0; changed.games[3].awayPoints = 70;
  const a = replay([original], config, [2024]), b = replay([changed], config, [2024]);
  assert.equal(a.predictions.find(row => row.gameId === 'one').homeMargin, b.predictions.find(row => row.gameId === 'one').homeMargin);
  assert.equal(a.predictions.find(row => row.gameId === 'same-week').homeMargin, b.predictions.find(row => row.gameId === 'same-week').homeMargin);
  assert.notEqual(a.predictions.find(row => row.gameId === 'cross').homeMargin, b.predictions.find(row => row.gameId === 'cross').homeMargin);
  assert.equal(a.checkpoints[0].trainingGames, 0);
  assert.equal(a.checkpoints[1].trainingGames, 2);
});

test('24-hour cutoff uses timezone-aware actual kickoff, completion and seen identity', () => {
  const season = fixture(), cutoff = Date.parse('2024-09-02T12:00:00.000Z');
  assert.deepEqual(eligibleGames(season, new Set(['one']), cutoff).map(game => game.id), ['one']);
  assert.equal(eligibleGames(season, new Set(['one']), cutoff - 1).length, 0);
  season.games[0].completed = false;
  assert.equal(eligibleGames(season, new Set(['one']), cutoff).length, 0);
});

test('rescheduled earlier-week game stays unavailable until its actual date', () => {
  const season = fixture(); season.games[1].startDate = '2024-09-21T12:00:00.000Z';
  const result = replay([season], config, [2024]);
  assert.equal(result.checkpoints.find(point => point.group === 'regular:2').trainingGames, 1);
  assert.equal(result.checkpoints.find(point => point.group === 'regular:3').trainingGames, 2);
});

test('prior-season game later than next-season checkpoint is rejected', () => {
  const prior = fixture(2023); prior.games[3].startDate = '2024-09-02T12:00:00.000Z';
  assert.throws(() => replay([prior, fixture()], config, [2024]), /Prior season contains unavailable/);
});

test('all requested populations use stable season-specific teams', () => {
  const result = replay([fixture()], config, [2024]);
  assert.deepEqual([...new Set(result.predictions.map(row => row.division))].sort(), ['FBS-FBS', 'FBS-FCS', 'FCS-FCS']);
  assert.equal(result.predictions.find(row => row.gameId === 'one').homeConference, 'One');
});

test('duplicate identity flag preserves rematches and normalizes UTC date', () => {
  const season = fixture(), original = season.games[0];
  season.games.push({ ...original, id: 'duplicate', startDate: '2024-09-01T07:00:00-06:00' });
  assert.deepEqual(duplicateCandidates(season), [['one', 'duplicate']]);
  season.games.at(-1).startDate = '2024-12-01T12:00:00Z';
  assert.deepEqual(duplicateCandidates(season), []);
});

test('primary school aliases resolve by explicit stable ID instead of creating false missing games', () => {
  const season = { teams: [{ id: '2755', name: 'Grambling' }] };
  assert.equal(resolvePrimaryTeam(season, 'Grambling State').id, '2755');
  assert.equal(resolvePrimaryTeam(season, 'Unknown program'), undefined);
});

test('source addition validation refuses inconsistent winners and unavailable calendar identities', () => {
  const event = { id: 'g', season: { year: 2020, type: 6 }, date: '2021-04-20T18:00Z', week: { number: 1 }, status: { type: { completed: true } },
    competitions: [{ neutralSite: true, competitors: [{ id: 'a', homeAway: 'home', score: '21', winner: true }, { id: 'b', homeAway: 'away', score: '7', winner: false }] }] };
  assert.equal(normalizeCachedEvent(event, 2020).seasonType, 'postseason');
  const changed = structuredClone(event); changed.competitions[0].competitors[0].winner = false;
  assert.throws(() => normalizeCachedEvent(changed, 2020));
  changed.competitions[0].competitors[0].winner = true; changed.date = '2020-04-20T18:00Z';
  assert.throws(() => normalizeCachedEvent(changed, 2020));
});

test('same-game comparisons reject lost targets and changed winners; score corrections share a target', () => {
  const rows = replay([fixture()], config, [2024]).predictions;
  assert.throws(() => sameSupport(rows, rows.slice(1)), /lost target/);
  const changed = structuredClone(rows); changed[0].outcome = 0;
  assert.throws(() => sameSupport(rows, changed), /changed target outcome/);
  changed[0].outcome = rows[0].outcome; changed[0].actualMargin = 15;
  const result = sameSupport(rows, changed);
  assert.equal(result.paired[0][0].actualMargin, 15);
  assert.equal(result.correctedTargetScores.length, 1);
});

test('probability and calibration metrics respect empty support and bin counts', () => {
  assert.equal(metrics([], scales).brier, null);
  const rows = replay([fixture()], config, [2024]).predictions;
  const result = metrics(rows, scales, true);
  assert.equal(result.games, 4); assert.equal(result.reliability.reduce((sum, bin) => sum + bin.games, 0), 4);
  assert.ok(result.brier > 0 && result.logLoss > 0);
  const mixed = rows.filter(row => row.division === 'FBS-FCS');
  assert.deepEqual(metrics(mixed, scales, false), metrics(mixed, scales, true));
  assert.equal(metrics([{ ...rows[0], homeMargin: 0 }], scales, true).accuracy, 0.5);
});

test('paired week-block resampling is deterministic and identity comparison is exactly zero', () => {
  const rows = replay([fixture()], config, [2024]).predictions, pairs = sameSupport(rows, rows).paired;
  const result = pairedSensitivity(pairs, scales, false, 100, 1);
  assert.deepEqual(result, pairedSensitivity(pairs, scales, false, 100, 1));
  for (const value of Object.values(result.candidateMinusOriginal)) assert.deepEqual(value, { difference: 0, sensitivity95: [0, 0] });
});
