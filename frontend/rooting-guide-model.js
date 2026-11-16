import { calculateScenario } from './cfp-scenario-model.js';
import { SCENARIO_CHAMPION_CONFERENCES, selectScenarioField } from './cfp-scenario-field.js';

const nextSevenDays = 7 * 86_400_000;
const candidateLimit = 5;
const recommendationLimit = 3;
const minimumScoreSwing = 0.001;

export function rootingCandidates(input, teamId, now) {
  const teams = new Map(input.teams.map(team => [team.id, team]));
  const favorite = teams.get(teamId);
  if (favorite?.division !== 'fbs' || !Number.isFinite(now)) return [];
  const opponents = new Set();
  for (const game of input.games) {
    if (game.a === teamId) opponents.add(game.b);
    if (game.b === teamId) opponents.add(game.a);
  }
  const rankGap = id => {
    const rank = teams.get(id)?.baselineRank;
    return Number.isInteger(rank) && Number.isInteger(favorite.baselineRank) ? Math.abs(rank - favorite.baselineRank) : Infinity;
  };
  return input.fixtures.flatMap(game => {
    const kickoff = Date.parse(game.startDate);
    const participants = [game.home, game.away];
    if (game.status !== 'scheduled' || game.startTimeTbd !== false || !Number.isFinite(kickoff) ||
        kickoff <= now || kickoff > now + nextSevenDays || participants.includes(teamId)) return [];
    const pastOpponents = participants.filter(id => opponents.has(id));
    const gap = Math.min(...participants.map(rankGap));
    const conferenceRival = participants.some(id => teams.get(id)?.conference === favorite.conference);
    const relevance = pastOpponents.length ? 0 : gap <= 10 ? 1 : conferenceRival ? 2 : 3;
    return [{ game, pastOpponents, relevance, gap, kickoff }];
  }).sort((a, b) => a.relevance - b.relevance || b.pastOpponents.length - a.pastOpponents.length ||
    (a.gap === b.gap ? 0 : a.gap - b.gap) || a.kickoff - b.kickoff || a.game.id.localeCompare(b.game.id))
    .slice(0, candidateLimit);
}

export function rootingCacheVersion(input, teamId, candidates) {
  const slate = candidates.map(({ game }) => [game.id, game.home, game.away, game.startDate, game.neutral, game.week, game.seasonType]);
  return JSON.stringify([1, input.season, input.snapshotHash, input.asOf, teamId, slate]);
}

export function rootingChampions(rankedTeams) {
  const champions = {};
  for (const name of SCENARIO_CHAMPION_CONFERENCES) {
    const team = rankedTeams.find(row => row.conference === name && Number.isInteger(row.displayRank) && row.displayRank > 0);
    if (!team) return null;
    champions[name] = team.id;
  }
  return champions;
}

function scenarioTeam(rows, teamId, champions) {
  const team = rows.find(row => row.id === teamId);
  if (!Number.isInteger(team?.sorRank) || !Number.isFinite(team.sor)) return null;
  let field = null;
  if (champions) {
    try { field = selectScenarioField(rows, champions).field.find(row => row.id === teamId)?.seed ?? 0; }
    catch { /* The field is available only when the published rules apply to these rows. */ }
  }
  return { rank: team.sorRank, sor: team.sor, seed: field };
}

export function compareRootingOutcome(input, teamId, candidate, champions, calculateDivisionSor) {
  const { game, pastOpponents } = candidate;
  const outcome = winner => scenarioTeam(calculateScenario(input, { [game.id]: winner }, [], calculateDivisionSor), teamId, champions);
  const home = outcome(game.home), away = outcome(game.away);
  if (!home || !away) return null;
  if (home.seed === null || away.seed === null) home.seed = away.seed = null;
  const fieldSwitch = home.seed !== null && Number(Boolean(away.seed)) - Number(Boolean(home.seed));
  const byeSwitch = home.seed > 0 && away.seed > 0 && Number(away.seed <= 4) - Number(home.seed <= 4);
  const seedDifference = home.seed > 0 && away.seed > 0 && home.seed - away.seed;
  const rankDifference = home.rank - away.rank;
  const scoreDifference = Math.abs(home.sor - away.sor) >= minimumScoreSwing ? home.sor - away.sor : 0;
  const decision = fieldSwitch || byeSwitch || seedDifference || rankDifference || -scoreDifference;
  if (!decision) return null;
  const priority = fieldSwitch ? 5 : byeSwitch ? 4 : seedDifference ? 3 : rankDifference ? 2 : 1;
  const swing = Math.abs(fieldSwitch || byeSwitch || seedDifference || rankDifference || scoreDifference);
  return { game, pastOpponents, winner: decision < 0 ? game.home : game.away, home, away, priority, swing };
}

export function topRootingRecommendations(results) {
  return results.filter(Boolean).sort((a, b) => b.priority - a.priority || b.swing - a.swing ||
    b.pastOpponents.length - a.pastOpponents.length || a.game.startDate.localeCompare(b.game.startDate) ||
    a.game.id.localeCompare(b.game.id)).slice(0, recommendationLimit);
}
