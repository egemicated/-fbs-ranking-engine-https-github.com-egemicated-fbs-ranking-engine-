import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateSeason, rankSeason } from '../src/engine.js';
import { assertNoLogicalDuplicates } from '../src/data-quality.js';
import { atomicJson } from '../src/ingest.js';
import { matchupValidation } from '../src/site-validation.js';

const DAY = 86400000;
const HORIZON_DAYS = 7;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestamp = value => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const favored = probability => probability > 0.5 ? 'home' : probability < 0.5 ? 'away' : 'even';
const weekKey = game => `${game.seasonType}:${game.week}`;
const sameMatchup = (old, game) => old && old.home === game.home && old.away === game.away && old.neutral === game.neutral;

function strengthByTeam(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Missing Strength ratings');
  const strengths = new Map();
  for (const row of rows) {
    if (typeof row.id !== 'string' || !row.id || strengths.has(row.id) || !Number.isFinite(row.strength)) throw new Error('Invalid Strength ratings');
    strengths.set(row.id, row.strength);
  }
  return strengths;
}

function predictGame(game, strengths, homeAdvantage, scale) {
  if (!strengths.has(game.home) || !strengths.has(game.away)) return null;
  const edge = strengths.get(game.home) - strengths.get(game.away) + (game.neutral ? 0 : homeAdvantage);
  const homeWinProbability = 1 / (1 + Math.exp(-edge / scale));
  return { homeWinProbability, favored: favored(homeWinProbability) };
}

function savedPick(previous, game, kickoff, previousAsOf) {
  if (!sameMatchup(previous, game) || !previous.pick) return null;
  const { capturedAt, homeWinProbability, favored: side } = previous.pick;
  const capture = timestamp(capturedAt);
  if (!Number.isFinite(capture) || capture > previousAsOf || capture >= Date.parse(previous.startDate) ||
      !Number.isFinite(homeWinProbability) || homeWinProbability < 0 || homeWinProbability > 1 ||
      side !== favored(homeWinProbability)) throw new Error(`Invalid previously saved pick for game ${game.id}`);
  return capture < kickoff ? { capturedAt, homeWinProbability, favored: side } : null;
}

function previousGames(previous, season, capture, scheduleCutoff) {
  if (!previous) return new Map();
  const priorRelease = timestamp(previous.asOf);
  if (previous.schemaVersion !== 1 || !Number.isInteger(previous.season) || previous.season > season ||
      !Number.isFinite(priorRelease) || priorRelease > capture || !Array.isArray(previous.games)) throw new Error('Invalid previous Weekly Picks artifact');
  if (previous.season < season) return new Map();
  if (timestamp(previous.source?.scheduleAsOf) > scheduleCutoff) throw new Error('Refusing to replace Weekly Picks with older schedule data');
  const byId = new Map(previous.games.map(game => [game.id, game]));
  if (byId.size !== previous.games.length) throw new Error('Duplicate game in previous Weekly Picks artifact');
  return byId;
}

export function buildWeeklyPicks(season, snapshot, { capturedAt, prior = null, previous = null } = {}) {
  validateSeason(season);
  assertNoLogicalDuplicates(season.games);
  const capture = timestamp(capturedAt);
  const scheduleCutoff = timestamp(season.source?.fetchedAt);
  const strengthCutoff = timestamp(snapshot.asOf);
  const strengthFetched = timestamp(snapshot.source?.fetchedAt);
  if (![capture, scheduleCutoff, strengthCutoff, strengthFetched].every(Number.isFinite) ||
      scheduleCutoff > capture || strengthFetched > strengthCutoff || strengthCutoff > capture ||
      season.year !== snapshot.season || !hash(snapshot.snapshotHash) || !hash(season.source?.sha256) ||
      snapshot.source?.provider !== 'cfbd' || !hash(snapshot.source.sha256) ||
      !['cfbd', 'sportsdataverse'].includes(season.source.provider)) throw new Error('Weekly Picks requires dated season data and its season’s published CFBD Strength snapshot');
  const live = season.source.provider === 'cfbd';
  if (live && (scheduleCutoff !== strengthFetched || season.source.sha256 !== snapshot.source.sha256)) {
    throw new Error('CFBD schedule and Strength snapshot must come from the same refresh');
  }
  const validation = matchupValidation(snapshot);
  const scale = validation?.winProbability.scale ?? snapshot.config?.probabilityScale;
  const homeAdvantage = snapshot.config?.homeAdvantage;
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(homeAdvantage) || homeAdvantage < 0) throw new Error('Invalid Strength probability settings');
  const strengths = strengthByTeam(snapshot.rankings.filter(team => team.division === 'fbs'));
  const modeledGames = new Set(snapshot.rankings.flatMap(team => (team.contributions ?? []).map(row => row.gameId)));
  const teamsById = new Map(season.teams.map(team => [team.id, team]));
  const fbs = id => teamsById.get(id).division === 'fbs';
  const schedule = season.games.filter(game => fbs(game.home) || fbs(game.away));
  if (!schedule.length) throw new Error('No FBS schedule games');
  const oldGames = previousGames(previous, season.year, capture, scheduleCutoff);
  const canceled = new Set((season.source.audit?.confirmedCanceledRecords ?? []).map(row => row.id));
  const incomplete = new Set(season.source.audit?.incompleteFinals ?? []);
  const openings = new Map();
  for (const game of schedule) {
    const kickoff = Date.parse(game.startDate);
    if (game.completed && kickoff > scheduleCutoff) throw new Error(`Final appears after the schedule retrieval cutoff for game ${game.id}`);
    if (canceled.has(game.id)) continue;
    const key = weekKey(game);
    openings.set(key, Math.min(openings.get(key) ?? Infinity, kickoff));
  }
  if (prior) {
    if (prior.season !== season.year - 1 || !hash(prior.snapshotHash)) throw new Error('Replay requires the previous season’s saved Strength snapshot');
    strengthByTeam(prior.ratings);
  }

  const replayRatings = new Map();
  const games = schedule.map(game => {
    const { id, week, seasonType, home, away, neutral } = game;
    const kickoff = Date.parse(game.startDate);
    const startDate = new Date(kickoff).toISOString();
    const old = oldGames.get(id);
    const isCanceled = canceled.has(id);
    const wasPlayed = modeledGames.has(id) || (sameMatchup(old, game) && old.status === 'final');
    const underway = wasPlayed || incomplete.has(id) || Number.isInteger(game.homePoints) || Number.isInteger(game.awayPoints);
    const status = game.completed && !isCanceled ? 'final' : kickoff <= capture || isCanceled || underway ? 'pending' : 'scheduled';
    const fbsMatchup = fbs(home) && fbs(away);
    let pick = fbsMatchup && !isCanceled ? savedPick(old, game, kickoff, timestamp(previous?.asOf)) : null;
    let estimate = null;
    let replay = null;
    if (!pick && fbsMatchup && status === 'scheduled' && kickoff <= capture + HORIZON_DAYS * DAY) {
      const odds = predictGame(game, strengths, homeAdvantage, scale);
      // If no verified time was supplied, the calendar day is the earliest safe boundary.
      const safeKickoff = game.startTimeTbd === false ? kickoff : Date.parse(`${startDate.slice(0, 10)}T00:00:00Z`);
      if (odds && live && capture < safeKickoff) pick = { capturedAt, ...odds };
      if (odds && !live) estimate = { asOf: snapshot.asOf, ...odds };
    }
    if (!pick && fbsMatchup && !isCanceled && kickoff <= capture && !incomplete.has(id)) {
      const key = weekKey(game);
      const asOf = new Date(openings.get(key) - 1).toISOString();
      if (prior) {
        if (!replayRatings.has(key)) {
          const replaySnapshot = rankSeason(season, { config: snapshot.config, previous: prior, before: asOf });
          replayRatings.set(key, strengthByTeam(replaySnapshot.rankings));
        }
        const odds = predictGame(game, replayRatings.get(key), homeAdvantage, scale);
        if (odds) replay = { asOf, ...odds };
      } else if (sameMatchup(old, game) && old.replay?.asOf === asOf) {
        replay = old.replay;
      }
    }
    return { id, week, seasonType, home, away, startDate, neutral, status,
      homePoints: status === 'final' ? game.homePoints : null, awayPoints: status === 'final' ? game.awayPoints : null,
      pick, estimate, replay };
  }).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));

  const teamIds = new Set(games.flatMap(game => [game.home, game.away]));
  const teams = season.teams.filter(team => teamIds.has(team.id)).map(({ id, name, division, conference }) =>
    ({ id, name, division, conference: conference ?? null })).sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 1, season: season.year, asOf: capturedAt,
    source: {
      provider: season.source.provider, scheduleAsOf: season.source.fetchedAt,
      ...(season.source.extraScoreProvider === 'ESPN' ? { extraScoreProvider: 'ESPN' } : {}),
      rankingAsOf: snapshot.asOf, snapshotHash: snapshot.snapshotHash, modelVersion: snapshot.modelVersion,
      probabilityScale: scale, calibrated: Boolean(validation), homeAdvantage, pickHorizonDays: HORIZON_DAYS,
      replay: games.some(game => game.replay) ? {
        method: 'Archived Strength replay before the earliest available FBS kickoff of each week, with a 24-hour results buffer',
        priorSnapshotHash: prior?.snapshotHash ?? previous?.source?.replay?.priorSnapshotHash ?? null,
      } : null,
    },
    teams, games,
  };
}

async function run(args) {
  const flags = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const [key, value] = args.slice(i, i + 2);
    if (!['--season', '--snapshot', '--output', '--prior'].includes(key) || !value || value.startsWith('--') || flags.has(key)) {
      throw new Error('Usage: node scripts/publish-weekly-picks.js [--season path] [--snapshot path] [--output path] [--prior path]');
    }
    flags.set(key, value);
  }
  const json = async path => JSON.parse(await readFile(path, 'utf8'));
  const snapshotPath = flags.get('--snapshot') ?? 'published/latest.json';
  const output = flags.get('--output') ?? 'published/weekly-picks.json';
  const snapshot = await json(snapshotPath);
  const seasonPath = flags.get('--season') ?? `data/seasons/${snapshot.season}.json`;
  const priorPath = flags.get('--prior');
  if ([snapshotPath, seasonPath, priorPath].some(path => path && resolve(path) === resolve(output))) throw new Error('Weekly Picks output must be separate from its inputs');
  const [season, prior, previous] = await Promise.all([
    json(seasonPath), priorPath ? json(priorPath) : null,
    json(output).catch(error => { if (error.code !== 'ENOENT') throw error; return null; }),
  ]);
  const capturedAt = new Date().toISOString();
  const artifact = buildWeeklyPicks(season, snapshot, { capturedAt, prior, previous });
  const now = Date.now();
  if (artifact.games.some(game => game.pick?.capturedAt === capturedAt && Date.parse(game.startDate) <= now)) throw new Error('A new pick passed kickoff during generation; retry to publish the remaining games');
  await atomicJson(output, artifact);
  const count = key => artifact.games.filter(game => game[key]).length;
  console.log(`Published ${artifact.season} Weekly Picks: ${artifact.games.length} games, ${count('pick')} saved picks, ${count('estimate')} upcoming estimates, ${count('replay')} archive replays. No API requests.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await run(process.argv.slice(2));
