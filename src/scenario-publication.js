import { readFile } from 'node:fs/promises';
import { solveGraph } from './engine.js';
import { outcomeDataset } from './publication.js';
import { predictScenarioGame } from '../frontend/cfp-scenario-model.js';
import { SCENARIO_CFP_SEASON, SCENARIO_CFP_SELECTION_AT } from '../frontend/cfp-scenario-field.js';

const probability = value => Number.isFinite(value) && value >= 0 && value <= 1;
const knownDivision = team => team?.division === 'fbs' || team?.division === 'fcs';
const selectionDay = Date.parse(SCENARIO_CFP_SELECTION_AT);

export function buildScenarioPublication(snapshot, weekly, policy) {
  if (snapshot?.season !== SCENARIO_CFP_SEASON || Date.parse(snapshot.asOf) >= selectionDay) return null;
  if (!snapshot?.snapshotHash || weekly?.season !== snapshot.season ||
      weekly.source?.snapshotHash !== snapshot.snapshotHash || weekly.source?.rankingAsOf !== snapshot.asOf ||
      !Number.isFinite(Date.parse(snapshot.asOf)) || !Array.isArray(weekly.games)) {
    throw new Error('The scenario schedule and rankings need the same saved snapshot.');
  }
  const parameters = policy?.parameters;
  if (!parameters || !['slope', 'homeLogOdds', 'divisionLogOdds'].every(key => Number.isFinite(parameters[key]))) {
    throw new Error('Scenario Strength of Record parameters are missing.');
  }
  const dataset = outcomeDataset(snapshot);
  const strengths = new Map(snapshot.ratings.map(team => [team.id, team.strength]));
  const baseline = new Map(snapshot.rankings.map(team => [team.id, team.displayRank]));
  const teams = dataset.teams.map(team => {
    const strength = strengths.get(team.id);
    const baselineRank = baseline.get(team.id);
    return { ...team, ...(knownDivision(team) && Number.isFinite(strength) ? { strength } : {}),
      ...(Number.isInteger(baselineRank) ? { baselineRank } : {}) };
  });
  const predictive = {
    probabilityScale: weekly.source.probabilityScale ?? snapshot.config.probabilityScale,
    homeAdvantage: weekly.source.homeAdvantage ?? snapshot.config.homeAdvantage,
  };
  if (!Number.isFinite(predictive.probabilityScale) || predictive.probabilityScale <= 0 ||
      !Number.isFinite(predictive.homeAdvantage) || predictive.homeAdvantage < 0) {
    throw new Error('Scenario Strength probability settings are invalid.');
  }
  const input = { season: dataset.year, asOf: snapshot.asOf, snapshotHash: snapshot.snapshotHash,
    parameters: { ...parameters }, teams, games: dataset.games, fixtures: [], predictive };
  const byId = new Map(teams.map(team => [team.id, team]));
  const completed = new Set(dataset.games.map(game => game.id));
  const canceled = new Set((snapshot.source?.audit?.confirmedCanceledRecords ?? []).map(row => String(row.id)));
  const fixtureIds = new Set();
  for (const game of weekly.games) {
    if ((game.seasonType !== 'regular' && game.seasonType !== 'postseason') ||
        (game.status !== 'scheduled' && game.status !== 'pending') || Date.parse(game.startDate) >= selectionDay ||
        completed.has(game.id) || canceled.has(game.id)) continue;
    const home = byId.get(game.home), away = byId.get(game.away);
    if (!knownDivision(home) || !knownDivision(away) || (home.division !== 'fbs' && away.division !== 'fbs')) continue;
    if (typeof game.id !== 'string' || !game.id || fixtureIds.has(game.id) || home.id === away.id ||
        typeof game.neutral !== 'boolean' || !Number.isInteger(game.week) || !Number.isFinite(Date.parse(game.startDate))) {
      throw new Error('The scenario schedule contains an invalid or repeated fixture.');
    }
    fixtureIds.add(game.id);
    let homeWinProbability, probabilitySource;
    if (probability(game.pick?.homeWinProbability)) {
      homeWinProbability = game.pick.homeWinProbability;
      probabilitySource = 'saved';
    } else if (probability(game.estimate?.homeWinProbability)) {
      homeWinProbability = game.estimate.homeWinProbability;
      probabilitySource = 'estimate';
    } else {
      homeWinProbability = predictScenarioGame(input, game.home, game.away, game.neutral);
      probabilitySource = homeWinProbability === null ? null : 'snapshot';
    }
    const { id, week, seasonType, startDate, neutral, status } = game;
    input.fixtures.push({ id, home: game.home, away: game.away, week, seasonType, startDate, neutral, status,
      homeWinProbability, probabilitySource });
  }
  return input;
}

export async function browserSorSource() {
  const candidate = await readFile(new URL('../research/lib/division_candidate.mjs', import.meta.url), 'utf8');
  const serverImport = "import { solveGraph } from '../../src/engine.js';";
  if (candidate.split(serverImport).length !== 2) throw new Error('The frozen SOR calculator import changed.');
  return candidate.replace(serverImport, solveGraph.toString());
}
