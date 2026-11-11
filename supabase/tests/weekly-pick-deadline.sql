-- Run after the weekly contest migrations in a disposable database.
begin;
set local plpgsql.check_asserts = on;
set local timezone = 'America/Denver';
insert into auth.users(id) values
  ('30000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002');

set local role service_role;
do $$
declare
  v_now timestamptz := clock_timestamp();
  v_day date := (v_now at time zone 'America/Los_Angeles')::date + 3;
  v_first timestamptz := (v_day + time '19:30') at time zone 'America/Los_Angeles';
  v_later timestamptz := ((v_day + 3) + time '12:00') at time zone 'America/Los_Angeles';
  v_deadline timestamptz := ((v_day - 1) + time '23:59') at time zone 'America/Los_Angeles';
  v_game jsonb;
  v_games jsonb;
begin
  v_game := jsonb_build_object('id', 'first', 'week', 11, 'seasonType', 'regular',
    'home', 'A', 'away', 'B', 'homeName', 'Alpha Team', 'awayName', 'Beta Team',
    'neutral', false, 'startDate', v_first, 'status', 'scheduled',
    'modelTeam', 'A', 'homeWinProbability', .7, 'modelCapturedAt', v_now - interval '4 days');
  v_games := jsonb_build_array(v_game,
    v_game || jsonb_build_object('id', 'later', 'startDate', v_later),
    v_game || jsonb_build_object('id', 'unpicked', 'startDate', v_later),
    v_game || jsonb_build_object('id', 'next-week', 'week', 12, 'startDate', v_later + interval '7 days'),
    v_game || jsonb_build_object('id', 'bowl', 'seasonType', 'postseason', 'startDate', v_later));
  perform public.weekly_sync(2098, v_now, v_games);
  perform set_config('weekly_deadline_test.games', v_games::text, true);
  perform set_config('weekly_deadline_test.lock_at', v_deadline::text, true);
end;
$$;

set local role anon;
do $$
declare
  v_deadline timestamptz := current_setting('weekly_deadline_test.lock_at')::timestamptz;
  v_games jsonb := public.weekly_contest(2098) -> 'games';
begin
  assert (select count(*) from jsonb_array_elements(v_games) g where g ->> 'id' in ('first', 'later', 'unpicked')
    and (g ->> 'lockAt')::timestamptz = v_deadline and (g ->> 'weeklyLockAt')::timestamptz = v_deadline
    and (g ->> 'startDate')::timestamptz > v_deadline and (g ->> 'locked')::boolean is false) = 3,
    'the entire slate gets a single 11:59 PM Pacific lock independent of kickoff';
  assert (select count(*) from jsonb_array_elements(v_games) g where g ->> 'id' in ('next-week', 'bowl')
    and (g ->> 'weeklyLockAt')::timestamptz > v_deadline) = 2,
    'separate weeks and season types get independent deadlines';
  assert not has_table_privilege('weekly_private.deadlines', 'select,insert,update,delete');
  assert not has_function_privilege('public.weekly_save_picks_with_immediate_sharing(integer,text,jsonb,boolean,boolean)', 'execute');
end;
$$;

set local role service_role;
do $$
declare
  v_games jsonb := current_setting('weekly_deadline_test.games')::jsonb;
  v_deadline timestamptz := current_setting('weekly_deadline_test.lock_at')::timestamptz;
begin
  v_games := v_games || jsonb_build_array(v_games -> 0 || jsonb_build_object('id', 'late-schedule', 'startDate', v_deadline - interval '1 hour'));
  perform public.weekly_sync(2098, clock_timestamp(), v_games);
end;
$$;

set local role authenticated;
do $$
declare
  v_deadline timestamptz := current_setting('weekly_deadline_test.lock_at')::timestamptz;
  v_games jsonb := public.weekly_contest(2098) -> 'games';
begin
  assert (select (g ->> 'lockAt')::timestamptz from jsonb_array_elements(v_games) g where g ->> 'id' = 'later') = v_deadline,
    'adding a game to an announced slate cannot move its deadline';
  assert not exists (select 1 from jsonb_array_elements(v_games) g
    where g ->> 'id' = 'late-schedule' and (g ->> 'eligible')::boolean),
    'a late-added game that would start before the existing deadline is ineligible';
  perform set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
  perform public.weekly_save_picks_with_sharing(2098, 'Legacy Share', '{"first":"B","later":"A"}', true, true);
  assert public.weekly_entry_with_sharing(2098) -> 'sharePicksImmediately' = 'false'::jsonb;
  perform set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
  perform public.weekly_save_picks_with_immediate_sharing(2098, 'Immediate Share', '{"first":"A","later":"B","next-week":"A"}', false, true);
  assert not (public.weekly_leaderboard(2098) -> 'me' ? 'publicPickId'), 'a private leaderboard profile remains private';
  perform public.weekly_save_picks_with_immediate_sharing(2098, 'Immediate Share', '{}', true, true);
  assert public.weekly_entry_with_sharing(2098) -> 'sharePicksImmediately' = 'true'::jsonb;
end;
$$;

reset role;
do $$
begin
  perform set_config('weekly_deadline_test.legacy_id', (select public_pick_id::text
    from weekly_private.players where user_id = '30000000-0000-4000-8000-000000000001'), true);
  perform set_config('weekly_deadline_test.immediate_id', (select public_pick_id::text
    from weekly_private.players where user_id = '30000000-0000-4000-8000-000000000002'), true);
end;
$$;

set local role anon;
do $$
declare
  v_legacy uuid := current_setting('weekly_deadline_test.legacy_id')::uuid;
  v_immediate uuid := current_setting('weekly_deadline_test.immediate_id')::uuid;
  v_picks jsonb := public.weekly_player_picks(2098, v_immediate, 'regular', 11) -> 'picks';
begin
  assert public.weekly_player_picks(2098, v_legacy, 'regular', 11) -> 'picks' = '[]'::jsonb,
    'legacy sharing consent does not reveal pregame picks';
  assert jsonb_array_length(v_picks) = 2 and v_picks -> 0 ->> 'gameId' = 'first'
    and v_picks -> 0 ->> 'teamId' = 'A' and v_picks -> 0 ->> 'status' = 'scheduled'
    and v_picks -> 1 ->> 'gameId' = 'later' and v_picks -> 1 ->> 'teamId' = 'B',
    'only saved picks in the selected scope are visible immediately to anonymous viewers';
  assert not (v_picks -> 0 ?| array['userId','email','capturedAt','updatedAt']);
end;
$$;

reset role;
-- Simulate the deadline passing while every game is still scheduled.
update weekly_private.picks set captured_at = clock_timestamp() - interval '2 hours', updated_at = clock_timestamp() - interval '2 hours'
  where season = 2098;
update weekly_private.deadlines set lock_at = clock_timestamp() - interval '1 minute'
  where season = 2098 and season_type = 'regular' and week = 11;

set local role service_role;
do $$
declare v_games jsonb := current_setting('weekly_deadline_test.games')::jsonb;
begin
  v_games := v_games || jsonb_build_array(v_games -> 1 || jsonb_build_object('id', 'late-forecast', 'modelCapturedAt', clock_timestamp()));
  perform public.weekly_sync(2098, clock_timestamp(), v_games);
end;
$$;

set local role authenticated;
do $$
declare v_games jsonb := public.weekly_contest(2098) -> 'games';
begin
  assert (select count(*) from jsonb_array_elements(v_games) g where g ->> 'id' in ('first', 'later', 'unpicked')
    and (g ->> 'locked')::boolean and g ->> 'status' = 'scheduled') = 3, 'all games lock together before kickoff';
  assert not exists (select 1 from jsonb_array_elements(v_games) g where g ->> 'id' = 'late-forecast' and (g ->> 'eligible')::boolean),
    'a forecast first captured after the deadline cannot enter the slate';
  perform set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
  begin
    perform public.weekly_save_picks_with_immediate_sharing(2098, 'Immediate Share', '{"first":"B"}', true, true);
    raise exception 'shared deadline permitted a change';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.weekly_save_picks(2098, 'Immediate Share', '{"later":null}', true);
    raise exception 'shared deadline permitted removal via the legacy API';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.weekly_save_picks(2098, 'Immediate Share', '{"unpicked":"A"}', true);
    raise exception 'shared deadline permitted a new pick via the legacy API';
  exception when invalid_parameter_value then null;
  end;
  perform public.weekly_save_picks_with_immediate_sharing(2098, 'Immediate Share', '{"first":"A","next-week":"B"}', true, true);
  assert public.weekly_entry_with_sharing(2098) -> 'picks' = '{"first":"A","later":"B","next-week":"B"}'::jsonb,
    'the next slate stays editable and locked choices are preserved';
end;
$$;

reset role;
do $$
begin
  begin
    update weekly_private.picks set team_id = 'A' where season = 2098 and game_id = 'later';
    raise exception 'storage trigger permitted a write after the shared deadline';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
update weekly_private.games g set status = 'final', home_points = 24, away_points = 14, winner_id = 'A',
  kickoff = d.lock_at + interval '1 second'
  from weekly_private.deadlines d
  where (g.season, g.season_type, g.week) = (d.season, d.season_type, d.week) and g.season = 2098 and g.id = 'first';

set local role anon;
do $$
declare
  v_immediate uuid := current_setting('weekly_deadline_test.immediate_id')::uuid;
  v_legacy uuid := current_setting('weekly_deadline_test.legacy_id')::uuid;
  v_board jsonb := public.weekly_leaderboard(2098, 'regular', 11);
begin
  assert v_board -> 'model' = '{"correct":1,"graded":1}'::jsonb;
  assert v_board -> 'rows' -> 0 ->> 'nickname' = 'Immediate Share' and v_board -> 'rows' -> 0 -> 'points' = '1'::jsonb;
  assert public.weekly_player_picks(2098, v_immediate, 'regular', 11) -> 'picks' -> 0 ->> 'winner' = 'A';
  assert jsonb_array_length(public.weekly_player_picks(2098, v_legacy, 'regular', 11) -> 'picks') = 1,
    'legacy sharing still reveals a pick when its game kicks off';
end;
$$;

set local role authenticated;
do $$
declare v_immediate uuid := current_setting('weekly_deadline_test.immediate_id')::uuid;
begin
  perform set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
  perform public.weekly_save_picks_with_immediate_sharing(2098, 'Immediate Share', '{}', true, false);
  assert public.weekly_player_picks(2098, v_immediate) is null, 'revocation removes public access even after lock';
  assert public.weekly_entry_with_sharing(2098) -> 'picks' = '{"first":"A","later":"B","next-week":"B"}'::jsonb;
end;
$$;
rollback;
