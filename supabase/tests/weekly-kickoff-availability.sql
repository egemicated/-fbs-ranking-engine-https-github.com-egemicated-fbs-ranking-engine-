-- Run after the weekly migrations in a disposable database.
begin;
set local plpgsql.check_asserts = on;
insert into auth.users(id) values ('80000000-0000-4000-8000-000000000001');

set local role service_role;
do $$
declare
  v_now timestamptz := clock_timestamp();
  v_game jsonb := jsonb_build_object('home','A','away','B','homeName','Alpha','awayName','Beta',
    'week',11,'seasonType','regular','neutral',false,'status','scheduled',
    'startDate', v_now + interval '2 days', 'modelTeam','A',
    'modelCapturedAt', v_now - interval '1 hour','homeWinProbability',.7);
  v_games jsonb;
begin
  select jsonb_object_agg(id, v_game || jsonb_build_object('id',id)) into v_games
    from unnest(array['corrected','bridge-past','final','initial-tbd']) id;
  v_games := jsonb_set(v_games, '{initial-tbd,startTimeTbd}', 'true');
  perform public.weekly_sync(2094, v_now, (select jsonb_agg(value) from jsonb_each(v_games)));
  perform set_config('weekly_kickoff_test.games', v_games::text, true);
  perform set_config('weekly_kickoff_test.now', v_now::text, true);
end;
$$;

set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',true);
  perform public.weekly_save_picks_with_immediate_sharing(2094,'Kickoff Tester',
    '{"corrected":"B","bridge-past":"B","final":"A"}',true,true);
  assert (select g -> 'startTimeTbd' from jsonb_array_elements(public.weekly_contest(2094) -> 'games') g
    where g ->> 'id' = 'corrected') = 'false'::jsonb, 'omitting the flag keeps verified legacy behavior';
  begin
    perform public.weekly_save_picks(2094,'Kickoff Tester','{"initial-tbd":"A"}',true);
    raise exception 'unresolved kickoff accepted a pick';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

set local role service_role;
do $$
declare
  v_source jsonb := current_setting('weekly_kickoff_test.games')::jsonb;
  v_now timestamptz := current_setting('weekly_kickoff_test.now')::timestamptz;
  v_placeholder jsonb := jsonb_build_object('startTimeTbd',true,'status','pending',
    'startDate',v_now - interval '1 day','modelTeam',null,'modelCapturedAt',null,'homeWinProbability',null);
begin
  v_source := jsonb_set(jsonb_set(v_source,'{corrected}',v_source -> 'corrected' || v_placeholder),
    '{bridge-past}',v_source -> 'bridge-past' || v_placeholder);
  perform public.weekly_sync(2094, clock_timestamp(), (select jsonb_agg(value) from jsonb_each(v_source)));
  -- An older publisher without a flag cannot unmark an actively unresolved kickoff.
  v_source := v_source || jsonb_build_object('corrected', (v_source -> 'corrected') - 'startTimeTbd');
  perform public.weekly_sync(2094, clock_timestamp(), (select jsonb_agg(value) from jsonb_each(v_source)));
end;
$$;

set local role authenticated;
do $$
declare
  v_game jsonb;
  v_profile uuid := (public.weekly_leaderboard(2094) -> 'me' ->> 'publicPickId')::uuid;
begin
  select g into v_game from jsonb_array_elements(public.weekly_contest(2094) -> 'games') g where g ->> 'id' = 'corrected';
  assert v_game -> 'startTimeTbd' = 'true'::jsonb and v_game -> 'locked' = 'true'::jsonb and v_game ->> 'modelTeam' = 'A';
  assert public.weekly_entry(2094) -> 'picks' ->> 'corrected' = 'B';
  assert public.weekly_leaderboard(2094) -> 'me' -> 'picked' = '3'::jsonb, 'saved picks still count as entered';
  assert not exists (select 1 from jsonb_array_elements(public.weekly_player_picks(2094,v_profile) -> 'picks') g
    where g ->> 'gameId' in ('corrected','bridge-past')), 'public sharing waits for confirmed kickoff';
  begin
    perform public.weekly_save_picks(2094,'Kickoff Tester','{"corrected":"A"}',true);
    raise exception 'unresolved kickoff accepted an edit';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

reset role;
do $$
begin
  begin
    update weekly_private.picks set team_id = 'A' where season = 2094 and game_id = 'corrected';
    raise exception 'unresolved kickoff accepted a direct write';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
-- Simulate a verified kickoff passing while its replacement is still undated.
update weekly_private.games set previous_verified_kickoff = clock_timestamp() - interval '1 minute'
  where season = 2094 and id = 'bridge-past';
update weekly_private.picks set captured_at = clock_timestamp() - interval '3 hours', updated_at = clock_timestamp() - interval '3 hours'
  where season = 2094 and game_id = 'final';
update weekly_private.games set kickoff = current_setting('weekly_kickoff_test.now')::timestamptz - interval '30 minutes'
  where season = 2094 and id = 'final';

set local role service_role;
do $$
declare
  v_source jsonb := current_setting('weekly_kickoff_test.games')::jsonb;
  v_now timestamptz := current_setting('weekly_kickoff_test.now')::timestamptz;
  v_verified jsonb := jsonb_build_object('startTimeTbd',false, 'startDate',v_now + interval '3 days',
      'modelTeam','B','modelCapturedAt',v_now - interval '1 minute','homeWinProbability',.4);
begin
  v_source := jsonb_set(jsonb_set(v_source,'{corrected}',v_source -> 'corrected' || v_verified),
    '{bridge-past}',v_source -> 'bridge-past' || v_verified);
  v_source := jsonb_set(v_source,'{final}',v_source -> 'final' || jsonb_build_object('status','final',
    'startDate',v_now - interval '30 minutes','startTimeTbd',true,'homePoints',21,'awayPoints',14));
  perform public.weekly_sync(2094, clock_timestamp(), (select jsonb_agg(value) from jsonb_each(v_source)));
end;
$$;

set local role authenticated;
do $$
declare
  v_games jsonb := public.weekly_contest(2094) -> 'games';
  v_game jsonb;
  v_profile uuid := (public.weekly_leaderboard(2094) -> 'me' ->> 'publicPickId')::uuid;
begin
  select g into v_game from jsonb_array_elements(v_games) g where g ->> 'id' = 'corrected';
  assert v_game -> 'startTimeTbd' = 'false'::jsonb and v_game -> 'locked' = 'false'::jsonb
    and v_game ->> 'modelTeam' = 'A' and v_game -> 'homeWinProbability' = '0.7'::jsonb
    and v_game -> 'voidReason' = 'null'::jsonb, 'future verified correction preserves the original forecast';
  assert public.weekly_entry(2094) -> 'picks' ->> 'corrected' = 'B';
  perform public.weekly_save_picks(2094,'Kickoff Tester','{"corrected":"A"}',true);
  assert public.weekly_entry(2094) -> 'picks' ->> 'corrected' = 'A', 'owner sees the corrected future edit';
  assert not exists (select 1 from jsonb_array_elements(public.weekly_player_picks(2094,v_profile) -> 'picks') g
    where g ->> 'gameId' = 'corrected'), 'future verified corrections remain private until kickoff';
  select g into v_game from jsonb_array_elements(v_games) g where g ->> 'id' = 'bridge-past';
  assert v_game -> 'locked' = 'true'::jsonb and v_game ->> 'voidReason' = 'Matchup or kickoff changed after picks were saved',
    'a formerly verified elapsed kickoff cannot reopen through a placeholder';
  assert public.weekly_entry(2094) -> 'picks' ->> 'bridge-past' = 'B';
  assert public.weekly_leaderboard(2094) -> 'me' -> 'graded' = '1'::jsonb, 'a confirmed final can still be graded';
end;
$$;
rollback;
