const count = value => Number.isFinite(value) && value >= 0 ? value : null;
const label = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const sum = (lines, field) => lines.every(line => line[field] !== null)
  ? lines.reduce((total, line) => total + line[field], 0) : null;
const ratio = (numerator, denominator) => numerator !== null && denominator > 0 ? numerator / denominator : null;
const averageFields = ['minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers'];

function shots(value) {
  const made = count(value?.made);
  const attempted = count(value?.attempted);
  return made !== null && attempted !== null && made <= attempted ? { made, attempted } : { made: null, attempted: null };
}

function playerLine(player, game) {
  const name = label(player?.name);
  if (!name || !Number.isSafeInteger(player.athleteId) || player.athleteId < 1) return null;
  const minutes = count(player.minutes);
  const recordedPlay = minutes > 0 || ['points', 'assists', 'steals', 'blocks', 'turnovers'].some(field => player[field] > 0)
    || player.rebounds?.total > 0;
  if (!recordedPlay) return null;
  return {
    id: String(player.athleteId), name, position: label(player.position), gameId: game.id, startDate: game.startDate, minutes,
    points: count(player.points), rebounds: count(player.rebounds?.total), assists: count(player.assists),
    steals: count(player.steals), blocks: count(player.blocks), turnovers: count(player.turnovers),
    fieldGoals: shots(player.fieldGoals), threes: shots(player.threePointFieldGoals), freeThrows: shots(player.freeThrows),
  };
}

function playerSummary(lines) {
  const newest = lines.at(-1);
  const shooting = field => lines.every(line => line[field].attempted !== null)
    ? lines.reduce((totals, line) => ({
      made: totals.made + line[field].made, attempted: totals.attempted + line[field].attempted,
    }), { made: 0, attempted: 0 }) : { made: null, attempted: null };
  const fg = shooting('fieldGoals'), three = shooting('threes'), ft = shooting('freeThrows');
  const trueShootingAttempts = fg.attempted === null || ft.attempted === null ? null : fg.attempted + 0.44 * ft.attempted;
  return {
    id: newest.id, name: newest.name, position: [...lines].reverse().find(line => line.position)?.position ?? null, games: lines.length,
    ...Object.fromEntries(averageFields.map(field => [field, ratio(sum(lines, field), lines.length)])),
    fgPct: ratio(fg.made, fg.attempted), threePct: ratio(three.made, three.attempted), ftPct: ratio(ft.made, ft.attempted),
    threeMade: ratio(three.made, lines.length), threeAttempts: ratio(three.attempted, lines.length),
    trueShootingPct: ratio(sum(lines, 'points'), trueShootingAttempts === null ? null : 2 * trueShootingAttempts),
    recent: lines.slice(-3).reverse().map(({ gameId, minutes, points, rebounds, assists }) => ({
      gameId, minutes, points, rebounds, assists,
    })),
  };
}

export function basketballPlayerStats({ season, teams, games, playerRows }) {
  const gameByProviderId = new Map(games.filter(game => game.completed).map(game => [game.providerId, game]));
  const teamByProviderId = new Map(teams.map(team => [team.providerId, team.id]));
  const playerSides = new Map();
  const rejected = new Set();
  for (const row of playerRows) {
    const game = gameByProviderId.get(row.gameId);
    if (!game) continue;
    const team = teamByProviderId.get(row.teamId);
    if (!team) continue;
    const side = row.isHome === true ? 'home' : row.isHome === false ? 'away' : null;
    const key = `${game.id}|${team}`;
    const opposite = side === 'home' ? 'away' : 'home';
    if (row.season !== season || !side || game[side] !== team || game[opposite] !== `ncaam-d1:${row.opponentId}`
      || Date.parse(row.startDate) !== Date.parse(game.startDate) || !Array.isArray(row.players)) {
      rejected.add(key);
      continue;
    }
    const lines = row.players.map(player => playerLine(player, game)).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
    if (new Set(lines.map(player => player.id)).size !== lines.length
      || (playerSides.has(key) && JSON.stringify(playerSides.get(key).lines) !== JSON.stringify(lines))) {
      rejected.add(key);
      continue;
    }
    if (lines.length) playerSides.set(key, { game, team, lines });
  }

  const byTeam = new Map();
  const gamesWithPlayers = new Set();
  let fullyCoveredDivisionOneGames = 0;
  for (const [key, { game, team, lines }] of playerSides) {
    if (rejected.has(key)) continue;
    if (!byTeam.has(team)) byTeam.set(team, new Map());
    const players = byTeam.get(team);
    for (const line of lines) {
      if (!players.has(line.id)) players.set(line.id, []);
      players.get(line.id).push(line);
    }
    gamesWithPlayers.add(game.id);
    if (game.divisionOne && team === game.home) {
      const awayKey = `${game.id}|${game.away}`;
      if (playerSides.has(awayKey) && !rejected.has(awayKey)) fullyCoveredDivisionOneGames++;
    }
  }
  const playerStats = Object.fromEntries([...byTeam].sort(([a], [b]) => a.localeCompare(b)).map(([id, players]) => [id,
    [...players.values()].map(lines => playerSummary(lines.sort((a, b) =>
      a.startDate.localeCompare(b.startDate) || a.gameId.localeCompare(b.gameId))))
      .sort((a, b) => (b.points ?? -1) - (a.points ?? -1) || b.games - a.games || a.id.localeCompare(b.id)),
  ]));
  return { playerStats, coverage: {
    playerRows: playerRows.length, playerTeams: byTeam.size,
    playerTeamMemberships: Object.values(playerStats).reduce((total, team) => total + team.length, 0),
    gamesWithPlayers: gamesWithPlayers.size, divisionOneFinalsWithBothPlayerBoxes: fullyCoveredDivisionOneGames,
    rejectedPlayerBoxSides: rejected.size,
  } };
}
