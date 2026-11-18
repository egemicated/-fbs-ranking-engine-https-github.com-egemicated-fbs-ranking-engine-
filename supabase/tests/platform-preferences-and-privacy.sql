-- Run with ON_ERROR_STOP against the migrated database. All fixtures roll back.
begin;
set local plpgsql.check_asserts = on;
insert into auth.users(id) values
  ('90000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000002');
insert into weekly_private.publications(season,observed_at) values (2091,statement_timestamp());
insert into weekly_private.games(season,id,week,season_type,home_id,away_id,home_name,away_name,neutral,kickoff,status,
  model_team_id,model_captured_at,home_probability)
select 2091,id,1,'regular','h','a','Home','Away',false,statement_timestamp()+interval '1 day','scheduled',
  'h',statement_timestamp()-interval '2 days',.7 from unnest(array['privacy-past','privacy-future']) id;

set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);
select public.weekly_save_picks_with_immediate_sharing(2091,'Test Owner','{"privacy-past":"h","privacy-future":"a"}',true,true);
do $$
begin
  assert (public.weekly_entry_with_sharing(2091)->>'sharePicksImmediately')::boolean is false;
  assert public.weekly_entry(2091)->'picks' = '{"privacy-past":"h","privacy-future":"a"}'::jsonb;
  insert into public.my_team_preferences(user_id,team_id) values ('90000000-0000-4000-8000-000000000001','252');
  assert (select team_ids from public.my_team_preferences) = array['252'];
  update public.my_team_preferences set team_ids=array['252','254'];
  assert (select team_id from public.my_team_preferences)='252';
  update public.my_team_preferences set team_id='2390';
  assert (select team_ids from public.my_team_preferences)=array['2390','252','254'];
  update public.my_team_preferences set seen_updates='{"revision":"10000000-0000-4000-8000-000000000001","teamId":"2390"}';
  update public.my_team_preferences set team_ids=array['254','252'];
  assert (select team_id from public.my_team_preferences)='254';
  assert (select seen_updates from public.my_team_preferences) is null;
  begin
    update public.my_team_preferences set team_ids=array['254','254'];
    raise exception 'Duplicate favorites accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.my_team_preferences set user_id='90000000-0000-4000-8000-000000000002';
    raise exception 'Preferences transferred between accounts';
  exception when insufficient_privilege then null;
  end;
  assert jsonb_array_length(public.my_account_requests())=0;
  assert public.submit_account_request('deletion','Please remove my account')->>'status'='pending';
  perform public.submit_account_request('deletion','Repeat request');
  assert jsonb_array_length(public.my_account_requests())=1;
end;
$$;
reset role;
-- Emulate a game reaching kickoff and retain the legacy opt-in in the row to
-- prove the public function protects existing profiles too.
update weekly_private.players set share_picks_immediately=true where user_id='90000000-0000-4000-8000-000000000001';
update weekly_private.picks set updated_at=statement_timestamp()-interval '2 hours' where season=2091;
update weekly_private.games set kickoff=statement_timestamp()-interval '1 hour' where season=2091 and id='privacy-past';
select set_config('privacy.public_id',(select public_pick_id::text from weekly_private.players where user_id='90000000-0000-4000-8000-000000000001'),true);

set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
declare v jsonb;
begin
  v:=public.weekly_player_picks(2091,current_setting('privacy.public_id')::uuid);
  assert jsonb_array_length(v->'picks')=1;
  assert v->'picks'->0->>'gameId'='privacy-past';
  assert not has_table_privilege('weekly_private.picks','select');
  assert not has_function_privilege('public.weekly_entry(integer)','execute');
  assert not has_function_privilege('public.submit_account_request(text,text)','execute');
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000002',true);
do $$
begin
  assert public.weekly_entry(2091)->'picks'='{}'::jsonb;
  assert jsonb_array_length(public.weekly_player_picks(2091,current_setting('privacy.public_id')::uuid)->'picks')=1;
  assert not exists(select 1 from public.my_team_preferences);
  assert public.my_account_requests()='[]'::jsonb;
  assert not has_table_privilege('support_private.account_requests','select');
end;
$$;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);
do $$
begin
  assert public.weekly_entry(2091)->'picks' ? 'privacy-future';
  begin
    perform public.weekly_save_picks_with_sharing(2091,'Test Owner','{"privacy-past":"a"}',true,true);
    raise exception 'Post-kickoff edit accepted';
  exception when invalid_parameter_value then null;
  end;
  perform public.weekly_save_picks_with_sharing(2091,'Updated nickname','{}',false,false);
  assert public.weekly_player_picks(2091,current_setting('privacy.public_id')::uuid) is null;
  assert public.weekly_entry(2091)->'picks'='{"privacy-past":"h","privacy-future":"a"}'::jsonb;
  assert public.weekly_entry(2091)->>'nickname'='Updated nickname';
end;
$$;
rollback;
