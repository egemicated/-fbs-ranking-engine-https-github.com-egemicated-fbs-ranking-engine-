-- Run after the weekly migrations in a disposable database.
begin;
set local plpgsql.check_asserts = on;
insert into auth.users(id) values
  ('90000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000002'),
  ('90000000-0000-4000-8000-000000000003'),
  ('90000000-0000-4000-8000-000000000004');

set local role service_role;
do $$
declare
  v_now timestamptz := clock_timestamp();
  v_game jsonb := jsonb_build_object('home','A','away','B','homeName','Alpha','awayName','Beta',
    'week',12,'seasonType','regular','neutral',false,'status','scheduled',
    'startDate',v_now + interval '2 days','modelTeam','A',
    'modelCapturedAt',v_now - interval '1 hour','homeWinProbability',.7);
  v_games jsonb;
begin
  select jsonb_agg(v_game || jsonb_build_object('id',id)) into v_games
    from unnest(array['open','unpicked','paused','voided']) id;
  v_games := v_games || jsonb_build_array(
    v_game || '{"id":"other-week","week":13}'::jsonb,
    v_game || '{"id":"other-slate","seasonType":"postseason"}'::jsonb);
  perform public.weekly_sync(2093,v_now,v_games);
  -- A newer publisher forecast cannot replace Forge's original pick or probability.
  select jsonb_agg(value || '{"modelTeam":"B","homeWinProbability":0.18}'::jsonb) into v_games
    from jsonb_array_elements(v_games);
  perform public.weekly_sync(2093,clock_timestamp(),v_games);
end;
$$;

set local role anon;
do $$
begin
  assert not has_function_privilege(current_user,'public.weekly_community_picks(integer,text,integer)','execute');
  assert not has_function_privilege(current_user,'weekly_private.community_picks(integer,text,integer)','execute');
end;
$$;

set local role authenticated;
do $$
declare
  v_counts jsonb;
begin
  assert not has_table_privilege(current_user,'weekly_private.picks','select');
  assert public.weekly_community_picks(2093,'regular',12) = '[]'::jsonb;
  perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);
  assert public.weekly_community_picks(2093,'regular',12) = '[]'::jsonb;
  perform public.weekly_save_picks(2093,'Private One',
    '{"open":"A","paused":"A","voided":"A","other-week":"A","other-slate":"B"}',false);
  v_counts := public.weekly_community_picks(2093,'regular',12);
  assert jsonb_array_length(v_counts) = 3;
  assert v_counts @> '[{"gameId":"open","participants":1,"homePicks":null,"awayPicks":null}]'::jsonb;
  assert public.weekly_community_picks(2093,'regular',13) -> 0 ->> 'gameId' = 'other-week';
  assert public.weekly_community_picks(2093,'postseason',12) -> 0 ->> 'gameId' = 'other-slate';
  assert public.weekly_community_picks(2093,null,null) = '[]'::jsonb;

  perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000002',true);
  perform public.weekly_save_picks(2093,'Private Two','{"open":"B","unpicked":"A"}',false);
  v_counts := public.weekly_community_picks(2093,'regular',12);
  assert v_counts @> '[{"gameId":"open","participants":2,"homePicks":null,"awayPicks":null}]'::jsonb;

  perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000003',true);
  perform public.weekly_save_picks(2093,'Private Three','{"open":"A"}',false);
  assert public.weekly_community_picks(2093,'regular',12) =
    '[{"gameId":"open","participants":3,"homePicks":2,"awayPicks":1}]'::jsonb;

  perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000002',true);
  perform public.weekly_save_picks(2093,'Private Two','{"open":"A"}',false);
  v_counts := public.weekly_community_picks(2093,'regular',12);
  assert v_counts @> '[{"gameId":"open","participants":3,"homePicks":3,"awayPicks":0}]'::jsonb;

  perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000004',true);
  assert public.weekly_community_picks(2093,'regular',12) = '[]'::jsonb;
end;
$$;

reset role;
update weekly_private.games set start_time_tbd = true where season = 2093 and id = 'paused';
update weekly_private.games set void_reason = 'Schedule changed' where season = 2093 and id = 'voided';
update weekly_private.games set status = 'final', home_points = 28, away_points = 17, winner_id = 'A'
  where season = 2093 and id = 'open';

set local role authenticated;
do $$
declare
  v_game jsonb;
begin
  perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);
  assert public.weekly_community_picks(2093,'regular',12) =
    '[{"gameId":"open","participants":3,"homePicks":3,"awayPicks":0}]'::jsonb;
  select value into v_game from jsonb_array_elements(public.weekly_contest(2093) -> 'games') where value ->> 'id' = 'open';
  assert v_game -> 'locked' = 'true'::jsonb and v_game ->> 'modelTeam' = 'A' and v_game -> 'homeWinProbability' = '0.7'::jsonb;
  begin
    perform public.weekly_save_picks(2093,'Private One','{"open":"B"}',false);
    raise exception 'Game allowed a change after closing';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

rollback;
