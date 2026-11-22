import assert from 'node:assert/strict';
import test from 'node:test';
import { basketballForgeEditionPath, readBasketballForgeBallots, renderBasketballForgeBallot } from '../basketball/forge-ballot.mjs';

const snapshot = {
  season: 2027, asOf: '2026-11-22T14:39:54.630Z', snapshotHash: 'a'.repeat(64),
  teams: Array.from({ length: 26 }, (_, index) => ({ id: `ncaam-d1:${index + 1}`, name: `School ${index + 1}`, wins: 5, losses: 1 })),
};
const rowsFrom = teams => teams.map(({ id, name: team, wins, losses }) => ({ id, team, wins, losses }));
const edition = {
  gamesThrough: '2026-11-21', released: '2026-11-22', snapshotAsOf: snapshot.asOf, snapshotHash: snapshot.snapshotHash,
  notes: ['Rank team results and opponent quality.'], rows: rowsFrom(snapshot.teams.slice(0, 25)),
};
const archive = editions => ({ schema: 1, season: 2027, editions });

test('basketball Forge requires complete, unique ballots that agree with a matching snapshot', () => {
  assert.deepEqual(readBasketballForgeBallots(archive([edition]), snapshot).editions, [edition]);
  const duplicate = [edition.rows[0], ...edition.rows.slice(0, 24)];
  const wrongRecord = [{ ...edition.rows[0], losses: 0 }, ...edition.rows.slice(1)];
  for (const change of [
    { rows: duplicate }, { rows: edition.rows.slice(0, 24) }, { rows: wrongRecord },
    { gamesThrough: '2026-11-31' }, { released: '2026-11-20' },
    { snapshotAsOf: '2026-11-23T14:39:54.630Z' }, { snapshotHash: 'bogus' },
  ]) assert.throws(() => readBasketballForgeBallots(archive([{ ...edition, ...change }]), snapshot), /basketball Forge ballot/i);
  assert.throws(() => readBasketballForgeBallots(archive([edition, edition]), snapshot), /ballot edition/);
});

test('basketball Forge renders a dated editorial archive and preserves historical records', () => {
  const prior = { ...edition, gamesThrough: '2026-11-14', released: '2026-11-15', snapshotAsOf: '2026-11-15T14:30:00Z',
    snapshotHash: 'b'.repeat(64), rows: rowsFrom([snapshot.teams[1], snapshot.teams[0], ...snapshot.teams.slice(2, 24), snapshot.teams[25]]) };
  prior.rows[0].wins = 3;
  const saved = readBasketballForgeBallots(archive([prior, edition]), snapshot);
  assert.deepEqual(saved.editions, [edition, prior]);
  const latest = renderBasketballForgeBallot(snapshot, saved);
  assert.match(latest, /AI-authored editorial ballot/);
  assert.match(latest, /datetime="2026-11-21"/);
  assert.match(latest, /data-basketball-forge-ballot/);
  assert.match(latest, /href="\/basketball\/forge-rankings\/" aria-current="page"/);
  assert.match(latest, /aria-label="Up 1">↑1/);
  assert.match(latest, /aria-label="Entered the Top 25">In/);
  assert.ok(latest.includes(basketballForgeEditionPath(prior.gamesThrough)));
  const historical = renderBasketballForgeBallot(snapshot, saved, prior.gamesThrough);
  assert.match(historical, /School 2.*3–1/s);
  assert.match(historical, /datetime="2026-11-14"/);
  assert.doesNotMatch(historical, /<th scope="col">Move/);
});

test('basketball Forge retains a useful empty state before its first ballot', () => {
  const empty = renderBasketballForgeBallot(snapshot, readBasketballForgeBallots(null, snapshot));
  assert.match(empty, /role="status">No Forge basketball ballot is available yet/);
  assert.doesNotMatch(empty, /<tbody>/);
});

test('the archive survives a season rollover independently of the current team pool', () => {
  const newSeason = { ...snapshot, season: 2028, teams: [] };
  const saved = readBasketballForgeBallots(archive([edition]), newSeason);
  const page = renderBasketballForgeBallot(newSeason, saved, edition.gamesThrough);
  assert.match(page, /2026–27/);
  assert.match(page, /ncaam-d1%3A1\/\?season=2027/);
  assert.match(page, /School 1/);
});
