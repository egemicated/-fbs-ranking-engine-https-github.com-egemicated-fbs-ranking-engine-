import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const paths = {
  html: 'review-site/index.html', script: 'review-site/app.js',
  current: 'review-site/data/current.json', research: 'review-site/data/research.json',
  artifact: 'research/results/predictive-v2/ab24aeeb21fa/model.json'
};
const [html, script, currentText, researchText, artifactText] = await Promise.all(Object.values(paths).map(path => readFile(path, 'utf8')));
const current = JSON.parse(currentText), research = JSON.parse(researchText), artifact = JSON.parse(artifactText);
const clone = value => JSON.parse(JSON.stringify(value));

async function browser({ data = current, historyData = research, hash = '#current', failPath = null } = {}) {
  const nodes = new Map(), calls = [], events = new Map();
  const document = { activeElement: null };
  class Element {
    constructor(id, openingTag) {
      this.id = id; this.innerHTML = ''; this.textContent = ''; this.value = '';
      this.hidden = /\bhidden\b/.test(openingTag); this.open = false; this.listeners = new Map(); this.attributes = new Map();
      const classes = new Set((/\bclass="([^"]*)"/.exec(openingTag)?.[1] || '').split(/\s+/).filter(Boolean));
      this.classList = { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) };
    }
    addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) || []), callback]); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name); }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    getBoundingClientRect() { return { left: 10, top: 10, right: 800, bottom: 600 }; }
  }
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    assert.equal(nodes.has(match[1]), false, `Duplicate static element ${match[1]}`);
    nodes.set(match[1], new Element(match[1], match[0]));
  }
  document.getElementById = id => {
    assert.ok(nodes.has(id), `App queried a missing element: ${id}`);
    return nodes.get(id);
  };
  const location = { hash };
  const window = { addEventListener(name, callback) { events.set(name, callback); } };
  const context = { document, window, location,
    history: { replaceState(_state, _title, value) { location.hash = value; } },
    fetch: async path => {
      calls.push(path);
      assert.ok(['./data/current.json', './data/research.json'].includes(path), `Unexpected request ${path}`);
      return { ok: path !== failPath, json: async () => clone(path === './data/current.json' ? data : historyData) };
    }
  };
  vm.runInNewContext(script, context, { filename: paths.script });
  const ready = await window.fbsReviewReady;
  const dispatch = (id, name, properties = {}) => {
    const node = document.getElementById(id);
    const event = { target: node, preventDefault() { this.defaultPrevented = true; }, ...properties };
    for (const callback of node.listeners.get(name) || []) callback(event);
    return event;
  };
  return { ready, calls, nodes, document, location,
    node: document.getElementById, dispatch,
    search(value) { nodes.get('team-search').value = value; dispatch('team-search', 'input'); },
    conference(value) { nodes.get('conference-filter').value = value; dispatch('conference-filter', 'change'); },
    team(id) { dispatch('ranking-body', 'click', { target: { closest: selector => selector === '[data-team]' ? { dataset: { team: id } } : null } }); },
    hash(value) { location.hash = value; events.get('hashchange')(); }
  };
}

test('current preview scores reconcile to the fixed selected model and are centered shared ranks', async () => {
  assert.equal(current.status, 'research-only-current-illustration');
  assert.equal(current.model.family, artifact.family);
  assert.equal(current.model.experimentFingerprint, artifact.experimentFingerprint);
  assert.equal(current.model.trainedThroughSeason, 2019);
  assert.equal(current.provenance.modelArtifactSha256, createHash('sha256').update(artifactText).digest('hex'));
  assert.equal(current.rankings.length, current.coverage.sourceFbsTeams);
  assert.ok(current.rankings.length > 25);
  const weights = Object.fromEntries(artifact.logistic.columns.map((name, index) => [name, artifact.logistic.coefficients[index] / artifact.logistic.scale[index]]));
  const shifts = new Set();
  let mean = 0;
  for (const row of current.rankings) {
    assert.ok(row.games >= 4 && row.basicMeasuredGames >= 4);
    let sum = 0;
    for (const [name, value] of Object.entries(row.components)) {
      assert.ok(Number.isFinite(value)); sum += value;
      if (name === 'centeringAdjustment') shifts.add(value);
      if (Object.hasOwn(row.metrics, name)) {
        const metric = row.metrics[name];
        assert.ok(Math.abs(value - weights[name] * (metric.offenseEffect - metric.allowanceEffect)) < 1e-12);
        assert.ok(metric.offenseGames >= 0 && metric.defenseGames >= 0);
      }
    }
    assert.ok(Math.abs(sum - row.score) < 1e-12, `${row.name} score explanation`);
    assert.equal(row.rank, 1 + current.rankings.filter(other => other.score > row.score + 1e-10).length);
    mean += row.score / current.rankings.length;
  }
  assert.equal(shifts.size, 1);
  assert.ok(Math.abs(mean) < 1e-12);
  assert.match(current.model.scoreUnits, /not a win probability/i);
});

test('all teams load by default from two static files and partial source coverage is visible', async () => {
  const page = await browser();
  assert.equal(page.ready, true);
  assert.deepEqual(page.calls, ['./data/current.json', './data/research.json']);
  assert.equal((page.node('ranking-body').innerHTML.match(/data-team=/g) || []).length, current.rankings.length);
  assert.equal(page.node('result-count').textContent, `${current.rankings.length} of ${current.rankings.length} teams shown`);
  assert.equal(page.node('panel-current').hidden, false);
  assert.equal(page.node('panel-history').hidden, true);
  assert.match(page.node('hero-cutoff').textContent, /Nov 5, 2026/);
  assert.equal(page.node('coverage-fbs').textContent, `${current.coverage.pairedFbsGames} / ${current.coverage.expectedFbsGames}`);
  assert.equal(page.node('coverage-basic').textContent, `${current.coverage.validBasicFbsGames} / ${current.coverage.expectedFbsGames}`);
  assert.equal(page.node('coverage-fcs').textContent, `${current.coverage.pairedFcsContextGames} / ${current.coverage.expectedFcsContextGames}`);
  assert.match(page.node('coverage-source').textContent, /FCS-only box scores are unavailable/);
  assert.match(page.node('coverage-source').textContent, /Nov 4, 2026/);
});

test('search reaches teams outside the Top25 and conference filtering preserves their actual ranks', async () => {
  const page = await browser(), outside = current.rankings.findLast(row => row.rank > 25);
  page.search(outside.name);
  assert.match(page.node('ranking-body').innerHTML, new RegExp(`data-team="${outside.id}"`));
  assert.match(page.node('ranking-body').innerHTML, new RegExp(`>${outside.rank}</span>`));
  page.search(''); page.conference(outside.conference);
  const expected = current.rankings.filter(row => row.conference === outside.conference);
  assert.equal((page.node('ranking-body').innerHTML.match(/data-team=/g) || []).length, expected.length);
  page.search('no-such-team-for-this-review');
  assert.match(page.node('ranking-body').innerHTML, /No teams match these filters/);
  assert.match(page.node('result-count').textContent, /^0 of /);
  assert.deepEqual(page.calls, ['./data/current.json', './data/research.json']);
});

test('team inspection opens measured evidence, reconciled terms and comparison ranks without requests', async () => {
  const page = await browser(), row = current.rankings.find(team => team.name === 'LSU') || current.rankings[0];
  page.team(row.id);
  assert.equal(page.node('team-dialog').open, true);
  const detail = page.node('dialog-content').innerHTML;
  assert.match(detail, new RegExp(row.name));
  assert.match(detail, /GAME CUTOFF/);
  assert.match(detail, /How this score is built/);
  assert.match(detail, /Measured FBS reference adjustment/);
  assert.match(detail, /Games<br>offense \/ defense/);
  assert.match(detail, /not .*probability of winning its next game/);
  assert.match(detail, /Model weights were trained through 2019/);
  page.dispatch('dialog-close', 'click');
  assert.equal(page.node('team-dialog').open, false);
  page.team(row.id);
  page.dispatch('team-dialog', 'click', { clientX: 0, clientY: 0 });
  assert.equal(page.node('team-dialog').open, false);
  assert.equal(page.calls.length, 2);
});

test('tabs, keyboard navigation and deep links expose historical evidence without promoting the later winner', async () => {
  const page = await browser({ hash: '#history' });
  assert.equal(page.node('panel-history').hidden, false);
  assert.equal(page.node('tab-history').getAttribute('aria-selected'), 'true');
  const selected = research.selectedBroaderCandidate.family;
  assert.equal(selected, 'strength+efficiency');
  const metrics = page.node('history-metrics').innerHTML;
  assert.match(metrics, /1,723/); assert.match(metrics, /70\.34%/); assert.match(metrics, /70\.28%/);
  assert.match(metrics, /No established improvement/);
  const familyRows = page.node('history-families').innerHTML;
  assert.equal((familyRows.match(/class="selected-family"/g) || []).length, 1);
  assert.match(familyRows, /Strength \+ efficiency<span class="family-note">Selected on older validation/);
  assert.match(html, /historical replays are useful evidence, but they are not an untouched future trial/i);
  const event = page.dispatch('tab-history', 'keydown', { key: 'ArrowRight' });
  assert.equal(event.defaultPrevented, true);
  assert.equal(page.document.activeElement.id, 'tab-method');
  assert.equal(page.node('panel-method').hidden, false);
  page.dispatch('tab-method', 'keydown', { key: 'Home' });
  assert.equal(page.node('panel-current').hidden, false);
  page.hash('#not-a-review-section');
  assert.equal(page.node('panel-current').hidden, false);
});

test('provider names and explanatory text are escaped in table, controls and team details', async () => {
  const data = clone(current), danger = '<img src=x onerror="bad()">';
  data.rankings[0].name = danger;
  data.rankings[0].conference = danger;
  data.limitations.push(danger);
  const page = await browser({ data });
  for (const id of ['ranking-body', 'conference-filter', 'current-limitations']) {
    assert.doesNotMatch(page.node(id).innerHTML, /<img src=x/);
    assert.match(page.node(id).innerHTML, /&lt;img/);
  }
  page.team(data.rankings[0].id);
  assert.doesNotMatch(page.node('dialog-content').innerHTML, /<img src=x/);
  assert.match(page.node('dialog-content').innerHTML, /&lt;img/);
});

test('unavailable or corrupted saved data produces an explicit load error without fetching a provider', async () => {
  const duplicate = clone(current); duplicate.rankings[1].id = duplicate.rankings[0].id;
  for (const options of [{ failPath: './data/current.json' }, { data: duplicate }]) {
    const page = await browser(options);
    assert.equal(page.ready, false);
    assert.equal(page.node('load-error').hidden, false);
    assert.equal(page.node('panel-current').hidden, true);
    assert.deepEqual(page.calls, ['./data/current.json', './data/research.json']);
  }
});
