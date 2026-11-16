import { loadAccountConfig, loadBracketClient } from './bracket-auth.js?v=header-account';
import { myTeamColors } from './my-team-colors.js?v=2026';
import { mountMyTeamUpdates } from './my-team-updates.js?v=1';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const preferences = 'my_team_preferences';

function accountAdapter() {
  let preferenceUserId = null;
  const client = () => loadAccountConfig().then(loadBracketClient);
  async function userId(auth) {
    const { data, error } = await auth.getSession();
    if (error) throw error;
    return data.session?.user?.id ?? null;
  }
  return {
    async getPreference() {
      const connection = await client();
      const id = await userId(connection.auth);
      preferenceUserId = id;
      if (id === null) return { signedIn: false, teamId: null };
      let { data, error } = await connection.from(preferences).select('team_id,seen_updates').eq('user_id', id).maybeSingle();
      const updatesEnabled = !['42703', 'PGRST204'].includes(error?.code);
      if (!updatesEnabled) ({ data, error } = await connection.from(preferences).select('team_id').eq('user_id', id).maybeSingle());
      if (error) throw error;
      return { signedIn: true, teamId: data?.team_id ?? null, seen: data?.seen_updates ?? null, updatesEnabled };
    },
    async savePreference(teamId) {
      const expectedUserId = preferenceUserId;
      const connection = await client();
      const id = await userId(connection.auth);
      if (!id || id !== expectedUserId) throw Error('The signed-in account changed');
      const table = connection.from(preferences);
      const { error } = await (teamId === null ? table.delete().eq('user_id', id)
        : table.upsert({ user_id: id, team_id: teamId }, { onConflict: 'user_id' }));
      if (error) throw error;
    },
    async markUpdatesSeen(teamId, seen, previousRevision) {
      const expectedUserId = preferenceUserId;
      const connection = await client();
      const id = await userId(connection.auth);
      if (!id || id !== expectedUserId) return false;
      const row = connection.from(preferences).update({ seen_updates: seen }).eq('user_id', id).eq('team_id', teamId);
      const guarded = previousRevision ? row.eq('seen_updates->>revision', previousRevision) : row.is('seen_updates', null);
      const { data, error } = await guarded.select('team_id').maybeSingle();
      if (error) throw error;
      return data?.team_id === teamId;
    },
    subscribe(onChange) {
      let active = true, subscription, notification;
      void client().then(connection => {
        if (!active) return;
        subscription = connection.auth.onAuthStateChange((event, session) => {
          if (!['SIGNED_IN', 'SIGNED_OUT'].includes(event) ||
              (session?.user?.id ?? null) === preferenceUserId) return;
          clearTimeout(notification);
          notification = setTimeout(onChange, 0);
        }).data.subscription;
      }).catch(() => {});
      return () => { active = false; clearTimeout(notification); subscription?.unsubscribe(); };
    },
  };
}

function options(teams, selected) {
  const groups = ['fbs', 'fcs'].map(division => {
    const members = [...teams.values()].filter(team => team.division === division)
      .sort((a, b) => a.name.localeCompare(b.name));
    return members.length ? `<optgroup label="${division.toUpperCase()}">${members.map(team =>
      `<option value="${escape(team.id)}"${team.id === selected ? ' selected' : ''}>${escape(team.name)}</option>`).join('')}</optgroup>` : '';
  });
  return '<option value="">Choose a team</option>'+groups.join('');
}

export function mountMyTeam(root, { teams, renderTeam, chosenTeamId, adapter = accountAdapter(), loadUpdateFacts, season, mountExtras }) {
  let active = true, version = 0, signedIn = false, loaded = false, failure = false, editing = false, busy = false;
  let favorite = null, draft = '', message = '';
  let seen = null, updatesEnabled = true, cleanupUpdates, cleanupExtras;
  const current = request => active && root.isConnected && request === version;

  function draw(focus) {
    if (!current(version)) return;
    cleanupUpdates?.();
    cleanupExtras?.();
    const team = teams.get(favorite);
    const disabled = busy ? ' disabled' : '';
    const button = (action, label, symbol) => `<button type="button" class="button ${symbol ? 'my-team-change' : 'light small'}" data-my-team-action="${action}"${disabled}>${symbol ? `<span aria-hidden="true">${symbol}</span>` : ''}${label}</button>`;
    const showFavorite = loaded && signedIn && team && !editing;
    let content;
    if (!loaded) content = failure ? `<div class="my-team-prompt"><p>My Team could not load.</p>${button('retry', 'Try again')}</div>` : '<p role="status">Loading My Team…</p>';
    else if (!signedIn) content = '<p>Sign in from the header to follow your favorite team.</p>';
    else if (editing || !team) content = `${team ? '' : `<p>${favorite ? 'Your saved team is unavailable this season.' : 'Choose your favorite team.'}</p>`}
      <form class="my-team-choice" data-my-team-form><div><label for="my-team-select">Team</label>
      <select id="my-team-select" name="team" required${disabled}>${options(teams, draft)}</select></div>
      <button type="submit" class="button small"${disabled}>Save team</button>
      ${team ? button('cancel', 'Cancel') : ''}${favorite ? button('clear', 'Remove team') : ''}</form>`;
    else content = renderTeam(team);
    const teamColor = showFavorite ? myTeamColors[team.id] : null;
    const theme = showFavorite ? ` data-favorite-team="${escape(team.id)}"${teamColor ? ` style="--my-team-color:${teamColor}"` : ''}` : '';
    root.innerHTML = `<section class="panel my-team"${theme} aria-labelledby="my-team-title"><div class="panel-body">
      <div class="my-team-header"><div class="my-team-header-title"><h2 id="my-team-title">${showFavorite ? '<span class="my-team-star" aria-hidden="true">☆</span>' : ''}My Team</h2>
      ${showFavorite ? '<span data-my-team-update-badge></span>' : ''}</div>${showFavorite ? button('edit', 'Change team', '⇄') : ''}</div>
      ${showFavorite ? '<div data-my-team-update-panel hidden></div>' : ''}${content}<p class="my-team-message compact-note" role="status">${escape(message)}</p></div></section>`;
    if (showFavorite) {
      cleanupExtras = mountExtras?.(root, team);
      if (updatesEnabled && loadUpdateFacts && season) {
        cleanupUpdates = mountMyTeamUpdates(root.querySelector('[data-my-team-update-badge]'), root.querySelector('[data-my-team-update-panel]'), {
          team, season, previous: seen, adapter, loadFacts: () => loadUpdateFacts(team),
          onSaved: value => { seen = value; }, onConflict: read,
        });
      }
    }
    if (focus) root.querySelector(focus)?.focus();
  }

  async function read() {
    const request = ++version;
    loaded = false; failure = false; message = ''; draw();
    try {
      const preference = await adapter.getPreference();
      if (!current(request)) return;
      signedIn = preference.signedIn === true;
      seen = preference.seen ?? null;
      updatesEnabled = preference.updatesEnabled !== false;
      favorite = signedIn && typeof preference.teamId === 'string' ? preference.teamId : null;
      editing = signedIn && teams.has(chosenTeamId) && chosenTeamId !== favorite;
      draft = editing ? chosenTeamId : teams.has(favorite) ? favorite : '';
      loaded = true;
    } catch {
      if (!current(request)) return;
      failure = true;
    }
    if (current(request)) { busy = false; draw(); }
  }

  async function save(teamId) {
    if (!signedIn || busy || (teamId !== null && !teams.has(teamId))) return;
    const request = ++version;
    busy = true; message = ''; draw();
    try {
      await adapter.savePreference(teamId);
      if (!current(request)) return;
      if (favorite !== teamId) seen = null;
      favorite = teamId;
      draft = teamId ?? '';
      editing = false;
      message = teamId ? 'Team saved to your account.' : 'Team removed from your account.';
    } catch {
      if (!current(request)) return;
      message = 'The team preference could not be saved. Try again.';
    }
    busy = false;
    draw(editing || !favorite ? '#my-team-select' : '[data-my-team-action="edit"]');
  }

  root.onchange = event => {
    if (event.target.id === 'my-team-select') draft = event.target.value;
  };
  root.onsubmit = event => {
    if (!event.target.matches('[data-my-team-form]')) return;
    event.preventDefault();
    void save(event.target.elements.team.value);
  };
  root.onclick = event => {
    const action = event.target.closest('[data-my-team-action]')?.dataset.myTeamAction;
    if (!action || busy) return;
    if (action === 'retry') return read();
    if (action === 'edit') { editing = true; message = ''; draw('#my-team-select'); }
    if (action === 'cancel') { editing = false; draft = favorite; message = ''; draw('[data-my-team-action="edit"]'); }
    if (action === 'clear') return save(null);
  };
  void read();
  const unsubscribe = adapter.subscribe?.(read);
  return () => {
    active = false;
    cleanupUpdates?.();
    cleanupExtras?.();
    unsubscribe?.();
    root.onclick = root.onchange = root.onsubmit = null;
  };
}
