create schema weekly_private;
revoke all on schema weekly_private from public;
grant usage on schema weekly_private to anon, authenticated, service_role;

create table weekly_private.publications (
  season integer primary key check (season between 2024 and 2100),
  observed_at timestamptz not null
);

create table weekly_private.players (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  public_leaderboard boolean not null default false
);

create table weekly_private.games (
  season integer not null references weekly_private.publications(season),
  id text not null,
  week integer not null check (week between 0 and 30),
  season_type text not null check (season_type in ('regular', 'postseason')),
  home_id text not null,
  away_id text not null,
  home_name text not null,
  away_name text not null,
  neutral boolean not null,
  kickoff timestamptz not null,
  status text not null check (status in ('scheduled', 'pending', 'final')),
  home_points integer,
  away_points integer,
  winner_id text,
  model_team_id text,
  model_captured_at timestamptz,
  home_probability double precision,
  void_reason text,
  primary key (season, id),
  check (home_id <> away_id),
  check (model_team_id is null or model_team_id in (home_id, away_id)),
  check (winner_id is null or winner_id in (home_id, away_id)),
  check (home_probability between 0 and 1),
  check (model_captured_at is null or model_captured_at < kickoff)
);

create table weekly_private.picks (
  season integer not null,
  game_id text not null,
  user_id uuid not null references weekly_private.players(user_id) on delete cascade,
  team_id text not null,
  captured_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (season, game_id, user_id),
  foreign key (season, game_id) references weekly_private.games(season, id)
);
create index weekly_picks_user_season_idx on weekly_private.picks (user_id, season);

alter table weekly_private.publications enable row level security;
alter table weekly_private.players enable row level security;
alter table weekly_private.games enable row level security;
alter table weekly_private.picks enable row level security;
revoke all on all tables in schema weekly_private from public, anon, authenticated, service_role;

create function weekly_private.contest(p_season integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('season', p_season, 'observedAt',
    (select observed_at from weekly_private.publications where season = p_season),
    'serverNow', statement_timestamp(), 'games', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'week', week, 'seasonType', season_type,
        'home', home_id, 'away', away_id, 'homeName', home_name, 'awayName', away_name,
        'startDate', kickoff, 'status', status,
        'locked', kickoff <= statement_timestamp() or void_reason is not null or model_team_id is null or status <> 'scheduled',
        'eligible', model_team_id is not null and void_reason is null,
        'modelTeam', model_team_id, 'modelCapturedAt', model_captured_at, 'homeWinProbability', home_probability,
        'homePoints', home_points, 'awayPoints', away_points, 'winner', winner_id, 'voidReason', void_reason)
        order by kickoff, id)
      from weekly_private.games where season = p_season and model_team_id is not null
    ), '[]'::jsonb));
$$;

create function weekly_private.entry(p_season integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nickname', coalesce((select nickname from weekly_private.players where user_id = auth.uid()), ''),
    'publicLeaderboard', coalesce((select public_leaderboard from weekly_private.players where user_id = auth.uid()), false),
    'picks', coalesce((select jsonb_object_agg(game_id, team_id) from weekly_private.picks
      where season = p_season and user_id = auth.uid()), '{}'::jsonb));
$$;

create function weekly_private.check_pick_deadline()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_game weekly_private.games%rowtype;
  v_pick weekly_private.picks%rowtype;
begin
  v_pick := case when tg_op = 'DELETE' then old else new end;
  if tg_op = 'DELETE' and not exists (select 1 from weekly_private.players where user_id = v_pick.user_id) then
    -- Account removal cascades through the private profile and its picks.
    return null;
  end if;
  select * into v_game from weekly_private.games where season = v_pick.season and id = v_pick.game_id;
  if clock_timestamp() >= v_game.kickoff or v_game.model_team_id is null or v_game.void_reason is not null or
      v_game.status <> 'scheduled' or v_pick.team_id not in (v_game.home_id, v_game.away_id) then
    raise exception 'This game is locked or unavailable for picks' using errcode = '22023';
  end if;
  return null;
end;
$$;
create trigger weekly_pick_deadline after insert or update or delete on weekly_private.picks
for each row execute function weekly_private.check_pick_deadline();

create function weekly_private.save_picks(p_season integer, p_nickname text, p_picks jsonb, p_public boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_nickname text := btrim(p_nickname);
  v_id text;
  v_value jsonb;
  v_team text;
  v_previous text;
  v_game weekly_private.games%rowtype;
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
    select * into v_game from weekly_private.games where season = p_season and id = v_id;
    if not found or clock_timestamp() >= v_game.kickoff or v_game.model_team_id is null or
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

create function weekly_private.leaderboard(p_season integer, p_season_type text, p_week integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  with games as (
    select * from weekly_private.games where season = p_season and model_team_id is not null and void_reason is null
      and (p_season_type is null or season_type = p_season_type) and (p_week is null or week = p_week)
  ), scores as (
    select p.user_id, count(*) as picked,
      count(*) filter (where g.winner_id is not null) as graded,
      count(*) filter (where p.team_id = g.winner_id) as correct,
      count(*) filter (where g.winner_id is not null and g.model_team_id = g.winner_id) as model_correct
    from weekly_private.picks p join games g on (g.season, g.id) = (p.season, p.game_id)
    where p.updated_at < g.kickoff group by p.user_id
  ), public_scores as (
    select s.*, player.nickname, rank() over (order by s.correct desc) as rank
    from scores s join weekly_private.players player using (user_id)
    where player.public_leaderboard
  ), visible as (
    select * from public_scores order by rank, nickname, user_id limit 100
  ), my_score as (
    select s.*, player.nickname, public.rank from scores s
    join weekly_private.players player using (user_id)
    left join public_scores public using (user_id)
    where s.user_id = (select auth.uid())
  )
  select jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object(
      'rank', rank, 'nickname', nickname, 'points', correct, 'correct', correct, 'graded', graded,
      'picked', picked, 'modelCorrect', model_correct, 'compared', graded, 'beatModel', correct > model_correct,
      'isYou', coalesce(user_id = (select auth.uid()), false)) order by rank, nickname, user_id) from visible), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', rank, 'nickname', nickname, 'points', correct, 'correct', correct,
      'graded', graded, 'picked', picked, 'modelCorrect', model_correct, 'compared', graded,
      'beatModel', correct > model_correct, 'isYou', true) from my_score),
    'model', (select jsonb_build_object('correct', count(*) filter (where model_team_id = winner_id),
      'graded', count(*) filter (where winner_id is not null)) from games));
$$;

create function weekly_private.sync(p_season integer, p_observed_at timestamptz, p_games jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_game jsonb;
  v_old weekly_private.games%rowtype;
  v_id text;
  v_home text;
  v_away text;
  v_kickoff timestamptz;
  v_status text;
  v_week integer;
  v_season_type text;
  v_neutral boolean;
  v_home_points integer;
  v_away_points integer;
  v_winner text;
  v_model text;
  v_capture timestamptz;
  v_probability double precision;
  v_reason text;
  v_seen text[] := '{}';
  v_updated integer := 0;
  v_previous_observed timestamptz;
begin
  if p_season is null or p_season not between 2024 and 2100 or p_observed_at is null or
      not isfinite(p_observed_at) or p_observed_at > clock_timestamp() + interval '1 minute' or
      jsonb_typeof(p_games) is distinct from 'array' then
    raise exception 'Invalid weekly contest source' using errcode = '22023';
  end if;
  if jsonb_array_length(p_games) = 0 then raise exception 'The weekly source has no games' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(1464877900, p_season);
  select observed_at into v_previous_observed from weekly_private.publications where season = p_season;
  if p_observed_at <= v_previous_observed then return jsonb_build_object('updated', 0, 'stale', true); end if;
  insert into weekly_private.publications (season, observed_at) values (p_season, p_observed_at)
  on conflict (season) do update set observed_at = excluded.observed_at;

  for v_game in select value from jsonb_array_elements(p_games) loop
    v_id := v_game ->> 'id';
    v_home := v_game ->> 'home';
    v_away := v_game ->> 'away';
    if jsonb_typeof(v_game -> 'id') is distinct from 'string' or v_id !~ '^[A-Za-z0-9_-]{1,50}$' or
        v_id = any(v_seen) or jsonb_typeof(v_game -> 'home') is distinct from 'string' or
        jsonb_typeof(v_game -> 'away') is distinct from 'string' or v_home = v_away or
        char_length(v_home) not between 1 and 50 or char_length(v_away) not between 1 and 50 or
        jsonb_typeof(v_game -> 'homeName') is distinct from 'string' or
        jsonb_typeof(v_game -> 'awayName') is distinct from 'string' or
        jsonb_typeof(v_game -> 'neutral') is distinct from 'boolean' or
        jsonb_typeof(v_game -> 'week') is distinct from 'number' or (v_game ->> 'week') !~ '^(0|[1-9][0-9]?)$' or
        (v_game ->> 'week')::integer > 30 or (v_game ->> 'seasonType') not in ('regular', 'postseason') or
        (v_game ->> 'status') not in ('scheduled', 'pending', 'final') or
        jsonb_typeof(v_game -> 'startDate') is distinct from 'string' then
      raise exception 'Invalid weekly game %', v_id using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_id);
    v_kickoff := (v_game ->> 'startDate')::timestamptz;
    if not isfinite(v_kickoff) then raise exception 'Invalid game kickoff' using errcode = '22023'; end if;
    v_week := (v_game ->> 'week')::integer;
    v_season_type := v_game ->> 'seasonType';
    v_neutral := (v_game ->> 'neutral')::boolean;
    v_status := v_game ->> 'status';
    v_home_points := null;
    v_away_points := null;
    v_winner := null;
    if v_status = 'final' then
      if jsonb_typeof(v_game -> 'homePoints') is distinct from 'number' or
          jsonb_typeof(v_game -> 'awayPoints') is distinct from 'number' or
          (v_game ->> 'homePoints') !~ '^[0-9]{1,4}$' or (v_game ->> 'awayPoints') !~ '^[0-9]{1,4}$' or
          v_kickoff > p_observed_at then
        raise exception 'Invalid final score for game %', v_id using errcode = '22023';
      end if;
      v_home_points := (v_game ->> 'homePoints')::integer;
      v_away_points := (v_game ->> 'awayPoints')::integer;
      v_winner := case when v_home_points > v_away_points then v_home when v_away_points > v_home_points then v_away end;
    end if;
    v_model := v_game ->> 'modelTeam';
    v_capture := (v_game ->> 'modelCapturedAt')::timestamptz;
    v_probability := (v_game ->> 'homeWinProbability')::double precision;
    if v_model is not null and (v_model not in (v_home, v_away) or v_capture is null or
        not isfinite(v_capture) or v_capture >= v_kickoff or v_capture > p_observed_at or v_capture > clock_timestamp() or
        v_probability is null or not (v_probability between 0 and 1) or
        (v_probability > .5) is distinct from (v_model = v_home) or v_probability = .5) then
      raise exception 'Invalid saved model forecast for game %', v_id using errcode = '22023';
    end if;
    select * into v_old from weekly_private.games where season = p_season and id = v_id;
    if v_old.status = 'final' and v_status <> 'final' then
      v_status := v_old.status;
      v_home_points := v_old.home_points;
      v_away_points := v_old.away_points;
      v_winner := v_old.winner_id;
    end if;
    v_reason := v_old.void_reason;
    if v_reason = 'Game no longer available in the source schedule' then v_reason := null; end if;
    if v_old.id is not null and (v_old.home_id, v_old.away_id, v_old.kickoff, v_old.neutral, v_old.week, v_old.season_type)
        is distinct from (v_home, v_away, v_kickoff, v_neutral, v_week, v_season_type) and
        (v_old.model_team_id is not null or v_old.kickoff <= clock_timestamp() or
          exists (select 1 from weekly_private.picks where season = p_season and game_id = v_id)) then
      v_reason := 'Matchup or kickoff changed after picks were saved';
    end if;
    if v_reason is not null then
      update weekly_private.games set void_reason = v_reason where season = p_season and id = v_id;
    else
      if v_old.model_team_id is not null then
        v_model := v_old.model_team_id;
        v_capture := v_old.model_captured_at;
        v_probability := v_old.home_probability;
      elsif v_kickoff <= clock_timestamp() then
        -- New stored forecasts can only open a contest while it is still pregame.
        v_model := null;
        v_capture := null;
        v_probability := null;
      end if;
      insert into weekly_private.games (season, id, week, season_type, home_id, away_id, home_name, away_name,
        neutral, kickoff, status, home_points, away_points, winner_id, model_team_id, model_captured_at, home_probability, void_reason)
      values (p_season, v_id, v_week, v_season_type, v_home, v_away, v_game ->> 'homeName', v_game ->> 'awayName',
        v_neutral, v_kickoff, v_status, v_home_points, v_away_points, v_winner, v_model, v_capture, v_probability, null)
      on conflict (season, id) do update set week = excluded.week, season_type = excluded.season_type,
        home_id = excluded.home_id, away_id = excluded.away_id, home_name = excluded.home_name, away_name = excluded.away_name,
        neutral = excluded.neutral, kickoff = excluded.kickoff, status = excluded.status, home_points = excluded.home_points,
        away_points = excluded.away_points, winner_id = excluded.winner_id, model_team_id = excluded.model_team_id,
        model_captured_at = excluded.model_captured_at, home_probability = excluded.home_probability, void_reason = excluded.void_reason;
    end if;
    v_updated := v_updated + 1;
  end loop;
  update weekly_private.games set void_reason = 'Game no longer available in the source schedule'
    where season = p_season and not (id = any(v_seen)) and void_reason is null;
  return jsonb_build_object('updated', v_updated, 'stale', false);
end;
$$;

revoke all on all functions in schema weekly_private from public, anon, authenticated, service_role;
grant execute on function weekly_private.contest(integer), weekly_private.leaderboard(integer, text, integer) to anon, authenticated;
grant execute on function weekly_private.entry(integer), weekly_private.save_picks(integer, text, jsonb, boolean) to authenticated;
grant execute on function weekly_private.sync(integer, timestamptz, jsonb) to service_role;

create function public.weekly_contest(p_season integer)
returns jsonb language sql stable set search_path = '' as $$ select weekly_private.contest(p_season); $$;
create function public.weekly_entry(p_season integer)
returns jsonb language sql stable set search_path = '' as $$ select weekly_private.entry(p_season); $$;
create function public.weekly_save_picks(p_season integer, p_nickname text, p_picks jsonb, p_public boolean default false)
returns jsonb language sql set search_path = '' as $$ select weekly_private.save_picks(p_season, p_nickname, p_picks, p_public); $$;
create function public.weekly_leaderboard(p_season integer, p_season_type text default null, p_week integer default null)
returns jsonb language sql stable set search_path = '' as $$ select weekly_private.leaderboard(p_season, p_season_type, p_week); $$;
create function public.weekly_sync(p_season integer, p_observed_at timestamptz, p_games jsonb)
returns jsonb language sql set search_path = '' as $$ select weekly_private.sync(p_season, p_observed_at, p_games); $$;

revoke all on function public.weekly_contest(integer), public.weekly_entry(integer),
  public.weekly_save_picks(integer, text, jsonb, boolean), public.weekly_leaderboard(integer, text, integer),
  public.weekly_sync(integer, timestamptz, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.weekly_contest(integer), public.weekly_leaderboard(integer, text, integer) to anon, authenticated;
grant execute on function public.weekly_entry(integer), public.weekly_save_picks(integer, text, jsonb, boolean) to authenticated;
grant execute on function public.weekly_sync(integer, timestamptz, jsonb) to service_role;
