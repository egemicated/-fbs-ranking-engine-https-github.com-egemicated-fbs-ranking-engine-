import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { atomicJson } from './ingest.js';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' });
const record = team => `${team.wins}–${team.losses}${team.ties ? `–${team.ties}` : ''}`;
const key = edition => `${edition.seasonType ?? 'regular'}:${edition.week}`;
const order = (left, right) => (left.seasonType === 'postseason') - (right.seasonType === 'postseason') || left.week - right.week;

function validateEdition(edition) {
  if (!edition || !Number.isInteger(edition.week) || edition.week < 0 ||
      !['regular', 'postseason'].includes(edition.seasonType) || !['saved', 'replay'].includes(edition.kind) ||
      typeof edition.complete !== 'boolean' || !/^\d{4}-\d{2}-\d{2}$/.test(edition.gamesThrough) ||
      !Number.isFinite(Date.parse(edition.asOf)) || !hash(edition.snapshotHash) ||
      typeof edition.modelId !== 'string' || !edition.modelId || !Array.isArray(edition.rows) || !edition.rows.length) {
    throw new Error('Invalid SOR history edition');
  }
  const ids = new Set();
  for (const row of edition.rows) {
    if (typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.team !== 'string' || !row.team ||
        !(row.rank === null || Number.isInteger(row.rank) && row.rank > 0) ||
        !(row.sor === null && edition.kind === 'replay' || Number.isFinite(row.sor) && row.sor >= 0) ||
        ![row.wins, row.losses, row.ties, row.games].every(value => Number.isInteger(value) && value >= 0) ||
        row.games !== row.wins + row.losses + row.ties || row.record !== record(row) || !Array.isArray(row.weekGames)) {
      throw new Error('Invalid SOR history team');
    }
    ids.add(row.id);
  }
}

function scheduleGames(snapshot, schedule) {
  const normalized = schedule?.year === snapshot.season;
  const picks = schedule?.schemaVersion === 1 && schedule.season === snapshot.season;
  const source = schedule?.source;
  const matchingSource = normalized
    ? source?.sha256 === snapshot.source.sha256 && source?.fetchedAt === snapshot.source.fetchedAt
    : picks && source?.snapshotHash === snapshot.snapshotHash && source?.rankingAsOf === snapshot.asOf && source?.scheduleAsOf === snapshot.source.fetchedAt;
  if (source?.provider !== 'cfbd' || !matchingSource || !Array.isArray(schedule.games) || !Array.isArray(schedule.teams)) {
    throw new Error('SOR history requires the matching CFBD schedule');
  }
  const fbs = new Set(schedule.teams.filter(team => team.division === 'fbs').map(team => team.id));
  if (fbs.size !== snapshot.rankings.length || snapshot.rankings.some(team => !fbs.has(team.id))) {
    throw new Error('SOR history FBS membership differs from the snapshot');
  }
  const canceled = new Set((snapshot.source.audit?.confirmedCanceledRecords ?? []).map(game => game.id));
  const seen = new Set();
  return schedule.games.filter(game => fbs.has(game.home) || fbs.has(game.away)).map(game => {
    if (!game.id || seen.has(game.id) || !Number.isInteger(game.week) || game.week < 0 ||
        !['regular', 'postseason'].includes(game.seasonType) || !Number.isFinite(Date.parse(game.startDate)) ||
        typeof game.neutral !== 'boolean') throw new Error('Invalid SOR history schedule game');
    seen.add(game.id);
    return { ...game, completed: !canceled.has(game.id) && (normalized ? game.completed : game.status === 'final'), canceled: canceled.has(game.id) };
  });
}

// Store only the results that were actually in this published graph. A later
// graph is never reused to invent a ranking for an earlier week.
export function buildSorHistoryEdition(snapshot, schedule) {
  const fetchedAt = Date.parse(snapshot?.source?.fetchedAt);
  const asOf = Date.parse(snapshot?.asOf);
  if (snapshot?.source?.provider !== 'cfbd' || !Number.isFinite(fetchedAt) || !Number.isFinite(asOf) || fetchedAt > asOf ||
      !hash(snapshot.source.sha256) || !hash(snapshot.snapshotHash) || !hash(snapshot.publicationHash) || !snapshot.rankingMethod?.id ||
      !Array.isArray(snapshot.rankings) || !snapshot.rankings.length || snapshot.rankings.some(team =>
        !Object.hasOwn(team, 'displayRank') || !Number.isFinite(team.sor) || !Array.isArray(team.contributions) || team.contributions.length !== team.games)) {
    throw new Error('SOR history requires a complete dated SOR publication');
  }
  const games = scheduleGames(snapshot, schedule);
  const byGame = new Map(games.map(game => [game.id, game]));
  const modeled = new Map();
  for (const team of snapshot.rankings) {
    for (const result of team.contributions) {
      const game = byGame.get(result.gameId);
      const home = game?.home === team.id;
      if (!game || !game.completed || (!home && game.away !== team.id) ||
          result.opponentId !== (home ? game.away : game.home) || Date.parse(game.startDate) > fetchedAt ||
          !Number.isInteger(game.homePoints) || !Number.isInteger(game.awayPoints) ||
          result.finalMargin !== (home ? game.homePoints - game.awayPoints : game.awayPoints - game.homePoints) ||
          result.result !== (result.finalMargin > 0 ? 'W' : result.finalMargin < 0 ? 'L' : 'T')) {
        throw new Error('SOR history game evidence differs from the snapshot');
      }
      modeled.set(game.id, game);
    }
  }
  if (!modeled.size) return null;
  if (games.some(game => game.completed && Date.parse(game.startDate) <= fetchedAt && !modeled.has(game.id))) {
    throw new Error('SOR history snapshot omits a completed schedule game');
  }
  const target = [...modeled.values()].sort(order).at(-1);
  const currentGames = [...modeled.values()].filter(game => key(game) === key(target));
  const gamesThrough = date.format(Math.max(...[...modeled.values()].map(game => Date.parse(game.startDate))));
  const due = games.filter(game => !game.canceled && (key(game) === key(target) || Date.parse(game.startDate) <= fetchedAt));
  const complete = due.every(game => game.completed && modeled.has(game.id));
  const ranks = new Map(snapshot.rankings.map(team => [team.id, team.displayRank]));
  const rows = snapshot.rankings.map(team => ({
    id: team.id, team: team.name, rank: team.displayRank, sor: team.sor === 0 ? 0 : team.sor,
    wins: team.wins, losses: team.losses, ties: team.ties, games: team.games, record: record(team),
    weekGames: currentGames.filter(game => game.home === team.id || game.away === team.id).map(game => {
      const result = team.contributions.find(result => result.gameId === game.id);
      return { id: game.id, opponentId: result.opponentId, opponentName: result.opponentName,
        result: result.result, margin: result.finalMargin, venue: game.neutral ? 'neutral' : game.home === team.id ? 'home' : 'away',
        opponentRank: ranks.get(result.opponentId) ?? null };
    }).sort((left, right) => left.id.localeCompare(right.id))
  }));
  const edition = { week: target.week, seasonType: target.seasonType, kind: 'saved', complete, weekGamesAvailable: true, gamesThrough,
    released: date.format(asOf), asOf: snapshot.asOf, snapshotHash: snapshot.snapshotHash,
    publicationHash: snapshot.publicationHash, modelId: snapshot.rankingMethod.id, modelVersion: snapshot.modelVersion, rows };
  validateEdition(edition);
  return edition;
}

export function addSorHistoryEdition(history, edition, season) {
  validateEdition(edition);
  if (history?.schemaVersion !== 1 || history.season !== season || !Array.isArray(history.editions)) {
    throw new Error('SOR history archive does not match the season');
  }
  const result = structuredClone(history);
  for (const previous of result.editions) validateEdition(previous);
  if (new Set(result.editions.map(key)).size !== result.editions.length) throw new Error('Duplicate SOR history edition');
  const current = result.editions.find(item => key(item) === key(edition));
  const newest = result.editions.filter(item => item.kind === 'saved').sort(order).at(-1);
  if (edition.kind === 'saved' && newest && (order(edition, newest) < 0 || Date.parse(edition.asOf) < Date.parse(newest.asOf))) {
    throw new Error('Refusing to replace SOR history with an older snapshot');
  }
  if (current?.kind === 'saved' && edition.kind === 'replay') throw new Error('A replay cannot replace a saved SOR edition');
  if (current?.kind === edition.kind && current.modelId !== edition.modelId) {
    throw new Error('A different SOR model already has this edition');
  }
  if (edition.kind === 'saved' && newest) {
    const byId = new Map(edition.rows.map(row => [row.id, row]));
    if (newest.rows.some(row => !byId.has(row.id) || byId.get(row.id).games < row.games)) {
      throw new Error('SOR history would lose previously published team results');
    }
  }
  if (current?.publicationHash === edition.publicationHash && current?.kind === edition.kind &&
      current?.complete === edition.complete && current?.gamesThrough === edition.gamesThrough && isDeepStrictEqual(current?.rows, edition.rows)) return result;
  if (current) result.editions[result.editions.indexOf(current)] = structuredClone(edition);
  else result.editions.push(structuredClone(edition));
  result.editions.sort(order);
  return result;
}

function comparisonArchive(archive, edition, season) {
  if (archive.season !== season || !Array.isArray(archive.sor)) throw new Error('Ranking comparison archive does not match the season');
  const result = structuredClone(archive);
  if (!edition.complete || edition.seasonType !== 'regular') return result;
  const current = result.sor.find(item => item.week === edition.week);
  if (current && (current.gamesThrough !== edition.gamesThrough || current.modelId && current.modelId !== edition.modelId)) {
    throw new Error('A different SOR comparison edition is already stored for this week');
  }
  const entry = { ...(current ?? {}), week: edition.week, gamesThrough: edition.gamesThrough, released: edition.released,
    asOf: edition.asOf, modelId: edition.modelId, snapshotHash: edition.snapshotHash, publicationHash: edition.publicationHash,
    rows: edition.rows.map(({ team, rank, record, sor }) => ({ team, rank, record, sor })) };
  if (current) result.sor[result.sor.indexOf(current)] = entry;
  else result.sor.push(entry);
  result.sor.sort((left, right) => left.week - right.week);
  return result;
}

export async function saveSorHistory(snapshot, schedule, {
  historyPath = 'frontend/ranking-history.json', comparisonPath = 'frontend/ranking-editions.json'
} = {}) {
  const edition = buildSorHistoryEdition(snapshot, schedule);
  if (!edition) return false;
  let history;
  try { history = JSON.parse(await readFile(historyPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; history = { schemaVersion: 1, season: snapshot.season, editions: [] }; }
  const comparisons = JSON.parse(await readFile(comparisonPath, 'utf8'));
  const updated = addSorHistoryEdition(history, edition, snapshot.season);
  const retained = updated.editions.find(item => key(item) === key(edition));
  const nextComparisons = comparisonArchive(comparisons, retained, snapshot.season);
  const historyChanged = !isDeepStrictEqual(history, updated), comparisonChanged = !isDeepStrictEqual(comparisons, nextComparisons);
  if (historyChanged) await atomicJson(historyPath, updated);
  if (comparisonChanged) await atomicJson(comparisonPath, nextComparisons);
  return historyChanged || comparisonChanged;
}
