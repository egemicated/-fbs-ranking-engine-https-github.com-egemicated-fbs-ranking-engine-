-- Disposable fixtures only. Exact tallies require kickoff and sharing consent.
begin;
set local plpgsql.check_asserts = on;
insert into auth.users(id) values
  ('91000000-0000-4000-8000-000000000001'),
  ('91000000-0000-4000-8000-000000000002'),
  ('91000000-0000-4000-8000-000000000003'),
  ('91000000-0000-4000-8000-000000000004');
set local role service_role;
do $$
declare
  v_now timestamptz := clock_timestamp();
  v_game jsonb := jsonb_build_object('home','A','away','B','homeName','Alpha','awayName','Beta',
    'week',12,'seasonType','regular','neutral',false,'status','scheduled',
    'startDate',v_now + interval '2 days','modelTeam','A',
    'modelCapturedAt',v_now - interval '3 days','homeWinProbability',.7);
begin
  perform public.weekly_sync(2093,v_now,(select jsonb_agg(v_game || jsonb_build_object('id',id))
    from unnest(array['open','future','paused','voided','postponed','unpicked']) id));
end;
$$;
set local role anon;
do $$ begin
  assert not has_function_privilege(current_user,'public.weekly_community_picks(integer,text,integer)','execute');
  assert not has_function_privilege(current_user,'weekly_private.community_picks(integer,text,integer)','execute');
end $$;
set local role authenticated;
do $$
declare v_user text;
begin
  assert not has_table_privilege(current_user,'weekly_private.picks','select');
  assert public.weekly_community_picks(2093,'regular',12) = '[]'::jsonb;
  foreach v_user in array array['91000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003'] loop
    perform set_config('request.jwt.claim.sub',v_user,true);
    perform public.weekly_save_picks(2093,'Private participant',
      '{"open":"A","future":"A","paused":"A","voided":"A","postponed":"A"}',false);
  end loop;
  -- Before the fix this disclosed 3/0 from three private profiles pregame.
  assert public.weekly_community_picks(2093,'regular',12) = '[]'::jsonb,
    'a unanimous private pregame tally must not disclose any selection';
  perform public.weekly_save_picks_with_sharing(2093,'Public participant','{}',true,true);
  assert public.weekly_community_picks(2093,'regular',12) = '[]'::jsonb,
    'sharing consent does not release aggregate selections before kickoff';
end;
$$;
reset role;
update weekly_private.picks set captured_at=clock_timestamp()-interval '2 days',updated_at=clock_timestamp()-interval '2 days' where season=2093;
update weekly_private.games set kickoff=clock_timestamp()-interval '1 day' where season=2093 and id <> 'future';
update weekly_private.games set start_time_tbd=true where season=2093 and id='paused';
update weekly_private.games set void_reason='Schedule changed' where season=2093 and id='voided';
update weekly_private.games set status='pending' where season=2093 and id='postponed';
set local role authenticated;
do $$
begin
  assert public.weekly_community_picks(2093,'regular',12) =
    '[{"gameId":"open","participants":1,"homePicks":null,"awayPicks":null}]'::jsonb,
    'only opted-in participants count; future, TBD, void, and pending games stay hidden';
  perform set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
  perform public.weekly_save_picks_with_sharing(2093,'Public participant one','{}',true,true);
  assert public.weekly_community_picks(2093,'regular',12) -> 0 -> 'participants' = '2'::jsonb;
  assert public.weekly_community_picks(2093,'regular',12) -> 0 -> 'homePicks' = 'null'::jsonb;
  perform set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
  perform public.weekly_save_picks_with_sharing(2093,'Public participant two','{}',true,true);
  assert public.weekly_community_picks(2093,'regular',12) =
    '[{"gameId":"open","participants":3,"homePicks":3,"awayPicks":0}]'::jsonb;
  assert public.weekly_community_picks(2093,'regular',13) = '[]'::jsonb;
  assert public.weekly_community_picks(2093,'postseason',12) = '[]'::jsonb;
  assert public.weekly_community_picks(2093,null,null) = '[]'::jsonb;
  perform public.weekly_save_picks_with_sharing(2093,'Public participant two','{}',true,false);
  assert public.weekly_community_picks(2093,'regular',12) -> 0 -> 'participants' = '2'::jsonb,
    'revoking sharing removes the participant immediately';
  perform set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000004',true);
  assert public.weekly_community_picks(2093,'regular',12) = '[]'::jsonb,
    'an account without its own valid pregame pick cannot inspect the aggregate';
end;
$$;
reset role;
-- Construct an invalid late update without weakening real enforcement.
alter table weekly_private.picks disable trigger weekly_pick_deadline;
update weekly_private.picks set updated_at=clock_timestamp() where season=2093 and game_id='open'
  and user_id='91000000-0000-4000-8000-000000000001';
alter table weekly_private.picks enable trigger weekly_pick_deadline;
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000003',true);
  assert public.weekly_community_picks(2093,'regular',12) -> 0 -> 'participants' = '1'::jsonb,
    'invalid late updates never enter aggregate tallies';
end $$;
rollback;
