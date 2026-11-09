const roundIds = [
  ['r1-1', 'r1-2', 'r1-3', 'r1-4'], ['qf-1', 'qf-2', 'qf-3', 'qf-4'], ['sf-1', 'sf-2'], ['final'],
];
const kickoffTolerance = 2 * 60 * 60 * 1000;
const timestamp = value => typeof value === 'string' && /T\d\d:\d\d.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const score = value => Number.isSafeInteger(value) && value >= 0;

export function validateCfpBracket(bracket, season, teamNames) {
  const ids = roundIds.flat();
  const lock = timestamp(bracket?.lockAt);
  if (bracket?.season !== season || new Date(lock).getUTCFullYear() !== season ||
      !Array.isArray(bracket.slots) || bracket.slots.length !== ids.length) {
    throw new Error(`Expected a reviewed ${season} CFP field with 11 slots and a lock time`);
  }
  const earlier = new Map();
  const feeders = new Set();
  const teams = new Set();
  const slots = bracket.slots.map((slot, index) => {
    const { id, round, kickoff, home, away, homeFrom, awayFrom } = slot ?? {};
    const start = timestamp(kickoff);
    if (id !== ids[index] || !Number.isInteger(round) || !roundIds[round - 1]?.includes(id) ||
        !Number.isFinite(start) || start < lock || new Date(start).getUTCFullYear() > season + 1) {
      throw new Error(`Invalid CFP slot at position ${index + 1}`);
    }
    const sides = [[home, homeFrom], [away, awayFrom]];
    if (sides.filter(([, from]) => from !== null).length !== (round === 1 ? 0 : round === 2 ? 1 : 2)) {
      throw new Error(`Wrong number of feeders for ${id}`);
    }
    for (const [team, from] of sides) {
      if (from !== null) {
        const feeder = earlier.get(from);
        if (team !== null || !feeder || feeder.round !== round - 1 || feeder.start >= start || feeders.has(from)) {
          throw new Error(`Invalid CFP feeder for ${id}`);
        }
        feeders.add(from);
      } else {
        if (!teamNames.has(team) || teams.has(team)) throw new Error(`Unknown or duplicate CFP team in ${id}`);
        teams.add(team);
      }
    }
    earlier.set(id, { round, start });
    return { id, round, kickoff, home, away, homeFrom, awayFrom };
  });
  if (Math.min(...slots.map(slot => timestamp(slot.kickoff))) !== lock) throw new Error('CFP lock must equal the first kickoff');
  return { lockAt: bracket.lockAt, slots };
}

export function selectCfpResults(bracket, games, observedAt) {
  const cutoff = timestamp(observedAt);
  if (!Number.isFinite(cutoff)) throw new Error('Missing game-source cutoff for the CFP result sync');
  const results = {};
  const finals = games.filter(game => {
    const start = timestamp(game.startDate);
    return game.seasonType === 'postseason' && game.completed === true && start <= cutoff &&
      score(game.homePoints) && score(game.awayPoints) && game.homePoints !== game.awayPoints;
  });
  for (const slot of bracket.slots) {
    const home = slot.home ?? results[slot.homeFrom]?.winner;
    const away = slot.away ?? results[slot.awayFrom]?.winner;
    const scheduled = timestamp(slot.kickoff);
    if (!home || !away || scheduled > cutoff) continue;
    const matches = finals.filter(game => Math.abs(timestamp(game.startDate) - scheduled) <= kickoffTolerance &&
      ((game.home === home && game.away === away) || (game.home === away && game.away === home)));
    if (matches.length > 1) throw new Error(`Multiple confirmed postseason games match CFP slot ${slot.id}`);
    if (matches.length === 0) continue;
    const game = matches[0];
    const [homePoints, awayPoints] = game.home === home ? [game.homePoints, game.awayPoints] : [game.awayPoints, game.homePoints];
    results[slot.id] = { winner: homePoints > awayPoints ? home : away, homePoints, awayPoints };
  }
  return results;
}

export function readWeeklyCfpGames(picks, season) {
  if (picks?.season !== season || picks.source?.provider !== 'cfbd' || !Array.isArray(picks.teams) || !Array.isArray(picks.games)) {
    throw new Error(`No ${season} CFBD weekly result snapshot is available`);
  }
  const teams = new Map(picks.teams.map(({ id, name }) => [id, name]));
  return { observedAt: picks.source.scheduleAsOf, games: picks.games.map(game => ({
    ...game, completed: game.status === 'final', home: teams.get(game.home), away: teams.get(game.away),
  })) };
}

export async function fetchCfbdCfpGames(season, teamById, key, fetcher = fetch) {
  if (!key) throw new Error('Set the CFBD_API_KEY GitHub secret for playoff game-night checks');
  const url = `https://api.collegefootballdata.com/games?year=${season}&seasonType=postseason`;
  let response;
  try {
    response = await fetcher(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000), redirect: 'error' });
  } catch { throw new Error('CFBD postseason request could not connect'); }
  if (!response.ok) throw new Error(`CFBD postseason request failed (HTTP ${response.status})`);
  const rows = await response.json().catch(() => null);
  if (!Array.isArray(rows) || rows.some(row => row?.season !== season || row.seasonType !== 'postseason')) {
    throw new Error(`Invalid ${season} CFBD postseason data`);
  }
  return { observedAt: new Date().toISOString(), games: rows.map(row => ({
    ...row, home: teamById.get(String(row.homeId)), away: teamById.get(String(row.awayId)),
  })) };
}

export function cfpSyncCredentials(url, key) {
  let target;
  try { target = new URL(url); } catch { throw new Error('Configure the Supabase project URL for CFP sync'); }
  if (target.protocol !== 'https:' || target.origin + '/' !== target.href) throw new Error('CFP Supabase project URL must be an HTTPS origin');
  if (typeof key !== 'string' || !/^sb_secret_\S+$/.test(key)) throw new Error('Set CFP_SUPABASE_SECRET_KEY to a Supabase secret API key');
  return { endpoint: new URL('/rest/v1/rpc/cfp_sync', target), key };
}

export async function publishCfpSync({ endpoint, key }, season, bracket, results, { observedAt = null, fetcher = fetch } = {}) {
  if (Object.keys(results).length && !Number.isFinite(timestamp(observedAt))) throw new Error('A CFP score update requires the game-source cutoff');
  let response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_season: season, p_bracket: bracket, p_results: results, p_observed_at: observedAt }),
      signal: AbortSignal.timeout(30_000), redirect: 'error',
    });
  } catch { throw new Error('Supabase CFP sync could not connect'); }
  if (!response.ok) throw new Error(`Supabase CFP sync failed (HTTP ${response.status})`);
}
