-- Run with psql -v ON_ERROR_STOP=1 against a disposable Supabase-shaped
-- database after the migration. Every account, pick and source fixture rolls back.
begin;
set local plpgsql.check_asserts = on;
insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');

do $$
declare
  v_now timestamptz := clock_timestamp();
  v_game jsonb;
begin
  v_game := jsonb_build_object('id', 'g1', 'week', 11, 'seasonType', 'regular',
    'home', 'A', 'away', 'B', 'homeName', 'Alpha Team', 'awayName', 'Beta Team',
    'neutral', false, 'startDate', v_now + interval '1 day', 'status', 'scheduled',
    'homePoints', null, 'awayPoints', null, 'modelTeam', 'A', 'homeWinProbability', .7,
    'modelCapturedAt', v_now - interval '2 hours');
  perform set_config('weekly_test.games', jsonb_build_array(v_game,
    v_game || jsonb_build_object('id', 'g2', 'startDate', v_now + interval '2 days'),
    v_game || jsonb_build_object('id', 'g3', 'week', 12, 'startDate', v_now + interval '3 days'),
    v_game || jsonb_build_object('id', 'g4', 'startDate', v_now + interval '4 days'),
    v_game || jsonb_build_object('id', 'past', 'startDate', v_now - interval '1 day',
      'modelCapturedAt', v_now - interval '2 days', 'status', 'final', 'homePoints', 21, 'awayPoints', 7),
    v_game || jsonb_build_object('id', 'no-model', 'modelTeam', null, 'modelCapturedAt', null, 'homeWinProbability', null))::text, true);
end;
$$;

set local role anon;
do $$
begin
  assert (public.weekly_contest(2099) -> 'games') = '[]'::jsonb;
  assert (public.weekly_leaderboard(2099) -> 'rows') = '[]'::jsonb;
  assert not has_function_privilege('public.weekly_entry(integer)', 'execute');
  assert not has_function_privilege('public.weekly_save_picks(integer,text,jsonb,boolean)', 'execute');
  assert not has_function_privilege('public.weekly_sync(integer,timestamptz,jsonb)', 'execute');
  assert not has_table_privilege('weekly_private.picks', 'select,insert,update,delete');
end;
$$;

set local role service_role;
do $$
declare
  v_games jsonb := current_setting('weekly_test.games')::jsonb;
  v_time timestamptz := clock_timestamp();
begin
  perform public.weekly_sync(2099, v_time, v_games);
  assert public.weekly_sync(2099, v_time, v_games) = '{"updated":0,"stale":true}'::jsonb;
  begin
    perform public.weekly_sync(2099, clock_timestamp(), jsonb_set(v_games, '{0,modelCapturedAt}', v_games -> 0 -> 'startDate'));
    raise exception 'post-kickoff model capture accepted';
  exception when invalid_parameter_value then null;
  end;
  -- A changed source forecast cannot replace the first accepted model checkpoint.
  v_games := jsonb_set(jsonb_set(v_games, '{0,modelTeam}', '"B"'), '{0,homeWinProbability}', '0.3');
  perform public.weekly_sync(2099, clock_timestamp(), v_games);
end;
$$;

set local role authenticated;
do $$
declare
  v_game jsonb;
begin
  assert not has_function_privilege('public.weekly_sync(integer,timestamptz,jsonb)', 'execute');
  assert not has_table_privilege('weekly_private.players', 'select,insert,update,delete');
  select value into v_game from jsonb_array_elements(public.weekly_contest(2099) -> 'games') where value ->> 'id' = 'g1';
  assert v_game ->> 'modelTeam' = 'A', 'first model checkpoint remains frozen';
  assert not exists (select 1 from jsonb_array_elements(public.weekly_contest(2099) -> 'games')
    where value ->> 'id' in ('past', 'no-model')), 'no late model backfill or unneeded raw schedule in the public response';
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
  assert public.weekly_entry(2099) = '{"nickname":"","publicLeaderboard":false,"picks":{}}'::jsonb;
  perform public.weekly_save_picks(2099, '  Alpha  ', '{}', true);
  perform public.weekly_save_picks(2099, 'Alpha', '{"g1":"B","g3":"A","g4":"A"}', true);
  perform public.weekly_save_picks(2099, 'Alpha', '{"g1":"A"}', true);
  perform public.weekly_save_picks(2099, 'Alpha', '{"g1":"B"}', true);
  assert public.weekly_entry(2099) -> 'picks' = '{"g1":"B","g3":"A","g4":"A"}'::jsonb;
  begin
    perform public.weekly_save_picks(2099, 'Alpha', '{"g1":"A","no-model":"B"}', true);
    raise exception 'pick without a saved model accepted';
  exception when invalid_parameter_value then null;
  end;
  assert public.weekly_entry(2099) -> 'picks' ->> 'g1' = 'B', 'failed batch rolls back every change';
  begin
    perform public.weekly_save_picks(2099, 'Alpha', '{"g1":"X"}', true);
    raise exception 'nonparticipant pick accepted';
  exception when invalid_parameter_value then null;
  end;
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
  assert public.weekly_entry(2099) -> 'picks' = '{}'::jsonb, 'other players cannot see private picks';
  perform public.weekly_save_picks(2099, 'Beta', '{"g1":"A","g2":"A"}', true);
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
  perform public.weekly_save_picks(2099, 'Private Player', '{"g1":"B"}');
  assert public.weekly_entry(2099) -> 'publicLeaderboard' = 'false'::jsonb, 'public visibility requires consent';
end;
$$;

set local role service_role;
do $$
declare
  v_games jsonb := current_setting('weekly_test.games')::jsonb;
  v_partial jsonb;
begin
  select jsonb_agg(value) into v_partial from jsonb_array_elements(v_games) where value ->> 'id' <> 'g4';
  perform public.weekly_sync(2099, clock_timestamp(), v_partial);
  perform public.weekly_sync(2099, clock_timestamp(), v_games);
end;
$$;

set local role anon;
do $$
declare v_game jsonb;
begin
  select value into v_game from jsonb_array_elements(public.weekly_contest(2099) -> 'games') where value ->> 'id' = 'g4';
  assert v_game -> 'eligible' = 'true'::jsonb and v_game -> 'voidReason' = 'null'::jsonb,
    'an unchanged fixture recovers when it returns to the full source';
end;
$$;

set local role service_role;
do $$
declare v_games jsonb := current_setting('weekly_test.games')::jsonb;
begin
  -- A venue change after stored picks excludes the original contest game.
  v_games := jsonb_set(v_games, '{3,neutral}', 'true');
  perform public.weekly_sync(2099, clock_timestamp(), v_games);
  perform set_config('weekly_test.games', v_games::text, true);
end;
$$;

reset role;
do $$
begin
  assert (select void_reason from weekly_private.games where season = 2099 and id = 'g4') =
    'Matchup or kickoff changed after picks were saved';
  assert (select count(*) from weekly_private.picks where season = 2099 and game_id = 'g4') = 1;
end;
$$;

-- Move test fixtures through kickoff while retaining legitimate pregame capture times.
update weekly_private.picks set captured_at = captured_at - interval '10 days', updated_at = updated_at - interval '10 days'
  where season = 2099 and game_id in ('g1', 'g2');
update weekly_private.games set kickoff = kickoff - interval '10 days', model_captured_at = model_captured_at - interval '10 days'
  where season = 2099 and id in ('g1', 'g2');
do $$
declare v_games jsonb;
begin
  select jsonb_agg(case when g.value ->> 'id' in ('g1', 'g2') then
    jsonb_set(jsonb_set(g.value, '{startDate}', to_jsonb((g.value ->> 'startDate')::timestamptz - interval '10 days')),
      '{modelCapturedAt}', to_jsonb((g.value ->> 'modelCapturedAt')::timestamptz - interval '10 days'))
    else g.value end order by g.ordinal) into v_games
  from jsonb_array_elements(current_setting('weekly_test.games')::jsonb) with ordinality g(value, ordinal);
  perform set_config('weekly_test.games', v_games::text, true);
  begin
    delete from weekly_private.picks where season = 2099 and game_id = 'g1';
    raise exception 'after-delete deadline guard failed';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
  perform public.weekly_save_picks(2099, 'Alpha', '{"g1":"B"}', true);
  begin
    perform public.weekly_save_picks(2099, 'Alpha', '{"g1":"A"}', true);
    raise exception 'locked pick changed';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.weekly_save_picks(2099, 'Alpha', '{"g1":null}', true);
    raise exception 'locked pick deleted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.weekly_save_picks(2099, 'Alpha', '{"g2":"A"}', true);
    raise exception 'new pick entered after kickoff';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

set local role service_role;
do $$
declare
  v_games jsonb := current_setting('weekly_test.games')::jsonb;
begin
  v_games := jsonb_set(v_games, '{0}', v_games -> 0 || '{"status":"final","homePoints":14,"awayPoints":21}'::jsonb);
  v_games := jsonb_set(v_games, '{1}', v_games -> 1 || '{"status":"final","homePoints":21,"awayPoints":7}'::jsonb);
  perform public.weekly_sync(2099, clock_timestamp(), v_games);
  perform set_config('weekly_test.games', v_games::text, true);
end;
$$;

set local role authenticated;
do $$
declare v_board jsonb;
begin
  v_board := public.weekly_leaderboard(2099, 'regular', 11);
  assert v_board -> 'model' = '{"correct":1,"graded":2}'::jsonb;
  assert v_board -> 'rows' = '[
    {"rank":1,"nickname":"Alpha","points":1,"correct":1,"graded":1,"picked":1,"modelCorrect":0,"compared":1,"beatModel":true,"isYou":true},
    {"rank":1,"nickname":"Beta","points":1,"correct":1,"graded":2,"picked":2,"modelCorrect":1,"compared":2,"beatModel":false,"isYou":false}]'::jsonb,
    'weekly ties and user/model comparison use the same decided games';
  assert public.weekly_leaderboard(2099) -> 'me' -> 'picked' = '2'::jsonb, 'season includes next-week pick';
  assert public.weekly_leaderboard(2099, 'regular', 12) -> 'me' -> 'graded' = '0'::jsonb;
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
  assert public.weekly_leaderboard(2099) -> 'me' -> 'rank' = 'null'::jsonb, 'private player gets personal scores without public rank';
end;
$$;

set local role service_role;
do $$
declare
  v_games jsonb := current_setting('weekly_test.games')::jsonb;
  v_old timestamptz := clock_timestamp();
begin
  -- A newer incomplete response does not withdraw already confirmed finals.
  perform public.weekly_sync(2099, v_old, jsonb_set(v_games, '{0}', v_games -> 0 || '{"status":"pending","homePoints":null,"awayPoints":null}'::jsonb));
  perform set_config('weekly_test.old_observed', v_old::text, true);
end;
$$;

set local role anon;
do $$
declare v_game jsonb;
begin
  select value into v_game from jsonb_array_elements(public.weekly_contest(2099) -> 'games') where value ->> 'id' = 'g1';
  assert v_game ->> 'status' = 'final' and v_game ->> 'winner' = 'B' and v_game -> 'awayPoints' = '21'::jsonb,
    'newer pending source preserves the confirmed final';
end;
$$;

set local role service_role;
do $$
declare
  v_games jsonb := current_setting('weekly_test.games')::jsonb;
  v_old timestamptz := current_setting('weekly_test.old_observed')::timestamptz;
begin
  -- A validated newer final correction does revise points.
  v_games := jsonb_set(v_games, '{0}', v_games -> 0 || '{"status":"final","homePoints":28,"awayPoints":7}'::jsonb);
  perform public.weekly_sync(2099, clock_timestamp(), v_games);
  assert public.weekly_sync(2099, v_old, current_setting('weekly_test.games')::jsonb) -> 'stale' = 'true'::jsonb,
    'older observations cannot undo a corrected score';
end;
$$;

set local role authenticated;
do $$
declare v_board jsonb;
begin
  v_board := public.weekly_leaderboard(2099, 'regular', 11);
  assert v_board -> 'model' = '{"correct":2,"graded":2}'::jsonb;
  assert v_board -> 'rows' -> 0 ->> 'nickname' = 'Beta';
  assert v_board -> 'rows' -> 0 -> 'points' = '2'::jsonb;
  assert v_board -> 'rows' -> 1 -> 'points' = '0'::jsonb;
end;
$$;

reset role;
-- Deleting an auth account still cascades through its locked picks.
delete from auth.users where id = '10000000-0000-4000-8000-000000000003';
do $$ begin assert not exists (select 1 from weekly_private.picks where user_id = '10000000-0000-4000-8000-000000000003'); end; $$;
rollback;
