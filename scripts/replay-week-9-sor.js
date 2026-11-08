import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { normalizeCfbd } from '../src/ingest.js';
import { outcomeDataset, readPublicationPolicy } from '../src/publication.js';
import { calculateDivisionSor } from '../research/lib/division_candidate.mjs';

const cutoff = '2026-11-01T06:00:00.000Z';
const gamesThrough = '2026-10-31';
const released = '2026-11-08';
const editionPath = 'frontend/ranking-editions.json';
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const [policy, baseline, picks, editions] = await Promise.all([
  readPublicationPolicy(), json('published/latest.json'),
  json('published/weekly-picks.json'), json(editionPath),
]);
assert.equal(baseline.snapshotHash, '1cba520c894e2a14c4b9356025b40fd93295f84e0630b27ec5e9583797ccfd61');
assert.equal(picks.source.snapshotHash, baseline.snapshotHash);
const graph = outcomeDataset(baseline);
const fbs = new Set(graph.teams.filter(team => team.division === 'fbs').map(team => team.id));
const roster = graph.teams.filter(team => fbs.has(team.id))
  .map(team => ({ id: team.id, school: team.name, conference: team.conference }));
const gamesById = new Map(graph.games.map(game => [game.id, game]));
const week9 = picks.games.filter(game => game.status === 'final' && game.seasonType === 'regular' && game.week <= 9);
const week9Ids = new Set(week9.map(game => game.id));
assert.equal(fbs.size, 138);
assert.equal(week9Ids.size, 622);
assert(process.env.CFBD_API_KEY, 'The replay requires the existing CFBD credential');

// The published graph supplies outcomes and venues. One results response supplies
// dates for those exact game IDs, including the lower-division schedule context.
const response = await fetch('https://api.collegefootballdata.com/games?year=2026&seasonType=both', {
  headers: { Authorization: `Bearer ${process.env.CFBD_API_KEY}` },
  signal: AbortSignal.timeout(45_000),
  redirect: 'error',
});
if (!response.ok) throw Error(`CFBD results returned HTTP ${response.status}`);
const raw = await response.json();
const dated = normalizeCfbd(raw, roster, 2026);
const datedById = new Map(dated.games.map(game => [game.id, game]));
for (const edge of graph.games) {
  const game = datedById.get(edge.id);
  assert(game?.completed, `Archived game ${edge.id} is missing a confirmed result or date`);
  assert(Number.isFinite(Date.parse(game.startDate)), `Archived game ${edge.id} has no valid date`);
}
const eligible = dated.games.filter(game => game.completed && Date.parse(game.startDate) < Date.parse(cutoff));
const confirmedFbs = eligible.filter(game => fbs.has(game.home) || fbs.has(game.away));
assert.deepEqual(confirmedFbs.map(game => game.id).sort(), [...week9Ids].sort());
for (const saved of week9) {
  const game = datedById.get(saved.id);
  for (const field of ['home', 'away', 'homePoints', 'awayPoints', 'startDate', 'neutral']) {
    assert.equal(game[field], saved[field], `Week 9 result ${saved.id} differs in ${field}`);
  }
}
const games = eligible.map(game => {
  const edge = gamesById.get(game.id);
  assert(edge, `Cutoff game ${game.id} is absent from the published evidence`);
  const forward = edge.a === game.home && edge.b === game.away;
  assert(forward || (edge.a === game.away && edge.b === game.home), `Team mismatch for ${game.id}`);
  const outcome = Math.sign(forward ? game.homePoints - game.awayPoints : game.awayPoints - game.homePoints);
  assert.equal(edge.outcome, outcome, `Outcome mismatch for ${game.id}`);
  assert.equal(edge.venue, game.neutral ? 0 : forward ? 1 : -1, `Venue mismatch for ${game.id}`);
  return edge;
}).sort((a, b) => a.id.localeCompare(b.id));

const replay = calculateDivisionSor({ ...graph, games }, policy.parameters);
const rows = replay.rows.map(row => ({ team: row.team, record: `${row.wins}–${row.losses}`, rank: row.sorRank }));
assert.equal(rows.length, 138);
assert(rows.every(row => Number.isInteger(row.rank) && row.rank > 0));
const byName = new Map(rows.map(row => [row.team, row.record]));
for (const list of [editions.forge, ...Object.values(editions.polls)]) {
  for (const row of list.find(item => item.week === 9).rows) {
    assert.equal(byName.get(row.team), row.record, `Week 9 record differs for ${row.team}`);
  }
}
editions.sorReplays = [{
  week: 9, gamesThrough, released, cutoff, modelId: policy.id,
  sourceSnapshotHash: baseline.snapshotHash,
  inputHash: createHash('sha256').update(JSON.stringify(games)).digest('hex'),
  networkGames: games.length, fbsGames: confirmedFbs.length, rows,
}];
await writeFile(editionPath, JSON.stringify(editions, null, 2) + '\n');
console.log(`Verified ${games.length} total outcomes, ${confirmedFbs.length} FBS-involving results and ${rows.length} ranks.`);
