// Offline research only. No provider access, fitting or production writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { rankSeason, predict, validateSeason } from '../src/engine.js';
import { normalizeCsv, parseCsv } from '../src/ingest.js';

const ROOT = resolve(import.meta.dirname, '..');
const DAY = 86400000;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse(await readFile(path));
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
export const logicalKey = game => [game.home, game.away].sort().join(':') + ':' + new Date(game.startDate).toISOString().slice(0, 10);
export function resolvePrimaryTeam(season, name) {
  // Explicit stable-ID alias for a retained primary fixture whose school name
  // differs from the provider's season-specific display name.
  const aliases = { 'Grambling State': '2755' };
  return season.teams.find(team => team.id === aliases[name]) ?? season.teams.find(team => team.name === name);
}
export function normalizeCachedEvent(event, year) {
  assert.equal(event.season.year, year); assert.equal(event.status.type.completed, true);
  assert.equal(event.competitions.length, 1);
  const competition = event.competitions[0], competitors = competition.competitors;
  assert.equal(competitors.length, 2); assert.equal(typeof competition.neutralSite, 'boolean');
  const home = competitors.find(team => team.homeAway === 'home'), away = competitors.find(team => team.homeAway === 'away');
  assert.ok(home && away && home !== away);
  for (const team of [home, away]) assert.match(String(team.score), /^\d+$/);
  const homePoints = Number(home.score), awayPoints = Number(away.score);
  assert.equal(home.winner, homePoints > awayPoints); assert.equal(away.winner, awayPoints > homePoints);
  assert.ok(homePoints !== awayPoints); assert.ok(Number.isInteger(event.week.number));
  assert.match(event.date, /(Z|[+-]\d\d:\d\d)$/);
  const type = event.season.type;
  assert.ok([2, 3, 5, 6].includes(type));
  if ([5, 6].includes(type)) assert.ok(year === 2020 && new Date(event.date).getUTCFullYear() === 2021 && new Date(event.date).getUTCMonth() <= 5);
  if (competition.date) assert.equal(Date.parse(competition.date), Date.parse(event.date));
  return { id: String(event.id), week: event.week.number, seasonType: [2, 5].includes(type) ? 'regular' : 'postseason',
    startDate: new Date(event.date).toISOString(), completed: true, neutral: competition.neutralSite,
    home: String(home.id), away: String(away.id), homePoints, awayPoints };
}
export function duplicateCandidates(season) {
  const groups = new Map();
  for (const game of season.games.filter(game => game.completed)) {
    const key = logicalKey(game);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(game.id);
  }
  return [...groups.values()].filter(ids => ids.length > 1);
}
export function eligibleGames(season, seen, cutoff) {
  return season.games.filter(game => game.completed && seen.has(game.id) && Date.parse(game.startDate) + DAY <= cutoff);
}
function population(home, away) {
  if (home === 'fbs' && away === 'fbs') return 'FBS-FBS';
  if (home === 'fcs' && away === 'fcs') return 'FCS-FCS';
  return new Set([home, away]).size === 2 && [home, away].every(division => ['fbs', 'fcs'].includes(division)) ? 'FBS-FCS' : null;
}

export function replay(seasons, config, evaluateYears) {
  let previous = null, previousLatest = -Infinity;
  const predictions = [], checkpoints = [];
  for (const season of [...seasons].sort((a, b) => a.year - b.year)) {
    const teams = new Map(season.teams.map(team => [team.id, team]));
    const weeks = new Map();
    for (const game of season.games.filter(game => game.completed)) {
      const key = `${game.seasonType}:${game.week}`;
      if (!weeks.has(key)) weeks.set(key, []);
      weeks.get(key).push(game);
    }
    const groups = [...weeks.values()].map(targets => ({ targets, cutoff: Math.min(...targets.map(game => Date.parse(game.startDate))) }))
      .sort((a, b) => a.cutoff - b.cutoff);
    const seen = new Set();
    for (const { targets, cutoff } of groups) {
      if (evaluateYears.includes(season.year)) {
        assert.ok(previousLatest + DAY <= cutoff, `Prior season contains unavailable result before ${season.year}`);
        const available = eligibleGames(season, seen, cutoff);
        const ids = new Set(available.map(game => game.id));
        assert.ok(targets.every(game => !ids.has(game.id)), 'Target result entered a training graph');
        const snapshot = rankSeason(season, { config, previous, gameIds: ids });
        assert.equal(snapshot.gamesUsed, ids.size);
        checkpoints.push({ season: season.year, group: `${targets[0].seasonType}:${targets[0].week}`, cutoff: new Date(cutoff).toISOString(),
          trainingGames: ids.size, latestTrainingKickoff: available.length ? new Date(Math.max(...available.map(game => Date.parse(game.startDate)))).toISOString() : null });
        for (const game of targets) {
          const home = teams.get(game.home), away = teams.get(game.away), division = population(home.division, away.division);
          if (!division || game.homePoints === game.awayPoints) continue;
          predictions.push({ season: season.year, gameId: game.id, home: game.home, away: game.away,
            startDate: game.startDate, neutral: game.neutral, division, homeConference: home.conference ?? 'Unknown', awayConference: away.conference ?? 'Unknown',
            group: `${season.year}:${game.seasonType}:${game.week}`, outcome: Number(game.homePoints > game.awayPoints),
            actualMargin: game.homePoints - game.awayPoints, ...predict(snapshot, game) });
        }
      }
      for (const game of targets) seen.add(game.id);
    }
    previous = rankSeason(season, { config, previous });
    previousLatest = Math.max(...season.games.filter(game => game.completed).map(game => Date.parse(game.startDate)));
  }
  return { predictions, checkpoints, finalSnapshot: previous };
}

export function metrics(rows, scales, calibrated = false) {
  if (!rows.length) return { games: 0, accuracy: null, brier: null, logLoss: null, marginMAE: null, calibrationError10Bins: null, meanProbabilityError: null, reliability: [] };
  const bins = Array.from({ length: 10 }, (_, index) => ({ lower: index / 10, upper: (index + 1) / 10, games: 0, probabilitySum: 0, wins: 0 }));
  const values = rows.map(row => {
    const scale = calibrated ? scales[row.division] : scales.baseline;
    const p = 1 / (1 + Math.exp(-row.homeMargin / scale)), y = row.outcome;
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.games++; bin.probabilitySum += p; bin.wins += y;
    return { accuracy: p === 0.5 ? 0.5 : Number((p > 0.5) === Boolean(y)), brier: (p - y) ** 2,
      logLoss: -Math.log(Math.max(1e-12, y ? p : 1 - p)), error: p - y, marginError: Math.abs(row.homeMargin - row.actualMargin) };
  });
  return { games: rows.length, accuracy: mean(values.map(row => row.accuracy)), brier: mean(values.map(row => row.brier)),
    logLoss: mean(values.map(row => row.logLoss)), marginMAE: mean(values.map(row => row.marginError)),
    calibrationError10Bins: bins.reduce((sum, bin) => sum + Math.abs(bin.probabilitySum - bin.wins), 0) / rows.length,
    meanProbabilityError: mean(values.map(row => row.error)),
    reliability: bins.filter(bin => bin.games).map(bin => ({ lower: bin.lower, upper: bin.upper, games: bin.games,
      meanProbability: bin.probabilitySum / bin.games, actualHomeWinRate: bin.wins / bin.games })) };
}

export function sameSupport(original, candidate) {
  const byId = new Map(candidate.map(row => [`${row.season}:${row.gameId}`, row]));
  const originalIds = new Set(original.map(row => `${row.season}:${row.gameId}`));
  const paired = original.map(row => {
    const other = byId.get(`${row.season}:${row.gameId}`);
    assert.ok(other, `Candidate lost target ${row.gameId}`);
    for (const key of ['outcome', 'home', 'away', 'division']) assert.equal(row[key], other[key], `Comparison changed target ${key}: ${row.gameId}`);
    // Independently adjudicated winner-preserving absolute-score corrections
    // supply the same target margin to both forecasts in the paired comparison.
    return [{ ...row, actualMargin: other.actualMargin }, other];
  });
  return { paired, candidateOnly: candidate.filter(row => !originalIds.has(`${row.season}:${row.gameId}`)),
    correctedTargetScores: original.filter(row => row.actualMargin !== byId.get(`${row.season}:${row.gameId}`)?.actualMargin)
      .map(row => ({ season: row.season, gameId: row.gameId, originalMargin: row.actualMargin, correctedMargin: byId.get(`${row.season}:${row.gameId}`).actualMargin })) };
}
export function pairedSensitivity(pairs, scales, calibrated, replicates = 2000, seed = 20261118) {
  if (!pairs.length) return null;
  const blocks = new Map();
  for (const [original, candidate] of pairs) {
    const a = metrics([original], scales, calibrated), b = metrics([candidate], scales, calibrated);
    if (!blocks.has(original.group)) blocks.set(original.group, { games: 0, accuracy: 0, brier: 0, logLoss: 0 });
    const block = blocks.get(original.group); block.games++;
    for (const key of ['accuracy', 'brier', 'logLoss']) block[key] += b[key] - a[key];
  }
  const values = [...blocks.values()], distributions = { accuracy: [], brier: [], logLoss: [] };
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (let repetition = 0; repetition < replicates; repetition++) {
    const sums = { games: 0, accuracy: 0, brier: 0, logLoss: 0 };
    for (let i = 0; i < values.length; i++) {
      const sample = values[Math.floor(random() * values.length)];
      for (const key of Object.keys(sums)) sums[key] += sample[key];
    }
    for (const key of Object.keys(distributions)) distributions[key].push(sums[key] / sums.games);
  }
  return { blocks: values.length, replicates, seed, candidateMinusOriginal: Object.fromEntries(Object.entries(distributions).map(([key, values]) => {
    values.sort((a, b) => a - b);
    const difference = [...blocks.values()].reduce((sum, block) => sum + block[key], 0) / pairs.length;
    return [key, { difference, sensitivity95: [values[Math.floor(replicates * 0.025)], values[Math.floor(replicates * 0.975)]] }];
  })) };
}

function summarize(season) {
  const completed = season.games.filter(game => game.completed), teams = new Map(season.teams.map(team => [team.id, team]));
  const appearances = new Map();
  for (const game of completed) for (const id of [game.home, game.away]) appearances.set(id, (appearances.get(id) ?? 0) + 1);
  return { recorded: season.games.length, completed: completed.length, regularCompleted: completed.filter(game => game.seasonType === 'regular').length,
    providerLabeledPostseason: completed.filter(game => game.seasonType === 'postseason').length,
    fbsInvolving: completed.filter(game => [game.home, game.away].some(id => teams.get(id).division === 'fbs')).length,
    fbsFbs: completed.filter(game => [game.home, game.away].every(id => teams.get(id).division === 'fbs')).length,
    fbsFcs: completed.filter(game => population(teams.get(game.home).division, teams.get(game.away).division) === 'FBS-FCS').length,
    fcsFcs: completed.filter(game => [game.home, game.away].every(id => teams.get(id).division === 'fcs')).length,
    unknownTeams: season.teams.filter(team => team.division === 'unknown').length,
    sourceFbsTeams: season.teams.filter(team => team.division === 'fbs').length,
    fcsTeamsWithAtMostOneGame: season.teams.filter(team => team.division === 'fcs' && (appearances.get(team.id) ?? 0) <= 1).map(team => ({ id: team.id, name: team.name })),
    logicalDuplicateCandidates: duplicateCandidates(season) };
}

function matchFixture(season, winnerId, loserId, score, year) {
  const candidates = season.games.filter(game => game.completed && [game.home, game.away].includes(winnerId) && [game.home, game.away].includes(loserId))
    .filter(game => { const date = new Date(game.startDate); return year === 2020 ? date.getUTCFullYear() === 2021 && date.getUTCMonth() <= 5 :
      (date.getUTCFullYear() === year && date.getUTCMonth() >= 10) || (date.getUTCFullYear() === year + 1 && date.getUTCMonth() === 0); });
  const exact = candidates.filter(game => (game.home === winnerId ? game.homePoints : game.awayPoints) === score[0] &&
    (game.home === loserId ? game.homePoints : game.awayPoints) === score[1]);
  return { status: exact.length === 1 ? 'exact' : exact.length > 1 ? 'ambiguous' : candidates.length ? 'scoreConflict' : 'missing',
    gameId: exact.length === 1 ? exact[0].id : null, candidateIds: candidates.map(game => game.id) };
}

async function loadRelease(version) {
  const metadata = await readJson(join(ROOT, 'research/releases', `${version}.metadata.json`));
  const raw = await readFile(join(ROOT, 'research/releases', `${version}.json.gz`));
  assert.equal(sha(raw), metadata.sha256, `${version} release checksum mismatch`);
  return { metadata, release: JSON.parse(gunzipSync(raw)) };
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    'data-dir': { type: 'string', default: 'data' },
    'repaired-dir': { type: 'string', default: 'research/datasets/historical-coverage-v1/seasons' },
    'fcs-dir': { type: 'string', default: 'research/datasets/fcs-coverage-v1/seasons' },
    'cache-dir': { type: 'string', default: 'research/cache' },
    'output-dir': { type: 'string', default: 'research/results/historical-foundation-v1' },
  } });
  const paths = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, resolve(value)]));
  const output = paths['output-dir'];
  assert.ok(output.startsWith(join(ROOT, 'research/results') + '\\') || output.startsWith(join(ROOT, 'research/results') + '/') || output === join(ROOT, 'research/results'), 'Output must stay in research/results');
  const protocol = await readJson(join(ROOT, 'research/historical-foundation-protocol.json'));
  const config = await readJson(join(ROOT, 'data/model.json'));
  const fbsCalibration = await readJson(join(ROOT, 'data/matchup-validation.json'));
  const fcsCalibration = await readJson(join(ROOT, 'data/fcs-matchup-validation.json'));
  assert.deepEqual(config, fbsCalibration.strengthConfig); assert.deepEqual(config, fcsCalibration.strengthConfig);
  const scales = { baseline: config.probabilityScale, 'FBS-FBS': fbsCalibration.winProbability.scale, 'FCS-FCS': fcsCalibration.scale, 'FBS-FCS': config.probabilityScale };
  const historical = await loadRelease('historical-coverage-v1'), fcs = await loadRelease('fcs-coverage-v1');
  const sourceLineage = {}, original = [], repaired = [], supplemented = [], duplicateOnly = [];
  const protectedPaths = ['src/engine.js', 'src/history.js', 'data/model.json', 'data/matchup-validation.json', 'data/fcs-matchup-validation.json', 'published/prior-2025.json', 'published/latest.json'];
  const protectedHashes = Object.fromEntries(await Promise.all(protectedPaths.map(async path => [path, sha(await readFile(join(ROOT, path)))])));
  const sourceChecks = [], fbsEvents = new Map(), fcsEvents = new Map();
  for (const source of historical.release.manifest.scoreboardSources) {
    const raw = await readFile(join(paths['cache-dir'], `espn-month-${source.year}.json`));
    assert.equal(sha(raw), source.sha256, `Cached FBS source changed: ${source.year}`);
    const payload = JSON.parse(raw); assert.ok(payload.events.length < 1000, 'Potential FBS source truncation');
    fbsEvents.set(Number(source.year), new Map(payload.events.map(event => [String(event.id), event])));
    sourceChecks.push({ file: `espn-month-${source.year}.json`, sha256: source.sha256, url: source.url, retrievedAt: source.retrievedAt ?? null });
  }
  const legacyRaw = await readFile(join(paths['cache-dir'], 'cfb_games_info.csv'));
  assert.equal(sha(legacyRaw), historical.release.manifest.legacySource.sha256);
  const legacyById = new Map(parseCsv(legacyRaw.toString('utf8')).filter(row => row.season_type === 'postseason').map(row => [row.game_id, row]));
  sourceChecks.push({ file: 'cfb_games_info.csv', ...historical.release.manifest.legacySource });
  for (const source of fcs.release.manifest.sources) {
    const raw = await readFile(join(paths['cache-dir'], 'fcs-history', source.file));
    assert.equal(sha(raw), source.sha256, `Cached FCS source changed: ${source.file}`);
    const payload = JSON.parse(raw); assert.ok(payload.events.length < 1000, 'Potential FCS source truncation');
    fcsEvents.set(source.file, new Map(payload.events.map(event => [String(event.id), event])));
    sourceChecks.push({ file: `fcs-history/${source.file}`, sha256: source.sha256, url: source.url, retrievedAt: source.retrievedAt ?? null });
  }
  const addedSourceChecks = {};
  for (let year = protocol.historyStart; year <= protocol.historyEnd; year++) {
    const patch = historical.release.seasons[year], fcsPatch = fcs.release.seasons[year];
    const parentRaw = await readFile(join(paths['data-dir'], 'seasons', `${year}.json`));
    const repairedRaw = await readFile(join(paths['repaired-dir'], `${year}.json`));
    assert.equal(sha(parentRaw), patch.parentSha256, `Original ${year} checksum mismatch`);
    assert.equal(sha(repairedRaw), patch.outputSha256, `Repaired ${year} checksum mismatch`);
    const a = validateSeason(JSON.parse(parentRaw)), b = validateSeason(JSON.parse(repairedRaw));
    const raw = await readFile(join(paths['data-dir'], 'raw', `${year}.csv`), 'utf8');
    assert.equal(sha(raw), a.source.sha256, `Raw source ${year} checksum mismatch`);
    const normalized = normalizeCsv(raw, year, a.source);
    assert.deepEqual(normalized.teams, a.teams); assert.deepEqual(normalized.games, a.games);
    assert.deepEqual(a.teams, b.teams);
    const originalById = new Map(a.games.map(game => [game.id, game])), fixedById = new Map(b.games.map(game => [game.id, game]));
    for (const [id, game] of originalById) if (!patch.removeIds.includes(id)) assert.deepEqual(fixedById.get(id), game, `Unlisted original change in ${year}/${id}`);
    const sourceEvidence = { fbsAddedFieldsMatchCachedEvent: 0, fbsScoresCorroboratedByLegacyArchive: 0, fbsAddedWithoutLegacyScore: [], fcsAddedFieldsMatchCachedEvent: 0 };
    for (const game of patch.addGames) {
      assert.deepEqual(fixedById.get(game.id), game);
      const sourceMonth = historical.release.manifest.seasons[year].added.find(row => row.id === game.id).sourceMonth;
      const event = fbsEvents.get(sourceMonth)?.get(game.id); assert.ok(event, `Missing addition source event ${year}/${game.id}`);
      assert.equal(event.season.type, 3);
      const normalized = normalizeCachedEvent(event, year);
      assert.deepEqual(normalized, { ...game, startDate: new Date(game.startDate).toISOString() });
      assert.ok([game.home, game.away].every(id => a.teams.find(team => team.id === id)?.division === 'fbs'));
      sourceEvidence.fbsAddedFieldsMatchCachedEvent++;
      const legacy = legacyById.get(game.id);
      if (legacy && !['NA', ''].includes(legacy.home_points) && !['NA', ''].includes(legacy.away_points)) {
        assert.deepEqual({ [legacy.home_id]: Number(legacy.home_points), [legacy.away_id]: Number(legacy.away_points) }, { [game.home]: game.homePoints, [game.away]: game.awayPoints });
        sourceEvidence.fbsScoresCorroboratedByLegacyArchive++;
      } else sourceEvidence.fbsAddedWithoutLegacyScore.push(game.id);
    }
    let c = b, fcsHash = null;
    if (fcsPatch) {
      assert.equal(sha(repairedRaw), fcsPatch.parentSha256);
      const bytes = await readFile(join(paths['fcs-dir'], `${year}.json`)); fcsHash = sha(bytes);
      assert.equal(fcsHash, fcsPatch.outputSha256, `FCS supplement ${year} checksum mismatch`);
      c = validateSeason(JSON.parse(bytes)); assert.deepEqual(c.teams, b.teams);
      const candidateById = new Map(c.games.map(game => [game.id, game]));
      for (const game of b.games) {
        const expected = structuredClone(game), correction = fcsPatch.scoreCorrections?.find(value => value.id === game.id);
        if (correction) {
          for (const [field, value] of Object.entries(correction.expected)) assert.deepEqual(expected[field], value);
          assert.ok(Object.keys(correction.correctedScores).every(field => ['homePoints', 'awayPoints'].includes(field)));
          Object.assign(expected, correction.correctedScores);
        }
        assert.deepEqual(candidateById.get(game.id), expected, `Unlisted FCS change ${year}/${game.id}`);
      }
      for (const game of fcsPatch.addGames) {
        assert.deepEqual(candidateById.get(game.id), game);
        const sources = fcs.release.manifest.seasons[year].added.find(row => row.id === game.id).sources;
        for (const source of sources) {
          const event = fcsEvents.get(source)?.get(game.id); assert.ok(event, `Missing FCS addition source event ${game.id}/${source}`);
          assert.deepEqual(normalizeCachedEvent(event, year), game);
        }
        sourceEvidence.fcsAddedFieldsMatchCachedEvent++;
      }
    }
    original.push(a); repaired.push(b); supplemented.push(c);
    duplicateOnly.push({ ...a, games: a.games.filter(game => !patch.removeIds.includes(game.id)) });
    sourceLineage[year] = { originalSha256: sha(parentRaw), rawSourceSha256: sha(raw), repairedSha256: sha(repairedRaw), fcsSupplementSha256: fcsHash };
    addedSourceChecks[year] = sourceEvidence;
  }
  const primaryPath = join(ROOT, 'research/results/round2/primary-fcs-checks.json.gz');
  const primaryRaw = await readFile(primaryPath), primaryMeta = await readJson(primaryPath.replace('.json.gz', '.metadata.json'));
  assert.equal(sha(primaryRaw), primaryMeta.compressedSha256);
  const primary = JSON.parse(gunzipSync(primaryRaw));
  const ncaa = primary.semanticCoverageCrosschecks.find(check => check.datasetVersion === 'fcs-coverage-v1');
  const otherPrimary = primary.otherPostseasonSemanticCrosschecks.find(check => check.datasetVersion === 'fcs-coverage-v1');
  const official = await readJson(join(ROOT, 'research/official-spot-checks.json'));
  const exceptions = await readJson(join(ROOT, 'research/primary-historical-exceptions-2026-11-18.json'));
  const coverage = [], primaryChecks = [];
  for (let index = 0; index < original.length; index++) {
    const year = original[index].year, patch = historical.release.seasons[year], manifest = historical.release.manifest.seasons[year], fcsManifest = fcs.release.manifest.seasons[year];
    const verification = {};
    for (const [name, season] of [['original', original[index]], ['historical-coverage-v1', repaired[index]], ['fcs-coverage-v1', supplemented[index]]]) {
      const verifiedIds = new Set(), checks = [];
      const seasonChecks = ncaa.seasons.find(item => item.season === year)?.checks ?? [];
      for (const fixture of seasonChecks) {
        const result = matchFixture(season, fixture.winnerId, fixture.loserId, fixture.expectedScore, year);
        checks.push({ category: 'NCAA tournament', winner: fixture.winner, loser: fixture.loser, expectedScore: fixture.expectedScore, ...result });
        if (result.gameId) verifiedIds.add(result.gameId);
      }
      for (const fixture of otherPrimary.checks.filter(item => item.season === year)) {
        const winner = resolvePrimaryTeam(season, fixture.winner), loser = resolvePrimaryTeam(season, fixture.loser);
        if (year !== 2020) assert.ok(winner && loser, `Unresolved primary fixture team identity ${fixture.winner}/${fixture.loser}`);
        const result = matchFixture(season, winner?.id, loser?.id, fixture.expectedScore, year);
        checks.push({ category: fixture.category, winner: fixture.winner, loser: fixture.loser, expectedScore: fixture.expectedScore, ...result });
        if (result.gameId) verifiedIds.add(result.gameId);
      }
      for (const fixture of official.sources.filter(item => item.season === year && item.kind === 'archive_full_scores')) {
        const team = season.teams.find(item => item.name === fixture.team);
        for (const result of fixture.games) {
          const opponent = season.teams.find(item => item.name === result.opponent);
          const matches = season.games.filter(game => game.completed && [game.home, game.away].includes(team?.id) && [game.home, game.away].includes(opponent?.id))
            .filter(game => (game.home === team.id ? game.homePoints : game.awayPoints) === result.pointsFor && (game.home === opponent.id ? game.homePoints : game.awayPoints) === result.pointsAgainst);
          assert.equal(matches.length, 1, `Primary school score mismatch ${fixture.team}/${result.opponent}`);
          verifiedIds.add(matches[0].id);
        }
      }
      const inactivePrograms = [];
      for (const fixture of exceptions.selectedInactivePrograms.filter(item => item.season === year)) {
        const recorded = season.games.filter(game => game.completed && [game.home, game.away].includes(fixture.teamId));
        const result = { team: fixture.team, expectedPlayedGames: fixture.expectedPlayedGames, recordedGames: recorded.length,
          countGap: fixture.expectedPlayedGames - recorded.length, independentlyVerifiedScores: 0, knownMissingFixtureGames: [], sourceUrl: fixture.sourceUrl };
        for (const game of fixture.games ?? []) {
          const matches = recorded.filter(row => [row.home, row.away].includes(game.opponentId) && row.startDate.slice(0, 10) === game.date);
          if (!matches.length) result.knownMissingFixtureGames.push(game);
          else {
            assert.equal(matches.length, 1);
            const row = matches[0];
            assert.equal(row.home === fixture.teamId ? row.homePoints : row.awayPoints, game.pointsFor);
            assert.equal(row.home === fixture.teamId ? row.awayPoints : row.homePoints, game.pointsAgainst);
            result.independentlyVerifiedScores++; verifiedIds.add(row.id);
          }
        }
        inactivePrograms.push(result);
      }
      verification[name] = { independentExactScoreGames: verifiedIds.size, verifiedGameIds: [...verifiedIds].sort(),
        knownCategoryMissing: checks.filter(check => check.status === 'missing').length,
        primaryScoreConflicts: checks.filter(check => check.status === 'scoreConflict').length,
        ncaaExpected: seasonChecks.length, ncaaExact: checks.filter(check => check.category === 'NCAA tournament' && check.status === 'exact').length, inactivePrograms };
      primaryChecks.push({ year, dataset: name, checks });
    }
    coverage.push({ year, original: summarize(original[index]), historicalRepaired: summarize(repaired[index]), fcsSupplemented: summarize(supplemented[index]),
      independentVerification: verification, addedFbsPostseason: patch.addGames.length, removedDuplicateOccurrences: patch.removeIds.length,
      addedFcsGames: fcs.release.seasons[year]?.addGames.length ?? 0, correctedFcsScores: fcs.release.seasons[year]?.scoreCorrections?.length ?? 0,
      remainingMissingTotal: null, knownMissingOriginalFbsPostseason: patch.addGames.length,
      knownMissingInactiveProgramFixtures: verification.original.inactivePrograms.reduce((sum, item) => sum + item.knownMissingFixtureGames.length, 0),
      knownAdditionalMissing2020Nmsu: year === 2020 ? exceptions.season2020.knownMissingGames.length : 0,
      sourceDiscrepancies: { fbsScoreConflicts: manifest.crossSourceConflicts, fbsOrientationDifferences: manifest.orientationDifferences,
        supplementalProviderDuplicateResolutions: manifest.crossArchiveDuplicateResolutions, fcsExistingConflicts: fcsManifest?.existingConflicts ?? [],
        fcsSourceConflicts: fcsManifest?.sourceConflicts ?? [] },
      classificationAndMembership: 'Source-designated season roster retained; conference/subdivision fields not independently certified for every program; no absent program inferred to have a missing played schedule',
      sourceAdditionChecks: addedSourceChecks[year], lineage: sourceLineage[year] });
  }
  const variants = { original, 'duplicate-only': duplicateOnly, 'historical-coverage-v1': repaired, 'fcs-coverage-v1': supplemented, 'original-start-2014': original.filter(season => season.year >= 2014) };
  const replays = {};
  for (const [name, seasons] of Object.entries(variants)) {
    console.log(`Replaying ${name} with frozen settings`);
    replays[name] = replay(seasons, config, protocol.evaluationSeasons);
  }
  const prior = await readJson(join(ROOT, 'published/prior-2025.json'));
  const originalPrior = new Map(replays.original.finalSnapshot.ratings.map(team => [team.id, team.strength]));
  assert.equal(prior.ratings.length, originalPrior.size);
  for (const team of prior.ratings) assert.ok(Math.abs(team.strength - originalPrior.get(team.id)) <= 1e-9, 'Original prior did not reproduce');
  const comparison = {};
  for (const [name, replayed] of Object.entries(replays)) {
    const support = sameSupport(replays.original.predictions, replayed.predictions);
    const compare = (pairs, includeUncertainty = false) => Object.fromEntries([false, true].map(calibrated => [calibrated ? 'frozenCalibrated' : 'baselineScale14', {
      original: metrics(pairs.map(pair => pair[0]), scales, calibrated), candidate: metrics(pairs.map(pair => pair[1]), scales, calibrated),
      ...(includeUncertainty && name !== 'original' ? { pairedSensitivity: pairedSensitivity(pairs, scales, calibrated, protocol.uncertainty.replicates, protocol.uncertainty.seed) } : {}) }]));
    const conferences = [...new Set(support.paired.flatMap(([row]) => [row.homeConference, row.awayConference]))].sort();
    comparison[name] = { ownTargetGames: replayed.predictions.length, candidateOnlyTargets: support.candidateOnly, correctedTargetScores: support.correctedTargetScores,
      byDivision: Object.fromEntries(['FBS-FBS', 'FBS-FCS', 'FCS-FCS'].map(division => [division, compare(support.paired.filter(([row]) => row.division === division), true)])),
      previousFbsComparison2023to2025: compare(support.paired.filter(([row]) => row.division === 'FBS-FBS' && protocol.previouslyReportedEvaluationSeasons.includes(row.season)), true),
      bySeason: Object.fromEntries(protocol.evaluationSeasons.map(year => [year, Object.fromEntries(['FBS-FBS', 'FBS-FCS', 'FCS-FCS'].map(division => [division,
        compare(support.paired.filter(([row]) => row.season === year && row.division === division))]))])),
      byConference: Object.fromEntries(conferences.map(conference => [conference, Object.fromEntries(['FBS-FBS', 'FBS-FCS', 'FCS-FCS'].map(division => [division,
        compare(support.paired.filter(([row]) => row.division === division && [row.homeConference, row.awayConference].includes(conference)))]))])) };
  }
  const omitted2020 = original.find(season => season.year === 2019).teams.filter(team => team.division === 'fbs' && original.find(season => season.year === 2021).teams.some(other => other.id === team.id && other.division === 'fbs') && !original.find(season => season.year === 2020).teams.some(other => other.id === team.id));
  const saved = fbsCalibration.winProbability, repeated = comparison.original.previousFbsComparison2023to2025;
  assert.equal(repeated.baselineScale14.original.games, saved.evaluation.games);
  for (const [actual, expected] of [[repeated.baselineScale14.original.brier, saved.evaluation.baselineBrier],
    [repeated.baselineScale14.original.logLoss, saved.evaluation.baselineLogLoss],
    [repeated.frozenCalibrated.original.brier, saved.evaluation.brier], [repeated.frozenCalibrated.original.logLoss, saved.evaluation.logLoss]]) {
    assert.ok(Math.abs(actual - expected) < 1e-12, 'Existing saved FBS validation baseline did not reproduce');
  }
  for (const season of original) assert.equal(sha(await readFile(join(paths['data-dir'], 'seasons', `${season.year}.json`))), sourceLineage[season.year].originalSha256);
  for (const path of protectedPaths) assert.equal(sha(await readFile(join(ROOT, path))), protectedHashes[path], `Protected production file changed during audit: ${path}`);
  const implementationHashes = Object.fromEntries(await Promise.all(['research/historical_foundation.mjs', 'research/report_historical_foundation.mjs', 'research/historical-foundation-protocol.json', 'research/primary-historical-exceptions-2026-11-18.json', 'research/official-spot-checks.json', 'research/duplicate-adjudications.json', 'src/engine.js', 'src/history.js', 'src/ingest.js'].map(async path => [path, sha(await readFile(join(ROOT, path)))])));
  const result = { status: 'Offline research. No production input, model parameter, prior, publication or ranking change.', protocol, config, scales,
    releaseChecksums: { historical: historical.metadata.sha256, fcs: fcs.metadata.sha256, independentFcsFixture: sha(primaryRaw) },
    implementationHashes, sourceLineage, cachedSourceChecks: sourceChecks, protectedHashes,
    originalPriorReproducedTolerance: 1e-9, sourceNormalizationChecksPassed: original.length, coverage, primaryChecks, comparison,
    checkpoints: Object.fromEntries(Object.entries(replays).map(([name, value]) => [name, value.checkpoints])),
    predictions: Object.fromEntries(Object.entries(replays).map(([name, value]) => [name, value.predictions])),
    residual2020: { sourceRosterOmissionsAgainstAdjacentYears: omitted2020, ...exceptions.season2020 },
    provenance: { independentFcsSources: primary.source, schoolFixtures: official.sources.filter(source => source.kind === 'archive_full_scores'),
      duplicateAdjudications: await readJson(join(ROOT, 'research/duplicate-adjudications.json')),
      caveat: 'Raw checksum/import agreement establishes integrity; ESPN/SportsDataverse/cfbfastR agreement is not independent verification. Independent exact-score counts cover only explicit primary fixtures; a zero means unchecked, not incorrect.' },
    limitations: ['Retrospective source corrections may not have been known before kickoff; the replay prevents result leakage within the retained archive but cannot certify actual historical information availability.',
      'Previously examined evaluation seasons and a protocol declared after earlier results prevent an untouched-holdout claim. No settings were fitted or selected here.',
      'Source-designated conference/subdivision fields are not a complete independently certified membership registry, including inactive programs and transitions.',
      'Known missing primary-fixture games are a lower bound; exact all-season missing totals remain unknown. Spring2020 NCAA tournament and SWAC gaps remain, and New Mexico State has two missing spring results.',
      'FCS tournament checks cannot certify complete regular-season context. Provider regular/postseason labels differ from semantic tournament identity.',
      'Calibration scales were fitted previously using different archive/prior conventions; applying them unchanged isolates data sensitivity and is not a new calibration validation.',
      'Conference slices overlap; sparse slices and block resampling with shared teams limit uncertainty interpretation. FBS-FCS probabilities remain uncalibrated.',
      'No pre2004 source archive was ingested. Original-start-2014 only tests truncation of existing history; it does not establish the utility of older historical eras.'],
    cfbdCalls: 0, productionChanges: false };
  await mkdir(output, { recursive: true });
  const encoded = Buffer.from(JSON.stringify(result) + '\n'), compressed = gzipSync(encoded);
  await writeFile(join(output, 'audit.json.gz'), compressed);
  await writeFile(join(output, 'audit.metadata.json'), JSON.stringify({ protocol: protocol.id, compressedSha256: sha(compressed), uncompressedSha256: sha(encoded),
    compressedBytes: compressed.length, uncompressedBytes: encoded.length, implementationHashes, sourceLineage, protectedHashes, productionChanges: false, cfbdCalls: 0 }, null, 2) + '\n');
  const headers = ['season', 'originalRecorded', 'originalCompleted', 'repairedCompleted', 'fcsSupplementCompleted', 'independentlyVerifiedOriginalScores', 'independentlyVerifiedSupplementScores', 'knownMissingOriginalFbsPostseason', 'knownMissingOriginalPrimaryFcs', 'knownMissingSupplementPrimaryFcs', 'knownMissingInactiveProgramFixtures', 'additionalKnownMissingNmsu', 'duplicateOccurrencesRemoved', 'originalLabeledPostseason', 'repairedLabeledPostseason', 'fcsExistingSourceDiscrepancies', 'allSeasonMissingTotal'];
  const lines = coverage.map(row => [row.year, row.original.recorded, row.original.completed, row.historicalRepaired.completed, row.fcsSupplemented.completed,
    row.independentVerification.original.independentExactScoreGames, row.independentVerification['fcs-coverage-v1'].independentExactScoreGames,
    row.addedFbsPostseason, row.independentVerification.original.knownCategoryMissing, row.independentVerification['fcs-coverage-v1'].knownCategoryMissing,
    row.knownMissingInactiveProgramFixtures, row.knownAdditionalMissing2020Nmsu, row.removedDuplicateOccurrences, row.original.providerLabeledPostseason, row.historicalRepaired.providerLabeledPostseason,
    row.sourceDiscrepancies.fcsExistingConflicts.length, 'unknown'].join(','));
  await writeFile(join(output, 'season-coverage.csv'), [headers.join(','), ...lines].join('\n') + '\n');
  const brief = row => Object.fromEntries(['games', 'accuracy', 'brier', 'logLoss', 'calibrationError10Bins'].map(key => [key, row[key]]));
  console.log(JSON.stringify({ output, rawNormalizationChecks: original.length, releasesVerified: true,
    independentScoresAfterSupplement: coverage.reduce((sum, row) => sum + row.independentVerification['fcs-coverage-v1'].independentExactScoreGames, 0),
    previousFbsBaseline: brief(comparison.original.previousFbsComparison2023to2025.baselineScale14.original),
    previousFbsRepaired: brief(comparison['historical-coverage-v1'].previousFbsComparison2023to2025.baselineScale14.candidate),
    supplementedDivisions: Object.fromEntries(Object.entries(comparison['fcs-coverage-v1'].byDivision).map(([division, mappings]) => [division,
      { original: brief(mappings.frozenCalibrated.original), candidate: brief(mappings.frozenCalibrated.candidate) }])) }, null, 2));
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
