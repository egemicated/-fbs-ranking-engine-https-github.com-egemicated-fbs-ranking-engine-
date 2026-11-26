import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBasketballSitePublication, omitSupersededBasketballFixture } from '../basketball/site-publication.mjs';

const loyola = { id: 'ncaam-d1:151', name: 'Loyola Chicago' };
const seattle = { id: 'ncaam-d1:262', name: 'Seattle U' };
const placeholder = {
  id: 'ncaam-d1:372907', home: loyola.id, away: seattle.id, startDate: '2026-11-23T05:00:00.000Z',
  status: 'scheduled', completed: false, startTimeTbd: true, neutral: true, divisionOne: true,
};
const final = {
  id: 'ncaam-d1:378701', home: seattle.id, away: loyola.id, startDate: '2026-11-24T02:30:00.000Z',
  status: 'final', completed: true, startTimeTbd: false, homePoints: 76, awayPoints: 63, neutral: true, divisionOne: true,
};
const otherGame = { ...placeholder, id: 'ncaam-d1:999' };

test('basketball publication removes only the verified stale fixture from the source slates', () => {
  const asOf = '2026-11-26T14:36:59.821Z';
  const games = [placeholder, otherGame, final];
  const ctx = {
    snapshot: { competition: 'ncaam-d1', season: 2027, asOf, gamesUsed: 1, teams: [loyola, seattle] },
    teams: new Map([[loyola.id, loyola], [seattle.id, seattle]]),
    dataset: { games, source: { asOf } },
    historical: false, conferenceQuality: { rows: [] }, conferences: [], editions: [],
    report: { forecasts: 1, graded: 1, games: [] },
    forecasts: new Map([[final.id, { capturedAt: '2026-11-23T14:32:32Z', startDate: final.startDate, homeWinProbability: .57 }]]),
    forecastReportById: new Map([[final.id, { status: 'graded', right: 1 }]]),
  };
  const { files } = buildBasketballSitePublication({ seasons: new Map([[2027, ctx]]), activeYear: 2027 }, Date.parse(asOf));
  const sunday = JSON.parse(files.get('2027/slate/2026-11-22.json'));
  const monday = JSON.parse(files.get('2027/slate/2026-11-23.json'));
  assert.deepEqual(sunday.games, [otherGame]);
  assert.deepEqual(monday.games, [final]);
  assert.deepEqual(monday.forecasts, [[final.id, { homeWinProbability: .57, capturedAt: '2026-11-23T14:32:32Z' }]]);
  assert.deepEqual(monday.grades, [[final.id, { status: 'graded', right: 1 }]]);
  assert.deepEqual(games, [placeholder, otherGame, final]);
});

test('basketball fixture correction requires the exact season, participants, dates, status and replacement score', () => {
  const noEvidence = () => false;
  const notVerified = [
    [placeholder],
    [{ ...placeholder, startDate: final.startDate }, final],
    [{ ...placeholder, startTimeTbd: false }, final],
    [{ ...placeholder, home: 'ncaam-d1:99' }, final],
    [{ ...placeholder, status: 'postponed' }, final],
    [placeholder, { ...final, completed: false }],
    [placeholder, { ...final, startDate: placeholder.startDate }],
    [placeholder, { ...final, away: 'ncaam-d1:99' }],
    [placeholder, { ...final, homePoints: 75 }],
  ];
  for (const games of notVerified) assert.equal(omitSupersededBasketballFixture(2027, games, noEvidence), games);
  const games = [placeholder, final];
  assert.equal(omitSupersededBasketballFixture(2026, games, noEvidence), games);
  assert.equal(omitSupersededBasketballFixture(2027, games, id => id === placeholder.id), games);
});
