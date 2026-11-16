const seasonsOnly = new Set(['regular', 'postseason']);
const eligibleDivisions = new Set(['fbs', 'fcs']);
const identifier = value => /^\d{1,24}$/.test(String(value ?? '')) ? String(value) : null;
const time = value => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const cleanName = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 100) : '';
const nameKey = value => cleanName(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const statNames = {
  passing: { ATT: 'attempts', CMP: 'completions', COMP: 'completions', COMPLETIONS: 'completions', YDS: 'yards', TD: 'touchdowns', INT: 'interceptions', LONG: 'long' },
  rushing: { ATT: 'attempts', CAR: 'attempts', YDS: 'yards', TD: 'touchdowns', LONG: 'long' },
  receiving: { REC: 'receptions', YDS: 'yards', TD: 'touchdowns', LONG: 'long' },
  defensive: { TOT: 'tackles', SOLO: 'solo', AST: 'assists', SACKS: 'sacks', TFL: 'tacklesForLoss', PD: 'passesDefended', QBH: 'quarterbackHurries', 'QB HUR': 'quarterbackHurries', TD: 'touchdowns' },
  interceptions: { INT: 'interceptions', YDS: 'yards', TD: 'touchdowns' },
  fumbles: { FUM: 'fumbles', LOST: 'lost', REC: 'recoveries' },
  kicking: { FGM: 'fieldGoalsMade', FGA: 'fieldGoalAttempts', XPM: 'extraPointsMade', XPA: 'extraPointAttempts', PTS: 'points', LONG: 'long' },
  punting: { NO: 'punts', PUNTS: 'punts', YDS: 'yards', LONG: 'long', TB: 'touchbacks', IN20: 'inside20', 'IN 20': 'inside20' },
  kickReturns: { NO: 'returns', YDS: 'yards', TD: 'touchdowns', LONG: 'long' },
  puntReturns: { NO: 'returns', YDS: 'yards', TD: 'touchdowns', LONG: 'long' },
};
const categories = new Map(Object.keys(statNames).map(name => [nameKey(name), name]));
categories.set('defense', 'defensive');
categories.set('interception', 'interceptions');
categories.set('kickreturn', 'kickReturns');
categories.set('puntreturn', 'puntReturns');

function quantity(value, { min = 0, max = 100_000, fraction = false } = {}) {
  if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && (fraction || Number.isInteger(amount)) && amount >= min && amount <= max ? amount : null;
}

function setFact(group, key, value) {
  if (value === null) return;
  if (!Object.hasOwn(group, key)) group[key] = value;
  else if (group[key] !== value) group[key] = null;
}

function addStat(stats, categoryName, typeName, value) {
  const category = categories.get(nameKey(categoryName));
  if (!category || typeof typeName !== 'string') return;
  const type = typeName.toUpperCase().trim();
  const combined = category === 'passing' && ['C/ATT', 'CMP/ATT', 'COMP/ATT'].includes(type) ? ['completions', 'attempts']
    : category === 'kicking' && ['FG', 'FGM/FGA'].includes(type) ? ['fieldGoalsMade', 'fieldGoalAttempts']
    : category === 'kicking' && ['XP', 'XPM/XPA'].includes(type) ? ['extraPointsMade', 'extraPointAttempts'] : null;
  if (combined) {
    const pair = typeof value === 'string' && /^(\d+)\s*[-/]\s*(\d+)$/.exec(value.trim());
    if (!pair || Number(pair[1]) > Number(pair[2])) return;
    const group = stats[category] ??= {};
    combined.forEach((key, index) => setFact(group, key, quantity(pair[index + 1])));
    return;
  }
  if (!Object.hasOwn(statNames[category], type)) return;
  const key = statNames[category][type];
  const number = quantity(value, { min: key === 'yards' ? -100_000 : 0, fraction: ['sacks', 'tacklesForLoss'].includes(key) });
  if (number !== null) setFact(stats[category] ??= {}, key, number);
}

function rosterPosition(value) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{1,7}(?:[/-][A-Z]{1,7})?$/.test(normalized) ? normalized : null;
}

export function playerSchedule(weekly, fcs) {
  const season = weekly?.season;
  const { snapshotHash, scheduleAsOf } = weekly?.source ?? {};
  if (!Number.isInteger(season) || weekly.source?.provider !== 'cfbd' || !snapshotHash || !Number.isFinite(time(scheduleAsOf)) ||
      !Array.isArray(weekly.teams) || !Array.isArray(weekly.games)) throw new Error('An aligned CFBD Weekly Picks snapshot is required');
  if (fcs && (fcs.season !== season || fcs.source?.provider !== 'cfbd' || fcs.source.snapshotHash !== snapshotHash ||
      fcs.source.scheduleAsOf !== scheduleAsOf || !Array.isArray(fcs.teams) || !Array.isArray(fcs.games))) {
    throw new Error('FCS weekly schedule does not align with the FBS publication');
  }
  const teams = new Map(), games = new Map();
  for (const team of [...weekly.teams, ...(fcs?.teams ?? [])]) {
    const id = identifier(team?.id);
    if (!id || !cleanName(team.name) || !eligibleDivisions.has(team.division)) continue;
    const old = teams.get(id);
    if (old && (old.name !== team.name || old.division !== team.division)) throw new Error('Conflicting scheduled team identity');
    teams.set(id, { id, name: team.name, division: team.division });
  }
  for (const game of [...weekly.games, ...(fcs?.games ?? [])]) {
    const id = identifier(game?.id), home = identifier(game?.home), away = identifier(game?.away);
    if (!id || !home || !away || home === away || game.status !== 'final' || !seasonsOnly.has(game.seasonType) ||
        !Number.isInteger(game.week) || !Number.isFinite(time(game.startDate)) || time(game.startDate) > time(scheduleAsOf) ||
        ![game.homePoints, game.awayPoints].every(score => Number.isInteger(score) && score >= 0)) continue;
    const old = games.get(id);
    if (old && ['home', 'away', 'week', 'seasonType', 'startDate', 'homePoints', 'awayPoints'].some(key => old[key] !== game[key])) {
      throw new Error('Conflicting scheduled game identity');
    }
    games.set(id, { ...game, id, home, away });
  }
  return { season, scheduleAsOf, snapshotHash, teams, games };
}

function uniqueTeamNames(teams) {
  const names = new Map();
  for (const team of teams.values()) {
    const key = nameKey(team.name);
    names.set(key, names.has(key) ? null : team.id);
  }
  return names;
}

function getPlayer(team, playerId, name) {
  if (!team.players.has(playerId)) team.players.set(playerId, { id: playerId, name, position: null,
    jersey: null, height: null, weight: null, rosterListed: false, stats: {}, gameLogs: [] });
  return team.players.get(playerId);
}

export function normalizePlayerData(cache, schedule) {
  const { season, games, teams, scheduleAsOf } = schedule;
  if (cache?.schemaVersion !== 1 || cache.source !== 'cfbd' || cache.season !== season || !Number.isFinite(time(cache.asOf)) ||
      time(cache.asOf) < time(scheduleAsOf) || !Array.isArray(cache.roster?.rows) || !Array.isArray(cache.totals?.rows) || !Array.isArray(cache.weeks)) {
    throw new Error('The player cache does not match the published season and cutoff');
  }
  const names = uniqueTeamNames(teams);
  const groups = new Map([...teams].map(([id, team]) => [id, { ...team, players: new Map(), expected: new Set(), matched: new Set() }]));
  const evidence = { unmatchedRoster: 0, unmatchedTotals: 0, unmatchedBoxes: 0, duplicateBoxes: 0, coveredWeeks: [] };
  for (const game of games.values()) for (const id of [game.home, game.away]) groups.get(id)?.expected.add(game.id);
  for (const row of cache.roster.rows) {
    const team = groups.get(names.get(nameKey(row?.team))), playerId = identifier(row?.id);
    const name = cleanName([cleanName(row?.firstName), cleanName(row?.lastName)].filter(Boolean).join(' '));
    if (!team || !playerId || !name || (row.season != null && Number(row.season) !== season)) { evidence.unmatchedRoster++; continue; }
    const player = getPlayer(team, playerId, name);
    if (player.rosterListed) continue;
    Object.assign(player, { rosterListed: true, position: rosterPosition(row.position), jersey: quantity(row.jersey, { max: 199 }),
      height: quantity(row.height, { min: 48, max: 96, fraction: true }), weight: quantity(row.weight, { min: 90, max: 600 }) });
  }
  for (const row of cache.totals.rows) {
    const team = groups.get(names.get(nameKey(row?.team))), playerId = identifier(row?.playerId), name = cleanName(row?.player);
    if (!team || !playerId || !name || Number(row.season) !== season) { evidence.unmatchedTotals++; continue; }
    const player = getPlayer(team, playerId, name);
    player.position ??= rosterPosition(row.position);
    addStat(player.stats, row.category, row.statType, row.stat);
  }
  const observations = [];
  const seenWeeks = new Set();
  for (const batch of cache.weeks) {
    if (!Number.isInteger(batch?.week) || seenWeeks.has(batch.week) || !Array.isArray(batch.rows)) throw new Error('Invalid player box-score week');
    seenWeeks.add(batch.week);
    evidence.coveredWeeks.push(batch.week);
    for (const gameBox of batch.rows) {
      const game = games.get(identifier(gameBox?.id));
      if (!game || game.week !== batch.week || !Array.isArray(gameBox?.teams)) { evidence.unmatchedBoxes++; continue; }
      for (const box of gameBox.teams) {
        const side = box?.homeAway;
        if (side !== 'home' && side !== 'away') { evidence.unmatchedBoxes++; continue; }
        const team = groups.get(game[side]);
        const opponentId = game[side === 'home' ? 'away' : 'home'];
        const opponent = teams.get(opponentId);
        if (!team || names.get(nameKey(box.team)) !== team.id || !Array.isArray(box.categories) ||
            (box.points != null && quantity(box.points) !== game[`${side}Points`])) { evidence.unmatchedBoxes++; continue; }
        if (team.matched.has(game.id)) { evidence.duplicateBoxes++; continue; }
        const perPlayer = new Map();
        for (const category of box.categories) for (const metric of Array.isArray(category?.types) ? category.types : []) {
          for (const row of Array.isArray(metric?.athletes) ? metric.athletes : []) {
            const playerId = identifier(row?.id), name = cleanName(row?.name);
            if (!playerId || !name) continue;
            if (!perPlayer.has(playerId)) perPlayer.set(playerId, { name, stats: {} });
            addStat(perPlayer.get(playerId).stats, category.name, metric.name, row.stat);
          }
        }
        let hasStats = false;
        for (const [playerId, { name, stats }] of perPlayer) {
          if (!Object.keys(stats).length) continue;
          hasStats = true;
          const player = getPlayer(team, playerId, name);
          const log = { gameId: game.id, date: game.startDate, week: game.week, opponentId, opponentName: opponent?.name ?? null, stats };
          player.gameLogs.push(log);
          if (stats.passing) observations.push({ gameId: game.id, playerId, teamId: team.id,
            opponentId, division: team.division, opponentDivision: opponent?.division ?? null,
            kickoff: game.startDate, date: game.startDate, passing: stats.passing, rushing: stats.rushing ?? null,
            fumblesLost: stats.fumbles?.lost ?? null, opponentPregameRating: null });
        }
        if (hasStats) team.matched.add(game.id);
      }
    }
  }
  return { season, scheduleAsOf, asOf: cache.asOf, groups, observations, evidence };
}

export function buildPlayerPublications(data, qb = {}) {
  const files = new Map();
  for (const team of data.groups.values()) {
    const players = [...team.players.values()].map(player => {
      const qbRating = qb.ratings?.get(`${team.id}:${player.id}`);
      return { ...player, gameLogs: player.gameLogs.sort((a, b) => time(b.date) - time(a.date) || a.gameId.localeCompare(b.gameId)).slice(0, 5),
        ...(qbRating ? { qbRating } : {}) };
    }).sort((a, b) => Number(b.rosterListed) - Number(a.rosterListed) || (a.jersey ?? 999) - (b.jersey ?? 999) || a.name.localeCompare(b.name));
    if (!players.length) continue;
    files.set(team.id, { schemaVersion: 1, season: data.season, teamId: team.id, division: team.division,
      source: 'CollegeFootballData', scheduleAsOf: data.scheduleAsOf, asOf: data.asOf,
      coverage: { roster: players.filter(player => player.rosterListed).length, listedPositions: players.filter(player => player.rosterListed && player.position).length,
        seasonTotals: players.filter(player => Object.keys(player.stats).length).length, boxGames: team.matched.size, expectedGames: team.expected.size, logLimit: 5 },
      ...(qb.methodology ? { ratingMethod: qb.methodology } : {}), players });
  }
  return files;
}
