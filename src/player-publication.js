import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicJson } from './ingest.js';
import { buildQBRatings } from './qb-rating.js';
import { buildPlayerPublications, normalizePlayerData, playerSchedule } from './player-data.js';

const readJson = file => readFile(file, 'utf8').then(JSON.parse);
const cohorts = new Set(['team-players', 'team-availability']);

export async function loadPlayerSchedule(directory) {
  const [weekly, fcs] = await Promise.all([
    readJson(join(directory, 'weekly-picks.json')),
    readJson(join(directory, 'weekly-fcs-picks.json')).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    }),
  ]);
  return playerSchedule(weekly, fcs);
}

function coverageSummary(files) {
  const coverage = {};
  for (const { division, players, coverage: facts } of files.values()) {
    coverage[division] ??= { teams: 0, listedPlayers: 0, listedPositions: 0, seasonTotals: 0,
      boxGames: 0, expectedGames: 0, ratedQbs: 0 };
    const tally = coverage[division];
    tally.teams++;
    tally.listedPlayers += facts.roster;
    tally.listedPositions += facts.listedPositions;
    tally.seasonTotals += facts.seasonTotals;
    tally.boxGames += facts.boxGames;
    tally.expectedGames += facts.expectedGames;
    tally.ratedQbs += players.filter(player => Number.isFinite(player.qbRating?.rating)).length;
  }
  return coverage;
}

export async function publishPlayerPages({ cache, schedule, directory }) {
  const evidence = normalizePlayerData(cache, schedule);
  const qb = buildQBRatings(evidence.observations, { season: schedule.season, asOf: schedule.scheduleAsOf });
  const files = buildPlayerPublications(evidence, qb);
  if (![...files.values()].some(file => file.division === 'fbs' && file.coverage.roster && file.coverage.boxGames)) {
    throw new Error('No verified FBS roster and game evidence to publish');
  }
  const output = resolve(directory, 'team-players');
  await mkdir(output, { recursive: true });
  await Promise.all([...files].map(([id, file]) => atomicJson(join(output, `${id}.json`), file, { spacing: 0 })));
  await removeStaleTeamPages(output, new Set(files.keys()));
  return { season: schedule.season, scheduleAsOf: schedule.scheduleAsOf, asOf: evidence.asOf,
    comparisonGroups: qb.comparisons, ...evidence.evidence, coverage: coverageSummary(files) };
}

export async function readTeamPage(directory, kind, teamId, season) {
  if (!cohorts.has(kind) || !/^\d{1,24}$/.test(teamId)) return null;
  try {
    const page = await readJson(join(directory, kind, `${teamId}.json`));
    const key = kind === 'team-players' ? 'players' : 'reports';
    return page?.schemaVersion === 1 && page.season === season && page.teamId === teamId && Array.isArray(page[key]) ? page : null;
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function removeStaleTeamPages(directory, saved) {
  const names = await readdir(directory, { withFileTypes: true });
  await Promise.all(names.filter(file => file.isFile() && /^\d{1,24}\.json$/.test(file.name) && !saved.has(file.name.slice(0, -5)))
    .map(file => rm(join(directory, file.name))));
}

export async function copyPlayerPages(source, output, teams, season) {
  await Promise.all([...cohorts].map(async kind => {
    const dest = join(output, kind);
    await mkdir(dest, { recursive: true });
    const saved = new Set();
    await Promise.all(teams.map(async team => {
      const page = await readTeamPage(source, kind, team.id, season);
      if (!page) return;
      saved.add(team.id);
      await atomicJson(join(dest, `${team.id}.json`), page, { spacing: 0 });
    }));
    await removeStaleTeamPages(dest, saved);
  }));
}
