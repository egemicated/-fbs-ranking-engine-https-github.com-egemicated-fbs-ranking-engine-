import assert from 'node:assert/strict';
import test from 'node:test';
import { mountMyTeam } from '../frontend/my-team.js';

const teams = new Map([
  ['26', { id: '26', name: 'UCLA', division: 'fbs' }],
  ['147', { id: '147', name: 'Montana <State>', division: 'fcs' }],
]);
const renderTeam = team => `<span data-favorite="${team.id}"></span>`;
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(adapter, chosenTeamId) {
  const root = { isConnected: true, innerHTML: '', querySelector: () => null };
  const unmount = mountMyTeam(root, { teams, renderTeam, adapter, chosenTeamId });
  return {
    root, unmount,
    click: action => root.onclick({ target: { closest: () => ({ dataset: { myTeamAction: action } }) } }),
    save: teamId => root.onsubmit({ preventDefault() {},
      target: { matches: () => true, elements: { team: { value: teamId } } } }),
  };
}

test('signed-out visitors use the header and the known team draft stays unsaved until account selection', async () => {
  let onChange, signedIn = false;
  const saved = [];
  const ui = fixture({
    getPreference: async () => ({ signedIn, teamId: null }),
    savePreference: async id => saved.push(id),
    subscribe: callback => { onChange = callback; },
  }, '147');
  await flush();
  assert.match(ui.root.innerHTML, /Sign in from the header/);
  assert.doesNotMatch(ui.root.innerHTML, /my-team-select|data-my-team-action="signin"/);
  signedIn = true;
  onChange();
  await flush();
  assert.match(ui.root.innerHTML, /value="147" selected>Montana &lt;State&gt;/);
  assert.deepEqual(saved, []);
  ui.save('invalid');
  await flush();
  assert.deepEqual(saved, []);
  ui.save('147');
  await flush();
  assert.deepEqual(saved, ['147']);
  assert.match(ui.root.innerHTML, /data-favorite="147"/);
  assert.match(ui.root.innerHTML, /saved to your account/);
  ui.unmount();
});

test('a preselected draft preserves the saved team on cancel, and removing it uses the account adapter', async () => {
  const saved = [];
  const ui = fixture({ getPreference: async () => ({ signedIn: true, teamId: '26' }),
    savePreference: async id => saved.push(id) }, '147');
  await flush();
  assert.match(ui.root.innerHTML, /value="147" selected/);
  await ui.click('cancel');
  assert.deepEqual(saved, []);
  assert.match(ui.root.innerHTML, /data-favorite="26"/);
  await ui.click('edit');
  assert.match(ui.root.innerHTML, /value="26" selected/);
  await ui.click('clear');
  assert.deepEqual(saved, [null]);
  assert.match(ui.root.innerHTML, /Team removed from your account/);
  assert.doesNotMatch(ui.root.innerHTML, /data-favorite=/);
  ui.unmount();
});

test('a late account preference does not render after unmount', async () => {
  let resolveRead;
  const ui = fixture({ getPreference: () => new Promise(resolve => { resolveRead = resolve; }) });
  ui.unmount();
  resolveRead({ signedIn: true, teamId: '26' });
  await flush();
  assert.doesNotMatch(ui.root.innerHTML, /data-favorite=/);
  assert.equal(ui.root.onchange, null);
});

test('an account without a favorite starts with a compact prompt and opens selection only on request', async()=>{
  const saved=[];
  const ui=fixture({getPreference:async()=>({signedIn:true,userId:'empty',teamId:null,teamIds:[]}),savePreference:async id=>saved.push(id)});
  await flush();assert.match(ui.root.innerHTML,/data-my-team-compact="true"/);assert.match(ui.root.innerHTML,/Choose team/);
  assert.doesNotMatch(ui.root.innerHTML,/data-my-team-form/);ui.click('edit');
  assert.match(ui.root.innerHTML,/data-my-team-form/);assert.deepEqual(saved,[]);ui.unmount();
});

test('followed-team carousel wraps in both directions without saving or changing the primary team', async () => {
  const saved = [];
  const ui = fixture({ getPreference: async () => ({ signedIn: true, userId: 'owner', teamId: '26', teamIds: ['26', '147'] }),
    savePreference: (...args) => saved.push(args) });
  await flush();
  assert.match(ui.root.innerHTML, /aria-roledescription="carousel"/);
  assert.match(ui.root.innerHTML, /aria-label="1 of 2: UCLA"/);
  ui.click('previous');
  assert.match(ui.root.innerHTML, /data-favorite="147"/);
  assert.match(ui.root.innerHTML, /aria-label="2 of 2: Montana &lt;State&gt;"/);
  ui.click('next');
  assert.match(ui.root.innerHTML, /data-favorite="26"/);
  ui.click('next');
  assert.match(ui.root.innerHTML, /data-favorite="147"/);
  assert.deepEqual(saved, []);
  ui.unmount();
});

test('a carousel preserves the viewed card on same-account refresh and resets across account changes or sign-out', async () => {
  let onChange;
  let preference = { signedIn: true, userId: 'first', teamId: '26', teamIds: ['26', '147'] };
  const ui = fixture({ getPreference: async () => preference, subscribe: callback => { onChange = callback; } });
  await flush(); ui.click('next');
  onChange(); await flush(); assert.match(ui.root.innerHTML, /data-favorite="147"/);
  preference = { ...preference, userId: 'second' };
  onChange(); await flush(); assert.match(ui.root.innerHTML, /data-favorite="26"/);
  preference = { signedIn: false, userId: null, teamId: null, teamIds: [] };
  onChange(); assert.doesNotMatch(ui.root.innerHTML, /data-favorite=/);
  await flush(); assert.doesNotMatch(ui.root.innerHTML, /data-my-team-carousel/);
  ui.unmount();
});

test('only distinct available saved teams appear, and single-team accounts have no carousel controls', async () => {
  const ui = fixture({ getPreference: async () => ({ signedIn: true, userId: 'owner', teamId: '26', teamIds: ['26', '26', 'unavailable'] }) });
  await flush();
  assert.match(ui.root.innerHTML, /data-favorite="26"/);
  assert.doesNotMatch(ui.root.innerHTML, /data-my-team-carousel/);
  ui.click('next'); assert.match(ui.root.innerHTML, /data-favorite="26"/);
  ui.unmount();
});

test('keyboard arrows and horizontal touch gestures cycle while vertical gestures do not', async () => {
  const ui = fixture({ getPreference: async () => ({ signedIn: true, userId: 'owner', teamId: '26', teamIds: ['26', '147'] }) });
  await flush();
  let prevented = false;
  ui.root.onkeydown({ target: { closest: () => ({}) }, key: 'ArrowRight', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.match(ui.root.innerHTML, /data-favorite="147"/);
  const target = { closest: selector => selector === '[data-my-team-slide]' ? {} : null };
  ui.root.onpointerdown({ pointerType: 'touch', pointerId: 1, clientX: 180, clientY: 100, target });
  ui.root.onpointerup({ pointerId: 1, clientX: 80, clientY: 110 });
  assert.match(ui.root.innerHTML, /data-favorite="26"/);
  ui.root.onpointerdown({ pointerType: 'touch', pointerId: 2, clientX: 180, clientY: 100, target });
  ui.root.onpointerup({ pointerId: 2, clientX: 130, clientY: 210 });
  assert.match(ui.root.innerHTML, /data-favorite="26"/);
  ui.unmount();
  assert.equal(ui.root.onkeydown, null); assert.equal(ui.root.onpointerdown, null);
});

test('removing a browsed secondary team targets that team and retains the primary favorite', async () => {
  const saved = [];
  const ui = fixture({ getPreference: async () => ({ signedIn: true, userId: 'owner', teamId: '26', teamIds: ['26', '147'] }),
    savePreference: async (...args) => saved.push(args) });
  await flush(); ui.click('next'); ui.click('edit');
  await ui.click('clear'); await flush();
  assert.deepEqual(saved, [[null, { removeTeamId: '147' }]]);
  assert.match(ui.root.innerHTML, /data-favorite="26"/);
  assert.doesNotMatch(ui.root.innerHTML, /data-my-team-carousel/);
  ui.unmount();
});
