import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bracketEdition, bracketTeams, buildBracket, chooseBasketballWinner, fillBasketballBracket,
  gradeBasketballBracket, practiceBasketballField, projectBasketballField, reconcileBracketPicks,
  tournamentSize, validateBasketballSubmission,
} from '../basketball/bracket.js';
import {historicalBasketballField} from '../basketball/bracket-archive.js';

const upcoming = buildBracket(practiceBasketballField(2027));
const archive = buildBracket(historicalBasketballField(2026));
const opening = upcoming.games.filter(game => game.round === 0);

test('the 76-team format connects 12 Opening Round winners and 52 other teams to 32 First Round games', () => {
  assert.equal(upcoming.teamCount, 76);
  assert.equal(upcoming.games.length, 75);
  assert.equal(new Set(upcoming.games.map(game => game.id)).size, 75);
  assert.equal(opening.length, 12);
  const first = upcoming.games.filter(game => game.round === 1);
  assert.equal(first.length, 32);
  const feeds = first.flatMap(game => game.sides);
  assert.equal(feeds.filter(side => side.team).length, 52);
  assert.deepEqual(feeds.flatMap(side => side.from ? [side.from] : []).sort(), opening.map(game => game.id).sort());
  assert.equal(upcoming.games.at(-1).id, 'championship');
});

test('historical tournament editions keep their original format', () => {
  assert.deepEqual([1999, 2008, 2015, 2020, 2026, 2027].map(tournamentSize), [64, 65, 68, null, 68, 76]);
  assert.equal(buildBracket(practiceBasketballField(2008)).games.length, 64);
  assert.equal(archive.games.length, 67);
  assert.equal(archive.games.filter(game => game.round === 0).length, 4);
  assert.equal(Object.keys(archive.results).length, 67);
  assert.equal(archive.teams[archive.results.championship.winner].name, 'Michigan');
  assert.deepEqual(archive.results.championship.scores, [63, 69]);
  assert.equal(archive.teams[archive.results['midwest-opening-16'].winner].name, 'Howard');
  assert.equal(archive.teams[archive.results['west-opening-11'].winner].name, 'Texas');
  const actual = Object.fromEntries(Object.entries(archive.results).map(([id, result]) => [id, result.winner]));
  assert.deepEqual(gradeBasketballBracket(archive, actual), {correct: 67, graded: 67});
});

test('pick validation rejects impossible winners and invalidates only the dependent path', () => {
  const opener = opening[0];
  const [original, alternate] = opener.sides.map(side => side.team);
  const destination = upcoming.games.find(game => game.sides.some(side => side.from === opener.id));
  const initial = fillBasketballBracket(upcoming, (a,b) => (a === original || b === original) ? (a === original ? .75 : .25) : .63);
  assert.equal(Object.keys(initial).length, 75);
  assert.equal(initial[opener.id], original);
  assert.equal(initial[destination.id], original);
  assert.equal(initial.championship, original);
  assert.deepEqual(chooseBasketballWinner(upcoming, {}, destination.id, 'anything'), {});
  const next = chooseBasketballWinner(upcoming, initial, opener.id, alternate);
  assert.equal(next[opener.id], alternate);
  assert.ok(bracketTeams(destination, next).includes(alternate));
  assert.equal(next[destination.id], undefined);
  assert.equal(next.championship, undefined);
  assert.equal(next[opening[1].id], initial[opening[1].id]);
  assert.deepEqual(reconcileBracketPicks(upcoming, JSON.parse(JSON.stringify(next))), next);
});

test('projection chooses one AQ per league, 44 at-large and one valid championship path', () => {
  const ranked = Array.from({length: 128}, (_, i) => ({
    id: String(i + 1), name: 'Team ' + (i + 1), conference: 'League ' + (1 + (i % 32)), sorRank: i + 1,
  }));
  assert.equal(projectBasketballField(2027, ranked.filter(team => team.conference !== 'League 4')), null);
  assert.equal(projectBasketballField(2026, ranked), null);
  const projection = buildBracket(projectBasketballField(2027, ranked, {excludedTeamIds: [1]}));
  const list = Object.values(projection.teams);
  assert.equal(list.length, 76);
  assert.equal(projection.teams[1], undefined);
  assert.equal(list.filter(team => team.bid === 'Projected automatic').length, 32);
  assert.equal(list.filter(team => team.bid === 'Projected at-large').length, 44);
  const aqGames = projection.games.filter(game => game.round === 0 && game.sides.every(side => projection.teams[side.team].bid === 'Projected automatic'));
  assert.deepEqual(aqGames.map(game => projection.teams[game.sides[0].team].seed).sort(), [15,15,16,16,16,16]);
  assert.ok(fillBasketballBracket(projection, () => .52).championship);
});

test('validation rejects duplicate entrants, incorrect placements, and stale downstream official results', () => {
  const duplicate = practiceBasketballField(2027);
  duplicate.regions[1].slots[0].teams[0] = duplicate.regions[0].slots[0].teams[0];
  assert.throws(() => buildBracket(duplicate), /duplicate entrant/);
  const reusedRegion = practiceBasketballField(2027);
  reusedRegion.semifinalPairs[0][0] = reusedRegion.semifinalPairs[1][0];
  assert.throws(() => buildBracket(reusedRegion), /every region/);
  const original = historicalBasketballField(2026);
  const corrected = structuredClone(original);
  corrected.results['midwest-opening-16'].scores = [89, 86];
  assert.throws(() => buildBracket(corrected), /participants must match/);
  delete corrected.results['midwest-r1-1'];
  assert.throws(() => buildBracket(corrected), /participants must match/);
});

test('server validation accepts an official complete draft only before its authoritative lock', () => {
  const lockAt = '2026-03-17T20:00:00.000Z';
  const field = buildBracket({...historicalBasketballField(2026), lockAt});
  const picks = fillBasketballBracket(field, () => .51);
  const edition = bracketEdition(field);
  const before = Date.parse(lockAt) - 1;
  assert.deepEqual(validateBasketballSubmission(field, {picks, edition}, before), picks);
  assert.throws(() => validateBasketballSubmission(field, {picks, edition}, before + 1), /locked/);
  assert.throws(() => validateBasketballSubmission(field, {picks, edition: 'unknown'}, before), /official edition/);
  assert.throws(() => validateBasketballSubmission(field, {picks: {}, edition}, before), /one reachable winner/);
  assert.throws(() => validateBasketballSubmission(upcoming, {picks, edition}, before), /unavailable or locked/);
});
