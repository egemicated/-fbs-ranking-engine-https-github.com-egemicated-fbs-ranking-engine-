-- Database authorization regression tests; no real accounts or data.
begin;
set local plpgsql.check_asserts = on;
do $$
declare v_table record; v_function record;
begin
  for v_table in select c.oid,n.nspname,c.relname,c.relrowsecurity from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','weekly_private','cfp_private','support_private') and c.relkind='r' loop
    assert v_table.relrowsecurity, 'Every application table requires RLS';
    if v_table.nspname <> 'public' then
      assert not has_table_privilege('anon',v_table.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
      assert not has_table_privilege('authenticated',v_table.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
    end if;
  end loop;
  assert not exists(select from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','weekly_private','cfp_private','support_private') and c.relkind in ('v','m')),
    'Any new view needs an explicit RLS/privilege review';
  for v_function in select p.oid,p.prosecdef,p.proconfig,n.nspname from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','weekly_private','cfp_private','support_private') loop
    assert coalesce(v_function.proconfig,'{}') @> array['search_path=""'], 'Pin function search_path';
    assert not exists(select from aclexplode(coalesce((select proacl from pg_proc where oid=v_function.oid),acldefault('f',(select proowner from pg_proc where oid=v_function.oid)))) where grantee=0 and privilege_type='EXECUTE'),
      'No application function may inherit default PUBLIC execute';
    if v_function.nspname='public' then assert not v_function.prosecdef, 'Public wrappers must be invoker'; end if;
  end loop;
end $$;
insert into auth.users(id) values ('92000000-0000-4000-8000-000000000001'),('92000000-0000-4000-8000-000000000002');
insert into weekly_private.publications(season,observed_at) values(2090,clock_timestamp());
insert into weekly_private.games(season,id,week,season_type,home_id,away_id,home_name,away_name,neutral,kickoff,status,model_team_id,model_captured_at,home_probability)
select 2090,id,1,'regular','h','a','Home','Away',false,clock_timestamp()+interval '1 day','scheduled','h',clock_timestamp()-interval '3 days',.7
from unnest(array['started','postponed','tbd','voided','future']) id;
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000001',true);
  perform public.weekly_save_picks_with_sharing(2090,'Disposable owner','{"started":"h","postponed":"h","tbd":"h","voided":"h","future":"h"}',true,true);
  insert into public.my_team_preferences(user_id,team_id,team_ids) values(auth.uid(),'252',array['252','254','2627','2710']);
  assert (select cardinality(team_ids) from public.my_team_preferences)=4;
  assert public.submit_account_request('support','Private support text')->>'status'='pending';
  assert public.submit_account_request('data','Private data text')->>'status'='pending';
  assert public.submit_account_request('deletion','Private deletion text')->>'status'='pending';
  perform public.submit_account_request('support','Duplicate private text');
  assert jsonb_array_length(public.my_account_requests())=3;
  assert not (public.my_account_requests() @> '[{"message":"Private support text"}]'::jsonb), 'Messages stay out of public RPC output';
  begin perform public.submit_account_request('invalid','message'); raise exception 'Invalid kind accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.submit_account_request('support',repeat('x',2001)); raise exception 'Oversized message accepted'; exception when invalid_parameter_value then null; end;
  begin update public.my_team_preferences set team_ids=array['252',null]; raise exception 'Null team accepted'; exception when invalid_parameter_value then null; end;
  begin update public.my_team_preferences set team_ids=array(select x::text from generate_series(1,21) x); raise exception 'Too many teams accepted'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
update weekly_private.picks set captured_at=clock_timestamp()-interval '2 days',updated_at=clock_timestamp()-interval '2 days' where season=2090;
update weekly_private.games set kickoff=clock_timestamp()-interval '1 day' where season=2090 and id <> 'future';
update weekly_private.games set status='pending' where season=2090 and id='postponed';
update weekly_private.games set start_time_tbd=true where season=2090 and id='tbd';
update weekly_private.games set void_reason='Invalid fixture' where season=2090 and id='voided';
do $$ begin
  perform set_config('security_test.public_id',(select public_pick_id::text from weekly_private.players where user_id='92000000-0000-4000-8000-000000000001'),true);
end $$;
set local role anon;
do $$ declare v jsonb; begin
  perform set_config('request.jwt.claim.sub','',true);
  v:=public.weekly_player_picks(2090,current_setting('security_test.public_id')::uuid)->'picks';
  assert jsonb_array_length(v)=1 and v->0->>'gameId'='started', 'Postponed elapsed times never confirm kickoff';
  assert not (v->0 ?| array['userId','email','capturedAt','updatedAt']);
  begin perform public.weekly_entry(2090); raise exception 'Anonymous owner RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform public.submit_account_request('support','Guest'); raise exception 'Anonymous submission allowed'; exception when insufficient_privilege then null; end;
  begin perform 1 from weekly_private.picks; raise exception 'Anonymous raw picks readable'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.my_team_preferences; raise exception 'Anonymous preferences readable'; exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
do $$ begin
  perform set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000002',true);
  assert public.weekly_entry(2090)->'picks'='{}'::jsonb;
  assert public.my_account_requests()='[]'::jsonb;
  assert not exists(select from public.my_team_preferences);
  begin perform 1 from support_private.account_requests; raise exception 'Raw request readable'; exception when insufficient_privilege then null; end;
  begin perform public.weekly_sync(2090,clock_timestamp(),'[]'); raise exception 'User publisher RPC allowed'; exception when insufficient_privilege then null; end;
  begin delete from weekly_private.picks; raise exception 'Raw picks deletable'; exception when insufficient_privilege then null; end;
  -- Missing/cleared JWT subject models the database boundary after sign-out.
  perform set_config('request.jwt.claim.sub','',true);
  assert public.weekly_entry(2090)->'picks'='{}'::jsonb;
  assert public.my_account_requests()='[]'::jsonb;
  assert not exists(select from public.my_team_preferences);
  begin perform public.weekly_save_picks(2090,'No session','{}',false); raise exception 'Subjectless save accepted'; exception when insufficient_privilege then null; end;
  begin perform public.submit_account_request('support','No session'); raise exception 'Subjectless support accepted'; exception when insufficient_privilege then null; end;
end $$;
rollback;
