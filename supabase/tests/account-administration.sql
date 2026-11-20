-- Entirely disposable accounts, requests, sessions, factors and contest data.
begin;
set local plpgsql.check_asserts=on;
insert into auth.users(id,email,email_confirmed_at) values
 ('a1000000-0000-4000-8000-000000000001','admin@example.invalid',clock_timestamp()),
 ('a1000000-0000-4000-8000-000000000002','owner@example.invalid',clock_timestamp()),
 ('a1000000-0000-4000-8000-000000000003','other@example.invalid',clock_timestamp()),
 ('a1000000-0000-4000-8000-000000000004','unverified@example.invalid',null);
insert into auth.sessions(id,user_id,aal) values('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','aal2');
insert into auth.mfa_factors(id,user_id,status) values('a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','verified');
insert into weekly_private.publications(season,observed_at) values(2088,clock_timestamp());
insert into weekly_private.games(season,id,week,season_type,home_id,away_id,home_name,away_name,neutral,kickoff,status,model_team_id,model_captured_at,home_probability)
values(2088,'privatefuture',1,'regular','home','away','Home','Away',false,clock_timestamp()+interval '2 days','scheduled','home',clock_timestamp()-interval '3 days',.7);
set local role service_role;
do $$begin
  perform account_private.provision_administrator('admin@example.invalid','Disposable provisioning test');
  begin perform account_private.provision_administrator('unverified@example.invalid','Disposable unverified test');raise exception 'Unverified admin accepted';exception when invalid_parameter_value then null;end;
end $$;
reset role;
do $$declare r record;f record;begin
  assert(select role='user' from account_private.memberships where user_id='a1000000-0000-4000-8000-000000000002');
  assert(select count(*)=0 from account_private.entitlements),'No paid access is seeded';
  for r in select oid,relrowsecurity from pg_class where relnamespace='account_private'::regnamespace and relkind='r' loop
    assert r.relrowsecurity;
    assert not has_table_privilege('anon',r.oid,'SELECT,INSERT,UPDATE,DELETE');
    assert not has_table_privilege('authenticated',r.oid,'SELECT,INSERT,UPDATE,DELETE');
    assert not has_table_privilege('service_role',r.oid,'SELECT,INSERT,UPDATE,DELETE');
  end loop;
  for f in select oid,proacl,proowner,proconfig from pg_proc where pronamespace='account_private'::regnamespace loop
    assert f.proconfig @> array['search_path=""'];
    assert not exists(select from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) where grantee=0 and privilege_type='EXECUTE');
  end loop;
end $$;
set local role anon;
do $$begin
  begin perform public.account_context();raise exception 'Guest account access';exception when insufficient_privilege then null;end;
  begin perform public.admin_users();raise exception 'Guest admin access';exception when insufficient_privilege then null;end;
  begin perform public.admin_action_history(8,0);raise exception 'Guest audit history access';exception when insufficient_privilege then null;end;
  begin perform public.service_claim_support_notifications();raise exception 'Guest outbox access';exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
do $$declare v jsonb;begin
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","aal":"aal2","user_metadata":{"role":"admin"}}',true);
  assert public.account_context()->>'role'='user';
  begin perform public.admin_users();raise exception 'Metadata privilege escalation';exception when insufficient_privilege then null;end;
  begin perform public.admin_action_history(8,0);raise exception 'User audit history access';exception when insufficient_privilege then null;end;
  begin perform account_private.provision_administrator('owner@example.invalid','Attacker self provision');raise exception 'Public admin provision';exception when insufficient_privilege then null;end;
  begin update account_private.memberships set role='admin' where user_id=auth.uid();raise exception 'Raw admin escalation';exception when insufficient_privilege then null;end;
  v:=public.save_account_profile('Original Nickname',true,true);
  assert v->>'nickname'='Original Nickname' and (v->>'publicLeaderboard')::boolean and (v->>'sharePicks')::boolean;
  perform public.weekly_save_picks_with_sharing(2088,'Original Nickname','{"privatefuture":"away"}',true,true);
  insert into public.my_team_preferences(user_id,team_id,team_ids) values(auth.uid(),'252',array['252','254']);
  v:=public.submit_support_request('teams','Keep this private support detail');
  perform set_config('account_test.request',v->>'id',true);
  assert public.submit_support_request('teams','Duplicate request')->>'id'=v->>'id';
  assert jsonb_array_length(public.my_account_requests())=1;
  assert public.my_account_requests()->0->>'message'='Keep this private support detail';
  assert not(public.my_account_requests()->0 ? 'adminNote');
  -- The still-live older frontend uses this legacy public RPC. It must route
  -- deletion to the protected category rather than a generic request.
  v:=public.submit_account_request('deletion','Please review account deletion');
  assert v->>'kind'='deletion' and v->>'category'='deletion';
  perform set_config('account_test.legacy_deletion',v->>'id',true);
  assert public.submit_support_request('deletion','New frontend same request')->>'id'=v->>'id';
  assert not public.account_has_entitlement('premium');
  begin perform public.service_claim_support_notifications();raise exception 'User outbox access';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
  assert public.my_account_requests()='[]'::jsonb;
  assert public.weekly_entry(2088)->'picks'='{}'::jsonb;
  assert not exists(select from public.my_team_preferences);
end $$;
-- Admin role alone, edited metadata, a missing/expired session or removed MFA
-- factor must all fail at the database boundary.
do $$begin
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
  begin perform public.admin_users();raise exception 'AAL1 admin allowed';exception when insufficient_privilege then null;end;
  begin perform public.admin_action_history(8,0);raise exception 'AAL1 audit history access';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","aal":"aal2","session_id":"a2000000-0000-4000-8000-000000000099"}',true);
  begin perform public.admin_users();raise exception 'Missing live session allowed';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","aal":"aal2","session_id":"a2000000-0000-4000-8000-000000000001"}',true);
  assert(public.admin_users('owner')->'users'->0->>'email')='owner@example.invalid';
  assert not((public.admin_users()->'users'->0)?|array['encrypted_password','password','picks']);
  assert jsonb_array_length(public.weekly_entry(2088)->'picks'->'unused') is null;
  assert public.weekly_entry(2088)->'picks'='{}'::jsonb,'Admin cannot view owner choices';
  begin perform 1 from weekly_private.picks;raise exception 'Admin raw picks readable';exception when insufficient_privilege then null;end;
  begin perform public.admin_set_account_status(auth.uid(),'suspended','Must not suspend myself');raise exception 'Self suspension accepted';exception when insufficient_privilege then null;end;
  perform public.admin_set_account_status('a1000000-0000-4000-8000-000000000002','suspended','Disposable suspension check');
end $$;
do $$declare latest_audit jsonb; next_audit jsonb;begin
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
  assert public.account_context()->>'status'='suspended';
  begin perform public.weekly_save_picks(2088,'Old Nickname','{}',false);raise exception 'Suspended picks save';exception when insufficient_privilege then null;end;
  begin update public.my_team_preferences set team_id='254';raise exception 'Suspended preference save';exception when insufficient_privilege then null;end;
  perform public.submit_support_request('access','Please review suspension');
  assert public.weekly_entry(2088)->'picks'->>'privatefuture'='away','Own saved data is preserved';
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
  perform public.admin_set_account_status('a1000000-0000-4000-8000-000000000002','active','Disposable reactivation check');
  perform public.admin_moderate_nickname('a1000000-0000-4000-8000-000000000002','Moderated Fan','Disposable moderation check');
  assert public.admin_users('owner')->'users'->0->>'nickname'='Moderated Fan';
  perform public.admin_update_request(current_setting('account_test.request')::uuid,'in_review','Private review note');
  assert public.admin_support_requests('in_review')->>'total'='1';
  begin perform public.admin_update_request(current_setting('account_test.legacy_deletion')::uuid,'resolved','');raise exception 'Legacy deletion falsely completed';exception when invalid_parameter_value then null;end;
  begin perform public.admin_update_request((public.admin_support_requests()->'requests'->0->>'id')::uuid,'invalid','');raise exception 'Invalid request state';exception when invalid_parameter_value then null;end;
  latest_audit:=public.admin_action_history(1,0);
  next_audit:=public.admin_action_history(1,1);
  assert (latest_audit->>'total')::integer>=4 and next_audit->>'total'=latest_audit->>'total';
  assert jsonb_array_length(latest_audit->'actions')=1 and jsonb_array_length(next_audit->'actions')=1;
  assert latest_audit->'actions'->0->>'id'<>next_audit->'actions'->0->>'id';
  assert public.admin_action_history(8,(latest_audit->>'total')::integer)->'actions'='[]'::jsonb;
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
  begin perform public.save_account_profile('Original Nickname',true,true);raise exception 'Moderated nickname restored';exception when invalid_parameter_value then null;end;
  perform public.save_account_profile('New Valid Nickname',false,true);
  assert not(public.account_context()->>'sharePicks')::boolean;
  assert public.weekly_entry(2088)->'picks'->>'privatefuture'='away';
end $$;
reset role;
-- Add MFA to the ordinary account. Frontend hiding alone is insufficient.
insert into auth.sessions(id,user_id,aal) values('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','aal2');
insert into auth.mfa_factors(id,user_id,status) values('a3000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','verified');
set local role authenticated;
do $$begin
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
  perform set_config('request.jwt.claims','{"aal":"aal1"}',true);
  begin perform public.account_context();raise exception 'MFA account bypass';exception when insufficient_privilege then null;end;
  begin perform public.weekly_entry_with_sharing(2088);raise exception 'MFA private picks bypass';exception when insufficient_privilege then null;end;
  begin perform public.weekly_save_picks(2088,'No MFA','{}',false);raise exception 'MFA save bypass';exception when insufficient_privilege then null;end;
  assert not exists(select from public.my_team_preferences),'MFA RLS blocks unverified session';
  perform set_config('request.jwt.claims','{"aal":"aal2","session_id":"a2000000-0000-4000-8000-000000000002"}',true);
  assert public.account_context()->>'userId'='a1000000-0000-4000-8000-000000000002';
  assert exists(select from public.my_team_preferences);
end $$;
reset role;
update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where user_id='a1000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$begin
  perform set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claims','{"aal":"aal2","session_id":"a2000000-0000-4000-8000-000000000001"}',true);
  begin perform public.admin_users();raise exception 'Expired admin session allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
update auth.sessions set not_after=null where user_id='a1000000-0000-4000-8000-000000000001';
delete from auth.mfa_factors where user_id='a1000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$begin
  begin perform public.admin_users();raise exception 'Removed MFA factor allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Service notification payloads reveal identifiers only, never request text.
set local role service_role;
do $$declare claimed jsonb;one jsonb;v_result jsonb;begin
  claimed:=public.service_claim_support_notifications(20);
  assert jsonb_array_length(claimed)=3;
  assert not((claimed->0)?|array['email','message','contactEmail']);
  assert public.service_claim_support_notifications(20)='[]'::jsonb,'Concurrent worker cannot claim a leased notification';
  one:=claimed->0;
  begin perform public.service_complete_support_notification((one->>'id')::uuid,gen_random_uuid(),true,'id',null);raise exception 'Wrong notification lease accepted';exception when invalid_parameter_value then null;end;
  v_result:=public.service_complete_support_notification((one->>'id')::uuid,(one->>'leaseToken')::uuid,true,'test-provider-id',null);
  assert v_result->>'status'='sent';
  one:=claimed->1;
  assert public.service_complete_support_notification((one->>'id')::uuid,(one->>'leaseToken')::uuid,false,null,'test_failure')->>'status'='pending';
  v_result:=public.service_submit_guest_request('guest@example.invalid','access','Cannot log in',repeat('a',64));
  assert v_result->>'status'='pending';
  begin perform public.service_submit_guest_request('guest@example.invalid','deletion','Unverified deletion',repeat('a',64));raise exception 'Guest deletion accepted';exception when invalid_parameter_value then null;end;
end $$;
reset role;
update support_private.notification_outbox set attempts=5,status='processing',lease_until=clock_timestamp()-interval '1 minute',lease_token=gen_random_uuid()
where request_id=(select id from support_private.account_requests where contact_email='guest@example.invalid');
set local role service_role;
select public.service_claim_support_notifications(20);
reset role;
do $$begin
  assert(select status='failed' and last_error_code='lease_exhausted' from support_private.notification_outbox
    where request_id=(select id from support_private.account_requests where contact_email='guest@example.invalid')),'Exhausted worker leases must not remain processing forever';
  assert(select count(*)=1 from weekly_private.picks where season=2088),'No administration operation changes picks';
  begin update account_private.audit_log set action='changed';raise exception 'Audit mutation accepted';exception when insufficient_privilege then null;end;
  begin delete from account_private.audit_log;raise exception 'Audit deletion accepted';exception when insufficient_privilege then null;end;
end $$;
rollback;
