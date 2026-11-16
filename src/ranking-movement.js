import { readFile } from 'node:fs/promises';
import { compareRankingHistory } from '../frontend/ranking-history.js';

function highlight({ id, team, rank, previousRank, movement, weekGames }) {
  return { id, team, rank, previousRank, movement, weekGames: (weekGames ?? []).map(
    ({ opponentId, opponentName, opponentRank, result, margin, venue }) =>
      ({ opponentId, opponentName, opponentRank, result, margin, venue })) };
}

export function buildRankingMovement(snapshot, history) {
  if (!snapshot?.rankingMethod?.id || !snapshot.snapshotHash || !snapshot.publicationHash ||
      !Number.isFinite(Date.parse(snapshot.asOf)) || !Array.isArray(snapshot.rankings) ||
      history?.season !== snapshot.season) return null;

  const { current, previous, rows, risers, fallers, arrivals, departures } = compareRankingHistory(history);
  if (current?.kind !== 'saved' || typeof current.complete !== 'boolean' ||
      current.asOf !== snapshot.asOf || current.snapshotHash !== snapshot.snapshotHash ||
      current.publicationHash !== snapshot.publicationHash || current.modelId !== snapshot.rankingMethod.id ||
      previous?.complete !== true) return null;

  const ranked = new Map(snapshot.rankings.map(row => [row.id, row.displayRank]));
  if (ranked.size !== snapshot.rankings.length || ranked.size !== rows.length ||
      rows.some(row => !ranked.has(row.id) || ranked.get(row.id) !== row.rank)) return null;

  const entering = new Set(arrivals.map(row => row.id));
  return {
    week: current.week,
    seasonType: current.seasonType,
    previousWeek: previous.week,
    previousSeasonType: previous.seasonType,
    previousKind: previous.kind,
    gamesThrough: current.gamesThrough,
    complete: current.complete,
    teams: Object.fromEntries(rows.map(({ id, previousRank, movement }) =>
      [id, { previousRank, movement, enteredTop25: entering.has(id) }])),
    risers: risers.map(highlight),
    fallers: fallers.map(highlight),
    arrivals: arrivals.map(highlight),
    departures: departures.map(highlight),
  };
}

export async function readRankingMovement(path, snapshot) {
  try {
    return buildRankingMovement(snapshot, JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return null;
  }
}
