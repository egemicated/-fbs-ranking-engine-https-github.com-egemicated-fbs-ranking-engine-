import assert from 'node:assert/strict';
import test from 'node:test';
import { conferenceStrengthMarkup, mountConferenceStrength } from '../frontend/conference-strength.js';

const conferences = [
  { id: 'SEC', name: 'SEC', group: 'power-four' },
  { id: 'Big Ten', name: 'Big Ten', group: 'power-four' },
  { id: 'Pac-12', name: 'Pac-12', group: 'group-of-six' },
];
function team(id, name, conference, rank, strength) {
  return { id, name, conference, division:'fbs', wins:8, losses:2, ties:0, strength, sos:0.611, sosRank:14,
    conferenceRecord:{wins:5,losses:2,ties:0}, ranks:{ sor:rank ?? 37, cfp:rank, predictive:rank ?? 44 } };
}
const dataset = {
  schemaVersion:1, season:2026, asOf:'2026-11-18T12:30:00Z', resultsThrough:'2026-11-17',
  probabilityScale:6.1, homeAdvantage:2.5, conferences,
  rankings: {
    sor:{available:true,asOf:'2026-11-18T12:30:00Z',fullField:true},
    predictive:{available:true,asOf:'2026-11-18T12:30:00Z',fullField:true},
    cfp:{available:true,asOf:'2026-11-17',fullField:false},
  },
  teams: {
    a:team('a','A & B','SEC',5,21),
    b:team('b','Bears','Big Ten',14,18),
    c:team('c','Cats','Big Ten',null,9),
    d:{ id:'d', name:'Hawks', conference:'Big Sky', division:'fcs', wins:5, losses:5, ties:0 },
  },
  games: [
    { id:'g1', home:'a', away:'b', homePoints:24, awayPoints:23, startDate:'2026-11-15T00:00:00Z',
      pregame:{cfp:[null,18]}, pregameAsOf:{cfp:'2026-11-10'} },
    { id:'g2', home:'c', away:'a', homePoints:20, awayPoints:14, startDate:'2026-11-08T00:00:00Z', neutral:true },
    { id:'g3', home:'a', away:'d', homePoints:33, awayPoints:13, startDate:'2026-10-25T00:00:00Z' },
  ],
};
const options = {
  view:'compare', method:'cfp', a:'SEC', b:'Big Ten', season:2026, seasons:[2026,2025],
  opponents:'all', rankScope:'all', result:'all', sort:'newest', qualitySort:'score',
};

test('comparison makes the snapshot and dated pregame CFP ranks explicit', () => {
  const markup = conferenceStrengthMarkup(dataset, options);
  assert.match(markup, /<dt>SEC wins vs\. current Top 25<\/dt><dd>1<\/dd>/);
  assert.match(markup, /<dt>Snapshot rank<\/dt><dd>#14<\/dd>/);
  assert.match(markup, /<dt>Snapshot rank<\/dt><dd>Unranked<\/dd>/);
  assert.match(markup, /<dt>Pregame rank<\/dt><dd>#18<\/dd>/);
  assert.match(markup, /<dt>Pregame rank<\/dt><dd>—<\/dd>/);
  assert.match(markup, /<dt>Vs\. own conference<\/dt><dd>5–2<\/dd>/);
  assert.match(markup, /A &amp; B defeated Bears/);
  assert.doesNotMatch(markup, /#0|#null|#undefined/);
});

test('the matrix links both conference orientations and keeps FCS separate', () => {
  const markup = conferenceStrengthMarkup(dataset,{ ...options, view:'records' });
  assert.match(markup, /#conference-strength\/compare\/2026\/SEC\/Big%20Ten/);
  assert.match(markup, /#conference-strength\/compare\/2026\/Big%20Ten\/SEC/);
  assert.match(markup, /#conference-strength\/compare\/2026\/SEC\/FCS/);
  assert.match(markup, /vs\. Power Four/);

  const fcs = conferenceStrengthMarkup(dataset,{ ...options, b:'FCS', opponents:'power-four', rankScope:'current' });
  assert.match(fcs,/FBS vs\. FCS/);
  assert.match(fcs,/A &amp; B defeated Hawks/);
  assert.doesNotMatch(fcs,/A &amp; B defeated Bears/);
});

test('archived ratings use season-end language and show group membership from the archive', () => {
  const archive = { ...dataset, archived:true, conferences:conferences.map(conference => conference.group === 'group-of-six'
    ? { ...conference, group:'group-of-five' } : conference) };
  assert.match(conferenceStrengthMarkup(archive,options), /season-end snapshot\. Results through Nov 17, 2026/);
  const quality = conferenceStrengthMarkup(archive,{ ...options, view:'quality' });
  assert.match(quality,/Season-end Top 10 \/ 25 wins/);
  assert.match(quality,/pull small samples toward 50/);
  assert.match(conferenceStrengthMarkup(archive,{ ...options, view:'records' }), /Group of Five vs\. Power Four/);
});

test('mount requests only the selected season and reuses it across conference views', async context => {
  const requests = [];
  context.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    return new Response(JSON.stringify(url.endsWith('index.json') ? {schemaVersion:1,seasons:[2026,2025]} : dataset));
  });
  const events = new Map();
  const attributes = new Set();
  const container = {
    innerHTML:'', isConnected:true,
    addEventListener:(name, action) => events.set(name,action),
    removeEventListener:name => events.delete(name),
    setAttribute:name => attributes.add(name),
    removeAttribute:name => attributes.delete(name),
    querySelectorAll:() => [],
    querySelector:() => null,
  };
  const navigate = [];
  const disconnect = mountConferenceStrength(container,{ view:'compare', dataRoot:'/conference-test', onNavigate:next => navigate.push(next) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attributes.has('aria-busy'),false);
  assert.match(container.innerHTML,/SEC vs\. Big Ten/);
  events.get('change')({ target:{ dataset:{conferenceField:'method'},value:'cfp' } });
  assert.match(container.innerHTML,/SEC wins vs\. current Top 25<\/dt><dd>1/);
  events.get('change')({ target:{ dataset:{conferenceField:'a'},value:'Pac-12' } });
  assert.deepEqual(navigate,[{ view:'compare',season:2026,a:'Pac-12',b:'Big Ten' }]);
  disconnect();
  assert.equal(events.size,0);

  const disconnectRecords = mountConferenceStrength(container,{ view:'records', dataRoot:'/conference-test' });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(container.innerHTML,/Conference matchup matrix/);
  assert.deepEqual(requests,['/conference-test/conferences/index.json','/conference-test/conferences/2026.json']);
  disconnectRecords();
});
