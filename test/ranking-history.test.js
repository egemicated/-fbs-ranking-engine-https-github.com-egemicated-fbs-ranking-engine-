import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { rankSeason } from '../src/engine.js';
import { publishDivisionSnapshot } from '../src/publication.js';
import { addSorHistoryEdition, buildSorHistoryEdition, saveSorHistory } from '../src/ranking-history.js';

const teams = ['a', 'b', 'c', 'd', 'f'].map(id => ({ id, name: id.toUpperCase(), division: id === 'f' ? 'fcs' : 'fbs', conference: 'Example' }));
const policy = { id: 'division-sor-v2', name: 'Strength of Record', publicationVersion: 'test', parameters: { slope: 5, homeLogOdds: .38, divisionLogOdds: 2.4 } };
const game = (id, home, away, week, startDate, completed = true) => ({ id, home, away, week, startDate,
  completed, neutral: false, seasonType: 'regular', homePoints: completed ? 24 : null, awayPoints: completed ? 17 : null });
const first = game('one', 'a', 'b', 1, '2026-09-06T03:00:00Z');
const second = game('two', 'c', 'f', 1, '2026-09-05T20:00:00Z');
const third = game('three', 'd', 'a', 2, '2026-09-12T20:00:00Z', false);
const fourth = game('four', 'b', 'c', 2, '2026-09-13T03:00:00Z', false);

function fixture(games = [first, second, third, fourth], fetchedAt = '2026-09-06T12:00:00Z') {
  const season = { year: 2026, teams, games, source: { provider: 'cfbd', fetchedAt, sha256: 'a'.repeat(64) } };
  const snapshot = publishDivisionSnapshot({ ...rankSeason(season), asOf: fetchedAt }, policy, { publishedAt: fetchedAt });
  return { season, snapshot };
}

function picksFor({ season, snapshot }) {
  return { schemaVersion: 1, season: season.year, teams: season.teams,
    source: { provider: 'cfbd', snapshotHash: snapshot.snapshotHash, rankingAsOf: snapshot.asOf, scheduleAsOf: season.source.fetchedAt },
    games: season.games.map(({ completed, ...game }) => ({ ...game, status: completed ? 'final' : 'scheduled' })) };
}

test('stores only saved SOR with the correct Mountain date, byes, zero-game teams, and current opponent evidence', () => {
  const { snapshot, season } = fixture();
  const edition = buildSorHistoryEdition(snapshot, season);
  assert.equal(edition.gamesThrough, '2026-09-05');
  assert.equal(edition.week, 1);
  assert.equal(edition.complete, true);
  assert.equal(edition.snapshotHash, snapshot.snapshotHash);
  assert.equal(edition.publicationHash, snapshot.publicationHash);
  const a = edition.rows.find(row => row.id === 'a'), b = edition.rows.find(row => row.id === 'b');
  assert.deepEqual(a.weekGames, [{ id: 'one', opponentId: 'b', opponentName: 'B', result: 'W', margin: 7, venue: 'home', opponentRank: b.rank }]);
  assert.equal(b.weekGames[0].venue, 'away');
  assert.equal(b.weekGames[0].margin, -7);
  assert.deepEqual(edition.rows.find(row => row.id === 'd').weekGames, []);
  assert.equal(edition.rows.find(row => row.id === 'd').rank, null);
  assert.deepEqual(buildSorHistoryEdition(snapshot, picksFor({ snapshot, season })), edition);
  assert.ok(edition.rows.every(row => !Object.hasOwn(row, 'contributions') && !Object.hasOwn(row, 'explanation')));
});

test('a midweek or unfinished Saturday is provisional and never backfills an earlier week with later results', () => {
  const { snapshot, season } = fixture([first, second, { ...third, completed: true, homePoints: 24, awayPoints: 17 }, fourth], '2026-09-13T06:01:00Z');
  const edition = buildSorHistoryEdition(snapshot, season);
  assert.equal(edition.week, 2);
  assert.equal(edition.complete, false);
  assert.equal(edition.gamesThrough, '2026-09-12');
  assert.deepEqual(edition.rows.find(row => row.id === 'c').weekGames, []);
  const complete = fixture([first, second, { ...third, completed: true, homePoints: 24, awayPoints: 17 },
    { ...fourth, completed: true, homePoints: 24, awayPoints: 17 }], '2026-09-13T12:00:00Z');
  assert.equal(buildSorHistoryEdition(complete.snapshot, complete.season).complete, true);
});

test('a completed postseason edition does not reuse a regular-season week number', () => {
  const bowl = { ...game('bowl', 'a', 'c', 1, '2026-12-19T20:00:00Z'), seasonType: 'postseason' };
  const { snapshot, season } = fixture([first, second, bowl], '2026-12-20T12:00:00Z');
  const edition = buildSorHistoryEdition(snapshot, season);
  assert.equal(edition.seasonType, 'postseason');
  assert.equal(edition.week, 1);
  assert.equal(edition.gamesThrough, '2026-12-19');
});

test('confirmed canceled slots do not keep a completed week provisional', () => {
  const canceled = game('canceled', 'a', 'c', 1, '2026-09-05T18:00:00Z', false);
  const { snapshot, season } = fixture([first, second, canceled, third]);
  snapshot.source.audit = { confirmedCanceledRecords: [{ id: canceled.id }] };
  assert.equal(buildSorHistoryEdition(snapshot, season).complete, true);
  assert.equal(buildSorHistoryEdition(snapshot, season).rows.find(row => row.id === 'a').weekGames.length, 1);
});

test('rejects legacy Colley, stale or mismatched schedule, wrong finals, and future outcomes', () => {
  const { snapshot, season } = fixture();
  assert.throws(() => buildSorHistoryEdition({ ...snapshot, publicationHash: undefined }, season), /dated SOR/);
  assert.throws(() => buildSorHistoryEdition(snapshot, { ...season, source: { ...season.source, sha256: 'b'.repeat(64) } }), /matching CFBD/);
  const stale = picksFor({ season, snapshot }); stale.source.rankingAsOf = '2026-09-01T12:00:00Z';
  assert.throws(() => buildSorHistoryEdition(snapshot, stale), /matching CFBD/);
  assert.throws(() => buildSorHistoryEdition(snapshot, { ...season, games: [{ ...first, homePoints: 40 }, ...season.games.slice(1)] }), /evidence differs/);
  const future = fixture([{ ...first, startDate: '2026-09-07T03:00:00Z' }, second]);
  assert.throws(() => buildSorHistoryEdition(future.snapshot, future.season), /evidence differs/);
  assert.throws(() => buildSorHistoryEdition(snapshot, { ...season, games: [first, second, { ...third, startDate: '2026-09-05T19:00:00Z', completed: true, homePoints: 21, awayPoints: 7 }] }), /omits/);
});

test('idempotent recaptures retain the original edition date and stale writes cannot erase a newer week', () => {
  const initial = fixture();
  const one = buildSorHistoryEdition(initial.snapshot, initial.season);
  const history = addSorHistoryEdition({ schemaVersion: 1, season: 2026, editions: [] }, one, 2026);
  const later = fixture(undefined, '2026-09-06T18:00:00Z');
  const duplicate = buildSorHistoryEdition(later.snapshot, later.season);
  assert.deepEqual(addSorHistoryEdition(history, duplicate, 2026), history);
  const next = fixture([first, second, { ...third, completed: true, homePoints: 24, awayPoints: 17 }, fourth], '2026-09-13T12:00:00Z');
  const updated = addSorHistoryEdition(history, buildSorHistoryEdition(next.snapshot, next.season), 2026);
  assert.throws(() => addSorHistoryEdition(updated, one, 2026), /older snapshot/);
  assert.throws(() => addSorHistoryEdition(updated, { ...one, week: 3, asOf: '2026-09-20T12:00:00Z' }, 2026), /lose previously/);
  assert.throws(() => addSorHistoryEdition({ ...history, season: 2025 }, one, 2026), /match the season/);
  assert.throws(() => addSorHistoryEdition(history, { ...one, modelId: 'other' }, 2026), /different SOR model/);
});

test('archive publication preserves polls, Forge, replay labels, and legacy metadata, and repairs a retry after either write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sor-history-'));
  const historyPath = join(directory, 'history.json'), comparisonPath = join(directory, 'editions.json');
  const original = { season: 2026, sor: [], polls: { ap: [{ week: 1 }], coaches: [], cfp: [] },
    forge: [{ week: 1 }], sorReplays: [{ week: 0, modelId: 'colley-history', label: 'Historical Colley' }] };
  try {
    await writeFile(comparisonPath, JSON.stringify(original));
    const { snapshot, season } = fixture();
    assert.equal(await saveSorHistory(snapshot, season, { historyPath, comparisonPath }), true);
    const history = await readFile(historyPath, 'utf8'), comparisons = JSON.parse(await readFile(comparisonPath, 'utf8'));
    assert.deepEqual(comparisons.polls, original.polls);
    assert.deepEqual(comparisons.forge, original.forge);
    assert.deepEqual(comparisons.sorReplays, original.sorReplays);
    assert.equal(comparisons.sor[0].week, 1);
    assert.equal(await saveSorHistory(snapshot, season, { historyPath, comparisonPath }), false);
    assert.equal(await readFile(historyPath, 'utf8'), history);
    await writeFile(comparisonPath, JSON.stringify(original));
    assert.equal(await saveSorHistory(snapshot, season, { historyPath, comparisonPath }), true);
    assert.equal(JSON.parse(await readFile(comparisonPath, 'utf8')).sor.length, 1);
    const next = fixture([first, second, { ...third, completed: true, homePoints: 24, awayPoints: 17 }, fourth], '2026-09-13T12:00:00Z');
    await saveSorHistory(next.snapshot, next.season, { historyPath, comparisonPath });
    assert.equal(JSON.parse(await readFile(historyPath, 'utf8')).editions.length, 2);
    assert.equal(JSON.parse(await readFile(comparisonPath, 'utf8')).sor.length, 1);
    const completed = fixture([first, second, { ...third, completed: true, homePoints: 24, awayPoints: 17 },
      { ...fourth, completed: true, homePoints: 24, awayPoints: 17 }], '2026-09-13T18:00:00Z');
    await saveSorHistory(completed.snapshot, completed.season, { historyPath, comparisonPath });
    const finished = JSON.parse(await readFile(historyPath, 'utf8'));
    assert.equal(finished.editions.length, 2);
    assert.equal(finished.editions[1].complete, true);
    assert.equal(JSON.parse(await readFile(comparisonPath, 'utf8')).sor.length, 2);
  } finally {
    await rm(directory, { recursive: true });
  }
});
