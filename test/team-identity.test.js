import assert from 'node:assert/strict';
import test from 'node:test';
import { teamAccent, teamDisplayName, teamNameMarkup } from '../frontend/team-identity.js';
import { teamNames } from '../frontend/team-name-data.js';

test('display names use established IDs and remain stable when formatted twice', () => {
  assert.equal(new Set(teamNames.map(([id]) => id)).size, teamNames.length);
  for (const [id, school, nickname] of teamNames) {
    const label = `${school} ${nickname}`;
    assert.equal(teamDisplayName(id, school), label);
    assert.equal(teamDisplayName(id, label), label);
  }
  assert.equal(teamDisplayName('254', 'Utah'), 'Utah Utes');
  assert.equal(teamDisplayName('2627', 'Tarleton State'), 'Tarleton State Texans');
  assert.equal(teamDisplayName('254', 'Utah State'), 'Utah State');
  assert.equal(teamDisplayName('future-team', 'Utah'), 'Utah');
});

test('team identity falls back to escaped text and a restrained accent', () => {
  assert.match(teamNameMarkup('2641', 'Texas Tech'), /<strong class="team-nickname">Red Raiders<\/strong>/);
  assert.equal(teamNameMarkup('unknown', '<School>'), '&lt;School&gt;');
  assert.match(teamAccent('254'), /^#[0-9a-f]{6}$/i);
  assert.equal(teamAccent('missing'), '#1689c1');
});
