/** Capture the frozen prospective trial from supplied local sources. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertNoLogicalDuplicates } from '../src/data-quality.js';
import { DEFAULT_CONFIG, rankSeason, validateSeason } from '../src/engine.js';

const day = 86_400_000;
const digest = data => createHash('sha256').update(data).digest('hex');
const shaPattern = /^[a-f0-9]{64}$/;
const datePattern = /^\d{4}-\d\d-\d\d$/;
const timestampPattern = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/;
const protocolFile = new URL('../preseason-preview/data/trial-2027.json', import.meta.url);
const engineFile = new URL('../src/engine.js', import.meta.url);
const qualityFile = new URL('../src/data-quality.js', import.meta.url);

function assignedTime(value) {
  if (typeof value !== 'string' || (!datePattern.test(value) && !timestampPattern.test(value))) return null;
  const calendarDate = value.slice(0, 10);
  const midnight = Date.parse(`${calendarDate}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== calendarDate) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? { time, dateOnly: datePattern.test(value) } : null;
}

function exactTime(value, name) {
  const parsed = assignedTime(value);
  assert.ok(parsed && !parsed.dateOnly, `${name} requires an exact timestamp with timezone`);
  return parsed.time;
}

function canceled(game) {
  return game.canceled === true || game.cancelled === true || /^(canceled|cancelled)$/i.test(game.status ?? '');
}

function publicProvenance(source) {
  const provider = source.provider ?? source.label;
  assert.ok(typeof provider === 'string' && /^[\p{L}\p{N}][\p{L}\p{N} ._+&()/–-]{0,99}$/u.test(provider),
    'Schedule source requires a short public provider label');
  if (source.publicUrl === undefined) return { provider };
  const url = new URL(source.publicUrl);
  assert.ok(url.protocol === 'https:' && !url.username && !url.password, 'Schedule publicUrl must be a public HTTPS citation');
  url.search = '';
  url.hash = '';
  return { provider, publicUrl: url.href };
}

export function isPostseasonOrTitle(game) {
  if (game.seasonType !== 'regular') return true;
  if (['conferenceChampionship', 'isConferenceChampionship', 'championship', 'isBowl', 'playoff', 'isPlayoff']
    .some(flag => game[flag] === true)) return true;
  const kind = [game.gameType, game.eventType, game.stage].filter(value => typeof value === 'string').join(' ');
  if (/\b(championship|playoff|postseason|bowl)\b/i.test(kind.replaceAll('_', ' ').replaceAll('-', ' '))) return true;
  // “Egg Bowl” and other regular-season rivalries are legitimate fixtures.
  const text = [game.name, game.title, game.notes, game.label].filter(value => typeof value === 'string').join(' ');
  return /\b(championship|playoff|(?:conference|national)\s+title)\b/i.test(text);
}

function protocolYears(protocol) {
  assert.ok(protocol?.schemaVersion === 1 && protocol.trialId === 'preseason-2027' && protocol.season === 2027,
    'Expected the frozen 2027 preseason trial protocol');
  assert.ok(shaPattern.test(protocol.engineSha256 ?? ''), 'Protocol requires an engine SHA-256 pin');
  const models = ['baseline', 'challenger'].map(key => protocol.models?.[key]);
  for (const model of models) {
    assert.ok(model && Number.isInteger(model.firstSeason) && model.firstSeason > 1900 && model.firstSeason < protocol.season);
    assert.ok(Number.isFinite(model.retention) && model.retention >= 0 && model.retention <= 1);
    assert.ok(Number.isFinite(model.marginCap) && model.marginCap > 0);
    assert.ok(Number.isFinite(model.probabilityScale) && model.probabilityScale > 0);
  }
  const first = Math.min(...models.map(model => model.firstSeason));
  return Array.from({ length: protocol.season - first }, (_, index) => first + index);
}

/** Match the historical window replay and carry its final prior into an empty target graph. */
export function fitPreseasonStrength(seasons, targetSeason, targetTeams, model, common) {
  const history = new Map(seasons.map(season => [season.year, season]));
  assert.equal(history.size, seasons.length, 'Duplicate historical season');
  assert.ok(seasons.every(season => season.year < targetSeason), 'History contains the target season or later');
  assert.ok(Number.isInteger(model.firstSeason) && model.firstSeason < targetSeason, 'Invalid historical window');
  const targetConfig = { ridge: common.ridge, retention: common.targetRetention, homeAdvantage: common.homeAdvantage,
    marginCap: DEFAULT_CONFIG.marginCap, probabilityScale: common.modelProbabilityScale };
  const historicalConfig = { ...targetConfig, retention: model.retention, marginCap: model.marginCap };
  let previous = null;
  for (let year = model.firstSeason; year < targetSeason; year++) {
    assert.ok(history.has(year), `Missing historical season ${year}`);
    previous = rankSeason(history.get(year), { config: historicalConfig, previous });
  }
  const preseason = rankSeason({ year: targetSeason, teams: targetTeams, games: [] }, { config: targetConfig, previous });
  assert.equal(preseason.gamesUsed, 0);
  return new Map(preseason.ratings.map(team => [team.id, team.strength]));
}

export function makeForecastGames(games, baselineStrength, challengerStrength, protocol) {
  const forecast = (game, ratings, model) => {
    const edge = ratings.get(game.home) - ratings.get(game.away) + (game.neutral ? 0 : protocol.common.homeAdvantage);
    assert.ok(Number.isFinite(edge), `Missing strength for ${game.id}`);
    const probability = 1 / (1 + Math.exp(-edge / model.probabilityScale));
    assert.ok(probability > 0 && probability < 1, `Invalid probability for ${game.id}`);
    return probability;
  };
  return games.map(game => ({ id: game.id, home: game.home, away: game.away, startDate: game.startDate,
    neutral: game.neutral, ...(typeof game.startTimeTbd === 'boolean' ? { startTimeTbd: game.startTimeTbd } : {}),
    baselineProbability: forecast(game, baselineStrength, protocol.models.baseline),
    challengerProbability: forecast(game, challengerStrength, protocol.models.challenger) }));
}

function prepareSchedule(schedule, season, captureTime) {
  assert.equal(schedule.year, season, 'Wrong schedule season');
  assert.ok(schedule.source && typeof schedule.source === 'object' && !Array.isArray(schedule.source), 'Schedule source provenance required');
  const retrieved = exactTime(schedule.retrievedAt, 'Schedule retrieval');
  const opening = exactTime(schedule.openingKickoff, 'Opening kickoff');
  assert.equal(new Date(opening).getUTCFullYear(), season, 'Opening kickoff is outside the trial year');
  assert.ok(retrieved <= captureTime && captureTime < opening, 'Capture must follow schedule retrieval and precede opening kickoff');
  assert.ok(Array.isArray(schedule.teams) && schedule.teams.length && Array.isArray(schedule.games) && schedule.games.length);
  const teams = schedule.teams.map(team => ({ id: team.id, name: team.name, division: team.division, conference: team.conference ?? null }));
  validateSeason({ year: season, teams, games: [] });
  assert.ok(teams.every(team => typeof team.name === 'string' && typeof team.division === 'string' &&
    (team.conference === null || typeof team.conference === 'string')), 'Invalid schedule team metadata');
  const byTeam = new Map(teams.map(team => [team.id, team]));
  const involvesFbs = game => byTeam.get(game.home)?.division === 'fbs' || byTeam.get(game.away)?.division === 'fbs';
  const openingDay = Math.floor(opening / day) * day;
  const ids = new Set();
  const excluded = { postseasonOrTitle: 0, canceled: 0, unknownParticipants: 0, nonFbsMatchup: 0, unknownVenue: 0, unassignedDate: 0 };
  const games = [];
  let openingVerified = false;
  for (const game of schedule.games) {
    assert.ok(typeof game.id === 'string' && game.id && !ids.has(game.id), 'Schedule requires unique string game IDs');
    ids.add(game.id);
    assert.ok((game.completed === undefined || game.completed === false) && game.homePoints == null &&
      game.awayPoints == null && game.regulationMargin == null && game.outcome == null && game.score == null &&
      !/^(final|completed|in progress|in_progress|live)$/i.test(game.status ?? ''),
    `Target-season result found in schedule game ${game.id}`);
    assert.ok(game.startTimeTbd === undefined || typeof game.startTimeTbd === 'boolean', `Invalid TBD flag for ${game.id}`);
    if (isPostseasonOrTitle(game)) { excluded.postseasonOrTitle++; continue; }
    if (canceled(game)) { excluded.canceled++; continue; }
    const assigned = assignedTime(game.startDate);
    const timeVerified = assigned && !assigned.dateOnly && game.startTimeTbd === false;
    const isOpening = assigned && !assigned.dateOnly && assigned.time === opening && game.startTimeTbd !== true &&
      (timeVerified || schedule.source.openingKickoffVerified === true) && involvesFbs(game) &&
      byTeam.has(game.home) && byTeam.has(game.away);
    if (assigned && involvesFbs(game)) {
      assert.ok(Math.floor(assigned.time / day) * day >= openingDay,
        `FBS fixture ${game.id} has a date before the declared opening`);
      assert.ok(!timeVerified || assigned.time >= opening, `FBS fixture ${game.id} starts before the declared opening`);
      if (isOpening) openingVerified = true;
    }
    if (!byTeam.has(game.home) || !byTeam.has(game.away) || game.home === game.away) {
      excluded.unknownParticipants++; continue;
    }
    if ([game.home, game.away].some(id => byTeam.get(id).division !== 'fbs')) { excluded.nonFbsMatchup++; continue; }
    if (typeof game.neutral !== 'boolean') { excluded.unknownVenue++; continue; }
    if (!assigned) { excluded.unassignedDate++; continue; }
    const startTimeTbd = !isOpening && (assigned.dateOnly || game.startTimeTbd !== false);
    if (startTimeTbd) {
      const scheduledDay = Math.floor(assigned.time / day) * day;
      assert.ok(scheduledDay >= openingDay && captureTime < scheduledDay, `Uncertain pre-kickoff capture for ${game.id}`);
    } else {
      assert.ok(assigned.time >= opening, `FBS fixture ${game.id} starts before the declared opening`);
    }
    games.push({ id: game.id, home: game.home, away: game.away, neutral: game.neutral,
      startDate: new Date(assigned.time).toISOString(), startTimeTbd });
  }
  assert.ok(openingVerified, 'Schedule must identify its verified exact first FBS-involving kickoff');
  assert.ok(games.length, 'Schedule contains no eligible FBS versus FBS regular-season forecasts');
  assertNoLogicalDuplicates(games.map(game => ({ ...game, completed: true })));
  games.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
  const coverage = { suppliedGames: schedule.games.length, forecastGames: games.length,
    unverifiedKickoffTimes: games.filter(game => game.startTimeTbd !== false).length, excluded };
  assert.equal(coverage.forecastGames + Object.values(excluded).reduce((sum, count) => sum + count, 0), coverage.suppliedGames);
  return { teams, games, opening, source: { ...publicProvenance(schedule.source),
    retrievedAt: new Date(retrieved).toISOString(), openingKickoffVerified: true, captureCoverage: coverage } };
}

function validateHistory(seasons, years, captureTime) {
  const history = new Map(seasons.map(season => [season.year, season]));
  assert.equal(history.size, seasons.length, 'Duplicate historical season');
  assert.deepEqual([...history.keys()].sort((a, b) => a - b), years, 'Historical years must exactly match the frozen training range');
  for (const season of seasons) {
    validateSeason(season);
    const fetchedAt = season.source?.fetchedAt ?? season.source?.retrievedAt;
    if (fetchedAt !== undefined) assert.ok(exactTime(fetchedAt, `${season.year} history retrieval`) <= captureTime, 'Historical source was retrieved after capture');
    for (const game of season.games) if (game.completed) {
      assert.ok(exactTime(game.startDate, `Historical game ${game.id} kickoff`) + day <= captureTime, `Historical result ${game.id} was not available at capture`);
    }
  }
  const lastYear = years.at(-1);
  const last = history.get(lastYear);
  const fbs = new Set(last.teams.filter(team => team.division === 'fbs').map(team => team.id));
  const fbsGames = last.games.filter(game => fbs.has(game.home) || fbs.has(game.away));
  assert.ok(fbsGames.length && fbsGames.every(game => game.completed !== canceled(game)),
    `The ${lastYear} FBS season must contain only resolved games or explicit cancellations`);
  assert.ok(fbsGames.some(game => game.completed && game.seasonType === 'postseason' && fbs.has(game.home) && fbs.has(game.away)),
    `The ${lastYear} archive requires completed FBS postseason evidence`);
  const fetched = exactTime(last.source?.fetchedAt ?? last.source?.retrievedAt, `${lastYear} archive retrieval`);
  const latestFbsFinal = Math.max(...fbsGames.filter(game => game.completed).map(game => Date.parse(game.startDate) + day));
  assert.ok(fetched >= Date.UTC(lastYear + 1, 1, 1) && fetched >= latestFbsFinal,
    `The ${lastYear} archive requires retrieval on or after February 1 and after its last included FBS result`);
}

/** Deterministic capture from explicit inputs and the capture clock supplied by the caller. */
export function buildTrialCapture(protocol, schedule, seasons, { capturedAt, sourceHashes }) {
  const years = protocolYears(protocol);
  const captureTime = exactTime(capturedAt, 'Capture time');
  assert.ok(sourceHashes && ['protocol', 'engine', 'capture', 'schedule'].every(key => shaPattern.test(sourceHashes[key] ?? '')) &&
    sourceHashes.engine === protocol.engineSha256, 'Source hashes and pinned engine required');
  assert.deepEqual(Object.keys(sourceHashes.history ?? {}).sort(), years.map(String), 'History hash years differ from the training range');
  assert.ok(years.every(year => shaPattern.test(sourceHashes.history[year])), 'Invalid historical source hash');
  const { teams, games, opening, source } = prepareSchedule(schedule, protocol.season, captureTime);
  validateHistory(seasons, years, captureTime);
  const baseline = fitPreseasonStrength(seasons, protocol.season, teams, protocol.models.baseline, protocol.common);
  const challenger = fitPreseasonStrength(seasons, protocol.season, teams, protocol.models.challenger, protocol.common);
  const artifact = { schemaVersion: 1, trialId: protocol.trialId, season: protocol.season,
    capturedAt: new Date(captureTime).toISOString(), openingKickoff: new Date(opening).toISOString(),
    source, sourceHashes, teams, games: makeForecastGames(games, baseline, challenger, protocol) };
  return { ...artifact, integritySha256: digest(JSON.stringify(artifact)) };
}

async function writeOnce(output, artifact) {
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx');
  try {
    try {
      await file.writeFile(`${JSON.stringify(artifact, null, 2)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    assert.ok(Date.now() < Date.parse(artifact.openingKickoff), 'Opening kickoff passed before the capture could be saved');
    await link(temporary, output); // Atomic publish, with EEXIST protecting any earlier capture.
  } finally {
    await unlink(temporary);
  }
}

async function main(args) {
  const usage = 'Usage: node research/preseason-trial-capture.mjs --schedule path --history-dir path --output path';
  assert.equal(args.length, 6, usage);
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) options.set(args[index], args[index + 1]);
  assert.ok(['--schedule', '--history-dir', '--output'].every(key => options.get(key) && !options.get(key).startsWith('--')), usage);
  const [protocolBytes, scheduleBytes, engineBytes, captureBytes, qualityBytes] = await Promise.all([
    readFile(protocolFile), readFile(resolve(options.get('--schedule'))), readFile(engineFile), readFile(new URL(import.meta.url)), readFile(qualityFile),
  ]);
  const protocol = JSON.parse(protocolBytes);
  const years = protocolYears(protocol);
  const engine = digest(engineBytes);
  assert.equal(engine, protocol.engineSha256, 'Strength engine differs from the frozen trial pin');
  const historyDirectory = resolve(options.get('--history-dir'));
  const histories = await Promise.all(years.map(async year => {
    const raw = await readFile(join(historyDirectory, `${year}.json`));
    const season = JSON.parse(raw);
    assert.equal(season.year, year, `Wrong season in ${year}.json`);
    return { season, sha256: digest(raw) };
  }));
  const artifact = buildTrialCapture(protocol, JSON.parse(scheduleBytes), histories.map(row => row.season), {
    capturedAt: new Date().toISOString(), sourceHashes: { protocol: digest(protocolBytes), engine,
      capture: digest(captureBytes), schedule: digest(scheduleBytes), dataQuality: digest(qualityBytes),
      history: Object.fromEntries(histories.map(row => [row.season.year, row.sha256])) },
  });
  const output = resolve(options.get('--output'));
  await writeOnce(output, artifact);
  console.log(`Captured ${artifact.games.length} forecasts at ${artifact.capturedAt}\n${output}\nSHA-256 ${artifact.integritySha256}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));
