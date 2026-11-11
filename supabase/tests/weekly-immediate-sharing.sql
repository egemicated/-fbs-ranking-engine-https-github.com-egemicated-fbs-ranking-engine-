-- Run after the weekly contest migrations in a disposable database.
begin;
set local plpgsql.check_asserts = on;
insert into auth.users(id) values
  ('30000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002');

set local role service_role;
do $$
declare
  v_now timestamptz := clock_timestamp();
  v_game jsonb;
begin
  v_game := jsonb_build_object('id', 'first', 'week', 11, 'seasonType', 'regular',
    'home', 'A', 'away', 'B', 'homeName', 'Alpha Team', 'awayName', 'Beta Team',
    'neutral', false, 'startDate', v_now + interval '3 days', 'status', 'scheduled',
    'modelTeam', 'A', 'homeWinProbability', .7, 'modelCapturedAt', v_now - interval '4 days');
  perform public.weekly_sync(2098, v_now, jsonb_build_array(v_game,
    v_game || jsonb_build_object('id', 'later', 'startDate', v_now + interval '5 days'),
    v_game || jsonb_build_object('id', 'next-week', 'week', 12, 'startDate', v_now + interval '10 days')));
end;
$$;

set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);
  perform public.weekly_save_picks_with_sharing(2098, 'Legacy Share', '{"first":"B","later":"A"}', true, true);
  assert public.weekly_entry_with_sharing(2098) -> 'sharePicksImmediately' = 'false'::jsonb;
  perform set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
  perform public.weekly_save_picks_with_immediate_sharing(2098, 'Immediate Share', '{"later":"B"}', false, true);
  assert not (public.weekly_leaderboard(2098) -> 'me' ? 'publicPickId'), 'a private leaderboard profile remains private';
end;
$$;

reset role;
do $$
begin
  perform set_config('weekly_immediate_test.legacy_id', (select public_pick_id::text
    from weekly_private.players where user_id = '30000000-0000-4000-8000-000000000001'), true);
  perform set_config('weekly_immediate_test.immediate_id', (select public_pick_id::text
    from weekly_private.players where user_id = '30000000-0000-4000-8000-000000000002'), true);
end;
$$;

set local role anon;
do $$
begin
  assert not has_function_privilege('public.weekly_save_picks_with_immediate_sharing(integer,text,jsonb,boolean,boolean)', 'execute');
  assert public.weekly_player_picks(2098, current_setting('weekly_immediate_test.immediate_id')::uuid) is null,
    'even a known share ID cannot read the picks of a private profile';
end;
$$;

set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
  perform public.weekly_save_picks_with_immediate_sharing(2098, 'Immediate Share', '{"first":"A","next-week":"A"}', true, true);
  assert public.weekly_entry_with_sharing(2098) -> 'sharePicksImmediately' = 'true'::jsonb;
end;
$$;

set local role anon;
do $$
declare
  v_legacy uuid := current_setting('weekly_immediate_test.legacy_id')::uuid;
  v_immediate uuid := current_setting('weekly_immediate_test.immediate_id')::uuid;
  v_picks jsonb := public.weekly_player_picks(2098, v_immediate, 'regular', 11) -> 'picks';
begin
  assert public.weekly_player_picks(2098, v_legacy, 'regular', 11) -> 'picks' = '[]'::jsonb,
    'legacy sharing consent does not reveal pregame picks';
  assert jsonb_array_length(v_picks) = 2 and v_picks -> 0 ->> 'gameId' = 'first'
    and v_picks -> 0 ->> 'teamId' = 'A' and v_picks -> 0 ->> 'status' = 'scheduled'
    and v_picks -> 1 ->> 'gameId' = 'later' and v_picks -> 1 ->> 'teamId' = 'B',
    'saved picks in the selected scope are visible immediately to anonymous viewers';
  assert not (v_picks -> 0 ?| array['userId','email','capturedAt','updatedAt']);
end;
$$;

reset role;
-- Only the first game has kicked off. Keep genuine pregame save times.
update weekly_private.picks set captured_at = clock_timestamp() - interval '2 hours', updated_at = clock_timestamp() - interval '2 hours'
  where season = 2098 and game_id = 'first';
update weekly_private.games set status = 'final', home_points = 24, away_points = 14, winner_id = 'A',
  kickoff = clock_timestamp() - interval '1 minute'
  where season = 2098 and id = 'first';

set local role authenticated;
do $$
declare v_games jsonb := public.weekly_contest(2098) -> 'games';
begin
  assert (select g -> 'locked' from jsonb_array_elements(v_games) g where g ->> 'id' = 'first') = 'true'::jsonb;
  assert (select g -> 'locked' from jsonb_array_elements(v_games) g where g ->> 'id' = 'later') = 'false'::jsonb;
  perform set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
  begin
    perform public.weekly_save_picks_with_immediate_sharing(2098, 'Immediate Share', '{"first":"B","later":"A"}', true, true);
    raise exception 'immediate sharing permitted a change after kickoff';
  exception when invalid_parameter_value then null;
  end;
  assert public.weekly_entry_with_sharing(2098) -> 'picks' ->> 'later' = 'B';
  perform public.weekly_save_picks_with_immediate_sharing(2098, 'Immediate Share', '{"first":"A","later":"A"}', true, true);
  assert public.weekly_entry_with_sharing(2098) -> 'picks' = '{"first":"A","later":"A","next-week":"A"}'::jsonb,
    'the later game stays editable and a locked choice can be carried forward unchanged';
end;
$$;

set local role anon;
do $$
declare
  v_immediate uuid := current_setting('weekly_immediate_test.immediate_id')::uuid;
  v_legacy uuid := current_setting('weekly_immediate_test.legacy_id')::uuid;
  v_board jsonb := public.weekly_leaderboard(2098, 'regular', 11);
  v_picks jsonb := public.weekly_player_picks(2098, v_immediate, 'regular', 11) -> 'picks';
begin
  assert v_board -> 'model' = '{"correct":1,"graded":1}'::jsonb;
  assert v_board -> 'rows' -> 0 ->> 'nickname' = 'Immediate Share' and v_board -> 'rows' -> 0 -> 'points' = '1'::jsonb;
  assert v_picks -> 0 ->> 'winner' = 'A' and v_picks -> 1 ->> 'teamId' = 'A',
    'the shared panel shows both the result and the latest pregame edit';
  assert jsonb_array_length(public.weekly_player_picks(2098, v_legacy, 'regular', 11) -> 'picks') = 1,
    'legacy sharing still reveals a pick when its game kicks off';
end;
$$;

set local role authenticated;
do $$
declare v_immediate uuid := current_setting('weekly_immediate_test.immediate_id')::uuid;
begin
  perform set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);
  perform public.weekly_save_picks_with_immediate_sharing(2098, 'Immediate Share', '{}', true, false);
  assert public.weekly_player_picks(2098, v_immediate) is null, 'revocation removes public access';
  assert public.weekly_entry_with_sharing(2098) -> 'picks' = '{"first":"A","later":"A","next-week":"A"}'::jsonb;
  perform public.weekly_save_picks_with_sharing(2098, 'Immediate Share', '{}', true, true);
  assert jsonb_array_length(public.weekly_player_picks(2098, v_immediate, 'regular', 11) -> 'picks') = 1,
    'the older consent does not restore immediate sharing';
end;
$$;
rollback;
