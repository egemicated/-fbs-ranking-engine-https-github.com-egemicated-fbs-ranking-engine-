// Optional offline research capture. No network, workflow, public-pick or model writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual as same } from 'node:util';
import { predict } from '../src/engine.js';
import { crossProbability } from './cross-division-calibration.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DAY = 86400000;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const time = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const observationHash = ({ resultSha256, ...data }) => sha(JSON.stringify(data));

export function makeCrossShadow({ snapshot, weekly, frozen, inputSha256 }, capturedAt) {
  const now = time(capturedAt);
  assert.ok(Number.isFinite(now) && Number.isFinite(time(frozen.frozenAt)) && now >= time(frozen.frozenAt), 'Capture must follow the real model freeze');
  assert.equal(frozen.id, 'cross-division-calibration-shadow-v1');
  assert.equal(frozen.horizonDays, 7);
  assert.ok(same(snapshot.config, frozen.strengthConfig) && snapshot.modelVersion === frozen.modelVersion, 'Frozen baseline changed');
  const sourceAt = time(snapshot.source?.fetchedAt), asOf = time(snapshot.asOf), weeklyAt = time(weekly.asOf);
  assert.ok([sourceAt, asOf, weeklyAt].every(Number.isFinite) && sourceAt <= asOf && asOf <= weeklyAt && weeklyAt <= now, 'Invalid source chronology');
  assert.ok(hash(snapshot.snapshotHash) && hash(snapshot.source?.sha256));
  assert.equal(snapshot.source.provider, 'cfbd');
  assert.equal(weekly.schemaVersion, 1);
  assert.equal(weekly.season, snapshot.season);
  assert.equal(weekly.source.snapshotHash, snapshot.snapshotHash);
  assert.equal(weekly.source.rankingAsOf, snapshot.asOf);
  assert.equal(weekly.source.scheduleAsOf, snapshot.source.fetchedAt);
  assert.equal(weekly.source.modelVersion, snapshot.modelVersion);
  assert.equal(weekly.source.crossDivisionProbabilityScale, 14);
  assert.equal(snapshot.config.probabilityScale, 14);
  assert.ok(hash(inputSha256.snapshot) && hash(inputSha256.weekly) && hash(inputSha256.frozen));
  const selected = frozen.model;
  assert.equal(selected.family, 'temperatureDivision');
  assert.ok(Array.isArray(selected.coefficients) && selected.coefficients.length === 2 && selected.coefficients.every(Number.isFinite) && selected.coefficients[0] > 0);
  const teams = new Map(snapshot.ratings.map(row => [row.id, row]));
  const publicTeams = new Map(weekly.teams.map(row => [row.id, row]));
  const fixtures = new Map(snapshot.futureFixtures.map(game => [game.id, game]));
  assert.equal(teams.size, snapshot.ratings.length);
  assert.equal(publicTeams.size, weekly.teams.length);
  assert.equal(fixtures.size, snapshot.futureFixtures.length);
  assert.equal(new Set(weekly.games.map(game => game.id)).size, weekly.games.length);
  const forecasts = [];
  for (const game of weekly.games) {
    const home = teams.get(game.home), away = teams.get(game.away);
    if (game.status !== 'scheduled' || game.startTimeTbd !== false ||
        ![home?.division, away?.division].every(d => ['fbs', 'fcs'].includes(d)) || home.division === away.division) continue;
    const kickoff = time(game.startDate);
    if (!Number.isFinite(kickoff) || kickoff <= now || kickoff > now + frozen.horizonDays * DAY) continue;
    assert.notEqual(home.id, away.id);
    assert.equal(publicTeams.get(home.id)?.division, home.division);
    assert.equal(publicTeams.get(away.id)?.division, away.division);
    const fixture = fixtures.get(game.id);
    assert.ok(fixture && ['home', 'away', 'neutral', 'startDate', 'startTimeTbd'].every(key => fixture[key] === game[key]), 'Future fixture disagrees with the published source');
    assert.equal(typeof game.neutral, 'boolean');
    const original = predict(snapshot, game);
    const row = { homeMargin: original.homeMargin, fbsSign: home.division === 'fbs' ? 1 : -1 };
    const candidateHomeProbability = crossProbability(row, selected);
    assert.ok(Number.isFinite(candidateHomeProbability) && candidateHomeProbability > 0 && candidateHomeProbability < 1);
    forecasts.push({ gameId: game.id, week: game.week, seasonType: game.seasonType,
      home: home.id, away: away.id, homeTeam: home.name, awayTeam: away.name,
      homeDivision: home.division, awayDivision: away.division, neutral: game.neutral, kickoff: game.startDate,
      homeMargin: original.homeMargin, baselineHomeProbability: original.homeWinProbability, candidateHomeProbability });
  }
  if (!forecasts.length) return null;
  forecasts.sort((a, b) => time(a.kickoff) - time(b.kickoff) || a.gameId.localeCompare(b.gameId));
  const data = { schemaVersion: 1, protocolId: frozen.id, frozenAt: frozen.frozenAt,
    capturedAt, season: snapshot.season, sourceAsOf: snapshot.asOf, sourceFetchedAt: snapshot.source.fetchedAt,
    snapshotHash: snapshot.snapshotHash, sourceHash: snapshot.source.sha256,
    inputSha256, model: selected, forecasts,
    interpretation: 'True before-kickoff research capture using an already published cached checkpoint. Both probabilities use the SAME current Strength graph. These are new research observations, not replacements for earlier saved public picks. The cached source may precede the parameter freeze. No future outcome is used.' };
  return { ...data, resultSha256: observationHash(data) };
}

export async function saveCrossShadow(input, directory, clock = () => new Date().toISOString()) {
  const target = join(directory, `${input.snapshot.snapshotHash.slice(0, 12)}-${input.frozen.id}.json`);
  try {
    const old = JSON.parse(await readFile(target, 'utf8'));
    assert.equal(observationHash(old), old.resultSha256, 'Existing immutable capture checksum changed');
    assert.ok(same(old.inputSha256, input.inputSha256), 'Immutable capture inputs changed');
    return { created: false, path: target, observation: old };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const observation = makeCrossShadow(input, clock());
  if (!observation) return { created: false, path: null, observation: null };
  const beforeKickoff = () => {
    const now = time(clock());
    return Number.isFinite(now) && now >= time(observation.capturedAt) && observation.forecasts.every(game => now < time(game.kickoff));
  };
  assert.ok(beforeKickoff(), 'Kickoff reached before capture write');
  await mkdir(directory, { recursive: true });
  await writeFile(target, JSON.stringify(observation, null, 2) + '\n', { flag: 'wx' });
  if (!beforeKickoff()) {
    await unlink(target); // Only our exclusive new file can reach this branch.
    throw Error('Kickoff reached during capture write; no observation retained');
  }
  return { created: true, path: target, observation };
}

async function main() {
  assert.equal(process.argv.length, 2, 'No arguments supported');
  const load = async path => { const bytes = await readFile(join(ROOT, path)); return { data: JSON.parse(bytes), sha256: sha(bytes) }; };
  const snapshot = await load('published/latest.json'), weekly = await load('published/weekly-picks.json');
  const frozen = await load('research/frozen-cross-division-calibration-v1.json');
  const research = await load('research/results/division-calibration-v1/cross-division-summary.json');
  assert.equal(research.sha256, frozen.data.researchSummarySha256, 'Frozen research selection changed');
  assert.ok(same({ family: research.data.selectedModel.family, coefficients: research.data.selectedModel.coefficients }, frozen.data.model));
  assert.ok(Object.keys(frozen.data.implementationSha256).length >= 3);
  for (const [file, expected] of Object.entries(frozen.data.implementationSha256)) {
    assert.equal(sha(await readFile(join(ROOT, file))), expected, `Frozen implementation changed: ${file}`);
  }
  const result = await saveCrossShadow({ snapshot: snapshot.data, weekly: weekly.data, frozen: frozen.data,
    inputSha256: { snapshot: snapshot.sha256, weekly: weekly.sha256, frozen: frozen.sha256 } },
  join(ROOT, 'research/cross-division-calibration-observations'));
  console.log(JSON.stringify({ path: result.path, created: result.created, forecasts: result.observation?.forecasts.length ?? 0 }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
