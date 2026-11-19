-- Complete the existing private request workflow without exposing private
-- messages through public tables, email notifications, or contest APIs.
create table support_private.request_responses (
  id uuid primary key,
  request_id uuid not null references support_private.account_requests(id) on delete cascade,
  author_id uuid not null,
  message text not null check(char_length(btrim(message)) between 1 and 2000),
  requires_action boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create index support_responses_request_created on support_private.request_responses(request_id,created_at desc,id);
alter table support_private.request_responses enable row level security;
revoke all on support_private.request_responses from public,anon,authenticated,service_role;
create trigger support_responses_append_only before update or delete on support_private.request_responses
for each row execute function account_private.reject_audit_mutation();

create or replace function support_private.submit_support_request(p_category text,p_message text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=account_private.require_user();v_request support_private.account_requests%rowtype;v_kind text;v_created boolean:=false;
begin
  if p_category is null or p_category not in('access','teams','contest','profile','data','deletion','general') or p_message is null
      or char_length(btrim(p_message)) not between 1 and 2000 then raise exception 'Choose a request category and enter a message of up to 2000 characters' using errcode='22023'; end if;
  v_kind:=case p_category when 'data' then 'data' when 'deletion' then 'deletion' else 'support' end;
  perform pg_advisory_xact_lock(hashtext(v_user::text),hashtext(p_category));
  select * into v_request from support_private.account_requests where user_id=v_user and category=p_category and status in('pending','in_review');
  if not found then
    if (select count(*) from support_private.account_requests where user_id=v_user and created_at>statement_timestamp()-interval '1 hour')>=10 then
      raise exception 'Too many requests. Please try again later.' using errcode='22023'; end if;
    insert into support_private.account_requests(user_id,kind,category,message) values(v_user,v_kind,p_category,btrim(p_message)) returning * into v_request;
    v_created:=true;
  end if;
  return jsonb_build_object('id',v_request.id,'kind',v_request.kind,'category',v_request.category,'status',v_request.status,'createdAt',v_request.created_at,'alreadyOpen',not v_created);
end $$;

create function account_private.admin_reply_request(p_request_id uuid,p_reply_id uuid,p_message text,p_requires_action boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=account_private.require_admin();v_owner uuid;v_existing support_private.request_responses%rowtype;v_message text:=btrim(p_message);
begin
  if p_request_id is null or p_reply_id is null or v_message is null or char_length(v_message) not between 1 and 2000 or p_requires_action is null then
    raise exception 'Choose a request and enter a private response of up to 2000 characters' using errcode='22023';
  end if;
  select user_id into v_owner from support_private.account_requests where id=p_request_id for update;
  if not found or v_owner is null then raise exception 'Private responses require a request associated with an account' using errcode='22023'; end if;
  select * into v_existing from support_private.request_responses where id=p_reply_id;
  if found then
    if v_existing.request_id<>p_request_id or v_existing.author_id<>v_actor or v_existing.message<>v_message or v_existing.requires_action<>p_requires_action then
      raise exception 'This response identifier has already been used' using errcode='22023';
    end if;
    return jsonb_build_object('id',v_existing.id,'requestId',v_existing.request_id,'createdAt',v_existing.created_at);
  end if;
  insert into support_private.request_responses(id,request_id,author_id,message,requires_action) values(p_reply_id,p_request_id,v_actor,v_message,p_requires_action);
  update support_private.account_requests set updated_at=clock_timestamp() where id=p_request_id;
  insert into account_private.audit_log(actor_id,target_user_id,action,details) values(v_actor,v_owner,'support_reply',
    jsonb_build_object('requestId',p_request_id,'responseId',p_reply_id,'requiresAction',p_requires_action));
  return jsonb_build_object('id',p_reply_id,'requestId',p_request_id,'createdAt',clock_timestamp());
end $$;
create function public.admin_reply_request(p_request_id uuid,p_reply_id uuid,p_message text,p_requires_action boolean default false)
returns jsonb language sql set search_path='' as $$select account_private.admin_reply_request(p_request_id,p_reply_id,p_message,p_requires_action);$$;
revoke all on function account_private.admin_reply_request(uuid,uuid,text,boolean),public.admin_reply_request(uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function account_private.admin_reply_request(uuid,uuid,text,boolean),public.admin_reply_request(uuid,uuid,text,boolean) to authenticated;

create or replace function support_private.my_account_requests() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_user uuid;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  v_user:=account_private.require_user();
  return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'category',category,'status',status,'createdAt',created_at,'updatedAt',updated_at,'message',message,
    'responseTotal',(select count(*) from support_private.request_responses where request_id=requests.id),
    'responses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'message',message,'requiresAction',requires_action,'createdAt',created_at) order by created_at,id)
      from(select * from support_private.request_responses where request_id=requests.id order by created_at desc,id desc limit 20) response_page),'[]'::jsonb))
    order by created_at desc),'[]'::jsonb) from(select * from support_private.account_requests where user_id=v_user order by created_at desc,id limit 30) requests);
end $$;

create or replace function account_private.admin_support_requests(p_status text,p_limit integer,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform account_private.require_admin();
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 or (p_status is not null and p_status not in('pending','in_review','resolved','closed')) then raise exception 'Invalid request search' using errcode='22023'; end if;
  return (with matching as(select r.*,coalesce(u.email,r.contact_email) email,o.status notification_status from support_private.account_requests r
    left join auth.users u on u.id=r.user_id left join support_private.notification_outbox o on o.request_id=r.id where p_status is null or r.status=p_status)
    select jsonb_build_object('total',(select count(*) from matching),
      'statusCounts',jsonb_build_object('pending',(select count(*) from support_private.account_requests where status='pending'),
        'in_review',(select count(*) from support_private.account_requests where status='in_review'),'resolved',(select count(*) from support_private.account_requests where status='resolved'),
        'closed',(select count(*) from support_private.account_requests where status='closed')),
      'notifications',jsonb_build_object('due',(select count(*) from support_private.notification_outbox where attempts<5 and next_attempt_at<=statement_timestamp()
        and (status='pending' or(status='processing' and lease_until<statement_timestamp()))),
        'failed',(select count(*) from support_private.notification_outbox where status='failed' and provider_id is null and sent_at is null and(lease_until is null or lease_until<=statement_timestamp()))),
      'requests',coalesce((select jsonb_agg(jsonb_build_object('id',id,'userId',user_id,'email',email,'kind',kind,'category',category,'message',message,'status',status,
        'createdAt',created_at,'updatedAt',updated_at,'adminNote',admin_note,'notificationStatus',notification_status,
        'responseTotal',(select count(*) from support_private.request_responses where request_id=page.id),
        'responses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'message',message,'requiresAction',requires_action,'createdAt',created_at) order by created_at,id)
          from(select * from support_private.request_responses where request_id=page.id order by created_at desc,id desc limit 20) response_page),'[]'::jsonb))
        order by created_at desc,id) from(select * from matching order by created_at desc,id limit p_limit offset p_offset) page),'[]'::jsonb)));
end $$;

create or replace function account_private.admin_action_history(p_limit integer,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform account_private.require_admin();
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then raise exception 'Invalid history page' using errcode='22023'; end if;
  return jsonb_build_object('total',(select count(*) from account_private.audit_log),'actions',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,
    'actorLabel',case when a.actor_id is null then 'Protected owner process' else coalesce(nullif(p.nickname,''),u.email,'Account no longer available') end,
    'targetLabel',coalesce(nullif(tp.nickname,''),tu.email,case when a.target_user_id is null then 'System' else 'Account no longer available' end),
    'action',a.action,'details',a.details,'createdAt',a.created_at) order by a.created_at desc,a.id)
    from(select * from account_private.audit_log order by created_at desc,id limit p_limit offset p_offset) a
    left join auth.users u on u.id=a.actor_id left join weekly_private.players p on p.user_id=a.actor_id
    left join auth.users tu on tu.id=a.target_user_id left join weekly_private.players tp on tp.user_id=a.target_user_id),'[]'::jsonb));
end $$;
