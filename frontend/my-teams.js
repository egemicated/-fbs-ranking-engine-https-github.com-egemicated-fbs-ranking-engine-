import { routeHref } from './clean-routes.js';
import { loadMyTeams, saveMyTeams, setPrimaryMyTeam, removeMyTeam, subscribeMyTeams } from './my-teams-store.js?v=1';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const number = value => Number.isFinite(value) ? value.toFixed(1) : '—';
const rank = value => Number.isInteger(value) && value > 0 ? `#${value}` : 'Not reported';
const record = team => Number.isInteger(team?.wins) && Number.isInteger(team?.losses) ? `${team.wins}–${team.losses}${team.ties ? `–${team.ties}` : ''}` : 'Not reported';
const dates = new Intl.DateTimeFormat('en-US', { timeZone:'America/Denver', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short' });
const time = value => Number.isFinite(Date.parse(value)) ? dates.format(new Date(value)) : 'Not reported';
const recentStatuses = /^(out|doubtful|questionable|game time decision)/i;

export function myTeamSummary(team, details, availability, { teams, movement, primary }) {
  const games = details?.contributions ?? [];
  const ownConference = games.filter(game => team.conference !== 'FBS Independents' && teams.get(game.opponentId)?.conference === team.conference);
  const ownRecord = ownConference.length ? record({ wins:ownConference.filter(game => game.result === 'W').length,
    losses:ownConference.filter(game => game.result === 'L').length, ties:ownConference.filter(game => game.result === 'T').length }) : 'Not reported';
  const next = details?.upcomingGames?.[0];
  const nextLink = next ? routeHref(`compare/matchup/${encodeURIComponent(next.homeId)}/${encodeURIComponent(next.awayId)}/home`) : '';
  const change = movement?.teams?.[team.id]?.movement;
  const movementLabel = Number.isInteger(change) ? change ? `${change > 0 ? '↑' : '↓'} ${Math.abs(change)} places` : '↔ No change' : 'Not reported';
  const strengthOrder = [...teams.values()].filter(row => row.division === team.division && Number.isFinite(row.strength))
    .sort((a,b) => b.strength - a.strength || a.id.localeCompare(b.id));
  const predictiveRank = team.strengthRank ?? (Number.isFinite(team.strength) ? strengthOrder.findIndex(row => row.id === team.id) + 1 : null);
  const report = [...(availability?.reports ?? [])].sort((a,b) => Date.parse(b.reportAt) - Date.parse(a.reportAt))[0];
  const absences = (report?.players ?? []).filter(player => recentStatuses.test(player.status));
  return `<article class="panel my-teams-card" data-saved-team="${escape(team.id)}"><div class="panel-body">
    <div class="my-teams-heading"><div><p class="section-label">${escape(team.division?.toUpperCase())} · ${escape(team.conference)}</p>
      <h2><a href="${routeHref(`team/${encodeURIComponent(team.id)}`)}">${escape(team.name)}</a>${primary ? '<small> Home team</small>' : ''}</h2></div>
      <img src="https://a.espncdn.com/i/teamlogos/ncaa/500/${encodeURIComponent(team.id)}.png" width="48" height="48" alt="" loading="lazy"></div>
    <dl class="my-teams-metrics"><div><dt>SOR rank</dt><dd>${rank(team.displayRank ?? team.sorRank ?? team.rank)}</dd></div>
      <div><dt>Predictive rank</dt><dd>${rank(predictiveRank)}</dd></div><div><dt>Overall record</dt><dd>${record(team)}</dd></div>
      <div><dt>Vs. own conference</dt><dd>${ownRecord}</dd></div><div><dt>SOR score</dt><dd>${Number.isFinite(team.sor) ? team.sor.toFixed(4) : 'Not reported'}</dd></div>
      <div><dt>Weekly movement</dt><dd>${movementLabel}</dd></div></dl>
    ${Number.isInteger(change) ? `<p class="compact-note">Week ${escape(movement.week)} vs. Week ${escape(movement.previousWeek)}${movement.complete ? '' : ' · Provisional'}</p>` : ''}
    ${next ? `<div class="my-teams-next"><p class="section-label">Next game</p><a href="${nextLink}"><strong>${next.venue === 'away' ? 'At' : next.venue === 'neutral' ? 'vs.' : 'Hosting'} ${escape(next.opponentName)}</strong></a>
      <p>${next.startTimeTbd ? 'Kickoff time pending' : escape(time(next.startDate))}</p>
      <p>${Number.isFinite(next.winProbability) ? `${number(next.winProbability * 100)}% ${next.probabilitySource === 'saved' ? 'saved pregame win chance' : 'current estimated win chance'}` : 'Prediction not reported'}</p>
      <div class="my-teams-links"><a href="${nextLink}">Matchup Lab</a><a href="${routeHref(`compare/weekly${team.division === 'fcs' ? '/fcs' : ''}`)}">Weekly Picks</a>${team.division === 'fbs' ? '<a href="/beat-the-model/">Beat the Model</a>' : ''}</div></div>` :
      '<p class="compact-note">No upcoming game reported in the published schedule.</p>'}
    <details class="my-teams-evidence"><summary>Recent results and availability</summary>
      <ul>${games.length ? games.slice(-3).reverse().map(game => `<li><strong>${escape(game.result)}</strong> <a href="${routeHref(`team/${encodeURIComponent(game.opponentId)}`)}">${escape(game.opponentName)}</a> · ${Number.isFinite(game.finalMargin) ? `${Math.abs(game.finalMargin)}-point margin` : 'Margin not reported'}</li>`).join('') : '<li>Recent results not reported.</li>'}</ul>
      <p>${report ? `Availability for ${escape(report.opponentName)} · reported ${escape(time(report.reportAt))}. ${absences.length ? absences.slice(0,3).map(player => escape(player.name)+' · '+escape(player.status)).join(' · ') : 'No reported absences in this report.'}` : 'Availability not reported.'}</p>
      <a href="${routeHref(`team/${encodeURIComponent(team.id)}/availability`)}">Availability details and sources</a>
    </details>
    <div class="my-teams-links"><a href="${routeHref(`team/${encodeURIComponent(team.id)}`)}">Team profile</a><a href="${routeHref(`team/${encodeURIComponent(team.id)}/results`)}">Schedule and results</a>
      <button type="button" class="text-link" data-my-teams-primary="${escape(team.id)}"${primary ? ' disabled' : ''}>Make Home team</button>
      <button type="button" class="text-link" data-my-teams-remove="${escape(team.id)}">Remove</button></div>
  </div></article>`;
}

export function mountMyTeams(container, { teams, chosenTeamId, loadTeamDetails, loadAvailability, movement,
  store = { load:loadMyTeams, save:saveMyTeams, primary:setPrimaryMyTeam, remove:removeMyTeam, subscribe:subscribeMyTeams } } = {}) {
  let active = true, request = 0, state, message = '', error = false, busy = false;
  let selected = teams.has(chosenTeamId) ? chosenTeamId : '';
  const details = new Map(), availability = new Map();
  const current = version => active && container.isConnected && version === request;
  function draw() {
    if (!active || !container.isConnected) return;
    const ids = state?.teamIds ?? [];
    const choices = [...teams.values()].filter(team => !ids.includes(team.id)).sort((a,b) => a.name.localeCompare(b.name));
    container.innerHTML = `<div class="my-teams-page"><div class="my-teams-intro"><h2>My Teams</h2><p>Follow your teams, their next games, and the evidence behind their rankings.</p></div>
      <p class="compact-note${error ? ' is-error' : ''}" role="status">${escape(message)}</p>
      ${!state ? '<p role="status">Loading your teams…</p>' : !state.signedIn ? '<section class="panel panel-body"><p>Sign in from the header to save FBS and FCS teams to your account across devices.</p><a class="text-link" href="/teams/fbs/">Browse teams</a></section>' :
        `<form class="my-teams-add panel panel-body" data-my-teams-add><label for="my-teams-team">Add a team</label><select id="my-teams-team" name="team" required${busy ? ' disabled' : ''}><option value="">Choose a team</option>${['fbs','fcs'].map(division => `<optgroup label="${division.toUpperCase()}">${choices.filter(team => team.division === division).map(team => `<option value="${escape(team.id)}"${team.id === selected ? ' selected' : ''}>${escape(team.name)}</option>`).join('')}</optgroup>`).join('')}</select><button class="button small" type="submit"${busy || ids.length >= 20 ? ' disabled' : ''}>Add team</button><small>Your first team appears on Home. Up to 20 teams.</small></form>
        ${ids.length ? `<div class="my-teams-grid">${ids.map(id => teams.has(id) ? myTeamSummary(teams.get(id),details.get(id),availability.get(id),{teams,movement,primary:id===state.primaryTeamId}) : `<section class="panel panel-body"><p>A saved team is unavailable in this season.</p><button class="text-link" data-my-teams-remove="${escape(id)}">Remove unavailable team</button></section>`).join('')}</div>` : '<p class="compact-note">Add your first team to follow its ranking and schedule here.</p>'}`}</div>`;
  }
  async function read() {
    const version = ++request;
    try {
      state = await store.load();
      if (!current(version)) return;
      draw();
      await Promise.all(state.teamIds.map(async id => {
        if (!teams.has(id)) return;
        const [detail, report] = await Promise.all([
          details.has(id) ? details.get(id) : Promise.resolve(loadTeamDetails?.(id)).catch(() => null),
          availability.has(id) ? availability.get(id) : Promise.resolve(loadAvailability?.(id)).catch(() => null),
        ]);
        if (!current(version)) return;
        details.set(id,detail); availability.set(id,report);
      }));
      if (current(version)) draw();
    } catch {
      if (!current(version)) return;
      message = 'My Teams could not load. Reload to try again.'; error = true; draw();
    }
  }
  async function save(operation) {
    if (busy) return;
    busy = true; error = false; message = 'Saving…'; draw();
    try { await operation(); message = 'Your teams are saved to your account.'; selected = ''; }
    catch (failure) { message = failure.message || 'Could not save your teams. Try again.'; error = true; }
    busy = false; await read();
  }
  container.onchange = event => { if (event.target.id === 'my-teams-team') selected = event.target.value; };
  container.onsubmit = event => {
    if (!event.target.matches('[data-my-teams-add]')) return;
    event.preventDefault();
    const id = event.target.elements.team.value;
    if (!teams.has(id)) return;
    void save(() => store.save([...state.teamIds, id]));
  };
  container.onclick = event => {
    const remove = event.target.closest('[data-my-teams-remove]')?.dataset.myTeamsRemove;
    const primary = event.target.closest('[data-my-teams-primary]')?.dataset.myTeamsPrimary;
    if (remove) void save(() => store.remove(remove));
    else if (primary) void save(() => store.primary(primary));
  };
  const unsubscribe = store.subscribe(() => { void read(); });
  void read();
  return () => { active = false; request++; unsubscribe?.(); container.onclick = container.onchange = container.onsubmit = null; };
}
