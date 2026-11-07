(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = { current: null, research: null, search: '', conference: '', view: 'current' };
  const metricLabels = { strength: 'Our Strength estimate', ypp: 'Yards-per-play efficiency', passingYpp: 'Passing efficiency', rushingYpp: 'Rushing efficiency', completionRate: 'Completion rate', firstDownRate: 'First-down rate', thirdDownRate: 'Third-down conversions', fourthDownRate: 'Fourth-down conversions', turnoverRate: 'Turnovers per recorded play', penaltyYardsPerPlay: 'Penalty yards per recorded play', centeringAdjustment: 'Measured FBS reference adjustment' };
  const familyLabels = { strength: 'Calibrated Strength control', 'raw-units': 'Recorded-stat units only', 'strength+efficiency': 'Strength + efficiency', 'strength+efficiency+sustain': 'Strength + efficiency + conversions', 'strength+all-counts': 'Strength + all nine measures' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const num = (value, digits = 2) => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
  const signed = (value, digits = 3) => finite(value) ? `${value > 0 ? '+' : ''}${num(value, digits)}` : '—';
  const rank = value => finite(value) ? `#${num(value, 0)}` : '—';
  const percent = value => finite(value) ? `${num(100 * value, 2)}%` : '—';
  const date = value => {
    if (!Number.isFinite(Date.parse(value))) return 'Cutoff unavailable';
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value));
  };

  function validateCurrent(data) {
    if (!data || !Array.isArray(data.rankings) || !data.model || !Number.isFinite(Date.parse(data.asOf))) throw Error('Invalid current review data');
    const ids = new Set();
    for (const row of data.rankings) {
      if (typeof row.id !== 'string' || !row.name || ids.has(row.id) || (row.rank !== null && !finite(row.rank)) || (row.score !== null && !finite(row.score))) throw Error('Invalid current team evidence');
      ids.add(row.id);
    }
    return data;
  }

  function selectView(view, updateHash = true) {
    if (!['current', 'history', 'method'].includes(view)) view = 'current';
    state.view = view;
    for (const key of ['current', 'history', 'method']) {
      $(`panel-${key}`).hidden = key !== view;
      $(`tab-${key}`).classList.toggle('active', key === view);
      $(`tab-${key}`).setAttribute('aria-selected', String(key === view));
    }
    if (updateHash && location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  }

  function renderRankings() {
    const all = state.current.rankings;
    const rows = all.filter(row => (!state.conference || row.conference === state.conference) && (!state.search || row.name.toLowerCase().includes(state.search.toLowerCase())));
    $('ranking-body').innerHTML = rows.length ? rows.map(row => {
      const initials = row.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('');
      return `<tr><td><span class="rank-number ${finite(row.rank) && row.rank <= 3 ? 'top' : ''}">${finite(row.rank) ? esc(row.rank) : '—'}</span></td><th scope="row"><button type="button" class="team-button" data-team="${esc(row.id)}" aria-label="Inspect ${esc(row.name)}"><span class="team-monogram" aria-hidden="true">${esc(initials)}</span><span><span class="team-name">${esc(row.name)}</span><small class="team-conference">${esc(row.conference || 'Independent')}</small></span></button></th><td class="record">${esc(row.wins)}–${esc(row.losses)}</td><td class="num score-number">${signed(row.score)}</td><td class="num">${rank(row.sorRank)}</td><td class="num">${rank(row.strengthRank)}</td><td class="num">${rank(row.performanceRank)}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="empty-row">No teams match these filters.</td></tr>';
    $('result-count').textContent = `${rows.length} of ${all.length} teams shown`;
  }

  function showTeam(identity) {
    const row = state.current.rankings.find(team => team.id === identity);
    if (!row) return;
    const terms = Object.entries(row.components || {});
    const support = Object.entries(row.metrics || {});
    const termRows = terms.map(([name, value]) => `<tr><th scope="row">${esc(metricLabels[name] || name)}</th><td class="num ${value > 0 ? 'positive' : value < 0 ? 'negative' : ''}">${signed(value, 4)}</td></tr>`).join('');
    const unitRows = support.map(([name, evidence]) => `<tr><th scope="row">${esc(metricLabels[name] || name)}</th><td class="num">${signed(evidence.offenseEffect, 3)}</td><td class="num">${signed(evidence.allowanceEffect, 3)}</td><td class="num">${esc(evidence.offenseGames ?? '—')} / ${esc(evidence.defenseGames ?? '—')}</td></tr>`).join('');
    $('dialog-content').innerHTML = `<div class="dialog-content"><div class="dialog-kicker">GAME CUTOFF ${esc(date(state.current.asOf))}</div><div class="dialog-heading"><div><h2 id="dialog-title">${esc(row.name)}</h2><p>${esc(row.conference || 'Independent')} · ${esc(row.wins)}–${esc(row.losses)} record</p></div><div class="dialog-score"><strong>${signed(row.score)}</strong><span>NEUTRAL MODEL SCORE</span></div></div><div class="rank-comparisons">${[['Preview rank', row.rank], ['SOR', row.sorRank], ['Strength', row.strengthRank], ['Performance', row.performanceRank]].map(([label, value]) => `<div class="rank-comparison"><span>${label}</span><strong>${rank(value)}</strong></div>`).join('')}</div><p class="detail-description">The preview combines our Strength estimate with reconstructed efficiency measures, adjusted for the opponents faced. ${esc(row.basicMeasuredGames ?? '—')} of ${esc(row.games)} completed games have measured basic efficiency. This score is an index, not ${esc(row.name)}'s probability of winning its next game.</p><section class="detail-section"><h3>How this score is built</h3><div class="table-scroll"><table class="contribution-table"><caption class="sr-only">Additive contributions to ${esc(row.name)}'s neutral model score</caption><thead><tr><th scope="col">Input</th><th scope="col" class="num">Score contribution</th></tr></thead><tbody>${termRows}<tr class="contribution-total"><th scope="row">Neutral model score</th><td class="num"><strong>${signed(row.score, 4)}</strong></td></tr></tbody></table></div><p class="detail-note">Efficiency contributions combine the offensive and defensive allowance estimates. Contributions add to the centered score, subject to display rounding. Positive contributions raise this index; they are not independent bonus points or win probabilities.</p></section><section class="detail-section"><h3>The measured units</h3><div class="table-scroll"><table><caption class="sr-only">Opponent-adjusted metric units and observed game counts</caption><thead><tr><th scope="col">Metric</th><th scope="col" class="num">Offense effect</th><th scope="col" class="num">Defensive allowance</th><th scope="col" class="num">Games<br>offense / defense</th></tr></thead><tbody>${unitRows}</tbody></table></div><p class="detail-note">Effects use each metric's own units and should not be compared directly across rows. Higher defensive allowance permits more of that metric. Sparse units shrink toward the model reference; missing records do not become fictional zero-valued games.</p></section><p class="detail-note">Research illustration from a saved cutoff. Model weights were trained through 2019; current 2026 positions did not select the model. Existing public rankings and the frozen future-game blend trial are separate.</p></div>`;
    $('team-dialog').showModal();
  }

  function renderHistory() {
    const research = state.research;
    const selected = research.selectedBroaderCandidate.family;
    const candidate = research.evaluation[selected].pooled;
    const baseline = research.evaluation.strength.pooled;
    const extra = (candidate.accuracy - baseline.accuracy) * candidate.games;
    $('history-metrics').innerHTML = [[candidate.games.toLocaleString('en-US'), 'Identical eligible games', '2023–2025 historical replay'], [percent(candidate.accuracy), 'Selected candidate', 'Calibrated probability picks'], [percent(baseline.accuracy), 'Strength control', 'Same fixtures and cutoff rules'], [`${extra >= 0 ? '+' : ''}${num(extra, 0)}`, 'Additional correct pick', 'No established improvement']].map(([value, label, detail]) => `<div class="metric"><span class="metric-label">${label}</span><strong class="metric-value">${value}</strong><span class="metric-detail">${detail}</span></div>`).join('');
    $('history-years').innerHTML = Object.entries(research.evaluation.strength.byYear).map(([year, control]) => {
      const model = research.evaluation[selected].byYear[year];
      return `<tr><th scope="row">${esc(year)}</th><td class="num">${num(control.games, 0)}</td><td class="num">${percent(control.accuracy)}</td><td class="num">${percent(model.accuracy)}</td><td class="num">${num(control.brier, 4)}</td><td class="num">${num(model.brier, 4)}</td></tr>`;
    }).join('');
    $('history-families').innerHTML = Object.entries(research.evaluation).map(([family, result]) => `<tr class="${family === selected ? 'selected-family' : ''}"><th scope="row">${esc(familyLabels[family] || family)}${family === selected ? '<span class="family-note">Selected on older validation</span>' : ''}</th><td class="num">${percent(result.pooled.accuracy)}</td><td class="num">${num(result.pooled.brier, 4)}</td><td class="num">${num(result.pooled.logLoss, 4)}</td></tr>`).join('');
  }

  async function boot() {
    try {
      const responses = await Promise.all(['./data/current.json', './data/research.json'].map(path => fetch(path)));
      if (responses.some(response => !response.ok)) throw Error('Saved review data unavailable');
      const [current, research] = await Promise.all(responses.map(response => response.json()));
      state.current = validateCurrent(current);
      if (!research?.selectedBroaderCandidate?.family || !research.evaluation?.strength?.pooled) throw Error('Invalid historical review data');
      state.research = research;
      $('hero-cutoff').textContent = date(current.asOf);
      $('current-season').textContent = current.season;
      $('current-cutoff').textContent = `Fixed review snapshot: ${date(current.asOf)}. Model trained through ${current.model.trainedThroughSeason ?? 2019}.`;
      $('team-total').textContent = `${current.coverage?.rankedFbsTeams ?? current.rankings.filter(row => row.rank !== null).length} teams ranked`;
      const coverage = current.coverage || {};
      $('coverage-fbs').textContent = `${coverage.pairedFbsGames ?? '—'} / ${coverage.expectedFbsGames ?? '—'}`;
      $('coverage-basic').textContent = `${coverage.validBasicFbsGames ?? '—'} / ${coverage.expectedFbsGames ?? '—'}`;
      $('coverage-fcs').textContent = `${coverage.pairedFcsContextGames ?? '—'} / ${coverage.expectedFcsContextGames ?? '—'}`;
      $('coverage-source').textContent = `Partial statistical coverage. Box-score source updated ${date(current.provenance?.recordedSourceReleaseUpdatedAt)}. FCS-only box scores are unavailable in this source; opponent unit estimates use the measured games. Strength uses its separate results network.`;
      $('current-coverage').textContent = `${coverage.pairedFbsGames ?? '—'} / ${coverage.expectedFbsGames ?? '—'} FBS games have paired recorded boxes. Select a team to inspect its score and measured-unit evidence.`;
      $('current-limitations').innerHTML = (current.limitations || []).map(item => `<li>${esc(item)}</li>`).join('');
      $('conference-filter').innerHTML = '<option value="">All conferences</option>' + [...new Set(current.rankings.map(row => row.conference).filter(Boolean))].sort().map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
      renderRankings(); renderHistory();
      $('loading').hidden = true;
      selectView(location.hash.slice(1) || 'current', false);
      return true;
    } catch (error) {
      $('loading').hidden = true; $('load-error').hidden = false;
      return false;
    }
  }

  $('team-search').addEventListener('input', event => { state.search = event.target.value.trim(); renderRankings(); });
  $('conference-filter').addEventListener('change', event => { state.conference = event.target.value; renderRankings(); });
  $('ranking-body').addEventListener('click', event => { const button = event.target.closest('[data-team]'); if (button) showTeam(button.dataset.team); });
  $('dialog-close').addEventListener('click', () => $('team-dialog').close());
  $('team-dialog').addEventListener('click', event => { if (event.target === $('team-dialog')) { const box = $('team-dialog').getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $('team-dialog').close(); } });
  for (const view of ['current', 'history', 'method']) {
    $(`tab-${view}`).addEventListener('click', () => selectView(view));
    $(`tab-${view}`).addEventListener('keydown', event => {
      const tabs = ['current', 'history', 'method'];
      let next = null;
      if (event.key === 'ArrowRight') next = tabs[(tabs.indexOf(view) + 1) % tabs.length];
      if (event.key === 'ArrowLeft') next = tabs[(tabs.indexOf(view) + tabs.length - 1) % tabs.length];
      if (event.key === 'Home') next = tabs[0];
      if (event.key === 'End') next = tabs[tabs.length - 1];
      if (next) { event.preventDefault(); selectView(next); $(`tab-${next}`).focus(); }
    });
  }
  window.addEventListener('hashchange', () => { if (state.current) selectView(location.hash.slice(1), false); });
  window.fbsReviewReady = boot();
})();
