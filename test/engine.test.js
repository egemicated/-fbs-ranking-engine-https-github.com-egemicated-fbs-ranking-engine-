import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSeason, predict } from '../src/engine.js';
import { normalizeCsv, normalizeCfbd, parseCsv } from '../src/ingest.js';
import { backtest } from '../src/history.js';
const teams = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id.toUpperCase(), division: 'fbs', conference: id < 'c' ? 'X' : 'Y' }));
const game = (id, home, away, homePoints, awayPoints, week = 1) => ({ id, home, away, homePoints, awayPoints, week, seasonType: 'regular', startDate: `2025-09-${String(week * 7).padStart(2, '0')}T12:00:00Z`, completed: true, neutral: true });
const season = games => ({ year: 2025, teams, games });

test('single win has analytically correct Colley scores; idle teams stay unranked', () => {
  const r = rankSeason(season([game('1', 'a', 'b', 7, 0)]));
  assert.equal(r.rankings.find(t => t.id === 'a').achievement, 0.625);
  assert.equal(r.rankings.find(t => t.id === 'b').achievement, 0.375);
  assert.equal(r.rankings.find(t => t.id === 'c').rank, null);
});
test('team names, conferences, input order and score margins do not change earned scores', () => {
  const s = season([game('1', 'a', 'b', 7, 0), game('2', 'c', 'd', 7, 0)]), first = rankSeason(s);
  const changed = structuredClone(s); changed.teams.reverse().forEach(t => { t.name = 'Renamed'; t.conference = 'Other'; }); changed.games.reverse(); changed.games[0].homePoints = 90;
  const second = rankSeason(changed);
  assert.deepEqual(first.ratings.map(t => t.achievement), second.ratings.map(t => t.achievement));
  assert.equal(first.rankings.find(t => t.id === 'a').rank, first.rankings.find(t => t.id === 'c').rank);
});
test('historical ratings influence strength only and identical inputs are deterministic', () => {
  const s = season([game('1', 'a', 'b', 7, 0)]), previous = rankSeason({ ...s, year: 2024 });
  const baseline = rankSeason(s), result = rankSeason(s, { previous });
  assert.deepEqual(baseline.ratings.map(t => t.achievement), result.ratings.map(t => t.achievement));
  assert.notEqual(baseline.ratings[0].strength, result.ratings[0].strength);
  assert.deepEqual(result, rankSeason(s, { previous }));
  assert.throws(() => rankSeason(s, { previous: result }), /precede/);
});
test('stronger opponents earn more schedule-adjusted achievement', () => {
  const t = [...teams, { id: 'e', name: 'E', conference: 'X', division: 'fbs' }];
  const r = rankSeason({ year: 2025, teams: t, games: [game('1', 'a', 'b', 7, 0), game('2', 'c', 'd', 7, 0), game('3', 'b', 'e', 7, 0), game('4', 'e', 'd', 7, 0)] });
  assert.ok(r.ratings.find(t => t.id === 'a').achievement > r.ratings.find(t => t.id === 'c').achievement);
});
test('cutoff excludes future results and requires a completed score', () => {
  const s = season([game('1', 'a', 'b', 7, 0, 1), game('2', 'c', 'd', 7, 0, 2)]);
  const r = rankSeason(s, { before: '2025-09-10T00:00:00Z' });
  s.games[1].homePoints = 100;
  assert.deepEqual(r, rankSeason(s, { before: '2025-09-10T00:00:00Z' }));
  assert.equal(r.gamesUsed, 1);
  s.games[0].homePoints = null;
  assert.throws(() => rankSeason(s), /score/);
});
test('home advantage reverses correctly and neutral games are symmetric', () => {
  const r = rankSeason(season([]));
  const g = game('1', 'a', 'b', 7, 0);
  assert.equal(predict(r, g).homeWinProbability, 0.5);
  assert.ok(predict(r, { ...g, neutral: false }).homeWinProbability > 0.5);
});
test('backtest freezes all games in a week and holds out future scores', () => {
  const s = season([game('1', 'a', 'b', 7, 0), game('2', 'c', 'd', 14, 0), game('3', 'a', 'c', 7, 0, 2)]);
  const a = backtest([s]); s.games[0].homePoints = 70; const b = backtest([s]);
  assert.deepEqual(a.predictions.slice(0, 2).map(p => p.homeWinProbability), b.predictions.slice(0, 2).map(p => p.homeWinProbability));
  assert.equal(a.predictions[0].trainingGames, 0); assert.equal(a.predictions[2].trainingGames, 2);
});
test('duplicate games and invalid parameters fail instead of corrupting rankings', () => {
  const g = game('1', 'a', 'b', 7, 0);
  assert.throws(() => rankSeason(season([g, g])), /duplicate/);
  assert.throws(() => rankSeason(season([g]), { config: { ridge: 0 } }), /configuration/);
});
test('CSV parser handles commas, escaped quotes and multiline fields', () => {
  assert.deepEqual(parseCsv('a,b\r\n"hello, ""world""","two\nlines"\r\n'), [{ a: 'hello, "world"', b: 'two\nlines' }]);
  assert.throws(() => parseCsv('a,b\n1,2,3'), /column/);
});
test('CSV ingest deliberately strips third-party ratings', () => {
  const header = 'game_id,season,week,season_type,start_date,completed,neutral_site,home_id,home_team,home_division,home_conference,home_points,away_id,away_team,away_division,away_conference,away_points,home_pregame_elo';
  const s = normalizeCsv(header + '\n1,2025,1,regular,2025-09-01T12:00:00Z,TRUE,FALSE,a,A,fbs,X,7,b,B,fbs,Y,0,9999', 2025);
  assert.equal(JSON.stringify(s).includes('9999'), false);
  assert.equal(s.games[0].neutral, false);
});
test('CFBD ingest recognizes overtime from tied regulation period totals', () => {
  const s = normalizeCfbd([{ id: 1, season: 2025, week: 1, seasonType: 'regular', startDate: '2025-09-01T12:00:00Z', completed: true, neutralSite: true, homeId: 'a', awayId: 'b', homeTeam: 'A', awayTeam: 'B', homeClassification: 'fbs', awayClassification: 'fbs', homePoints: 28, awayPoints: 21, homeLineScores: [7,7,0,7,7], awayLineScores: [7,7,7,0,0] }], [], 2025);
  assert.equal(s.games[0].regulationMargin, 0);
  const r = rankSeason(s);
  assert.ok(r.ratings.find(t => t.id === 'a').strength < 1);
});

test('historical priors decay across missing seasons and new teams start neutral', () => {
  const s = season([game('1', 'a', 'b', 21, 0)]);
  const previous = rankSeason({ ...s, year: 2023 });
  const now = rankSeason(season([]), { previous, config: { retention: 0.5 } });
  assert.equal(now.ratings[0].strength, previous.ratings[0].strength * 0.25);
  assert.equal(now.ratings.find(t => t.id === 'c').strength, 0);
});

test('CSV audit excludes duplicated fixtures and incomplete finals', () => {
  const header = 'game_id,season,week,season_type,start_date,completed,neutral_site,home_id,home_team,home_division,home_conference,home_points,away_id,away_team,away_division,away_conference,away_points';
  const row = '1,2025,1,regular,2025-09-01T12:00:00Z,TRUE,FALSE,a,A,fbs,X,7,b,B,fbs,Y,0';
  const incomplete = '3,2025,2,regular,2025-09-08T12:00:00Z,TRUE,FALSE,a,A,fbs,X,NA,b,B,fbs,Y,NA';
  const s = normalizeCsv([header, row, row.replace(/^1,/, '2,'), incomplete].join('\n'), 2025);
  assert.deepEqual(s.source.audit.duplicateRows, ['2']);
  assert.deepEqual(s.source.audit.incompleteFinals, ['3']);
  assert.equal(rankSeason(s).gamesUsed, 1);
});
