begin;
set local plpgsql.check_asserts=on;
insert into auth.users(id,email,email_confirmed_at) values
 ('b1000000-0000-4000-8000-000000000001','support-admin@example.invalid',clock_timestamp()),
 ('b1000000-0000-4000-8000-000000000002','support-owner@example.invalid',clock_timestamp()),
 ('b1000000-0000-4000-8000-000000000003','support-other@example.invalid',clock_timestamp());
insert into auth.sessions(id,user_id,aal) values('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','aal2');
insert into auth.mfa_factors(id,user_id,status) values('b3000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','verified');
set local role service_role;
select account_private.provision_administrator('support-admin@example.invalid','Disposable support reply provisioning');
reset role;
set local role anon;
do $$begin
  begin perform public.admin_reply_request(gen_random_uuid(),gen_random_uuid(),'No authority',false);raise exception 'Guest reply';exception when insufficient_privilege then null;end;
  begin perform public.my_account_requests();raise exception 'Guest request history';exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
do $$declare r jsonb;begin
  r:=public.submit_support_request('general','My private account question');
  assert not(r->>'alreadyOpen')::boolean;
  perform set_config('support_response_test.request',r->>'id',true);
  r:=public.submit_support_request('general','A new unsent draft');
  assert(r->>'alreadyOpen')::boolean and r->>'id'=current_setting('support_response_test.request');
  begin perform public.admin_reply_request((r->>'id')::uuid,'b4000000-0000-4000-8000-000000000001','A forged reply',false);raise exception 'Ordinary user reply';exception when insufficient_privilege then null;end;
  begin select to_jsonb(x) into r from support_private.request_responses x limit 1;raise exception 'Raw response read';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal1","session_id":"b2000000-0000-4000-8000-000000000001"}',true);
do $$begin
  begin perform public.admin_reply_request(current_setting('support_response_test.request')::uuid,'b4000000-0000-4000-8000-000000000001','Weak MFA',false);raise exception 'Weak MFA reply';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"aal":"aal2","session_id":"b2000000-0000-4000-8000-000000000001"}',true);
do $$declare r jsonb;v jsonb;begin
  perform public.admin_update_request(current_setting('support_response_test.request')::uuid,'in_review','Internal note: never user-visible');
  r:=public.admin_reply_request(current_setting('support_response_test.request')::uuid,'b4000000-0000-4000-8000-000000000001','Please check your saved team after reloading.',true);
  assert r->>'requestId'=current_setting('support_response_test.request');
  assert public.admin_reply_request(current_setting('support_response_test.request')::uuid,'b4000000-0000-4000-8000-000000000001','Please check your saved team after reloading.',true)->>'id'=r->>'id','Retry must be idempotent';
  begin perform public.admin_reply_request(current_setting('support_response_test.request')::uuid,'b4000000-0000-4000-8000-000000000001','Changed text',true);raise exception 'Response overwrite';exception when invalid_parameter_value then null;end;
  begin perform public.admin_reply_request(gen_random_uuid(),gen_random_uuid(),'Unknown request',false);raise exception 'Unknown request reply';exception when invalid_parameter_value then null;end;
  v:=public.admin_support_requests('pending');
  assert v->>'total'='0' and v->'statusCounts'->>'in_review'='1';
  assert v->'notifications'->>'due'='1';
  v:=public.admin_support_requests('in_review')->'requests'->0;
  assert v->>'adminNote'='Internal note: never user-visible';
  assert jsonb_array_length(v->'responses')=1 and (v->'responses'->0->>'requiresAction')::boolean;
  v:=public.admin_action_history();
  assert (v->'actions'->0->>'actorLabel')='support-admin@example.invalid';
  assert (v->'actions'->0->>'targetLabel')='support-owner@example.invalid';
  assert v->'actions'->0->>'action'='support_reply';
end $$;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{}',true);
do $$declare r jsonb;begin
  r:=public.my_account_requests()->0;
  assert r->>'status'='in_review';
  assert r->>'message'='My private account question';
  assert r->'responses'->0->>'message'='Please check your saved team after reloading.';
  assert not r ? 'adminNote' and r::text not like '%Internal note%';
  assert not(r->'responses'->0 ? 'authorId');
end $$;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
do $$begin assert public.my_account_requests()='[]'::jsonb,'Other user must not receive response';end $$;
reset role;
insert into auth.sessions(id,user_id,aal) values('b2000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','aal2');
insert into auth.mfa_factors(id,user_id,status) values('b3000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','verified');
update account_private.memberships set status='suspended' where user_id='b1000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"aal":"aal1","session_id":"b2000000-0000-4000-8000-000000000002"}',true);
do $$begin
  begin perform public.my_account_requests();raise exception 'Suspended MFA owner read at aal1';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claims','{"aal":"aal2","session_id":"b2000000-0000-4000-8000-000000000002"}',true);
do $$begin
  assert public.account_context()->>'status'='suspended';
  assert public.my_account_requests()->0->>'message'='My private account question';
  assert public.my_account_requests()->0->'responses'->0->>'message'='Please check your saved team after reloading.';
end $$;
reset role;
do $$begin
  assert (select count(*) from support_private.request_responses)=1;
  assert (select count(*) from account_private.audit_log where action='support_reply')=1;
  begin update support_private.request_responses set message='Overwrite';raise exception 'Mutable response';exception when insufficient_privilege then null;end;
  begin delete from support_private.request_responses;raise exception 'Deleted response';exception when insufficient_privilege then null;end;
  assert not has_table_privilege('authenticated','support_private.request_responses','select');
  assert not has_function_privilege('anon','public.admin_reply_request(uuid,uuid,text,boolean)','execute');
end $$;
rollback;
