import assert from 'node:assert/strict';
import test from 'node:test';
import { rankSeason, solveGraph } from '../src/engine.js';
import { publishFcsSnapshot } from '../src/fcs-publication.js';
import { outcomeDataset } from '../src/publication.js';
import { publicRankings, publicTeamDetails } from '../src/site-publication.js';

const parameters = { slope: 5.15, homeLogOdds: 0.38, divisionLogOdds: 2.40 };
const teams = [['top', 'fbs'], ['a', 'fcs'], ['b', 'fcs'], ['idle', 'fcs'], ['lower', 'ii']]
  .map(([id, division]) => ({ id, name: id, division, conference: division }));
const game = (id, home, away, homePoints, awayPoints, neutral = false) => ({ id, home, away, homePoints, awayPoints,
  completed: true, neutral, week: 1, seasonType: 'regular', startDate: '2026-09-01T18:00:00Z' });

function referenceWinProbability(dataset, heldOut, subject) {
  const ids = new Map(dataset.teams.map((team, i) => [team.id, i]));
  const edges = [], rhs = new Float64Array(ids.size);
  for (const match of dataset.games.filter(match => match.id !== heldOut.id)) {
    const a = ids.get(match.a), b = ids.get(match.b);
    edges.push([a, b]);
    rhs[a] += match.outcome / 2;
    rhs[b] -= match.outcome / 2;
  }
  const scores = solveGraph(ids.size, edges, rhs, 2).map(value => value + 0.5);
  const reference = dataset.teams.filter(team => team.division === 'fcs');
  const average = reference.reduce((sum, team) => sum + scores[ids.get(team.id)], 0) / reference.length;
  const side = heldOut.a === subject ? 1 : -1;
  const opponent = ids.get(side === 1 ? heldOut.b : heldOut.a);
  const subdivision = dataset.teams[opponent].division === 'fbs' ? -parameters.divisionLogOdds : 0;
  const logOdds = parameters.slope * (average - scores[opponent]) + parameters.homeLogOdds * heldOut.venue * side + subdivision;
  return 1 / (1 + Math.exp(-logOdds));
}

test('FCS publication matches explicit game-excluded fits and preserves the FBS projection', () => {
  const base = rankSeason({ year: 2026, teams, games: [
    game('cross', 'top', 'a', 34, 17),
    game('peer', 'b', 'a', 17, 20, true),
    game('other', 'a', 'lower', 28, 7),
  ] });
  const result = publishFcsSnapshot(base, { parameters });
  assert.equal(result.rankings, base.rankings);
  assert.equal(result.ratings, base.ratings);
  assert.equal(result.fcsTeams, 3);
  const a = result.fcsRankings.find(row => row.id === 'a');
  assert.deepEqual([a.wins, a.losses, a.sorWins, a.sorGames, a.sorExcludedGames], [2, 1, 1, 2, 1]);
  const dataset = outcomeDataset(base);
  const cross = referenceWinProbability(dataset, dataset.games.find(match => match.id === 'cross'), 'a');
  const peer = referenceWinProbability(dataset, dataset.games.find(match => match.id === 'peer'), 'a');
  assert.ok(Math.abs(a.sorExpectedWins - (cross + peer)) < 1e-10);
  assert.ok(Math.abs(a.sorTailProbability - (1 - (1 - cross) * (1 - peer))) < 1e-10);
  assert.ok(Math.abs(a.sor + Math.log10(a.sorTailProbability)) < 1e-10);
  const idle = result.fcsRankings.find(row => row.id === 'idle');
  assert.deepEqual([idle.displayRank, idle.strengthRank, idle.sor], [null, null, null]);
  const published = publicRankings(result, '/rankings/teams');
  assert.deepEqual(published.rankings, publicRankings(base, '/rankings/teams').rankings);
  assert.equal(published.fcsRankings.find(row => row.id === 'a').contributions, undefined);
  assert.equal(publicTeamDetails(result, a).contributions.length, 3);
  assert.equal(publicTeamDetails(result, a).sorGames, 2);
});
