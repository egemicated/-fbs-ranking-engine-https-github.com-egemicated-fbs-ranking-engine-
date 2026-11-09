-- Keep the tables and privileged implementations outside the exposed API schema.
create schema cfp_private;
revoke all on schema cfp_private from public;
grant usage on schema cfp_private to anon, authenticated, service_role;

create table cfp_private.contests (
  season integer primary key check (season between 2024 and 2100),
  lock_at timestamptz not null,
  slots jsonb not null,
  results jsonb not null default '{}'::jsonb,
  results_observed_at timestamptz
);

create table cfp_private.entries (
  season integer not null references cfp_private.contests(season),
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null,
  picks jsonb not null,
  primary key (season, user_id)
);
create index cfp_entries_user_idx on cfp_private.entries (user_id);

alter table cfp_private.contests enable row level security;
alter table cfp_private.entries enable row level security;
revoke all on all tables in schema cfp_private from public, anon, authenticated, service_role;

create function cfp_private.contest(p_season integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('season', season, 'lockAt', lock_at, 'slots', slots, 'results', results)
  from cfp_private.contests where season = p_season;
$$;

create function cfp_private.my_entry(p_season integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nickname', nickname, 'picks', picks)
  from cfp_private.entries where season = p_season and user_id = (select auth.uid());
$$;

-- The after-write check also covers a concurrent save that waited on a row lock.
create function cfp_private.enforce_entry_deadline()
returns trigger language plpgsql set search_path = '' as $$
begin
  if clock_timestamp() >= (select lock_at from cfp_private.contests where season = new.season) then
    raise exception 'Bracket entries are locked' using errcode = '22023';
  end if;
  return null;
end;
$$;

create trigger cfp_entry_deadline after insert or update on cfp_private.entries
for each row execute function cfp_private.enforce_entry_deadline();

create function cfp_private.save_entry(p_season integer, p_nickname text, p_picks jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_nickname text := btrim(p_nickname);
  v_contest cfp_private.contests%rowtype;
  v_slot jsonb;
  v_pick text;
  v_home text;
  v_away text;
begin
  if v_user is null then
    raise exception 'Sign in to save a bracket' using errcode = '42501';
  end if;
  if v_nickname is null or char_length(v_nickname) not between 2 and 30 or v_nickname ~ '[[:cntrl:]]' then
    raise exception 'Use a display name between 2 and 30 characters' using errcode = '22023';
  end if;
  -- Saves for different players can run together. The feed takes the same lock
  -- exclusively so it cannot change the field while an entry is being saved.
  perform pg_advisory_xact_lock_shared(1129334352, p_season);
  select * into v_contest from cfp_private.contests where season = p_season;
  if not found or clock_timestamp() >= v_contest.lock_at then
    raise exception 'Bracket entries are closed' using errcode = '22023';
  end if;
  if jsonb_typeof(p_picks) is distinct from 'object' then
    raise exception 'Pick a winner in all 11 games' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_picks)) <> 11 then
    raise exception 'Pick a winner in all 11 games' using errcode = '22023';
  end if;
  for v_slot in select value from jsonb_array_elements(v_contest.slots) loop
    v_pick := p_picks ->> (v_slot ->> 'id');
    v_home := coalesce(v_slot ->> 'home', p_picks ->> (v_slot ->> 'homeFrom'));
    v_away := coalesce(v_slot ->> 'away', p_picks ->> (v_slot ->> 'awayFrom'));
    if jsonb_typeof(p_picks -> (v_slot ->> 'id')) is distinct from 'string' or
      (v_pick is distinct from v_home and v_pick is distinct from v_away) then
      raise exception 'Pick a team that can reach game %', v_slot ->> 'id' using errcode = '22023';
    end if;
  end loop;
  insert into cfp_private.entries (season, user_id, nickname, picks)
  values (p_season, v_user, v_nickname, p_picks)
  on conflict (season, user_id) do update set nickname = excluded.nickname, picks = excluded.picks;
  return jsonb_build_object('nickname', v_nickname, 'picks', p_picks);
end;
$$;

create function cfp_private.leaderboard(p_season integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  with scored as (
    select e.user_id, e.nickname, scores.points, scores.correct
    from cfp_private.entries e
    join cfp_private.contests c using (season)
    cross join lateral (
      select coalesce(sum(case (s.slot ->> 'round')::integer
        when 1 then 1 when 2 then 2 when 3 then 4 when 4 then 8 end), 0) as points,
        count(*) as correct
      from jsonb_array_elements(c.slots) as s(slot)
      where (e.picks ->> (s.slot ->> 'id')) = (c.results -> (s.slot ->> 'id') ->> 'winner')
    ) scores
    where e.season = p_season and c.lock_at <= statement_timestamp()
  ), placed as (
    select *, rank() over (order by points desc) as rank from scored
  )
  select coalesce(jsonb_agg(jsonb_build_object('rank', rank, 'nickname', nickname,
    'points', points, 'correct', correct, 'isYou', coalesce(user_id = (select auth.uid()), false))
    order by rank, nickname, user_id), '[]'::jsonb)
  from placed;
$$;

create function cfp_private.sync(p_season integer, p_bracket jsonb, p_results jsonb, p_observed_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old cfp_private.contests%rowtype;
  v_lock timestamptz;
  v_first_kickoff timestamptz;
  v_kickoff timestamptz;
  v_slots jsonb;
  v_slot jsonb;
  v_slot_id text;
  v_round integer;
  v_round_counts integer[] := array[0, 0, 0, 0];
  v_teams text[] := '{}';
  v_consumed text[] := '{}';
  v_round_by_slot jsonb := '{}';
  v_side text;
  v_feeder text;
  v_team text;
  v_feeder_count integer;
  v_results jsonb;
  v_observed_at timestamptz;
  v_result jsonb;
  v_home text;
  v_away text;
  v_home_points integer;
  v_away_points integer;
begin
  if p_season is null or p_season not between 2024 and 2100 or
      jsonb_typeof(p_results) is distinct from 'object' then
    raise exception 'Invalid CFP season or results' using errcode = '22023';
  end if;
  if p_results <> '{}'::jsonb and (p_observed_at is null or not isfinite(p_observed_at) or
      p_observed_at > clock_timestamp()) then
    raise exception 'A valid source observation time is required for CFP results' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(1129334352, p_season);
  select * into v_old from cfp_private.contests where season = p_season;
  if p_bracket is null then
    if not found then raise exception 'Publish the CFP field before its results' using errcode = '22023'; end if;
    v_lock := v_old.lock_at;
    v_slots := v_old.slots;
  else
    v_slots := p_bracket -> 'slots';
    if jsonb_typeof(p_bracket -> 'lockAt') is distinct from 'string' or
        jsonb_typeof(v_slots) is distinct from 'array' then
      raise exception 'Invalid CFP bracket' using errcode = '22023';
    end if;
    v_lock := (p_bracket ->> 'lockAt')::timestamptz;
    if not isfinite(v_lock) or jsonb_array_length(v_slots) <> 11 then
      raise exception 'CFP bracket must have a finite deadline and 11 games' using errcode = '22023';
    end if;
    if v_old.season is not null and (v_slots <> v_old.slots or v_lock <> v_old.lock_at) and
        (v_old.results <> '{}'::jsonb or exists (select 1 from cfp_private.entries where season = p_season)) then
      raise exception 'CFP bracket is frozen after entries or results exist' using errcode = '22023';
    end if;
  end if;

  -- Both graders read the same provider. An older capture may finish last,
  -- so order writes by retrieval time once the per-season lock is held.
  if p_observed_at <= v_old.results_observed_at then p_results := '{}'::jsonb; end if;
  v_observed_at := case when p_results = '{}'::jsonb then v_old.results_observed_at else p_observed_at end;
  v_results := coalesce(v_old.results, '{}'::jsonb) || p_results;
  for v_slot in select value from jsonb_array_elements(v_slots) loop
    v_slot_id := v_slot ->> 'id';
    if not (v_slot ?& array['id', 'round', 'kickoff', 'home', 'away', 'homeFrom', 'awayFrom']) or
        jsonb_typeof(v_slot -> 'id') is distinct from 'string' or v_slot_id !~ '^[a-z0-9-]{1,20}$' or
        v_round_by_slot ? v_slot_id or jsonb_typeof(v_slot -> 'round') is distinct from 'number' or
        (v_slot ->> 'round') !~ '^[1-4]$' or jsonb_typeof(v_slot -> 'kickoff') is distinct from 'string' then
      raise exception 'Invalid CFP slot %', v_slot_id using errcode = '22023';
    end if;
    v_round := (v_slot ->> 'round')::integer;
    v_kickoff := (v_slot ->> 'kickoff')::timestamptz;
    if not isfinite(v_kickoff) or v_kickoff < v_lock then
      raise exception 'Invalid kickoff for game %', v_slot_id using errcode = '22023';
    end if;
    if v_round = 1 then v_first_kickoff := least(v_first_kickoff, v_kickoff); end if;
    v_round_counts[v_round] := v_round_counts[v_round] + 1;
    v_feeder_count := 0;
    foreach v_side in array array['home', 'away'] loop
      v_feeder := v_slot ->> (v_side || 'From');
      v_team := v_slot ->> v_side;
      if v_feeder is null then
        if jsonb_typeof(v_slot -> v_side) is distinct from 'string' or
            char_length(v_team) not between 1 and 80 or v_team <> btrim(v_team) or v_team = any(v_teams) then
          raise exception 'Invalid or duplicate team in game %', v_slot_id using errcode = '22023';
        end if;
        v_teams := array_append(v_teams, v_team);
      else
        if v_team is not null or jsonb_typeof(v_slot -> (v_side || 'From')) is distinct from 'string' or
            (v_round_by_slot ->> v_feeder)::integer is distinct from v_round - 1 or v_feeder = any(v_consumed) then
          raise exception 'Invalid feeder for game %', v_slot_id using errcode = '22023';
        end if;
        v_feeder_count := v_feeder_count + 1;
        v_consumed := array_append(v_consumed, v_feeder);
      end if;
    end loop;
    if v_feeder_count <> least(v_round - 1, 2) then
      raise exception 'Invalid pairing for game %', v_slot_id using errcode = '22023';
    end if;
    v_round_by_slot := v_round_by_slot || jsonb_build_object(v_slot_id, v_round);

    if v_results ? v_slot_id then
      v_result := v_results -> v_slot_id;
      v_home := coalesce(v_slot ->> 'home', v_results -> (v_slot ->> 'homeFrom') ->> 'winner');
      v_away := coalesce(v_slot ->> 'away', v_results -> (v_slot ->> 'awayFrom') ->> 'winner');
      if v_home is null or v_away is null or v_kickoff > clock_timestamp() or
          jsonb_typeof(v_result -> 'winner') is distinct from 'string' or
          jsonb_typeof(v_result -> 'homePoints') is distinct from 'number' or
          jsonb_typeof(v_result -> 'awayPoints') is distinct from 'number' or
          (v_result ->> 'homePoints') !~ '^[0-9]{1,4}$' or (v_result ->> 'awayPoints') !~ '^[0-9]{1,4}$' then
        raise exception 'Invalid final result for game %', v_slot_id using errcode = '22023';
      end if;
      v_home_points := (v_result ->> 'homePoints')::integer;
      v_away_points := (v_result ->> 'awayPoints')::integer;
      if v_home_points = v_away_points or (v_result ->> 'winner') <>
          (case when v_home_points > v_away_points then v_home else v_away end) then
        raise exception 'Winner does not match final score for game %', v_slot_id using errcode = '22023';
      end if;
      if not (p_results ? v_slot_id) and (
          (v_old.results -> (v_slot ->> 'homeFrom') ->> 'winner') is distinct from
            (v_results -> (v_slot ->> 'homeFrom') ->> 'winner') or
          (v_old.results -> (v_slot ->> 'awayFrom') ->> 'winner') is distinct from
            (v_results -> (v_slot ->> 'awayFrom') ->> 'winner')) then
        raise exception 'Correct the affected downstream result for game %', v_slot_id using errcode = '22023';
      end if;
      v_results := jsonb_set(v_results, array[v_slot_id], jsonb_build_object(
        'winner', v_result ->> 'winner', 'homePoints', v_home_points, 'awayPoints', v_away_points));
    end if;
  end loop;
  if v_round_counts <> array[4, 4, 2, 1] or v_lock is distinct from v_first_kickoff or
      exists (select 1 from jsonb_object_keys(v_results) as r(id) where not (v_round_by_slot ? r.id)) then
    raise exception 'Invalid CFP bracket structure, deadline, or result slot' using errcode = '22023';
  end if;

  insert into cfp_private.contests (season, lock_at, slots, results, results_observed_at)
  values (p_season, v_lock, v_slots, v_results, v_observed_at)
  on conflict (season) do update set lock_at = excluded.lock_at, slots = excluded.slots,
    results = excluded.results, results_observed_at = excluded.results_observed_at
  where (contests.lock_at, contests.slots, contests.results, contests.results_observed_at) is distinct from
    (excluded.lock_at, excluded.slots, excluded.results, excluded.results_observed_at);
end;
$$;

revoke all on all functions in schema cfp_private from public, anon, authenticated, service_role;
grant execute on function cfp_private.contest(integer), cfp_private.leaderboard(integer) to anon, authenticated;
grant execute on function cfp_private.my_entry(integer), cfp_private.save_entry(integer, text, jsonb) to authenticated;
grant execute on function cfp_private.sync(integer, jsonb, jsonb, timestamptz) to service_role;

create function public.cfp_contest(p_season integer)
returns jsonb language sql stable set search_path = '' as $$
  select cfp_private.contest(p_season);
$$;
create function public.cfp_my_entry(p_season integer)
returns jsonb language sql stable set search_path = '' as $$
  select cfp_private.my_entry(p_season);
$$;
create function public.cfp_save_entry(p_season integer, p_nickname text, p_picks jsonb)
returns jsonb language sql set search_path = '' as $$
  select cfp_private.save_entry(p_season, p_nickname, p_picks);
$$;
create function public.cfp_leaderboard(p_season integer)
returns jsonb language sql stable set search_path = '' as $$
  select cfp_private.leaderboard(p_season);
$$;
create function public.cfp_sync(p_season integer, p_bracket jsonb, p_results jsonb, p_observed_at timestamptz default null)
returns void language sql set search_path = '' as $$
  select cfp_private.sync(p_season, p_bracket, p_results, p_observed_at);
$$;

revoke all on function public.cfp_contest(integer), public.cfp_my_entry(integer), public.cfp_save_entry(integer, text, jsonb),
  public.cfp_leaderboard(integer), public.cfp_sync(integer, jsonb, jsonb, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.cfp_contest(integer), public.cfp_leaderboard(integer) to anon, authenticated;
grant execute on function public.cfp_my_entry(integer), public.cfp_save_entry(integer, text, jsonb) to authenticated;
grant execute on function public.cfp_sync(integer, jsonb, jsonb, timestamptz) to service_role;
