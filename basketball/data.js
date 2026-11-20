import { createHash } from 'node:crypto';
import { parseCsv } from '../src/ingest.js';

export const BASKETBALL_COMPETITION = 'ncaam-d1';
export const BASKETBALL_DATA_VERSION = 1;
export const CBBD_RECORD_CAP = 3000;

const statuses = new Set(['scheduled', 'in_progress', 'final', 'postponed', 'cancelled']);
const seasonTypes = new Set(['preseason', 'regular', 'postseason']);
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const numeric = value => (typeof value === 'number' || (typeof value === 'string' && value.trim()))
  && Number.isFinite(Number(value)) ? Number(value) : null;
const positiveId = value => {
  const number = numeric(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};
const nonnegative = value => {
  const number = numeric(value);
  return number !== null && number >= 0 ? number : null;
};
const score = value => {
  const number = nonnegative(value);
  return Number.isSafeInteger(number) ? number : null;
};
const boolean = value => {
  if (typeof value === 'boolean') return value;
  return typeof value === 'string' ? ({ true: true, false: false })[value.toLowerCase()] ?? null : null;
};
const color = value => typeof value === 'string' && /^#?[a-f\d]{6}$/i.test(value)
  ? '#' + value.replace(/^#/, '').toLowerCase() : null;
const basketballId = value => `${BASKETBALL_COMPETITION}:${value}`;
export const dataHash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

export function basketballTipoff(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function basketballSeasonBounds(season) {
  if (!Number.isInteger(season) || season < 1949 || season > 2100) throw new Error('Invalid basketball ending-year season');
  return [`${season - 1}-07-01T00:00:00.000Z`, `${season}-07-01T00:00:00.000Z`];
}

function unique(map, key, value, description) {
  const prior = map.get(key);
  if (prior && JSON.stringify(prior) !== JSON.stringify(value)) throw new Error(`Conflicting basketball ${description} ${key}`);
  if (prior) return false;
  map.set(key, value);
  return true;
}

function normalizeTeam(row) {
  const providerId = positiveId(row.id);
  const name = text(row.school ?? row.name);
  if (!providerId || !name) throw new Error('Basketball registry contains a record without a valid school ID or name');
  return {
    id: basketballId(providerId), providerId, name,
    mascot: text(row.mascot), abbreviation: text(row.abbreviation),
    conferenceId: positiveId(row.conferenceId), conference: text(row.conference),
    color: color(row.primaryColor ?? row.color), eligible: true,
  };
}

function normalizeGame(row, season, teams, cutoff) {
  if (numeric(row.season) !== season) throw new Error('Basketball game season does not match the requested ending year');
  const providerId = positiveId(row.id);
  const startDate = basketballTipoff(row.startDate);
  if (!providerId || !startDate || !statuses.has(row.status) || !seasonTypes.has(row.seasonType)) {
    throw new Error('Basketball schedule contains an invalid ID, tipoff, status or season type');
  }
  const homeProviderId = positiveId(row.homeTeamId), awayProviderId = positiveId(row.awayTeamId);
  if (!homeProviderId || !awayProviderId) return null;
  const home = basketballId(homeProviderId), away = basketballId(awayProviderId);
  if (home === away) throw new Error(`Basketball game ${providerId} has the same school on both sides`);
  if (!teams.has(home) && !teams.has(away)) return null;
  const homePoints = score(row.homePoints), awayPoints = score(row.awayPoints);
  const completed = row.status === 'final' && startDate < cutoff && homePoints !== null && awayPoints !== null
    && homePoints !== awayPoints;
  const periods = Array.isArray(row.homePeriodPoints) && Array.isArray(row.awayPeriodPoints)
    && row.homePeriodPoints.length === row.awayPeriodPoints.length && row.homePeriodPoints.length >= 2
    && [...row.homePeriodPoints, ...row.awayPeriodPoints].every(point => score(point) !== null)
    ? row.homePeriodPoints.length : null;
  return {
    id: basketballId(providerId), providerId, home, away, startDate, completed,
    homeName: teams.get(home)?.name ?? text(row.homeTeam),
    awayName: teams.get(away)?.name ?? text(row.awayTeam),
    homePoints: completed || row.status === 'in_progress' ? homePoints : null,
    awayPoints: completed || row.status === 'in_progress' ? awayPoints : null,
    startTimeTbd: boolean(row.startTimeTbd) !== false,
    neutral: boolean(row.neutralSite), conferenceGame: boolean(row.conferenceGame),
    status: row.status === 'final' && !completed ? 'unverified' : row.status,
    seasonType: row.seasonType, tournament: text(row.tournament), venue: text(row.venue),
    homeSeed: positiveId(row.homeSeed), awaySeed: positiveId(row.awaySeed),
    divisionOne: teams.has(home) && teams.has(away),
    overtimeMinutes: completed && periods !== null ? Math.max(0, (periods - 2) * 5) : null,
  };
}

function normalizeBox(stats) {
  if (!stats || typeof stats !== 'object') return null;
  const value = {
    possessions: nonnegative(stats.possessions) > 0 ? nonnegative(stats.possessions) : null,
    fieldGoalsMade: nonnegative(stats.fieldGoals?.made),
    fieldGoalsAttempted: nonnegative(stats.fieldGoals?.attempted),
    threePointsMade: nonnegative(stats.threePointFieldGoals?.made),
    threePointsAttempted: nonnegative(stats.threePointFieldGoals?.attempted),
    freeThrowsMade: nonnegative(stats.freeThrows?.made),
    freeThrowsAttempted: nonnegative(stats.freeThrows?.attempted),
    offensiveRebounds: nonnegative(stats.rebounds?.offensive),
    defensiveRebounds: nonnegative(stats.rebounds?.defensive),
    turnovers: nonnegative(stats.turnovers?.total ?? stats.turnovers?.teamTotal),
    assists: nonnegative(stats.assists), steals: nonnegative(stats.steals), blocks: nonnegative(stats.blocks),
  };
  for (const name of ['fieldGoals', 'threePoints', 'freeThrows']) {
    const attempts = value[`${name}Attempted`];
    const makes = value[`${name}Made`];
    if (attempts !== null && makes !== null && makes > attempts) return null;
  }
  return Object.values(value).some(item => item !== null) ? value : null;
}

function sameResult(prior, next) {
  return prior?.completed && next.completed && prior.home === next.home && prior.away === next.away
    && prior.homePoints === next.homePoints && prior.awayPoints === next.awayPoints
    && prior.startDate === next.startDate;
}

export function normalizeBasketballSeason({ season, teamRows, gameRows, boxRows = [], source, previous }) {
  const bounds = basketballSeasonBounds(season);
  const cutoff = basketballTipoff(source?.asOf);
  if (!cutoff || !Array.isArray(teamRows) || !teamRows.length || !Array.isArray(gameRows) || !Array.isArray(boxRows)) {
    throw new Error('Basketball normalization requires a dated source, season registry and schedule array');
  }
  const teams = new Map(), games = new Map(), boxes = new Map();
  const oldById = new Map((previous?.games ?? []).map(game => [game.id, game]));
  const oldTeamsById = new Map((previous?.teams ?? []).map(team => [team.id, team]));
  const coverage = {
    teamRows: teamRows.length, gameRows: gameRows.length, boxRows: boxRows.length,
    duplicateGames: 0, outsideRegistryGames: 0, unverifiedFinals: 0,
    conflictingBoxScores: 0, missingFinalBoxes: 0, unsupportedVenues: 0,
    missingTeamSchedule: [], conferenceDisagreements: 0,
  };
  for (const row of teamRows) {
    const team = normalizeTeam(row);
    unique(teams, team.id, team, 'team membership');
  }
  for (const row of gameRows) {
    const game = normalizeGame(row, season, teams, cutoff);
    if (!game) { coverage.outsideRegistryGames++; continue; }
    if (game.startDate < bounds[0] || game.startDate >= bounds[1]) throw new Error(`Basketball game ${game.id} falls outside its season`);
    if (game.seasonType === 'preseason') continue;
    if (!unique(games, game.id, game, 'schedule record')) coverage.duplicateGames++;
    if ([['home', 'homeConferenceId'], ['away', 'awayConferenceId']].some(([side, field]) => {
      const seasonConference = teams.get(game[side])?.conferenceId;
      const listed = positiveId(row[field]);
      return seasonConference && listed && seasonConference !== listed;
    })) coverage.conferenceDisagreements++;
  }
  const invalidBoxes = new Set();
  for (const row of boxRows) {
    if (numeric(row.season) !== season) throw new Error('Basketball box score season does not match the requested ending year');
    const id = basketballId(positiveId(row.gameId));
    const game = games.get(id);
    if (!game?.completed || invalidBoxes.has(id)) continue;
    const isHome = boolean(row.isHome);
    const homeId = basketballId(positiveId(isHome ? row.teamId : row.opponentId));
    const awayId = basketballId(positiveId(isHome ? row.opponentId : row.teamId));
    const home = isHome ? row.teamStats : row.opponentStats, away = isHome ? row.opponentStats : row.teamStats;
    const box = { home: normalizeBox(home), away: normalizeBox(away) };
    if (isHome === null || homeId !== game.home || awayId !== game.away || !box.home || !box.away
      || (score(home?.points?.total) !== null && score(home?.points?.total) !== game.homePoints)
      || (score(away?.points?.total) !== null && score(away?.points?.total) !== game.awayPoints)
      || (boxes.has(id) && JSON.stringify(boxes.get(id)) !== JSON.stringify(box))) {
      boxes.delete(id);
      invalidBoxes.add(id);
      coverage.conflictingBoxScores++;
      continue;
    }
    boxes.set(id, box);
  }
  const corrections = [];
  function trackChanges(entity, prior, next, fields) {
    const changed = fields.filter(field => JSON.stringify(prior[field]) !== JSON.stringify(next[field]));
    if (!changed.length) return;
    corrections.push({
      entity, id: next.id, observedAt: cutoff,
      changes: Object.fromEntries(changed.map(field => [field, [prior[field] ?? null, next[field] ?? null]])),
    });
  }
  for (const game of games.values()) {
    const prior = oldById.get(game.id);
    const box = boxes.get(game.id) ?? (!invalidBoxes.has(game.id) && sameResult(prior, game) ? prior.box : null);
    if (box) game.box = box;
    if (prior?.availableAt && sameResult(prior, game)) game.availableAt = prior.availableAt;
    if (prior) trackChanges('game', prior, game,
      ['home', 'away', 'startDate', 'startTimeTbd', 'status', 'homePoints', 'awayPoints', 'neutral', 'box']);
  }
  for (const team of teams.values()) {
    const prior = oldTeamsById.get(team.id);
    if (prior) trackChanges('team', prior, team, ['name', 'mascot', 'conferenceId', 'conference']);
  }
  for (const prior of oldById.values()) {
    if (!games.has(prior.id) && source.fullSchedule) corrections.push({ entity: 'game', id: prior.id, observedAt: cutoff, removed: true });
  }
  const sortedTeams = [...teams.values()].sort((a, b) => a.id.localeCompare(b.id));
  const sortedGames = [...games.values()].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
  return assembleBasketballSeason({ season, teams: sortedTeams, games: sortedGames, source, coverage,
    corrections: [...(previous?.corrections ?? []), ...corrections] });
}

export function assembleBasketballSeason({ season, teams, games, source, coverage = {}, corrections = [] }) {
  const teamGames = new Set(games.flatMap(game => [game.home, game.away]));
  const finals = games.filter(game => game.completed);
  const eligibleFinals = finals.filter(game => game.divisionOne);
  const boxes = eligibleFinals.filter(game => game.box);
  const possessions = boxes.filter(game => [game.box.home, game.box.away].every(box =>
    box.possessions > 0 || ['fieldGoalsAttempted', 'freeThrowsAttempted', 'offensiveRebounds', 'turnovers']
      .every(field => Number.isFinite(box[field]))));
  const duplicateFixtures = new Map();
  for (const game of games) {
    if (['cancelled', 'postponed'].includes(game.status) || game.startTimeTbd) continue;
    const key = `${[game.home, game.away].sort().join('|')}|${game.startDate}`;
    if (duplicateFixtures.has(key)) throw new Error(`Duplicate basketball fixture ${duplicateFixtures.get(key)} and ${game.id}`);
    duplicateFixtures.set(key, game.id);
  }
  const content = { version: BASKETBALL_DATA_VERSION, competition: BASKETBALL_COMPETITION, season, teams, games };
  return { ...content, source: { ...source, sha256: dataHash(content) }, coverage: {
    ...coverage, teams: teams.length, games: games.length, finals: finals.length,
    divisionOneFinals: eligibleFinals.length, otherFinals: finals.length - eligibleFinals.length,
    postseasonFinals: finals.filter(game => game.seasonType === 'postseason').length,
    divisionOneFinalsWithBoxes: boxes.length, missingFinalBoxes: eligibleFinals.length - boxes.length,
    divisionOneFinalsWithPossessionInputs: possessions.length,
    unverifiedFinals: games.filter(game => game.status === 'unverified').length,
    unsupportedVenues: games.filter(game => game.neutral === null).length,
    missingTeamSchedule: teams.filter(team => !teamGames.has(team.id)).map(team => team.id),
    latestFinalTipoff: finals.at(-1)?.startDate ?? null,
  }, corrections };
}

function csvCell(value) {
  if (value === '' || value === 'null' || value === 'NA') return null;
  if (/^[\[{]/.test(value)) {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

export function parseBasketballExport(csv) {
  return parseCsv(csv.replace(/^\uFEFF/, '')).map(row => {
    const payload = {};
    for (const [header, value] of Object.entries(row)) {
      const rawParts = header.trim().split(/[.\s]+/);
      const parts = rawParts.map(part =>
        part.replace(/^[A-Z]/, c => c.toLowerCase()).replace(/_([a-z])/g, (_, c) => c.toUpperCase()));
      if ([...rawParts, ...parts].some(part => !part || ['__proto__', 'prototype', 'constructor'].includes(part.toLowerCase()))) {
        throw new Error('Invalid basketball CSV field name');
      }
      const key = parts.pop();
      let target = payload;
      for (const part of parts) {
        if (!Object.hasOwn(target, part)) target[part] = {};
        if (!target[part] || typeof target[part] !== 'object') throw new Error('Conflicting basketball CSV field name');
        target = target[part];
      }
      const data = csvCell(value);
      target[key] = typeof data === 'string' && (key === 'homePeriodPoints' || key === 'awayPeriodPoints')
        ? data.split(',').map(score) : data;
    }
    return payload;
  });
}
