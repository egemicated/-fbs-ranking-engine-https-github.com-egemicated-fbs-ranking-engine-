import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { atomicJson } from '../src/ingest.js';
import {
  availabilitySources, buildAvailabilitySchedule, fetchOfficialAvailability, mergeAvailability,
  parseOfficialAvailability, planAvailabilityChecks,
} from '../src/player-availability.js';

const { values: options } = parseArgs({
  options: {
    mode: { type: 'string', default: 'nightly' },
    'output-dir': { type: 'string', default: 'published/team-availability' },
    'source-dir': { type: 'string' },
    at: { type: 'string' },
  },
});
if (options.at && !options['source-dir']) throw new Error('--at requires a saved --source-dir');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readArtifacts(directory, teamIds) {
  const artifacts = await Promise.all([...teamIds].map(async teamId => {
    try {
      return [teamId, await readJson(join(directory, `${teamId}.json`))];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return null;
    }
  }));
  return new Map(artifacts.filter(Boolean));
}

const now = options.at ?? new Date().toISOString();
const schedule = buildAvailabilitySchedule(await readJson('published/weekly-picks.json'));
const initialJobs = planAvailabilityChecks(schedule, new Map(), { now, mode: options.mode });
const teamIdsFor = jobs => new Set([...jobs.values()].flatMap(games => games.flatMap(game => [game.home.id, game.away.id])));
const previous = await readArtifacts(options['output-dir'], teamIdsFor(initialJobs));
const checks = planAvailabilityChecks(schedule, previous, { now, mode: options.mode });

if (checks.size === 0) {
  console.log('No official availability reports are due.');
} else {
  const rosters = await readArtifacts('published/team-players', teamIdsFor(checks));
  const conferences = [...checks.entries()];
  const results = await Promise.allSettled(conferences.map(async ([conference, games]) => {
    const { code } = availabilitySources[conference];
    const payload = options['source-dir']
      ? await readJson(join(options['source-dir'], `${code}-publish.json`))
      : await fetchOfficialAvailability(conference);
    const checkedAt = options.at ?? new Date().toISOString();
    return parseOfficialAvailability(payload, games, conference, { checkedAt, rosters, previous });
  }));
  const additions = [];
  let succeeded = 0;
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      succeeded++;
      additions.push(...result.value);
    } else {
      console.warn(`${conferences[index][0]} availability check failed: ${result.reason.message}`);
    }
  }
  if (succeeded === 0) throw new Error('Every due availability source failed');
  const merged = mergeAvailability(previous, additions);
  const changed = [...merged.entries()].filter(([teamId, artifact]) => previous.get(teamId) !== artifact);
  for (const [teamId, artifact] of changed) {
    await atomicJson(join(options['output-dir'], `${teamId}.json`), artifact);
  }
  if (options.mode === 'overnight' && succeeded < checks.size && process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, 'incomplete=true\n');
  }
  console.log(`Checked ${succeeded} of ${checks.size} due conference feeds, matched ${additions.length} team reports and refreshed ${changed.length} team files.`);
}
