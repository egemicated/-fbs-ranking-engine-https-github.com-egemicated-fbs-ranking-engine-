const knownDivision = team => team?.division === 'fbs' || team?.division === 'fcs';

function eligibleMatchup(home, away) {
  return knownDivision(home) && knownDivision(away) && home.id !== away.id &&
    (home.division === 'fbs' || away.division === 'fbs');
}

export function predictScenarioGame(input, home, away, neutral) {
  const homeTeam = input.teams.find(team => team.id === home);
  const awayTeam = input.teams.find(team => team.id === away);
  const { probabilityScale, homeAdvantage } = input.predictive ?? {};
  if (!eligibleMatchup(homeTeam, awayTeam) || typeof neutral !== 'boolean' ||
      !Number.isFinite(homeTeam.strength) || !Number.isFinite(awayTeam.strength) ||
      !Number.isFinite(probabilityScale) || probabilityScale <= 0 ||
      !Number.isFinite(homeAdvantage) || homeAdvantage < 0) return null;
  const margin = homeTeam.strength - awayTeam.strength + (neutral ? 0 : homeAdvantage);
  return 1 / (1 + Math.exp(-margin / probabilityScale));
}

function fixtureMap(fixtures) {
  if (!Array.isArray(fixtures)) throw new Error('Scenario fixtures are missing.');
  const byId = new Map();
  for (const fixture of fixtures) {
    if (!fixture || typeof fixture.id !== 'string' || !fixture.id || byId.has(fixture.id)) {
      throw new Error('Scenario fixtures contain an invalid or repeated game ID.');
    }
    byId.set(fixture.id, fixture);
  }
  return byId;
}

function selectedGames(fixtures, picks) {
  if (!picks || typeof picks !== 'object' || Array.isArray(picks)) throw new Error('Scenario picks must use game IDs.');
  return Object.entries(picks).map(([id, winner]) => {
    const game = fixtures.get(id);
    if (!game || (winner !== game.home && winner !== game.away)) {
      throw new Error(`Choose one of the teams playing in scenario game ${id}.`);
    }
    return [game, winner];
  });
}

export function fillScenarioFavorites(fixtures, picks = {}) {
  const byId = fixtureMap(fixtures);
  const winners = new Map(selectedGames(byId, picks).map(([game, winner]) => [game.id, winner]));
  for (const game of byId.values()) {
    const probability = game.homeWinProbability;
    if (winners.has(game.id) || !Number.isFinite(probability) || probability < 0 || probability > 1 || probability === 0.5) continue;
    winners.set(game.id, probability > 0.5 ? game.home : game.away);
  }
  return Object.fromEntries(winners);
}

export function calculateScenario(input, picks, customGames, calculateDivisionSor) {
  if (!input || !Array.isArray(input.teams) || !Array.isArray(input.games) || !Array.isArray(customGames)) {
    throw new Error('Scenario data is incomplete.');
  }
  const teams = new Map(input.teams.map(team => [team.id, team]));
  const completed = new Set(input.games.map(game => game.id));
  const fixtures = fixtureMap(input.fixtures);
  const usedIds = new Set([...completed, ...fixtures.keys()]);
  const added = [];
  function add(game, winner) {
    if (!eligibleMatchup(teams.get(game.home), teams.get(game.away)) || typeof game.neutral !== 'boolean' ||
        (winner !== game.home && winner !== game.away)) {
      throw new Error('Each scenario game needs two eligible teams, a venue, and a winner.');
    }
    added.push({ id: game.id, a: game.home, b: game.away,
      outcome: winner === game.home ? 1 : -1, venue: game.neutral ? 0 : 1 });
  }
  for (const [game, winner] of selectedGames(fixtures, picks)) {
    if (completed.has(game.id)) throw new Error(`Scenario game ${game.id} is already complete.`);
    if (game.status !== 'scheduled' && game.status !== 'pending') throw new Error(`Scenario game ${game.id} is unavailable.`);
    add(game, winner);
  }
  const customMatchups = new Set();
  for (const game of customGames) {
    if (!game || typeof game.id !== 'string' || !game.id || usedIds.has(game.id)) {
      throw new Error('Each custom game needs a new game ID.');
    }
    const matchup = JSON.stringify([game.home, game.away].sort());
    if (customMatchups.has(matchup)) throw new Error('This matchup is already in the custom games.');
    add(game, game.winner);
    usedIds.add(game.id);
    customMatchups.add(matchup);
  }
  const result = calculateDivisionSor({ year: input.season, teams: input.teams, games: [...input.games, ...added] }, input.parameters);
  return result.rows.map(({ id, sorRank, sor, wins, losses }) => {
    const team = teams.get(id);
    return { id, name: team.name, conference: team.conference, sorRank, sor: sor === 0 ? 0 : sor, wins, losses,
      baselineRank: team.baselineRank ?? null };
  });
}
