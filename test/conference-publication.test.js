import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { conferenceGames, conferenceRecords, conferenceSummary } from '../frontend/conference-metrics.js';
import { buildConferenceDataset, loadConferencePublications } from '../src/conference-publication.js';

const root = resolve(import.meta.dirname, '..');
const read = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const current = Promise.all([
  read('published/latest.json'), read('published/weekly-picks.json'),
  read('published/performance-latest.json'), read('frontend/ranking-history.json'), read('frontend/ranking-editions.json'),
]).then(([snapshot, fbsPicks, performance, rankingHistory, rankingEditions]) =>
  ({ snapshot, fbsPicks, performance, rankingHistory, rankingEditions }));
const sec = (dataset, conferenceB, method = 'cfp') => conferenceGames(dataset, { conferenceA: 'SEC', conferenceB, method });

test('November 18 results reconcile with the November 17 CFP edition for all seven SEC games', async t => {
  const input = await current;
  if (input.snapshot.season !== 2026) return t.skip('November 2026 checkpoints are required');
  const cutoff = Date.parse('2026-11-18T12:30:09.923Z');
  const cfp = input.rankingEditions.polls.cfp.find(edition => edition.released === '2026-11-17');
  assert.ok(cfp, 'November 17 CFP archive');
  const dataset = buildConferenceDataset({
    ...input,
    fbsPicks: { ...input.fbsPicks, games: input.fbsPicks.games.filter(game => Date.parse(game.startDate) <= cutoff) },
    rankingEditions: { ...input.rankingEditions, polls: { ...input.rankingEditions.polls, cfp: [cfp] } },
  });
  assert.equal(dataset.conferences.length, 11);
  const bigTen = sec(dataset, 'Big Ten');
  const bigTwelve = sec(dataset, 'Big 12');
  const results = rows => rows.map(row => [row.team.name, row.opponent.name, row.teamPoints, row.opponentPoints,
    row.result, row.opponentRank.current]).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(results(bigTen), [
    ['Mississippi State', 'Minnesota', 38, 13, 'win', null],
    ['Oklahoma', 'Michigan', 10, 17, 'loss', null],
    ['Texas', 'Ohio State', 24, 23, 'win', 14],
  ]);
  assert.deepEqual(results(bigTwelve), [
    ['Arkansas', 'Utah', 10, 43, 'loss', 2],
    ['Auburn', 'Baylor', 17, 16, 'win', null],
    ['Missouri', 'Kansas', 38, 21, 'win', null],
    ['Texas A&M', 'Arizona State', 48, 20, 'win', null],
  ]);
  const combined = [...bigTen, ...bigTwelve];
  assert.ok(combined.every(row => row.opponentRank.currentAvailable && !row.opponentRank.pregameAvailable));
  assert.equal(conferenceSummary(dataset, 'SEC', combined).currentTop25Wins, 1);
  const matrix = conferenceRecords(dataset).matrix;
  for (const [opponent, win, loss] of [['Big Ten', 2, 1], ['Big 12', 3, 1]]) {
    const a = matrix.SEC[opponent], b = matrix[opponent].SEC;
    assert.deepEqual([a.wins, a.losses, b.wins, b.losses], [win, loss, loss, win]);
  }
  assert.ok(conferenceSummary(dataset, 'SEC', sec(dataset, 'Big Ten', 'sor')).averageOpponentRank > 0);
  assert.equal(conferenceSummary(dataset, 'SEC', bigTen).averageOpponentRank, null);
});

test('an independent poll release updates the current view without leaking into a pregame rank', async t => {
  const input = await current;
  if (input.snapshot.season !== 2026) return t.skip('November 2026 checkpoints are required');
  const cfp = input.rankingEditions.polls.cfp.find(edition => edition.released === '2026-11-17');
  const newlyReleased = new Date(Date.parse(input.snapshot.source.fetchedAt) + 3 * 864e5).toISOString().slice(0, 10);
  const dataset = buildConferenceDataset({
    ...input,
    rankingEditions: { season: 2026, polls: { cfp: [
      { ...cfp, released: newlyReleased },
      { ...cfp, released: '2026-09-12', gamesThrough: '2026-09-11' },
    ] } },
  });
  const ohioState = sec(dataset, 'Big Ten').find(row => row.id === '401856682');
  assert.equal(dataset.rankings.cfp.asOf, newlyReleased);
  assert.equal(ohioState.opponentRank.current, 14);
  assert.equal(ohioState.opponentRank.pregame, null);
  assert.equal(ohioState.opponentRank.pregameAvailable, false);
});

test('current dataset accepts only aligned sources and unique finalized results', async () => {
  const input = await current;
  assert.ok(buildConferenceDataset(input));
  assert.equal(buildConferenceDataset({ ...input, fbsPicks: {
    ...input.fbsPicks, source: { ...input.fbsPicks.source, scheduleAsOf: '2020-01-01T00:00:00Z' },
  } }), null);
  const original = buildConferenceDataset(input);
  const game = input.fbsPicks.games.find(game => game.id === original.games[0].id);
  const future = { ...game, id: 'future', startDate: '2099-01-01T00:00:00Z' };
  const pending = { ...game, id: 'pending', status: 'scheduled' };
  const dataset = buildConferenceDataset({
    ...input, fbsPicks: { ...input.fbsPicks, games: [...input.fbsPicks.games, game, future, pending] },
    performance: { ...input.performance, baseSnapshotHash: 'stale-experimental' },
  });
  assert.deepEqual(dataset.games, original.games);
  assert.equal(dataset.rankings.performance.available, false);
  assert.ok(Object.values(dataset.teams).every(team => team.ranks.performance === null));
});

test('2025 conference archive preserves results and model values while adding verified historical comparison polls', async () => {
  const input = await current;
  const { manifest, datasets } = await loadConferencePublications({ root, ...input });
  const archive = datasets.find(dataset => dataset.season === 2025);
  assert.ok(manifest.seasons.includes(2025));
  assert.equal(archive.archived, true);
  assert.equal(archive.resultsThrough, '2026-01-19');
  assert.equal(archive.teams['68'].conference, 'Mountain West');
  assert.equal(archive.teams['326'].conference, 'Sun Belt');
  const next = datasets.find(dataset => dataset.season === 2026);
  if (next) {
    assert.equal(next.teams['68'].conference, 'Pac-12');
    assert.equal(next.teams['326'].conference, 'Pac-12');
  }
  assert.equal(archive.rankings.predictive.available, true);
  assert.equal(archive.rankings.predictive.fullField, true);
  assert.equal(archive.rankings.predictive.basis, 'season-end');
  assert.equal(archive.rankings.cfp.available, true);
  assert.equal(archive.rankings.ap.historicalEditions, 17);
  assert.equal(archive.rankings.cfp.historicalEditions, 6);
  const original = await read('published/conference-archives/2025.json');
  assert.equal(original.rankings.cfp.available, false, 'the original saved result publication remains unchanged');
  for (const game of archive.games) {
    const before = original.games.find(row => row.id === game.id);
    for (const key of ['home', 'away', 'homePoints', 'awayPoints', 'startDate', 'neutral', 'seasonType']) {
      assert.equal(game[key], before[key], `${game.id} ${key}`);
    }
    for (const edition of Object.values(game.pregameEdition)) {
      assert.ok(Date.parse(edition.availableBefore) < Date.parse(game.startDate));
      assert.notEqual(edition.kind, 'final', 'the final AP edition follows the last 2025 game');
    }
  }
  for (const [id, team] of Object.entries(archive.teams)) {
    assert.equal(team.strength, original.teams[id].strength);
    assert.equal(team.sos, original.teams[id].sos);
    assert.equal(team.conference, original.teams[id].conference);
  }
});

test('every published conference matrix reconciles with every unique game and reverse perspective', async () => {
  const input = await current;
  const { datasets } = await loadConferencePublications({ root, ...input });
  for (const dataset of datasets) {
    const {matrix,summaries,fcs}=conferenceRecords(dataset);
    let directionalGames=0;
    for (const a of dataset.conferences) {
      const row=Object.values(matrix[a.id]);
      assert.equal(summaries[a.id].games,row.reduce((sum,value)=>sum+value.games,0));
      assert.equal(summaries[a.id].wins,row.reduce((sum,value)=>sum+value.wins,0));
      for (const b of dataset.conferences) {
        if(a.id===b.id){assert.equal(matrix[a.id][b.id].games,0);continue;}
        const forward=matrix[a.id][b.id],reverse=matrix[b.id][a.id];
        assert.equal(forward.wins,reverse.losses);
        assert.equal(forward.losses,reverse.wins);
        assert.equal(forward.ties,reverse.ties);
        assert.equal(forward.games,conferenceGames(dataset,{conferenceA:a.id,conferenceB:b.id}).length);
        directionalGames+=forward.games;
      }
    }
    assert.equal(directionalGames,2*dataset.coverage.fbsInterconferenceGames);
    assert.equal(Object.values(fcs).reduce((sum,value)=>sum+value.games,0),dataset.coverage.fbsFcsGames);
    assert.equal(new Set(dataset.games.map(game=>game.id)).size,dataset.games.length);
  }
});
