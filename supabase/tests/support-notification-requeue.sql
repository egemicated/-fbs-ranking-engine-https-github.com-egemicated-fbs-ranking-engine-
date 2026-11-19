-- Disposable support notifications only. Every operation rolls back.
begin;
set local plpgsql.check_asserts=on;
insert into auth.users(id,email,email_confirmed_at) values
 ('af100000-0000-4000-8000-000000000001','retry-admin@example.invalid',clock_timestamp()),
 ('af100000-0000-4000-8000-000000000002','retry-user@example.invalid',clock_timestamp());
insert into auth.sessions(id,user_id,aal) values('af200000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001','aal2');
insert into auth.mfa_factors(id,user_id,status) values('af300000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000001','verified');
insert into support_private.account_requests(id,user_id,kind,category,message)
select ('af400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'af100000-0000-4000-8000-000000000002','support',category,'Disposable retry fixture'
from (values(1,'access'),(2,'teams'),(3,'contest'),(4,'profile'),(5,'general'),(6,'data')) v(n,category);
update support_private.notification_outbox set status='failed',attempts=5,last_error_code='lease_exhausted'
where request_id='af400000-0000-4000-8000-000000000001';
update support_private.notification_outbox set status='processing',attempts=1,lease_until=clock_timestamp()+interval '10 minutes',lease_token=gen_random_uuid()
where request_id='af400000-0000-4000-8000-000000000003';
update support_private.notification_outbox set status='sent',attempts=1,sent_at=clock_timestamp(),provider_id='accepted-receipt'
where request_id='af400000-0000-4000-8000-000000000004';
-- Defensive corrupt/inconsistent receipt/lease combinations must not resend.
update support_private.notification_outbox set status='failed',attempts=5,provider_id='known-accepted'
where request_id='af400000-0000-4000-8000-000000000005';
update support_private.notification_outbox set status='failed',attempts=5,lease_until=clock_timestamp()+interval '10 minutes',lease_token=gen_random_uuid()
where request_id='af400000-0000-4000-8000-000000000006';
set local role service_role;
select account_private.provision_administrator('retry-admin@example.invalid','Disposable retry administrator');
do $$begin
  begin perform public.admin_requeue_support_notification('af400000-0000-4000-8000-000000000001','Service role must not bypass administrator MFA');raise exception 'Service-only admin bypass';exception when insufficient_privilege then null;end;
end $$;
set local role anon;
do $$begin
  begin perform public.admin_requeue_support_notification('af400000-0000-4000-8000-000000000001','Guest retry attempt');raise exception 'Guest retry accepted';exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
do $$begin
  perform set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000002',true);
  perform set_config('request.jwt.claims','{"aal":"aal2","user_metadata":{"role":"admin"}}',true);
  begin perform public.admin_requeue_support_notification('af400000-0000-4000-8000-000000000001','Ordinary user retry attempt');raise exception 'User retry accepted';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claims','{"aal":"aal1","session_id":"af200000-0000-4000-8000-000000000001"}',true);
  begin perform public.admin_requeue_support_notification('af400000-0000-4000-8000-000000000001','AAL1 administrator retry');raise exception 'AAL1 retry accepted';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claims','{"aal":"aal2","session_id":"af200000-0000-4000-8000-000000000099"}',true);
  begin perform public.admin_requeue_support_notification('af400000-0000-4000-8000-000000000001','Missing session retry');raise exception 'Missing session retry accepted';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claims','{"aal":"aal2","session_id":"af200000-0000-4000-8000-000000000001"}',true);
  begin perform public.admin_requeue_support_notification('af400000-0000-4000-8000-000000000002','Pending mail must not resend');raise exception 'Pending retry accepted';exception when invalid_parameter_value then null;end;
  begin perform public.admin_requeue_support_notification('af400000-0000-4000-8000-000000000003','Active lease must not resend');raise exception 'Processing retry accepted';exception when invalid_parameter_value then null;end;
  begin perform public.admin_requeue_support_notification('af400000-0000-4000-8000-000000000004','Accepted mail must not resend');raise exception 'Sent retry accepted';exception when invalid_parameter_value then null;end;
  begin perform public.admin_requeue_support_notification('af400000-0000-4000-8000-000000000005','Known receipt must not resend');raise exception 'Receipt retry accepted';exception when invalid_parameter_value then null;end;
  begin perform public.admin_requeue_support_notification('af400000-0000-4000-8000-000000000006','Live failed lease must not resend');raise exception 'Live lease retry accepted';exception when invalid_parameter_value then null;end;
  begin perform public.admin_requeue_support_notification('af400000-0000-4000-8000-000000000001','');raise exception 'Unexplained retry accepted';exception when invalid_parameter_value then null;end;
  assert public.admin_requeue_support_notification('af400000-0000-4000-8000-000000000001','Delivery setup repaired; retry explicitly approved')->>'notificationStatus'='pending';
  begin perform public.admin_requeue_support_notification('af400000-0000-4000-8000-000000000001','Repeated click must not duplicate');raise exception 'Repeated retry accepted';exception when invalid_parameter_value then null;end;
end $$;
reset role;
do $$begin
  assert(select status='pending' and attempts=0 and lease_until is null and lease_token is null and last_error_code is null
    from support_private.notification_outbox where request_id='af400000-0000-4000-8000-000000000001');
  assert(select count(*)=1 from account_private.audit_log where action='support_notification_requeue');
  assert(select target_user_id='af100000-0000-4000-8000-000000000002' and details->>'requestId'='af400000-0000-4000-8000-000000000001'
    and(details->>'previousAttempts')::integer=5 and char_length(details->>'reason')>=5 from account_private.audit_log where action='support_notification_requeue');
end $$;
set local role service_role;
do $$declare claimed jsonb;begin
  claimed:=public.service_claim_support_notifications(100);
  assert exists(select from jsonb_array_elements(claimed) r where r->>'requestId'='af400000-0000-4000-8000-000000000001' and(r->>'attempt')::integer=1),
    'Explicitly requeued failed mail is claimable once again';
  assert not exists(select from jsonb_array_elements(claimed) r where r->>'requestId' in('af400000-0000-4000-8000-000000000003','af400000-0000-4000-8000-000000000004','af400000-0000-4000-8000-000000000005','af400000-0000-4000-8000-000000000006'));
end $$;
reset role;
rollback;
