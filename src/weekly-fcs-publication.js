import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function readFcsWeeklyPicks(publicationDirectory, snapshot) {
  try {
    const picks = JSON.parse(await readFile(join(publicationDirectory, 'weekly-fcs-picks.json'), 'utf8'));
    const source = picks?.source;
    if (picks?.schemaVersion !== 1 || picks.season !== snapshot.season ||
        snapshot.source?.provider !== 'cfbd' || source?.provider !== 'cfbd' ||
        source.matchupScope !== 'fcs-fcs' || source.calibrated !== true ||
        !snapshot.snapshotHash || source.snapshotHash !== snapshot.snapshotHash ||
        !Number.isFinite(Date.parse(snapshot.asOf)) || source.rankingAsOf !== snapshot.asOf ||
        !Number.isFinite(Date.parse(snapshot.source.fetchedAt)) || source.scheduleAsOf !== snapshot.source.fetchedAt ||
        !Number.isFinite(Date.parse(picks.asOf)) || Date.parse(picks.asOf) < Date.parse(snapshot.asOf) ||
        !Array.isArray(picks.teams) || !Array.isArray(picks.games) || !picks.games.length) return null;

    const teams = new Set();
    for (const team of picks.teams) {
      if (team?.division !== 'fcs' || typeof team.id !== 'string' || !team.id || teams.has(team.id)) return null;
      teams.add(team.id);
    }
    const games = new Set();
    for (const game of picks.games) {
      if (typeof game?.id !== 'string' || !game.id || games.has(game.id) || game.home === game.away ||
          !teams.has(game.home) || !teams.has(game.away)) return null;
      games.add(game.id);
    }
    return picks;
  } catch {
    return null;
  }
}
