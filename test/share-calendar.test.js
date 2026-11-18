import test from 'node:test';
import assert from 'node:assert/strict';
import { kickoffCalendar, kickoffEvent, publicFootballPageUrl } from '../frontend/game-calendar.js';
import { publicShareCard, shareCardButton } from '../frontend/share-card.js';

const fixtureGame = {
  id: '401866465', awayName: 'Illinois', homeName: 'Ohio State', startTimeTbd: false,
  startDate: '2026-11-21T12:00:00-05:00', asOf: '2026-11-16T01:01:38.431Z',
  href: '#compare/weekly/12', status: 'scheduled',
};
const unfold = source => source.replace(/\r\n /g, '');

test('calendar represents a confirmed zoned kickoff and a stable game identity', () => {
  const original = unfold(kickoffEvent(fixtureGame));
  const shifted = unfold(kickoffEvent({ ...fixtureGame, startDate: '2026-11-22T02:30:00+01:00' }));
  assert.match(original, /\r\nDTSTART:20261121T170000Z\r\n/);
  assert.match(shifted, /\r\nDTSTART:20261122T013000Z\r\n/);
  assert.match(original, /\r\nDTSTAMP:20261116T010138Z\r\n/);
  assert.match(original, /\r\nSUMMARY:Illinois at Ohio State\r\n/);
  assert.match(original, /\r\nURL:https:\/\/fbs-intelligence\.onrender\.com\/#compare\/weekly\/12\r\n/);
  assert.equal(original.match(/UID:[^\r]+/)[0], shifted.match(/UID:[^\r]+/)[0]);
  assert.match(original, /Downloaded events do not automatically follow schedule changes\./);
  assert.match(kickoffCalendar(fixtureGame), /download="fbs-kickoff-401866465\.ics"/);
});

test('calendar folds UTF-8 without truncation and escapes calendar text', () => {
  const title = 'São José, Consórcio; Fall \u2603 '.repeat(4).trim();
  const calendar = kickoffEvent({ ...fixtureGame, awayName: title + '\nNew line', neutral: true });
  for (const line of calendar.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  assert.ok(calendar.includes('\r\n '));
  assert.ok(unfold(calendar).includes(title.replaceAll(',', '\\,').replaceAll(';', '\\;') + '\\nNew line vs. Ohio State'));
});

test('calendar declines TBD, unzoned and final games and rejects off-site links', () => {
  const tbd = { ...fixtureGame, startTimeTbd: true };
  assert.equal(kickoffEvent(tbd), null);
  assert.match(kickoffCalendar(tbd), /Time pending/);
  assert.doesNotMatch(kickoffCalendar(tbd), /download/);
  assert.equal(kickoffEvent({ ...fixtureGame, startDate: '2026-11-21T12:00:00' }), null);
  assert.equal(kickoffEvent({ ...fixtureGame, href: 'https://external.example/#compare' }), null);
  assert.equal(kickoffCalendar({ ...fixtureGame, status: 'final' }), '');
});

test('card payload is restricted to display fields and uses a canonical public link', () => {
  const source = {
    teams: [{ id: '254', name: 'Utah & Friends', rank: 1, rankLabel: 'SOR rank', record: '10–0', division: 'fbs',
      probability: null, userId: 'private-owner' }], asOf: fixtureGame.asOf,
    href: '/?private=do-not-copy#team/254', email: 'private@example.invalid',
  };
  const result = publicShareCard(source);
  assert.equal(result.teams[0].division, 'FBS');
  assert.deepEqual(publicShareCard(result), result);
  assert.equal(result.href, 'https://fbs-intelligence.onrender.com/team/254/');
  assert.doesNotMatch(shareCardButton(source), /private-owner|private=|private@example/);
  assert.match(shareCardButton(source), /aria-label="Share Utah &amp; Friends card"/);
  assert.equal(publicShareCard({ ...source, href: 'https://external.example/#team/254' }), null);
});

test('matchup card preserves actual zero and one probabilities without inventing missing data', () => {
  const teams = [
    { id: '254', name: 'Utah', division: 'fbs', probability: 1 },
    { id: '26', name: 'UCLA', division: 'fbs', probability: 0 },
  ];
  const card = publicShareCard({ teams, href: '#compare', forecastLabel: 'Model win chance', venue: 'Neutral field' });
  assert.deepEqual(card.teams.map(team => [team.probability, team.rank]), [[1, null], [0, null]]);
  assert.equal(card.asOf, null);
});

test('weekly game deeplinks preserve the kickoff in FBS and FCS calendar and share links', () => {
  const fbs = '#compare/weekly/regular:12/401856866';
  const fcs = '#compare/weekly/fcs/postseason:2/401856865';
  assert.equal(publicFootballPageUrl(fbs), 'https://fbs-intelligence.onrender.com/' + fbs);
  assert.equal(publicFootballPageUrl(fcs), 'https://fbs-intelligence.onrender.com/' + fcs);
  assert.match(unfold(kickoffEvent({ ...fixtureGame, href: fcs })), /\/weekly\/fcs\/postseason:2\/401856865/);
  const teams = [{ id: '254', name: 'Utah' }, { id: '26', name: 'UCLA' }];
  assert.ok(shareCardButton({ teams, href: '#compare/matchup/254/26/neutral' }));
  assert.match(shareCardButton({ teams, href: fbs }), /regular:12\/401856866/);
  assert.equal(publicFootballPageUrl('#compare/weekly/secret:12/401856866'), null);
});
