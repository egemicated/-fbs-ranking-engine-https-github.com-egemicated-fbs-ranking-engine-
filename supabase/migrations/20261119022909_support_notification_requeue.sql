-- Explicit, auditable recovery for exhausted notifications only. No automatic
-- resend of accepted mail, and no new access to private contest selections.
create function account_private.admin_requeue_support_notification(p_request_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=account_private.require_admin();
  v_notification support_private.notification_outbox%rowtype;
  v_target uuid;
  v_reason text:=btrim(p_reason);
begin
  if p_request_id is null or v_reason is null or char_length(v_reason) not between 5 and 500 then
    raise exception 'Choose a failed notification and explain the retry' using errcode='22023';
  end if;
  select * into v_notification from support_private.notification_outbox where request_id=p_request_id for update;
  if not found then raise exception 'Notification not found' using errcode='22023'; end if;
  if v_notification.status<>'failed' or v_notification.provider_id is not null or v_notification.sent_at is not null or
      (v_notification.lease_until is not null and v_notification.lease_until>clock_timestamp()) then
    raise exception 'Only failed notifications without an accepted receipt or live delivery lease can be retried' using errcode='22023';
  end if;
  select user_id into v_target from support_private.account_requests where id=p_request_id;
  update support_private.notification_outbox set status='pending',attempts=0,next_attempt_at=clock_timestamp(),
    lease_until=null,lease_token=null,last_error_code=null where id=v_notification.id;
  insert into account_private.audit_log(actor_id,target_user_id,action,details) values(v_actor,v_target,'support_notification_requeue',
    jsonb_build_object('requestId',p_request_id,'notificationId',v_notification.id,'previousAttempts',v_notification.attempts,
      'previousErrorCode',v_notification.last_error_code,'reason',v_reason));
  return jsonb_build_object('requestId',p_request_id,'notificationId',v_notification.id,'notificationStatus','pending');
end $$;
create function public.admin_requeue_support_notification(p_request_id uuid,p_reason text)
returns jsonb language sql set search_path='' as $$
  select account_private.admin_requeue_support_notification(p_request_id,p_reason);
$$;
revoke all on function account_private.admin_requeue_support_notification(uuid,text),public.admin_requeue_support_notification(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function account_private.admin_requeue_support_notification(uuid,text),public.admin_requeue_support_notification(uuid,text)
  to authenticated;
