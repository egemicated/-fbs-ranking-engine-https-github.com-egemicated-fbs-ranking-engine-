import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { dayKey } from './preview-ui.mjs';
import { basketballTeamStats } from './team-stats.js';

const TEAM_FIELDS = [
  'id', 'name', 'mascot', 'conference', 'color', 'wins', 'losses', 'diWins', 'diLosses',
  'conferenceWins', 'conferenceLosses', 'sorRank', 'sorScore', 'expectedWins',
  'sorOpponentWinProbability', 'scheduleStrength', 'predictiveRank', 'predictiveScore',
  'performanceRank', 'performanceScore', 'adjustedOffense', 'adjustedDefense', 'tempo',
  'boxGames', 'games', 'colley', 'elo', 'marginRating', 'recentForm', 'lastGameAt', 'provisional', 'fourFactors',
];
const SNAPSHOT_FIELDS = [
  'competition', 'season', 'asOf', 'snapshotHash', 'modelVersion', 'modelConfig',
  'gamesUsed', 'leagueEfficiency', 'meanTempo',
];
const GAME_FIELDS = [
  'id', 'home', 'away', 'homeName', 'awayName', 'startDate', 'startTimeTbd',
  'status', 'completed', 'homePoints', 'awayPoints', 'neutral', 'divisionOne',
];
const REPORT_FIELDS = ['forecasts', 'graded', 'pending', 'excluded', 'missing', 'accuracy', 'brier'];
const RANKING_HISTORY_LIMIT = 22;
const DAY = 86_400_000;
export const teamPattern = /^ncaam-d1:\d+$/;

export const digestBasketballFile = bytes => createHash('sha256').update(bytes).digest('hex');
const pick = (value, fields) => Object.fromEntries(fields.filter(key => value?.[key] != null).map(key => [key, value[key]]));
const encode = value => JSON.stringify(value);
const chronological = (a,b) => Date.parse(a.startDate) - Date.parse(b.startDate) || a.id.localeCompare(b.id);

export function omitSupersededBasketballFixture(year, games, hasSavedEvidence) {
  if (year !== 2027) return games;

  // Seattle U played UC San Diego on Nov. 22 and Loyola Chicago on Nov. 23.
  // https://goseattleu.com/sports/mens-basketball/schedule
  // https://loyolaramblers.com/boxscore.aspx?id=7319&path=mbball
  const placeholder = games.find(game => game.id === 'ncaam-d1:372907');
  if (!placeholder || placeholder.home !== 'ncaam-d1:151' || placeholder.away !== 'ncaam-d1:262' ||
      placeholder.status !== 'scheduled' || placeholder.completed !== false || placeholder.startTimeTbd !== true ||
      placeholder.homePoints != null || placeholder.awayPoints != null ||
      !Number.isFinite(Date.parse(placeholder.startDate)) || dayKey(placeholder.startDate) !== '2026-11-22' ||
      hasSavedEvidence(placeholder.id)) return games;

  const final = games.find(game => game.id === 'ncaam-d1:378701');
  if (!final || final.home !== placeholder.away || final.away !== placeholder.home ||
      final.status !== 'final' || final.completed !== true || final.startTimeTbd !== false ||
      final.homePoints !== 76 || final.awayPoints !== 63 ||
      !Number.isFinite(Date.parse(final.startDate)) || dayKey(final.startDate) !== '2026-11-23') return games;

  return games.filter(game => game !== placeholder);
}

function gameDisplay(game) {
  const { completed, homePoints, awayPoints } = game;
  if (completed && ![homePoints, awayPoints].every(Number.isFinite)) {
    throw Error('Basketball publication contains an incomplete final score');
  }
  const display = pick(game, GAME_FIELDS);
  if (completed && game.box?.home && game.box?.away) {
    const rate = (n,d) => Number.isFinite(n) && d > 0 ? n/d : null;
    const side = (own,other) => ({
      shooting: [own.fieldGoalsMade,own.threePointsMade].every(Number.isFinite)
        ? rate(own.fieldGoalsMade + .5*own.threePointsMade,own.fieldGoalsAttempted) : null,
      reboundShare: [own.offensiveRebounds,other.defensiveRebounds].every(Number.isFinite)
        ? rate(own.offensiveRebounds,own.offensiveRebounds+other.defensiveRebounds) : null,
      turnoverRate: rate(own.turnovers,own.possessions),
    });
    display.boxEvidence = { home:side(game.box.home,game.box.away), away:side(game.box.away,game.box.home) };
  }
  return display;
}

function gameDisplayGroup(ctx, rows) {
  const forecasts = [];
  const grades = [];
  const games = [...new Map(rows.map(row => [row.id, row])).values()].sort(chronological);
  for (const game of games) {
    const forecast = ctx.forecasts.get(game.id);
    const grade = ctx.forecastReportById.get(game.id);
    if (forecast && Number.isFinite(forecast.homeWinProbability) && Date.parse(forecast.capturedAt) < Date.parse(forecast.startDate)) {
      forecasts.push([game.id, pick(forecast, ['homeWinProbability','capturedAt'])]);
    }
    if (grade) grades.push([game.id, pick(grade, ['homeWinProbability','status','right'])]);
  }
  return { games: games.map(gameDisplay), forecasts, grades };
}

function reportGames(ctx) {
  const grades = ctx.report.games.filter(row => row.status === 'graded');
  const confidence = row => Math.max(row.homeWinProbability, 1 - row.homeWinProbability);
  const wins = grades.filter(row => row.right === 1 && confidence(row) >= .7).slice(-5);
  const misses = grades.filter(row => row.right === 0 && confidence(row) >= .7)
    .sort((a,b) => confidence(b) - confidence(a)).slice(0, 5);
  const selected = new Set([...grades.slice(-15), ...wins, ...misses].map(row => row.gameId));
  return ctx.dataset.games.filter(game => selected.has(game.id));
}

function playerDisplay(ctx, team) {
  const complete = ctx.dataset.playerStats?.[team.id] ?? [];
  const ordered = [...complete].filter(row => Number.isFinite(row.games) && row.games > 0)
    .sort((a,b) => (b.minutes ?? -1) - (a.minutes ?? -1) || (b.points ?? -1) - (a.points ?? -1));
  const by = key => [...ordered].filter(row => Number.isFinite(row[key])).sort((a,b) => b[key] - a[key])[0];
  return [...new Map([by('points'), by('rebounds'), by('assists'), ...ordered.slice(0,8)]
    .filter(row => row?.name).map(row => [row.id ?? row.name, row])).values()]
    .map(row => ({
      ...pick(row, ['name','position','games','minutes','points','rebounds','assists','steals','blocks',
        'turnovers','fgPct','threePct','ftPct','trueShootingPct','threeMade','threeAttempts']),
      recent: (row.recent ?? []).slice(0,3).map(game => pick(game, ['startDate','points','rebounds','assists','minutes'])),
    }));
}

export function buildBasketballSitePublication({ seasons, activeYear }, clock = Date.now()) {
  const current = seasons.get(activeYear);
  if (!current?.snapshot.teams.length || !current.snapshot.gamesUsed || Date.parse(current.snapshot.asOf) > clock) {
    throw Error('The current basketball season must have a validated, dated publication');
  }
  const generatedAt = new Date(clock).toISOString();
  const years = [...seasons.keys()].sort((a,b) => b-a);
  const files = new Map();
  const add = (path, value) => files.set(path, encode(value));
  const directory = {};
  for (const [year, ctx] of seasons) {
    const { dataset, snapshot, teams, conferenceQuality, editions, report } = ctx;
    const games = omitSupersededBasketballFixture(year, dataset.games, gameId =>
      ctx.forecasts.has(gameId) || ctx.forecastReportById.has(gameId))
      .filter(game => game.startDate && Number.isFinite(Date.parse(game.startDate))).sort(chronological);
    const now = Date.parse(snapshot.asOf);
    const slateStart = now - 21 * DAY;
    const slateEnd = now + 14 * DAY;
    const slate = ctx.historical ? [] : games.filter(game => Date.parse(game.startDate) >= slateStart &&
      Date.parse(game.startDate) <= slateEnd);
    const dates = [...new Set(slate.map(game => dayKey(game.startDate)))].sort();
    const finals = games.filter(game => game.completed && game.divisionOne).slice(-4);
    const upcoming = ctx.historical ? [] : slate.filter(game => !game.completed && game.status === 'scheduled' &&
      Date.parse(game.startDate) > clock).slice(0, 80);
    const modelResults = reportGames(ctx);
    const homepage = gameDisplayGroup(ctx, [...finals, ...upcoming]);
    const displayReport = gameDisplayGroup(ctx, modelResults);
    const selections = new Set(modelResults.map(game => game.id));
    directory[year] = { historical: ctx.historical, teams: [...teams.keys()].filter(id => teamPattern.test(id)), dates };
    const publicTeams = snapshot.teams.map(team => pick(team, TEAM_FIELDS));
    if (publicTeams.length !== directory[year].teams.length) throw Error('Invalid basketball team identity');
    const seasonRecord = {
      snapshot: { ...pick(snapshot, SNAPSHOT_FIELDS), teams: publicTeams },
      conferenceQuality,
      editions: editions.slice(-RANKING_HISTORY_LIMIT).map(row => pick(row, ['asOf','publishedAt','gamesUsed','teams'])),
      home: homepage,
      modelReport: {
        ...displayReport,
        totals: { ...pick(report, REPORT_FIELDS), confidence: report.confidence },
        gradeOrder: report.games.filter(row => selections.has(row.gameId)).map(row => row.gameId),
      },
    };
    add(year + '/season.json', seasonRecord);
    const gamesByDate = Map.groupBy(slate, game => dayKey(game.startDate));
    for (const date of dates) add(year + '/slate/' + date + '.json', gameDisplayGroup(ctx, gamesByDate.get(date)));
    for (const team of snapshot.teams) {
      const schedule = games.filter(game => game.home === team.id || game.away === team.id);
      const recent = schedule.filter(game => game.completed).slice(-8);
      const next = ctx.historical ? [] : schedule.filter(game => !game.completed && game.status === 'scheduled' &&
        Date.parse(game.startDate) > clock).slice(0, 8);
      const best = (team.schedule ?? []).filter(game => game.result === 'W')
        .sort((a,b) => (b.opponentRating ?? -1) - (a.opponentRating ?? -1)).slice(0,5)
        .map(game => pick(game, ['opponentId','venue','opponentRating','result']));
      const teamStats = basketballTeamStats(dataset, team.id, team, snapshot.asOf);
      add(year + '/teams/' + team.id.replace('ncaam-d1:', '') + '.json', {
        ...gameDisplayGroup(ctx, [...recent, ...next]), best, players: playerDisplay(ctx, team),
        stats: pick(teamStats, ['record','scoring','divisionOne','possessions','tempo','adjustedOffense','adjustedDefense','adjustedNet']),
      });
    }
    if (!ctx.historical) {
      const evidence = new Map(snapshot.teams.map(team => [team.id,
        new Map((team.schedule ?? []).map(row => [row.gameId,row]))]));
      const eligible = games.filter(game => {
        const home = teams.get(game.home)?.conference, away = teams.get(game.away)?.conference;
        const homeGame = evidence.get(game.home)?.get(game.id), awayGame = evidence.get(game.away)?.get(game.id);
        return home && away && home !== away && game.completed && game.divisionOne !== false &&
          game.seasonType !== 'preseason' && game.conferenceGame !== true && homeGame?.opponentId === game.away &&
          awayGame?.opponentId === game.home && ['W','L'].includes(homeGame.result) && ['W','L'].includes(awayGame.result) &&
          homeGame.result !== awayGame.result;
      });
      ctx.conferences.forEach((name,index) => {
        const recent = eligible.filter(game => teams.get(game.home).conference === name || teams.get(game.away).conference === name).slice(-20);
        add(year + '/conferences/' + index + '.json', gameDisplayGroup(ctx, recent));
      });
    }
  }
  const holdout = current.validation?.holdout;
  const index = {
    schema: 1, competition: current.snapshot.competition, currentSeason: activeYear, generatedAt, years, directory,
    validation: holdout ? { holdout: pick(holdout, ['games','accuracy','brier','logLoss','marginMae','calibrationError','confidence']) } : null,
  };
  add('index.json', index);
  const fileHashes = Object.fromEntries([...files].map(([path,contents]) => [path,digestBasketballFile(contents)]));
  const version = digestBasketballFile(encode(fileHashes)).slice(0,24);
  return { files, manifest: { schema:1, version, generatedAt, currentSeason:activeYear, files:fileHashes } };
}

const displayPath = /^(?:index\.json|\d{4}\/(?:season\.json|teams\/\d+\.json|conferences\/\d+\.json|slate\/\d{4}-\d{2}-\d{2}\.json))$/;
export async function readBasketballSitePublication(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.schema !== 1 || !/^[\da-f]{24}$/.test(manifest.version) || !manifest.files ||
      digestBasketballFile(encode(manifest.files)).slice(0,24) !== manifest.version) {
    throw Error('Invalid basketball site publication manifest');
  }
  const files = new Map();
  const filesOnDisk = (await readdir(directory, { recursive:true, withFileTypes:true }))
    .filter(file => file.isFile()).map(file => join(file.parentPath,file.name).slice(directory.length + 1).replaceAll('\\','/'));
  if (filesOnDisk.length !== Object.keys(manifest.files).length + 1) throw Error('Unexpected basketball publication files');
  for (const [path, hash] of Object.entries(manifest.files)) {
    if (!displayPath.test(path)) throw Error('Unexpected basketball display path');
    const bytes = await readFile(join(directory,path), 'utf8');
    if (digestBasketballFile(bytes) !== hash) throw Error('Basketball display checksum mismatch');
    files.set(path, bytes);
  }
  const index = JSON.parse(files.get('index.json') ?? '{}');
  if (index.competition !== 'ncaam-d1' || index.currentSeason !== manifest.currentSeason ||
      index.generatedAt !== manifest.generatedAt || !index.years?.includes(index.currentSeason)) {
    throw Error('Basketball public index does not match its manifest');
  }
  return {manifest, files};
}
