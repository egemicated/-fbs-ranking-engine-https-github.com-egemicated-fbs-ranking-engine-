import { loadAccountConfig, loadBracketClient } from './bracket-auth.js?v=clean-routes';

const validId = value => typeof value === 'string' && /^[0-9]{1,32}$/.test(value);
export function normalizeMyTeamIds(values) {
  if (!Array.isArray(values) || values.length > 20 || values.some(value => !validId(value))) {
    throw Error('Choose up to 20 teams');
  }
  return [...new Set(values)];
}

function accountAdapter() {
  let connection;
  const client = async () => connection ??= await loadAccountConfig().then(loadBracketClient);
  return {
    async read() {
      const api = await client();
      const { data: auth, error: authError } = await api.auth.getSession();
      if (authError) throw authError;
      const userId = auth.session?.user?.id ?? null;
      if (!userId) return { signedIn: false, teamIds: [], primaryTeamId: null, userId: null };
      let { data, error } = await api.from('my_team_preferences').select('team_id,team_ids,seen_updates').eq('user_id', userId).maybeSingle();
      const multipleEnabled = !['42703', 'PGRST204'].includes(error?.code);
      if (!multipleEnabled) ({ data, error } = await api.from('my_team_preferences').select('team_id,seen_updates').eq('user_id', userId).maybeSingle());
      if (error) throw error;
      return { signedIn: true, userId, teamIds: data?.team_ids?.length ? data.team_ids : data?.team_id ? [data.team_id] : [],
        primaryTeamId: data?.team_id ?? null, seen: data?.seen_updates ?? null, updatesEnabled: true, multipleEnabled };
    },
    async save(teamIds, expectedUserId) {
      const api = await client();
      const { data, error: authError } = await api.auth.getSession();
      if (authError) throw authError;
      const userId = data.session?.user?.id;
      if (!userId || userId !== expectedUserId) throw Error('The signed-in account changed');
      const table = api.from('my_team_preferences');
      const { error } = await (teamIds.length ? table.upsert({ user_id: userId, team_id: teamIds[0], team_ids: teamIds }, { onConflict: 'user_id' })
        : table.delete().eq('user_id', userId));
      if (error) throw error;
    },
    subscribe(callback) {
      let active = true, subscription;
      void client().then(api => {
        if (!active) return;
        subscription = api.auth.onAuthStateChange(event => {
          if (['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'].includes(event)) setTimeout(callback, 0);
        }).data.subscription;
      }).catch(() => {});
      return () => { active = false; subscription?.unsubscribe(); };
    },
  };
}

export function createMyTeamsStore(adapter) {
  let state = { signedIn: false, teamIds: [], primaryTeamId: null }, loaded = false, pending, generation = 0;
  let unsubscribe;
  const listeners = new Set();
  const snapshot = () => ({ ...state, teamIds: [...state.teamIds] });
  const emit = () => { for (const callback of listeners) callback(snapshot()); };
  async function load({ force = false } = {}) {
    if (loaded && !force) return snapshot();
    if (pending && !force) return pending;
    const version = ++generation;
    pending = adapter.read().then(result => {
      if (version !== generation) return snapshot();
      state = { ...result, teamIds: normalizeMyTeamIds(result.teamIds ?? []) };
      loaded = true;
      emit();
      return snapshot();
    }).finally(() => { if (version === generation) pending = undefined; });
    return pending;
  }
  async function save(values) {
    const teamIds = normalizeMyTeamIds(values);
    const current = await load();
    if (!current.signedIn) throw Error('Sign in from the header to save your teams');
    if (current.multipleEnabled === false) throw Error('My Teams is temporarily unavailable');
    await adapter.save(teamIds, current.userId);
    return load({ force: true });
  }
  function subscribe(callback) {
    listeners.add(callback);
    unsubscribe ??= adapter.subscribe?.(() => {
      loaded = false;
      state = { signedIn: false, teamIds: [], primaryTeamId: null };
      emit();
      void load({ force: true }).catch(() => {});
    });
    return () => {
      listeners.delete(callback);
      if (!listeners.size) { unsubscribe?.(); unsubscribe = undefined; }
    };
  }
  return { load, save, subscribe, getIds: () => [...state.teamIds],
    async setPrimary(teamId) {
      if (!validId(teamId)) throw Error('Choose a valid team');
      const current = await load();
      return save([teamId, ...current.teamIds.filter(id => id !== teamId)]);
    },
    async remove(teamId) { return save((await load()).teamIds.filter(id => id !== teamId)); },
  };
}

const store = createMyTeamsStore(accountAdapter());
export const loadMyTeams = options => store.load(options);
export const saveMyTeams = ids => store.save(ids);
export const getMyTeamIds = () => store.getIds();
export const subscribeMyTeams = callback => store.subscribe(callback);
export const setPrimaryMyTeam = id => store.setPrimary(id);
export const removeMyTeam = id => store.remove(id);
