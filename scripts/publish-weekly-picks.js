import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateSeason, rankSeason } from '../src/engine.js';
import { assertNoLogicalDuplicates } from '../src/data-quality.js';
import { atomicJson } from '../src/ingest.js';
import { fcsMatchupValidation, matchupValidation, strengthWinProbability } from '../src/site-validation.js';

const DAY = 86400000;
const HORIZON_DAYS = 7;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestamp = value => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const favored = probability => probability > 0.5 ? 'home' : probability < 0.5 ? 'away' : 'even';
const weekKey = game => `${game.seasonType}:${game.week}`;
const sameMatchup = (old, game) => old && old.home === game.home && old.away === game.away && old.neutral === game.neutral;
const safeKickoff = game => game.startTimeTbd === false ? Date.parse(game.startDate) :
  Date.parse(`${new Date(game.startDate).toISOString().slice(0, 10)}T00:00:00Z`);

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
  const homeWinProbability = strengthWinProbability(strengths.get(game.home), strengths.get(game.away), game.neutral ? 0 : homeAdvantage, scale);
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

function fcsReplayGameIds(season, isTarget, canceled) {
  const groups = Map.groupBy(season.games.filter(game => !canceled.has(game.id)), weekKey);
  const weeks = [...groups].map(([key, games]) => {
    const targets = games.filter(isTarget);
    const opening = Math.min(...(targets.length ? targets : games).map(game => Date.parse(game.startDate)));
    return { key, games, opening, hasTargets: targets.length > 0 };
  }).sort((a, b) => a.opening - b.opening);
  const input = new Map();
  const earlier = [];
  for (const { key, games, opening, hasTargets } of weeks) {
    if (hasTargets) {
      input.set(key, new Set(earlier.filter(game => Date.parse(game.startDate) + DAY < opening).map(game => game.id)));
    }
    earlier.push(...games.filter(game => game.completed));
  }
  return input;
}

export function buildWeeklyPicks(season, snapshot, { capturedAt, prior = null, previous = null, cohort = 'fbs', fcsValidation = null } = {}) {
  if (cohort !== 'fbs' && cohort !== 'fcs') throw new Error('Weekly Picks cohort must be fbs or fcs');
  const fcsCohort = cohort === 'fcs';
  if (previous && fcsCohort !== (previous.source?.matchupScope === 'fcs-fcs')) throw new Error('Saved Weekly Picks belong to a different cohort');
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
  const validation = fcsCohort ? fcsMatchupValidation(snapshot, fcsValidation) : matchupValidation(snapshot);
  if (fcsCohort && !validation) throw new Error('FCS Weekly Picks requires approved historical calibration matching the saved Strength model');
  const crossDivisionScale = snapshot.config?.probabilityScale;
  const scale = fcsCohort ? validation.scale : validation?.winProbability.scale ?? crossDivisionScale;
  const homeAdvantage = snapshot.config?.homeAdvantage;
  if (![scale, crossDivisionScale].every(value => Number.isFinite(value) && value > 0) ||
      !Number.isFinite(homeAdvantage) || homeAdvantage < 0) throw new Error('Invalid Strength probability settings');
  const strengths = strengthByTeam(fcsCohort ? snapshot.ratings : snapshot.ratings ?? snapshot.rankings);
  const scoredTeamRows = fcsCohort ? snapshot.ratings.filter(team => team.division === 'fcs') : snapshot.rankings;
  const modeledGames = new Set(scoredTeamRows.flatMap(team => (team.contributions ?? []).map(row => row.gameId)));
  const teamsById = new Map(season.teams.map(team => [team.id, team]));
  const division = id => teamsById.get(id).division;
  const fbs = id => division(id) === 'fbs';
  const fbsOrFcs = id => ['fbs', 'fcs'].includes(division(id));
  const fcsMatchup = game => division(game.home) === 'fcs' && division(game.away) === 'fcs';
  const schedule = season.games.filter(fcsCohort ? fcsMatchup : game => fbs(game.home) || fbs(game.away));
  if (!schedule.length) throw new Error(`No ${cohort.toUpperCase()} schedule games`);
  const oldGames = previousGames(previous, season.year, capture, scheduleCutoff);
  const canceled = new Set((season.source.audit?.confirmedCanceledRecords ?? []).map(row => row.id));
  const incomplete = new Set(season.source.audit?.incompleteFinals ?? []);
  const openings = new Map();
  for (const game of schedule) {
    const kickoff = Date.parse(game.startDate);
    if (game.completed && kickoff > scheduleCutoff) throw new Error(`Final appears after the schedule retrieval cutoff for game ${game.id}`);
    if (canceled.has(game.id) || (fcsCohort && game.startTimeTbd === true)) continue;
    const key = weekKey(game);
    openings.set(key, Math.min(openings.get(key) ?? Infinity, kickoff));
  }
  if (prior) {
    if (prior.season !== season.year - 1 || !hash(prior.snapshotHash)) throw new Error('Replay requires the previous season’s saved Strength snapshot');
    strengthByTeam(prior.ratings);
  }

  const replayRatings = new Map();
  const replayInputs = fcsCohort && prior ? fcsReplayGameIds(season, game => fcsMatchup(game) && game.startTimeTbd !== true, canceled) : null;
  const games = schedule.map(game => {
    const { id, week, seasonType, home, away, neutral } = game;
    const kickoff = Date.parse(game.startDate);
    const startDate = new Date(kickoff).toISOString();
    const old = oldGames.get(id);
    const isCanceled = canceled.has(id);
    const wasPlayed = modeledGames.has(id) || (sameMatchup(old, game) && old.status === 'final');
    const underway = wasPlayed || incomplete.has(id) || Number.isInteger(game.homePoints) || Number.isInteger(game.awayPoints);
    const status = game.completed && !isCanceled ? 'final' : kickoff <= capture || isCanceled || underway ? 'pending' : 'scheduled';
    const eligible = fbsOrFcs(home) && fbsOrFcs(away);
    const gameScale = fcsCohort || (fbs(home) && fbs(away)) ? scale : crossDivisionScale;
    let pick = eligible && !isCanceled ? savedPick(old, game, kickoff, timestamp(previous?.asOf)) : null;
    let estimate = null;
    let replay = null;
    if (!pick && eligible && status === 'scheduled' && kickoff <= capture + HORIZON_DAYS * DAY) {
      const odds = predictGame(game, strengths, homeAdvantage, gameScale);
      // If no verified time was supplied, the calendar day is the earliest safe boundary.
      if (odds && live && (!fcsCohort || game.startTimeTbd !== true) && capture < safeKickoff(game)) pick = { capturedAt, ...odds };
      if (odds && !live) estimate = { asOf: snapshot.asOf, ...odds };
    }
    if (!pick && eligible && !isCanceled && kickoff <= capture && !incomplete.has(id) &&
        (!fcsCohort || game.startTimeTbd !== true)) {
      const key = weekKey(game);
      const asOf = new Date(openings.get(key) - 1).toISOString();
      if (prior) {
        if (!replayRatings.has(key)) {
          const replaySnapshot = rankSeason(season, { config: snapshot.config, previous: prior, before: asOf,
            ...(fcsCohort ? { gameIds: replayInputs.get(key) } : {}) });
          replayRatings.set(key, strengthByTeam(replaySnapshot.ratings));
        }
        const odds = predictGame(game, replayRatings.get(key), homeAdvantage, gameScale);
        if (odds) replay = { asOf, ...odds };
      } else if (sameMatchup(old, game) && old.replay?.asOf === asOf) {
        replay = old.replay;
      }
    }
    return { id, week, seasonType, home, away, startDate, neutral, status,
      ...(typeof game.startTimeTbd === 'boolean' ? { startTimeTbd: game.startTimeTbd } : {}),
      ...(game.kickoffSource === 'espn' ? {
        kickoffSource: game.kickoffSource, kickoffVerifiedAt: game.kickoffVerifiedAt, kickoffOriginalDate: game.kickoffOriginalDate,
      } : {}),
      homePoints: status === 'final' ? game.homePoints : null, awayPoints: status === 'final' ? game.awayPoints : null,
      pick, estimate, replay };
  }).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));

  const teamIds = new Set(games.flatMap(game => [game.home, game.away]));
  const teams = season.teams.filter(team => teamIds.has(team.id)).map(({ id, name, division, conference }) =>
    ({ id, name, division, conference: conference ?? null })).sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 1, season: season.year, asOf: capturedAt,
    ...(live && !fcsCohort ? { kickoffVerificationAsOf: capturedAt } : {}),
    source: {
      provider: season.source.provider, scheduleAsOf: season.source.fetchedAt,
      ...(season.source.extraScoreProvider === 'ESPN' ? { extraScoreProvider: 'ESPN' } : {}),
      rankingAsOf: snapshot.asOf, snapshotHash: snapshot.snapshotHash, modelVersion: snapshot.modelVersion,
      probabilityScale: scale, calibrated: Boolean(validation),
      ...(fcsCohort ? { matchupScope: 'fcs-fcs', validation: validation.evaluation } :
        { crossDivisionProbabilityScale: crossDivisionScale, crossDivisionCalibrated: false }),
      homeAdvantage, pickHorizonDays: HORIZON_DAYS,
      replay: games.some(game => game.replay) ? {
        method: fcsCohort ? 'Archived Strength replay before the earliest FCS–FCS kickoff of each week, with a 24-hour results buffer across earlier weeks' :
          'Archived Strength replay before the earliest available FBS kickoff of each week, with a 24-hour results buffer',
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
    if (!['--season', '--snapshot', '--output', '--prior', '--cohort'].includes(key) || !value || value.startsWith('--') || flags.has(key)) {
      throw new Error('Usage: node scripts/publish-weekly-picks.js [--season path] [--snapshot path] [--output path] [--prior path] [--cohort fbs|fcs]');
    }
    flags.set(key, value);
  }
  const json = async path => JSON.parse(await readFile(path, 'utf8'));
  const cohort = flags.get('--cohort') ?? 'fbs';
  if (cohort !== 'fbs' && cohort !== 'fcs') throw new Error('Weekly Picks cohort must be fbs or fcs');
  const snapshotPath = flags.get('--snapshot') ?? 'published/latest.json';
  const output = flags.get('--output') ?? (cohort === 'fcs' ? 'published/weekly-fcs-picks.json' : 'published/weekly-picks.json');
  if ((cohort === 'fcs' && resolve(output) === resolve('published/weekly-picks.json')) ||
      (cohort === 'fbs' && resolve(output) === resolve('published/weekly-fcs-picks.json'))) {
    throw new Error('Weekly Picks output must match its cohort');
  }
  const snapshot = await json(snapshotPath);
  const seasonPath = flags.get('--season') ?? `data/seasons/${snapshot.season}.json`;
  const priorPath = flags.get('--prior') ?? (cohort === 'fcs' ? `published/prior-${snapshot.season - 1}.json` : null);
  if ([snapshotPath, seasonPath, priorPath].some(path => path && resolve(path) === resolve(output))) throw new Error('Weekly Picks output must be separate from its inputs');
  const [season, prior, previous, fcsValidation] = await Promise.all([
    json(seasonPath), priorPath ? json(priorPath) : null,
    json(output).catch(error => { if (error.code !== 'ENOENT') throw error; return null; }),
    cohort === 'fcs' ? json(new URL('../data/fcs-matchup-validation.json', import.meta.url)) : null,
  ]);
  const capturedAt = new Date().toISOString();
  const artifact = buildWeeklyPicks(season, snapshot, { capturedAt, prior, previous, cohort, fcsValidation });
  const now = Date.now();
  if (artifact.games.some(game => game.pick?.capturedAt === capturedAt &&
      (cohort === 'fcs' ? safeKickoff(game) : Date.parse(game.startDate)) <= now)) {
    throw new Error(cohort === 'fcs' ? 'A new pick passed its kickoff safety boundary during generation; retry to publish the remaining games' :
      'A new pick passed kickoff during generation; retry to publish the remaining games');
  }
  await atomicJson(output, artifact);
  const count = key => artifact.games.filter(game => game[key]).length;
  console.log(`Published ${artifact.season} ${cohort === 'fcs' ? 'FCS ' : ''}Weekly Picks: ${artifact.games.length} games, ${count('pick')} saved picks, ${count('estimate')} upcoming estimates, ${count('replay')} archive replays. No API requests.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await run(process.argv.slice(2));
