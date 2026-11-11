create table weekly_private.deadlines (
  season integer not null references weekly_private.publications(season),
  season_type text not null,
  week integer not null,
  -- A null deadline preserves per-game locks for slates already in progress at rollout.
  lock_at timestamptz,
  primary key (season, season_type, week)
);
alter table weekly_private.deadlines enable row level security;
revoke all on table weekly_private.deadlines from public, anon, authenticated, service_role;

create function weekly_private.seed_deadlines(p_season integer, p_rollout boolean)
returns void language sql set search_path = '' as $$
  insert into weekly_private.deadlines (season, season_type, week, lock_at)
  select season, season_type, week,
    case when not p_rollout or lock_at > statement_timestamp() then lock_at end
  from (
    select season, season_type, week,
      (((min(kickoff) at time zone 'America/Los_Angeles')::date - 1) + time '23:59')
        at time zone 'America/Los_Angeles' as lock_at
    from weekly_private.games
    where model_team_id is not null and void_reason is null
      and (p_season is null or season = p_season)
    group by season, season_type, week
  ) slates
  on conflict (season, season_type, week) do nothing;
$$;

select weekly_private.seed_deadlines(null, true);

-- A game added later may not start before the posted deadline or use a late forecast.
create view weekly_private.pick_games as
  select g.*, d.lock_at as weekly_lock_at, least(d.lock_at, g.kickoff) as lock_at,
    (g.model_team_id is not null and
      (d.lock_at is null or (g.kickoff > d.lock_at and g.model_captured_at < d.lock_at))) as admitted
  from weekly_private.games g left join weekly_private.deadlines d using (season, season_type, week);
revoke all on table weekly_private.pick_games from public, anon, authenticated, service_role;

create function weekly_private.sync_with_deadlines(p_season integer, p_observed_at timestamptz, p_games jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  v_result := weekly_private.sync(p_season, p_observed_at, p_games);
  if not (v_result ->> 'stale')::boolean then
    perform weekly_private.seed_deadlines(p_season, false);
  end if;
  return v_result;
end;
$$;

create or replace function public.weekly_sync(p_season integer, p_observed_at timestamptz, p_games jsonb)
returns jsonb language sql set search_path = '' as $$
  select weekly_private.sync_with_deadlines(p_season, p_observed_at, p_games);
$$;

revoke all on function weekly_private.seed_deadlines(integer, boolean),
  weekly_private.sync_with_deadlines(integer, timestamptz, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function weekly_private.sync_with_deadlines(integer, timestamptz, jsonb) to service_role;

create or replace function weekly_private.contest(p_season integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('season', p_season, 'observedAt',
    (select observed_at from weekly_private.publications where season = p_season),
    'serverNow', statement_timestamp(), 'games', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'week', week, 'seasonType', season_type,
        'home', home_id, 'away', away_id, 'homeName', home_name, 'awayName', away_name,
        'startDate', kickoff, 'status', status, 'lockAt', lock_at, 'weeklyLockAt', weekly_lock_at,
        'locked', lock_at <= statement_timestamp() or void_reason is not null or status <> 'scheduled',
        'eligible', model_team_id is not null and void_reason is null,
        'modelTeam', model_team_id, 'modelCapturedAt', model_captured_at, 'homeWinProbability', home_probability,
        'homePoints', home_points, 'awayPoints', away_points, 'winner', winner_id, 'voidReason', void_reason)
        order by kickoff, id)
      from weekly_private.pick_games where season = p_season and admitted
    ), '[]'::jsonb));
$$;

create or replace function weekly_private.check_pick_deadline()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_game weekly_private.pick_games%rowtype;
  v_pick weekly_private.picks%rowtype;
begin
  v_pick := case when tg_op = 'DELETE' then old else new end;
  if tg_op = 'DELETE' and not exists (select 1 from weekly_private.players where user_id = v_pick.user_id) then
    -- Account removal cascades through the private profile and its picks.
    return null;
  end if;
  select * into v_game from weekly_private.pick_games where season = v_pick.season and id = v_pick.game_id;
  if not found or clock_timestamp() >= v_game.lock_at or not v_game.admitted or v_game.void_reason is not null or
      v_game.status <> 'scheduled' or v_pick.team_id not in (v_game.home_id, v_game.away_id) then
    raise exception 'This game is locked or unavailable for picks' using errcode = '22023';
  end if;
  return null;
end;
$$;

create or replace function weekly_private.save_picks(p_season integer, p_nickname text, p_picks jsonb, p_public boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_nickname text := btrim(p_nickname);
  v_id text;
  v_value jsonb;
  v_team text;
  v_previous text;
  v_game weekly_private.pick_games%rowtype;
begin
  if v_user is null then raise exception 'Sign in to save picks' using errcode = '42501'; end if;
  if v_nickname is null or char_length(v_nickname) not between 2 and 30 or v_nickname ~ '[[:cntrl:]]' then
    raise exception 'Use a display name between 2 and 30 characters' using errcode = '22023';
  end if;
  if jsonb_typeof(p_picks) is distinct from 'object' then
    raise exception 'Invalid game picks' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_picks)) > 200 then
    raise exception 'Save at most 200 picks at a time' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock_shared(1464877900, p_season);
  if not exists (select 1 from weekly_private.publications where season = p_season) then
    raise exception 'This season is not open for picks' using errcode = '22023';
  end if;
  insert into weekly_private.players (user_id, nickname, public_leaderboard)
  values (v_user, v_nickname, coalesce(p_public, false))
  on conflict (user_id) do update set nickname = excluded.nickname, public_leaderboard = excluded.public_leaderboard;
  for v_id, v_value in select key, value from jsonb_each(p_picks) order by key loop
    if jsonb_typeof(v_value) not in ('string', 'null') then
      raise exception 'Invalid winner for game %', v_id using errcode = '22023';
    end if;
    v_team := v_value #>> '{}';
    select team_id into v_previous from weekly_private.picks
      where season = p_season and game_id = v_id and user_id = v_user;
    if v_previous is not distinct from v_team then continue; end if;
    select * into v_game from weekly_private.pick_games where season = p_season and id = v_id;
    if not found or clock_timestamp() >= v_game.lock_at or not v_game.admitted or
        v_game.void_reason is not null or v_game.status <> 'scheduled' then
      raise exception 'Game % is locked or unavailable', v_id using errcode = '22023';
    end if;
    if v_team is null then
      delete from weekly_private.picks where season = p_season and game_id = v_id and user_id = v_user;
    elsif v_team not in (v_game.home_id, v_game.away_id) then
      raise exception 'Choose a participating team for game %', v_id using errcode = '22023';
    else
      insert into weekly_private.picks (season, game_id, user_id, team_id)
      values (p_season, v_id, v_user, v_team)
      on conflict (season, game_id, user_id) do update set team_id = excluded.team_id, updated_at = clock_timestamp();
    end if;
  end loop;
  return weekly_private.entry(p_season);
end;
$$;

create or replace function weekly_private.leaderboard(p_season integer, p_season_type text, p_week integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  with games as (
    select * from weekly_private.pick_games where season = p_season and admitted and void_reason is null
      and (p_season_type is null or season_type = p_season_type) and (p_week is null or week = p_week)
  ), scores as (
    select p.user_id, count(*) as picked,
      count(*) filter (where g.winner_id is not null) as graded,
      count(*) filter (where p.team_id = g.winner_id) as correct,
      count(*) filter (where g.winner_id is not null and g.model_team_id = g.winner_id) as model_correct
    from weekly_private.picks p join games g on (g.season, g.id) = (p.season, p.game_id)
    where p.updated_at < g.lock_at group by p.user_id
  ), public_scores as (
    select s.*, player.nickname, rank() over (order by s.correct desc) as rank,
      case when player.share_picks then player.public_pick_id end as public_pick_id
    from scores s join weekly_private.players player using (user_id)
    where player.public_leaderboard
  ), visible as (
    select * from public_scores order by rank, nickname, user_id limit 100
  ), my_score as (
    select s.*, player.nickname, public.rank, public.public_pick_id from scores s
    join weekly_private.players player using (user_id)
    left join public_scores public using (user_id)
    where s.user_id = (select auth.uid())
  )
  select jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object(
      'rank', rank, 'nickname', nickname, 'points', correct, 'correct', correct, 'graded', graded,
      'picked', picked, 'modelCorrect', model_correct, 'compared', graded, 'beatModel', correct > model_correct,
      'isYou', coalesce(user_id = (select auth.uid()), false)) ||
      case when public_pick_id is not null then jsonb_build_object('publicPickId', public_pick_id) else '{}'::jsonb end
      order by rank, nickname, user_id) from visible), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', rank, 'nickname', nickname, 'points', correct, 'correct', correct,
      'graded', graded, 'picked', picked, 'modelCorrect', model_correct, 'compared', graded,
      'beatModel', correct > model_correct, 'isYou', true) ||
      case when public_pick_id is not null then jsonb_build_object('publicPickId', public_pick_id) else '{}'::jsonb end from my_score),
    'model', (select jsonb_build_object('correct', count(*) filter (where model_team_id = winner_id),
      'graded', count(*) filter (where winner_id is not null)) from games));
$$;

alter table weekly_private.players
  add column share_picks_immediately boolean not null default false,
  add constraint weekly_immediate_sharing_opt_in check (not share_picks_immediately or share_picks);

create or replace function weekly_private.entry_with_sharing(p_season integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select weekly_private.entry(p_season) || coalesce((
    select jsonb_build_object('sharePicks', share_picks, 'sharePicksImmediately', share_picks_immediately)
    from weekly_private.players where user_id = (select auth.uid())
  ), '{"sharePicks":false,"sharePicksImmediately":false}'::jsonb);
$$;

create or replace function weekly_private.save_picks_with_sharing(
  p_season integer, p_nickname text, p_picks jsonb, p_public boolean, p_share_picks boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform weekly_private.save_picks(p_season, p_nickname, p_picks, p_public);
  update weekly_private.players set share_picks = coalesce(p_share_picks, false),
    share_picks_immediately = share_picks_immediately and coalesce(p_public and p_share_picks, false)
    where user_id = (select auth.uid());
  return weekly_private.entry_with_sharing(p_season);
end;
$$;

create function weekly_private.save_picks_with_immediate_sharing(
  p_season integer, p_nickname text, p_picks jsonb, p_public boolean, p_share_picks boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_share boolean := coalesce(p_public and p_share_picks, false);
begin
  perform weekly_private.save_picks(p_season, p_nickname, p_picks, p_public);
  update weekly_private.players set share_picks = v_share, share_picks_immediately = v_share
    where user_id = (select auth.uid());
  return weekly_private.entry_with_sharing(p_season);
end;
$$;

create function public.weekly_save_picks_with_immediate_sharing(
  p_season integer, p_nickname text, p_picks jsonb, p_public boolean, p_share_picks boolean
)
returns jsonb language sql set search_path = '' as $$
  select weekly_private.save_picks_with_immediate_sharing(p_season, p_nickname, p_picks, p_public, p_share_picks);
$$;

revoke all on function weekly_private.save_picks_with_immediate_sharing(integer, text, jsonb, boolean, boolean),
  public.weekly_save_picks_with_immediate_sharing(integer, text, jsonb, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function weekly_private.save_picks_with_immediate_sharing(integer, text, jsonb, boolean, boolean),
  public.weekly_save_picks_with_immediate_sharing(integer, text, jsonb, boolean, boolean) to authenticated;

create or replace function weekly_private.player_picks(p_season integer, p_public_pick_id uuid, p_season_type text, p_week integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nickname', player.nickname, 'picks', coalesce((
    select jsonb_agg(jsonb_build_object('gameId', g.id, 'teamId', p.team_id, 'week', g.week, 'seasonType', g.season_type,
      'home', g.home_id, 'away', g.away_id, 'homeName', g.home_name, 'awayName', g.away_name,
      'startDate', g.kickoff, 'modelTeam', g.model_team_id, 'status', g.status,
      'homePoints', g.home_points, 'awayPoints', g.away_points, 'winner', g.winner_id) order by g.kickoff, g.id)
    from weekly_private.picks p join weekly_private.pick_games g on (g.season, g.id) = (p.season, p.game_id)
    where p.user_id = player.user_id and p.season = p_season and (player.share_picks_immediately or g.kickoff <= statement_timestamp())
      and p.updated_at < g.lock_at and g.admitted and g.void_reason is null
      and (p_season_type is null or g.season_type = p_season_type) and (p_week is null or g.week = p_week)
  ), '[]'::jsonb))
  from weekly_private.players player
  where player.public_pick_id = p_public_pick_id and player.public_leaderboard and player.share_picks;
$$;
