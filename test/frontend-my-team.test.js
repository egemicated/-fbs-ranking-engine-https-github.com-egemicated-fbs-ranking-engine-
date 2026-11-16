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
