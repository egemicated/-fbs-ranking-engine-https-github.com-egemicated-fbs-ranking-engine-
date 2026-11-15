import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeeklyPicks } from '../scripts/publish-weekly-picks.js';

const teams = ['home', 'away', 'other'].map(id => ({ id, name: id, division: 'fbs', conference: 'Example' }));
const config = { ridge: 3, retention: .75, marginCap: 28, homeAdvantage: 2.5, probabilityScale: 14 };
const kickoff = '2026-11-07T20:00:00Z';
const capture = '2026-11-01T15:00:00Z';
const later = '2026-11-08T15:00:00Z';
const previousWeek = { id: 'prior', week: 9, seasonType: 'regular', home: 'home', away: 'other',
  neutral: false, completed: true, homePoints: 24, awayPoints: 17, startDate: '2026-10-24T20:00:00Z' };
const game = { id: 'target', week: 10, seasonType: 'regular', home: 'home', away: 'away',
  neutral: false, completed: false, startDate: kickoff, startTimeTbd: false };
const season = (provider, time, games) => ({ year: 2026, teams, games,
  source: { provider, fetchedAt: time, sha256: 'a'.repeat(64) } });
const snapshot = (time, homeStrength) => ({ season: 2026, asOf: time, config,
  source: { provider: 'cfbd', fetchedAt: time, sha256: 'a'.repeat(64) }, snapshotHash: 'b'.repeat(64),
  rankings: teams.map(team => ({ ...team, strength: team.id === 'home' ? homeStrength : 0 })) });
const pickRow = report => report.games.find(row => row.id === game.id);

test('preview odds yield to Sunday picks and final scores preserve the original odds', () => {
  const archive = buildWeeklyPicks(season('sportsdataverse', capture, [previousWeek, game]), snapshot(capture, 5), { capturedAt: capture });
  assert.ok(pickRow(archive).estimate);
  assert.equal(pickRow(archive).pick, null);

  const saved = buildWeeklyPicks(season('cfbd', capture, [previousWeek, game]), snapshot(capture, -10),
    { capturedAt: capture, previous: archive });
  assert.equal(pickRow(saved).estimate, null);
  assert.equal(pickRow(saved).startTimeTbd, false);
  assert.equal(pickRow(saved).pick.favored, 'away');

  const final = { ...game, completed: true, homePoints: 31, awayPoints: 21 };
  const refreshed = buildWeeklyPicks(season('cfbd', later, [previousWeek, final]), snapshot(later, 25),
    { capturedAt: later, previous: saved });
  assert.equal(pickRow(refreshed).status, 'final');
  assert.equal(pickRow(refreshed).homePoints, 31);
  assert.deepEqual(pickRow(refreshed).pick, pickRow(saved).pick);
});

test('historical replay excludes current-week scores and stays outside the tracked record', () => {
  const prior = { season: 2025, snapshotHash: 'c'.repeat(64), ratings: snapshot(capture, 3).rankings };
  const run = (homePoints, awayPoints) => buildWeeklyPicks(season('sportsdataverse', later,
    [previousWeek, { ...game, completed: true, homePoints, awayPoints }]), snapshot(later, 25),
  { capturedAt: later, prior });
  const one = pickRow(run(51, 10)), two = pickRow(run(10, 51));
  assert.equal(one.pick, null);
  assert.ok(one.replay);
  assert.ok(Date.parse(one.replay.asOf) < Date.parse(kickoff));
  assert.deepEqual(one.replay, two.replay);
});

const fcs = { id: 'fcs', name: 'FCS opponent', division: 'fcs', conference: 'Subdivision' };
const fcsAway = { id: 'fcs-away', name: 'Another FCS opponent', division: 'fcs', conference: 'Subdivision' };
const unknown = { id: 'unknown', name: 'Unknown subdivision', division: 'unknown', conference: null };
const crossGame = { ...game, home: 'fcs', away: 'home', neutral: true };
const withOpponents = (provider, time, games) => ({ ...season(provider, time, games), teams: [...teams, fcs, fcsAway, unknown] });
function fullSnapshot(time, homeStrength, fcsStrength) {
  const value = snapshot(time, homeStrength);
  return { ...value, modelVersion: '0.2.0', ratings: [...value.rankings, { ...fcs, strength: fcsStrength },
    { ...fcsAway, strength: 3 }, { ...unknown, strength: 3 }] };
}

test('cross-division picks use full Strength ratings and preserve the saved odds after a final', () => {
  const upcoming = [{ ...crossGame }, { ...game, id: 'fbs-only', neutral: true }, { ...crossGame, id: 'fcs-only', away: 'fcs-away' },
    { ...crossGame, id: 'unknown', home: 'unknown' }];
  const preview = buildWeeklyPicks(withOpponents('sportsdataverse', capture, upcoming),
    fullSnapshot(capture, 10, -4), { capturedAt: capture });
  const expected = 1 / (1 + Math.exp(14 / config.probabilityScale));
  assert.deepEqual(pickRow(preview).estimate, { asOf: capture, homeWinProbability: expected, favored: 'away' });
  assert.equal(pickRow(preview).pick, null);
  assert.equal(preview.source.calibrated, true);
  assert.equal(preview.source.crossDivisionCalibrated, false);
  assert.equal(preview.source.crossDivisionProbabilityScale, config.probabilityScale);
  assert.equal(preview.games.find(row => row.id === 'fbs-only').estimate.homeWinProbability,
    1 / (1 + Math.exp(-10 / preview.source.probabilityScale)));
  assert.equal(preview.games.some(row => row.id === 'fcs-only'), false);
  assert.equal(preview.games.find(row => row.id === 'unknown').estimate, null);
  const saved = buildWeeklyPicks(withOpponents('cfbd', capture, upcoming),
    fullSnapshot(capture, 10, -4), { capturedAt: capture, previous: preview });
  assert.deepEqual(pickRow(saved).pick, { capturedAt: capture, homeWinProbability: expected, favored: 'away' });
  assert.equal(saved.games.find(row => row.id === 'unknown').pick, null);
  const final = { ...crossGame, completed: true, homePoints: 21, awayPoints: 14 };
  const refreshed = buildWeeklyPicks(withOpponents('cfbd', later, [final]),
    fullSnapshot(later, -10, 12), { capturedAt: later, previous: saved });
  assert.equal(pickRow(refreshed).status, 'final');
  assert.deepEqual(pickRow(refreshed).pick, pickRow(saved).pick);
});

test('missing current FCS ratings leave new probabilities unavailable and preserve a valid saved pick', () => {
  const input = withOpponents('cfbd', capture, [crossGame]);
  const baseline = buildWeeklyPicks(input, snapshot(capture, 10), { capturedAt: capture });
  assert.equal(pickRow(baseline).pick, null);
  assert.equal(pickRow(baseline).estimate, null);
  const previous = buildWeeklyPicks(input, fullSnapshot(capture, 10, -4), { capturedAt: capture });
  const refreshed = buildWeeklyPicks(input, snapshot(capture, 10), { capturedAt: capture, previous });
  assert.deepEqual(pickRow(refreshed).pick, pickRow(previous).pick);
});

test('cross-division replay uses full prior-week ratings and excludes the game’s own result', () => {
  const prior = { season: 2025, snapshotHash: 'c'.repeat(64), ratings: fullSnapshot(capture, 10, -4).ratings };
  const run = (homePoints, awayPoints) => buildWeeklyPicks(withOpponents('sportsdataverse', later,
    [previousWeek, { ...crossGame, completed: true, homePoints, awayPoints }]), fullSnapshot(later, 25, -5),
  { capturedAt: later, prior });
  const first = pickRow(run(51, 10)), second = pickRow(run(10, 51));
  assert.equal(first.pick, null);
  assert.ok(Date.parse(first.replay?.asOf) < Date.parse(kickoff));
  assert.deepEqual(first.replay, second.replay);
});

const fcsValidation = { modelVersion: '0.2.0', strengthConfig: config, population: 'fcs-fcs', scale: 8,
  approvedForWeeklyPicks: true, evaluation: { firstSeason: 2021, lastSeason: 2025, games: 1200 } };
const fcsOptions = { cohort: 'fcs', fcsValidation };
const fcsGame = { ...crossGame, away: fcsAway.id };

test('FCS picks use the approved scale for FCS–FCS only and preserve captured odds', () => {
  const scheduled = [fcsGame, { ...crossGame, id: 'fbs-fcs' }, { ...game, id: 'fbs-fbs' },
    { ...fcsGame, id: 'unclassified', away: unknown.id }];
  const current = fullSnapshot(capture, 10, -4);
  const options = { ...fcsOptions, capturedAt: capture };
  const preview = buildWeeklyPicks(withOpponents('sportsdataverse', capture, scheduled), current, options);
  const live = buildWeeklyPicks(withOpponents('cfbd', capture, scheduled), current, { ...options, previous: preview });
  assert.deepEqual(live.games.map(match => match.id), [fcsGame.id]);
  assert.deepEqual(new Set(live.teams.map(team => team.division)), new Set(['fcs']));
  assert.equal(live.source.matchupScope, 'fcs-fcs');
  assert.equal(live.source.calibrated, true);
  assert.equal(live.source.probabilityScale, 8);
  assert.deepEqual(live.source.validation, fcsValidation.evaluation);
  const odds = { homeWinProbability: 1 / (1 + Math.exp(7 / 8)), favored: 'away' };
  assert.deepEqual(pickRow(preview).estimate, { asOf: capture, ...odds });
  assert.deepEqual(pickRow(live).pick, { capturedAt: capture, ...odds });
  const final = { ...fcsGame, completed: true, homePoints: 27, awayPoints: 17 };
  const updated = buildWeeklyPicks(withOpponents('cfbd', later, [final]), fullSnapshot(later, 20, 30),
    { ...fcsOptions, capturedAt: later, previous: live });
  assert.equal(pickRow(updated).status, 'final');
  assert.deepEqual(pickRow(updated).pick, pickRow(live).pick);
});

test('FCS publication rejects unsupported calibration and cross-cohort previous artifacts', () => {
  const input = withOpponents('cfbd', capture, [fcsGame, { ...game, id: 'fbs' }]);
  const current = fullSnapshot(capture, 10, -4);
  for (const candidate of [null, { ...fcsValidation, approvedForWeeklyPicks: false },
    { ...fcsValidation, population: 'fbs-fbs' }, { ...fcsValidation, modelVersion: 'older' },
    { ...fcsValidation, strengthConfig: { ...config, ridge: 999 } },
    { ...fcsValidation, evaluation: { ...fcsValidation.evaluation, lastSeason: 2026 } }]) {
    assert.throws(() => buildWeeklyPicks(input, current, { ...fcsOptions, fcsValidation: candidate, capturedAt: capture }),
      /approved historical calibration/);
  }
  const fbsResult = buildWeeklyPicks(input, current, { capturedAt: capture });
  assert.throws(() => buildWeeklyPicks(input, current, { ...fcsOptions, capturedAt: capture, previous: fbsResult }), /different cohort/);
});

test('FCS replay excludes the whole target week and very recent older games', () => {
  const prior = { season: 2025, snapshotHash: 'c'.repeat(64), ratings: fullSnapshot(capture, 10, -4).ratings };
  const completed = { ...fcsGame, completed: true, homePoints: 21, awayPoints: 14 };
  const old = { ...completed, id: 'eligible-older-final', week: 8, startDate: '2026-10-24T01:00:00Z' };
  const tooRecent = { ...completed, id: 'not-yet-available', week: 9, startDate: '2026-11-06T23:00:00Z' };
  const sameWeek = { ...completed, id: 'excluded-cross-game', home: 'home', away: 'fcs', startDate: '2026-11-04T01:00:00Z' };
  const tbd = { ...fcsGame, id: 'time-unconfirmed', startDate: '2026-11-04T00:00:00Z', startTimeTbd: true };
  const run = (older, recent, cross, target) => buildWeeklyPicks(withOpponents('sportsdataverse', later,
    [older, recent, cross, target, tbd]), fullSnapshot(later, 25, -5), { ...fcsOptions, capturedAt: later, prior });
  const reverse = match => ({ ...match, homePoints: match.awayPoints, awayPoints: match.homePoints });
  const base = pickRow(run(old, tooRecent, sameWeek, completed));
  const ignored = pickRow(run(old, reverse(tooRecent), reverse(sameWeek), reverse(completed)));
  const changed = pickRow(run(reverse(old), tooRecent, sameWeek, completed));
  assert.equal(base.replay.asOf, '2026-11-07T19:59:59.999Z');
  assert.deepEqual(base.replay, ignored.replay);
  assert.notDeepEqual(base.replay, changed.replay);
  assert.equal(base.pick, null);
});

test('FCS saved picks require a safe kickoff and leave explicit TBD fixtures unpicked', () => {
  const today = '2026-11-07T14:00:00Z';
  const run = (value, game) => pickRow(buildWeeklyPicks(withOpponents('cfbd', value, [game]),
    fullSnapshot(value, 0, -4), { ...fcsOptions, capturedAt: value }));
  assert.ok(run(today, fcsGame).pick);
  assert.equal(run(today, { ...fcsGame, startTimeTbd: undefined }).pick, null);
  assert.ok(run(capture, { ...fcsGame, startTimeTbd: undefined }).pick);
  const tbd = run(capture, { ...fcsGame, startTimeTbd: true });
  assert.equal(tbd.status, 'scheduled');
  assert.equal(tbd.pick, null);
});
