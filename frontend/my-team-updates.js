import { routeHref } from './clean-routes.js';
const dates = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const instant = value => typeof value === 'string' ? Date.parse(value) : NaN;
const id = value => typeof value === 'string' && /^\d{1,32}$/.test(value);
const relevantStatuses = /^(?:out\b|doubtful$|questionable$|game time decision$)/i;

function reportPlayers(report) {
  const players = new Map();
  for (const player of report.players) {
    if (typeof player?.name !== 'string' || !player.name.trim() || typeof player.status !== 'string' || !player.status.trim()) continue;
    const key = id(player.playerId) ? player.playerId : `name:${player.name.trim().toLowerCase().slice(0, 100)}:${player.jersey ?? ''}`;
    if (!players.has(key)) players.set(key, { name: player.name.trim(), status: player.status.trim().slice(0, 60) });
  }
  return players;
}

export function compareTeamUpdates(previous, { team, season, rank, method, asOf, contributions, availability, viewedAt }) {
  const same = previous?.teamId === team.id && previous.season === season;
  const baseline = same ? previous : {};
  const next = { teamId: team.id, season };
  const updates = [];
  const teamRoute = `team/${team.id}`;
  const published = instant(asOf);
  if (baseline.rank) next.rank = baseline.rank;
  if (Number.isFinite(published) && (rank === null || Number.isInteger(rank) && rank > 0) &&
      (!baseline.rank || published >= instant(baseline.rank.asOf))) {
    const oldRank = baseline.rank;
    next.rank = { asOf, method, value: rank };
    if (same && oldRank && oldRank.method === method && oldRank.value !== rank) {
      const label = value => value === null ? 'unranked' : `#${value}`;
      updates.push({ title: `${method} ${label(oldRank.value)} → ${label(rank)}`, asOf, href: routeHref(teamRoute), action: 'Team ranking' });
    }
  }
  if (baseline.games) next.games = baseline.games;
  if (Number.isFinite(published) && Array.isArray(contributions) &&
      (!baseline.games || published >= instant(baseline.games.asOf))) {
    const games = contributions.filter(game => id(game?.gameId) && ['W', 'L', 'T'].includes(game.result) &&
      Number.isFinite(game.finalMargin)).slice(-32);
    next.games = { asOf, entries: games.map(({ gameId, result, finalMargin }) => [gameId, result, finalMargin]) };
    if (same && Array.isArray(baseline.games?.entries)) {
      const oldGames = new Map(baseline.games.entries.map(row => [row[0], row.slice(1)]));
      for (const game of [...games].reverse()) {
        const previousResult = oldGames.get(game.gameId);
        if (previousResult?.[0] === game.result && previousResult[1] === game.finalMargin) continue;
        const result = game.result === 'W' ? 'Win over' : game.result === 'L' ? 'Loss to' : 'Tie with';
        const margin = game.finalMargin ? ` by ${Math.abs(game.finalMargin)}` : '';
        updates.push({ title: `${previousResult ? 'Corrected result · ' : ''}${result} ${game.opponentName || 'opponent'}${margin}`,
          asOf, href: routeHref(`${teamRoute}/results`), action: 'Game results' });
      }
    }
  }
  const oldReports = new Map((Array.isArray(baseline.reports) ? baseline.reports : []).map(report => [report.id, report]));
  if (baseline.reports) next.reports = baseline.reports;
  if (availability?.teamId === team.id && availability.season === season && Array.isArray(availability.reports)) {
    const reports = availability.reports
      .filter(report => id(report?.gameId) && Number.isFinite(instant(report.reportAt)) && Array.isArray(report.players))
      .sort((a, b) => instant(b.reportAt) - instant(a.reportAt)).slice(0, 4);
    for (const report of reports) {
      const previousReport = oldReports.get(report.gameId);
      if (previousReport && instant(report.reportAt) <= instant(previousReport.asOf)) continue;
      const players = [...reportPlayers(report)].slice(0, 80);
      oldReports.set(report.gameId, { id: report.gameId, asOf: report.reportAt,
        players: players.map(([key, player]) => [key, player.status]) });
      if (!same || (!previousReport && !(instant(report.reportAt) > instant(baseline.viewedAt)))) continue;
      const oldStatuses = new Map(previousReport?.players ?? []);
      const changes = players.filter(([key, { status }]) => oldStatuses.has(key)
        ? oldStatuses.get(key) !== status : relevantStatuses.test(status));
      if (!changes.length) continue;
      const [, first] = changes[0];
      const matchup = report.opponentName ? ` vs. ${report.opponentName}` : '';
      const title = changes.length === 1 ? `${first.name} · ${first.status}${matchup}` :
        `${changes.length} player statuses reported${matchup}`;
      updates.push({ title, asOf: report.reportAt, href: routeHref(`${teamRoute}/availability`), action: 'Availability report' });
    }
    next.reports = [...oldReports.values()].sort((a, b) => instant(b.asOf) - instant(a.asOf)).slice(0, 4);
  }
  const changed = !same || ['rank', 'games', 'reports'].some(key => JSON.stringify(baseline[key]) !== JSON.stringify(next[key]));
  return { updates: updates.slice(0, 3), next: { ...next, viewedAt: changed ? viewedAt : baseline.viewedAt }, changed };
}

export function mountMyTeamUpdates(badge, panel, { team, season, previous, adapter, loadFacts, onSaved, onConflict }) {
  let active = true;
  const mounted = () => active && badge.isConnected && panel.isConnected;
  if (typeof adapter.markUpdatesSeen !== 'function') return () => {};

  void Promise.resolve().then(loadFacts).then(async facts => {
    if (!mounted()) return;
    const { updates, next, changed } = compareTeamUpdates(previous, { ...facts, team, season, viewedAt: new Date().toISOString() });
    if (!changed) return;
    const seen = { ...next, revision: crypto.randomUUID() };
    const save = async () => {
      const saved = await adapter.markUpdatesSeen(team.id, seen, previous?.revision ?? null);
      if (saved && mounted()) onSaved(seen);
      return saved;
    };
    if (!updates.length) {
      await save();
      return;
    }
    badge.innerHTML = `<button type="button" class="my-team-update-badge" aria-expanded="false" aria-controls="my-team-updates">
      <span aria-hidden="true"></span>${updates.length} ${updates.length === 1 ? 'update' : 'updates'}</button>`;
    panel.id = 'my-team-updates';
    panel.hidden = true;
    panel.innerHTML = `<section class="my-team-updates" aria-labelledby="my-team-updates-heading">
      <h3 id="my-team-updates-heading">Since your last visit</h3><ul>${updates.map(update => `<li>
        <a href="${update.href}">${escape(update.title)}</a><small><time datetime="${escape(update.asOf)}">${dates.format(instant(update.asOf))}</time> · ${update.action}</small>
      </li>`).join('')}</ul>
      <button type="button" class="my-team-mark-read">Mark as read</button><p role="status" class="compact-note"></p>
    </section>`;
    const button = badge.querySelector('button');
    button.onclick = () => {
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
    };
    const mark = panel.querySelector('button');
    mark.onclick = async () => {
      mark.disabled = true;
      try {
        const saved = await save();
        if (!mounted()) return;
        if (!saved) return onConflict();
        badge.replaceChildren();
        panel.hidden = true;
        panel.replaceChildren();
        badge.closest('.my-team-header')?.querySelector('[data-my-team-action="edit"]')?.focus();
      } catch {
        if (!mounted()) return;
        panel.querySelector('[role="status"]').textContent = 'Could not mark updates as read. Try again.';
        mark.disabled = false;
      }
    };
  }).catch(() => {});

  return () => { active = false; };
}
