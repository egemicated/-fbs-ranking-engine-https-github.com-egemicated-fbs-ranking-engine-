create or replace function weekly_private.sync(p_season integer, p_observed_at timestamptz, p_games jsonb)
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
    -- A time-only correction to a still-upcoming game keeps its forecast and picks.
    if v_old.id is not null and (
        (v_old.home_id, v_old.away_id, v_old.neutral, v_old.week, v_old.season_type)
          is distinct from (v_home, v_away, v_neutral, v_week, v_season_type) or
        (v_old.kickoff is distinct from v_kickoff and (
          v_old.status is distinct from 'scheduled' or v_status is distinct from 'scheduled' or
          least(v_old.kickoff, v_kickoff) <= clock_timestamp()))
      ) and (
        v_old.model_team_id is not null or v_old.kickoff <= clock_timestamp() or
        exists (select 1 from weekly_private.picks where season = p_season and game_id = v_id)
      ) then
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
