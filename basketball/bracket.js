export const ROUND_NAMES = Object.freeze(['Opening Round', 'First Round', 'Second Round', 'Sweet 16', 'Elite Eight', 'Final Four', 'Championship']);
export const REGIONAL_SEEDS = Object.freeze([1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15]);
const regions = ['East', 'West', 'South', 'Midwest'];
const pair = xs => Array.from({length: xs.length / 2}, (_, i) => xs.slice(2 * i, 2 * i + 2));
const safeId = s => typeof s === 'string' && /^[\w-]{1,100}$/.test(s);
const safeTeamId = s => typeof s === 'string' && /^[\w:-]{1,100}$/.test(s);

export function tournamentSize(year) {
  if (!Number.isInteger(year) || year < 1985 || year === 2020) return null;
  if (year >= 2027) return 76;
  if (year >= 2011) return 68;
  return year >= 2001 ? 65 : 64;
}

function requireField(condition, message) {
  if (!condition) throw new Error('Invalid basketball bracket: ' + message);
}

export function buildBracket(field) {
  const { year, mode, regions: fieldRegions, semifinalPairs } = field;
  const teamCount = tournamentSize(year);
  requireField(teamCount && safeId(field.id) && ['official', 'projection', 'practice'].includes(mode), 'identity or format');
  requireField(Array.isArray(fieldRegions) && fieldRegions.length === 4 &&
    new Set(fieldRegions.map(region => region.id)).size === 4, 'four distinct regions required');
  requireField(Array.isArray(semifinalPairs) && semifinalPairs.length === 2 &&
    semifinalPairs.every(match => Array.isArray(match) && match.length === 2) &&
    new Set(semifinalPairs.flat()).size === 4 &&
    semifinalPairs.flat().every(id => fieldRegions.some(region => id === region.id)), 'semifinals must use every region once');
  const games = [];
  const teams = Object.create(null);
  const add = (id, round, region, sides) => {
    games.push({id, round, region, sides});
    return {from: id};
  };
  const regionalFinals = new Map();
  for (const region of fieldRegions) {
    requireField(safeId(region.id) && typeof region.name === 'string' && region.name.trim() &&
      Array.isArray(region.slots) && region.slots.length === 16, 'regional structure');
    const slots = new Map(region.slots.map(slot => [slot.seed, slot.teams]));
    const regionalSides = REGIONAL_SEEDS.map(seed => {
      const entries = slots.get(seed);
      requireField(Array.isArray(entries) && (entries.length === 1 || entries.length === 2), 'every seed needs one team or one opening matchup');
      const sides = entries.map(team => {
        requireField(safeTeamId(team?.id) && typeof team.name === 'string' && team.name.trim() &&
          !Object.hasOwn(teams, team.id), 'invalid or duplicate entrant');
        teams[team.id] = {...team, seed};
        return {team: team.id};
      });
      return sides.length === 2 ? add(region.id + '-opening-' + seed, 0, region.id, sides) : sides[0];
    });
    let roundSides = regionalSides;
    for (let round = 1; round <= 4; round++) {
      roundSides = pair(roundSides).map((sides, i) => add(region.id + '-r' + round + '-' + (i + 1), round, region.id, sides));
    }
    regionalFinals.set(region.id, roundSides[0]);
  }
  const semifinalSides = semifinalPairs.map((ids, i) => add('semifinal-' + (i + 1), 5, null, ids.map(id => regionalFinals.get(id))));
  add('championship', 6, null, semifinalSides);
  games.sort((a,b) => a.round - b.round);
  requireField(Object.keys(teams).length === teamCount && games.length === teamCount - 1 &&
    games.filter(game => game.round === 0).length === teamCount - 64, 'entrant count or opening game count');
  const consumed = games.flatMap(game => game.sides.flatMap(side => side.from ? [side.from] : []));
  requireField(new Set(consumed).size === games.length - 1 && !consumed.includes('championship'), 'progression graph');
  const bracket = {field, games, teams, teamCount};
  const officialResults = field.results ?? {};
  requireField(mode === 'official' || Object.keys(officialResults).length === 0, 'only official fields may contain game results');
  const results = validateResults(bracket, officialResults);
  return {...bracket, results};
}

export function bracketTeams(game, winners) {
  return game.sides.map(side => side.team ?? winners[side.from] ?? null);
}

/** Retain only selections reached by a valid path from the entrants. */
export function reconcileBracketPicks(bracket, selections = {}) {
  const valid = Object.create(null);
  for (const game of bracket.games) {
    const teams = bracketTeams(game, valid);
    const selection = Object.hasOwn(selections, game.id) ? selections[game.id] : null;
    if (teams.every(Boolean) && teams.includes(selection)) valid[game.id] = selection;
  }
  return {...valid};
}

export function chooseBasketballWinner(bracket, picks, gameId, teamId) {
  const game = bracket.games.find(item => item.id === gameId);
  const current = reconcileBracketPicks(bracket, picks);
  const teams = game ? bracketTeams(game, current) : [];
  if (!game || !teams.every(Boolean) || !teams.includes(teamId)) return current;
  return reconcileBracketPicks(bracket, {...current, [gameId]: teamId});
}

export function fillBasketballBracket(bracket, forecast) {
  const winners = Object.create(null);
  for (const game of bracket.games) {
    const [a, b] = bracketTeams(game, winners);
    if (!a || !b) continue;
    const chance = forecast(a, b);
    if (Number.isFinite(chance) && chance >= 0 && chance <= 1) winners[game.id] = chance >= .5 ? a : b;
  }
  return {...winners};
}

function validateResults(bracket, rows) {
  const results = {};
  const winners = Object.create(null);
  const knownGames = new Set(bracket.games.map(game => game.id));
  requireField(Object.keys(rows).every(id => knownGames.has(id)), 'unrecognized result slot');
  for (const game of bracket.games) {
    if (!Object.hasOwn(rows, game.id)) continue;
    const row = rows[game.id];
    const sides = bracketTeams(game, winners);
    requireField(Array.isArray(row?.scores) && row.scores.length === 2 &&
      row.scores.every(n => Number.isInteger(n) && n >= 0) && row.scores[0] !== row.scores[1], 'result must have a decisive score');
    requireField(sides.every(Boolean) && Array.isArray(row.teams) &&
      row.teams.length === 2 && sides.every((id, index) => id === row.teams[index]), 'result participants must match the bracket path');
    const winner = sides[row.scores[0] > row.scores[1] ? 0 : 1];
    winners[game.id] = winner;
    results[game.id] = {scores: [...row.scores], winner};
  }
  return results;
}

export function gradeBasketballBracket(bracket, picks) {
  const valid = reconcileBracketPicks(bracket, picks);
  let graded = 0, correct = 0;
  for (const [id, result] of Object.entries(bracket.results)) {
    if (!Object.hasOwn(valid, id)) continue;
    graded++;
    if (valid[id] === result.winner) correct++;
  }
  return {correct, graded};
}

function bracketField(year, id, mode, slots) {
  const fieldRegions = regions.map(name => ({id: name.toLowerCase(), name, slots: []}));
  slots.forEach((teams, i) => {
    const seed = Math.floor(i / 4) + 1;
    const quarter = i % 4;
    const region = fieldRegions[seed % 2 === 0 ? 3 - quarter : quarter];
    region.slots.push({seed, teams});
  });
  return {year, id, mode, regions: fieldRegions, semifinalPairs: [['east', 'midwest'], ['west', 'south']]};
}

export function practiceBasketballField(year) {
  const size = tournamentSize(year);
  if (!size) return null;
  // Numbered demonstration labels are synthetic throughout. Give the optional
  // opening slots the format used for those years without inventing schools.
  const openingSlots = size === 76 ? [40, 41, 42, 43, 44, 45, 58, 59, 60, 61, 62, 63]
    : size === 68 ? [40, 41, 62, 63] : size === 65 ? [63] : [];
  const slots = Array.from({length: 64}, (_, i) => {
    const entrant = j => ({id: 'demo-' + j, name: 'Practice team ' + j});
    return openingSlots.includes(i) ? [entrant(i + 1), entrant(65 + openingSlots.indexOf(i))] : [entrant(i + 1)];
  });
  return bracketField(year, 'practice-' + year, 'practice', slots);
}

export function projectBasketballField(year, rankings, {excludedTeamIds = []} = {}) {
  if (year !== 2027 || !Array.isArray(rankings)) return null;
  const excluded = new Set(excludedTeamIds.map(String));
  const candidates = rankings.filter(team => team && Number.isFinite(team.sorRank) && team.sorRank > 0 &&
    safeTeamId(String(team.id ?? '')) && typeof team.name === 'string' && team.name.trim() &&
    !excluded.has(String(team.id)))
    .map(team => ({id: String(team.id), name: team.name, conference: team.conference, sorRank: team.sorRank}))
    .sort((a,b) => a.sorRank - b.sorRank || a.id.localeCompare(b.id));
  const qualifying = new Map();
  for (const team of candidates) {
    if (typeof team.conference === 'string' && team.conference.trim() &&
        !/^(?:independents?|unknown|unaffiliated)$/i.test(team.conference.trim())) {
      if (!qualifying.has(team.conference)) qualifying.set(team.conference, team);
    }
  }
  if (qualifying.size !== 32 || new Set(candidates.map(team => team.id)).size !== candidates.length) return null;
  const auto = [...qualifying.values()].map(team => ({...team, bid: 'Projected automatic'}));
  const autoIds = new Set(auto.map(team => team.id));
  const atLarge = candidates.filter(team => !autoIds.has(team.id)).slice(0, 44)
    .map(team => ({...team, bid: 'Projected at-large'}));
  if (atLarge.length !== 44) return null;

  // Preserve the format: bottom 12 in each bid group enter the Opening Round.
  // Arrange the 58 non-AQ-play-in slots by average SOR rank. Reserve the last
  // six for AQ play-ins, using two seed-15 and four seed-16 placements.
  const mainSlots = [...auto.slice(0, 20), ...atLarge.slice(0, 32)].map(team => [team]);
  mainSlots.push(...pair(atLarge.slice(32)));
  const averageRank = teams => teams.reduce((value, team) => value + team.sorRank, 0) / teams.length;
  mainSlots.sort((a,b) => averageRank(a) - averageRank(b) || a[0].id.localeCompare(b[0].id));
  const slots = [...mainSlots, ...pair(auto.slice(20))];
  return bracketField(year, 'projection-' + year, 'projection', slots);
}

/** Derive an edition key from seed slots so a new field never inherits old picks. */
export function bracketEdition(bracket) {
  const {regions: fieldRegions, semifinalPairs} = bracket.field;
  const identity = JSON.stringify([semifinalPairs, fieldRegions.map(region => [region.id,
    region.slots.map(slot => [slot.seed, slot.teams.map(team => team.id)])])]);
  let h = 2166136261;
  for (const letter of identity) h = Math.imul(h ^ letter.charCodeAt(0), 16777619);
  return bracket.field.id + '-' + (h >>> 0).toString(16).padStart(8, '0');
}

// For a future isolated contest endpoint. The caller supplies the verified
// official field and current server time, never client-supplied lock metadata.
export function validateBasketballSubmission(bracket, {edition, picks}, now = Date.now()) {
  const lock = Date.parse(bracket.field.lockAt);
  requireField(bracket.field.mode === 'official' && Number.isFinite(lock) && Number.isFinite(now) && now < lock,
    'official entries are unavailable or locked');
  requireField(edition === bracketEdition(bracket) && picks && typeof picks === 'object' && !Array.isArray(picks),
    'submission must match the official edition');
  const valid = reconcileBracketPicks(bracket, picks);
  requireField(Object.keys(valid).length === bracket.games.length && Object.keys(picks).length === bracket.games.length,
    'submission must have one reachable winner per game');
  return valid;
}
