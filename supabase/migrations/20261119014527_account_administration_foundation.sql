-- Managed Auth owns credentials. Application roles are private, live database
-- records; user-editable metadata is never an authorization source.
create schema account_private;
revoke all on schema account_private from public, anon, authenticated, service_role;
grant usage on schema account_private to authenticated, service_role;

create table account_private.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user','admin')),
  status text not null default 'active' check (status in ('active','suspended','deletion_pending')),
  blocked_nickname text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
insert into account_private.memberships(user_id) select id from auth.users;

create table account_private.entitlements (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check(feature ~ '^[a-z][a-z0-9_]{1,63}$'),
  starts_at timestamptz not null default clock_timestamp(),
  ends_at timestamptz,
  revoked_at timestamptz,
  source text not null check(source in ('manual','future_billing')),
  primary key(user_id,feature),
  check(ends_at is null or ends_at > starts_at)
);
-- No entitlement rows, payment provider, webhook, subscription or price is seeded.
create table account_private.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  target_user_id uuid,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);
create index account_audit_created on account_private.audit_log(created_at desc,id);
alter table account_private.memberships enable row level security;
alter table account_private.entitlements enable row level security;
alter table account_private.audit_log enable row level security;
revoke all on all tables in schema account_private from public,anon,authenticated,service_role;

create function account_private.new_membership() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into account_private.memberships(user_id) values(new.id) on conflict do nothing;
  return new;
end $$;
create trigger fbs_account_membership after insert on auth.users
for each row execute function account_private.new_membership();
-- Cover an Auth registration committed between the initial backfill and the
-- trigger's table lock. Later registrations are protected by that trigger.
insert into account_private.memberships(user_id) select id from auth.users on conflict do nothing;

create function account_private.active_user(p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select from auth.users u left join account_private.memberships m on m.user_id=u.id
    where u.id=p_user_id and coalesce(m.status,'active')='active');
$$;
create function account_private.require_user() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null or not exists(select from auth.users where id=v_user) then
    raise exception 'Sign in to manage your account' using errcode='42501';
  end if;
  return v_user;
end $$;
create function account_private.require_active_user() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=account_private.require_user();
begin
  if not account_private.active_user(v_user) then raise exception 'This account cannot save changes. Contact support.' using errcode='42501'; end if;
  return v_user;
end $$;

create function account_private.require_admin() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=account_private.require_active_user(); v_claims jsonb; v_session uuid;
begin
  if not exists(select from account_private.memberships where user_id=v_user and role='admin' and status='active') then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  v_claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  if v_claims->>'aal' is distinct from 'aal2' or coalesce(v_claims->>'session_id','') !~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'Verify your authenticator to continue' using errcode='42501';
  end if;
  v_session:=(v_claims->>'session_id')::uuid;
  if not exists(select from auth.sessions where id=v_session and user_id=v_user and aal::text='aal2'
      and (not_after is null or not_after>statement_timestamp())) or
      not exists(select from auth.mfa_factors where user_id=v_user and status::text='verified' and factor_type::text='totp') then
    raise exception 'Your administrator session is no longer valid. Sign in and verify again.' using errcode='42501';
  end if;
  return v_user;
end $$;

create function account_private.context(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('userId',u.id,'email',u.email,'role',coalesce(m.role,'user'),
    'status',coalesce(m.status,'active'),'nickname',coalesce(p.nickname,(select nickname from cfp_private.entries where user_id=u.id order by season desc limit 1),''),
    'publicLeaderboard',coalesce(p.public_leaderboard,exists(select from cfp_private.entries where user_id=u.id)),
    'sharePicks',coalesce(p.share_picks,false),'adminMfaRequired',true,
    'entitlements',coalesce((select jsonb_agg(feature order by feature) from account_private.entitlements
      where user_id=u.id and revoked_at is null and starts_at<=statement_timestamp()
        and (ends_at is null or ends_at>statement_timestamp()) and coalesce(m.status,'active')='active'),'[]'::jsonb))
  from auth.users u left join account_private.memberships m on m.user_id=u.id
    left join weekly_private.players p on p.user_id=u.id where u.id=p_user_id;
$$;
create function account_private.account_context() returns jsonb
language sql stable security definer set search_path='' as $$
  select account_private.context(account_private.require_user());
$$;
create function account_private.save_account_profile(p_nickname text,p_public boolean,p_share_picks boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=account_private.require_active_user(); v_name text:=btrim(p_nickname);
begin
  if v_name is null or char_length(v_name) not between 2 and 30 or v_name ~ '[[:cntrl:]]' then
    raise exception 'Use a display name between 2 and 30 characters' using errcode='22023';
  end if;
  if exists(select from account_private.memberships where user_id=v_user and lower(blocked_nickname)=lower(v_name)) then
    raise exception 'Choose a different public nickname' using errcode='22023';
  end if;
  insert into weekly_private.players(user_id,nickname,public_leaderboard,share_picks,share_picks_immediately)
    values(v_user,v_name,coalesce(p_public,false),coalesce(p_public and p_share_picks,false),false)
    on conflict(user_id) do update set nickname=excluded.nickname,public_leaderboard=excluded.public_leaderboard,
      share_picks=excluded.share_picks,share_picks_immediately=false;
  return account_private.context(v_user);
end $$;
create function account_private.has_entitlement(p_feature text) returns boolean
language sql stable security definer set search_path='' as $$
  select account_private.active_user(auth.uid()) and exists(select from account_private.entitlements
    where user_id=auth.uid() and feature=p_feature and revoked_at is null and starts_at<=statement_timestamp()
      and (ends_at is null or ends_at>statement_timestamp()));
$$;

-- Suspension blocks existing contest paths as well as the new account UI.
create function account_private.enforce_contest_account() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_user uuid;
begin
  v_user:=case when tg_op='DELETE' then old.user_id else new.user_id end;
  -- Existing Auth cascades remain supported; production hard deletion is not enabled here.
  if tg_op='DELETE' and not exists(select from auth.users where id=v_user) then return old; end if;
  if auth.uid()=v_user then perform account_private.require_active_user(); end if;
  if not account_private.active_user(v_user) then raise exception 'This account cannot change contest selections. Contact support.' using errcode='42501'; end if;
  if tg_table_name in ('players','entries') and tg_op<>'DELETE' and exists(
      select from account_private.memberships where user_id=v_user and lower(blocked_nickname)=lower(to_jsonb(new)->>'nickname')) then
    raise exception 'Choose a different public nickname' using errcode='22023';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger account_status_before_weekly_profile before insert or update on weekly_private.players
for each row execute function account_private.enforce_contest_account();
create trigger account_status_before_weekly_pick before insert or update or delete on weekly_private.picks
for each row execute function account_private.enforce_contest_account();
create trigger account_status_before_cfp_entry before insert or update on cfp_private.entries
for each row execute function account_private.enforce_contest_account();
create function account_private.enforce_preferences_account() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform account_private.require_active_user();
  return case when tg_op='DELETE' then old else new end;
end $$;
-- Ownership stays in the existing RLS policy. A suspended owner can still read
-- preferences and send support requests; they cannot save new choices.
create trigger account_status_before_preferences before insert or update on public.my_team_preferences
for each row execute function account_private.enforce_preferences_account();

-- Canonical nickname/visibility changes apply to the public bracket standings
-- without updating any locked entry or its original picks.
create or replace function cfp_private.leaderboard(p_season integer)
returns jsonb language sql stable security definer set search_path='' as $$
  with scored as (
    select e.user_id,coalesce(p.nickname,e.nickname) nickname,scores.points,scores.correct
    from cfp_private.entries e join cfp_private.contests c using(season)
    left join weekly_private.players p on p.user_id=e.user_id
    cross join lateral (
      select coalesce(sum(case (s.slot->>'round')::integer when 1 then 1 when 2 then 2 when 3 then 4 when 4 then 8 end),0) points,
        count(*) correct from jsonb_array_elements(c.slots) s(slot)
      where e.picks->>(s.slot->>'id')=c.results->(s.slot->>'id')->>'winner'
    ) scores where e.season=p_season and c.lock_at<=statement_timestamp() and coalesce(p.public_leaderboard,true)
  ),placed as(select *,rank() over(order by points desc) rank from scored)
  select coalesce(jsonb_agg(jsonb_build_object('rank',rank,'nickname',nickname,'points',points,'correct',correct,
    'isYou',coalesce(user_id=auth.uid(),false)) order by rank,nickname,user_id),'[]'::jsonb) from placed;
$$;

-- Expand the existing private request system; preserve old request identifiers.
alter table support_private.account_requests drop constraint account_requests_kind_check;
alter table support_private.account_requests drop constraint account_requests_status_check;
alter table support_private.account_requests alter column user_id drop not null;
alter table support_private.account_requests add column category text;
alter table support_private.account_requests add column contact_email text;
alter table support_private.account_requests add column client_hash text;
alter table support_private.account_requests add column updated_at timestamptz not null default clock_timestamp();
alter table support_private.account_requests add column admin_note text not null default '';
update support_private.account_requests set category=case kind when 'data' then 'data' when 'deletion' then 'deletion' else 'general' end;
alter table support_private.account_requests alter column category set not null;
alter table support_private.account_requests add constraint account_requests_kind_check check(kind in('support','data','deletion'));
alter table support_private.account_requests add constraint account_requests_category_check check(category in('access','teams','contest','profile','data','deletion','general'));
alter table support_private.account_requests add constraint account_requests_status_check check(status in('pending','in_review','resolved','closed'));
alter table support_private.account_requests add constraint account_requests_owner_check check(user_id is not null or contact_email is not null);
drop index support_private.one_pending_account_request;
create unique index one_pending_account_request on support_private.account_requests(user_id,category) where status in('pending','in_review');
create index account_requests_status_created on support_private.account_requests(status,created_at desc);
create index account_requests_client_created on support_private.account_requests(client_hash,created_at desc) where client_hash is not null;

create table support_private.notification_outbox(
  id uuid primary key default gen_random_uuid(), request_id uuid not null unique references support_private.account_requests(id) on delete cascade,
  status text not null default 'pending' check(status in('pending','processing','sent','failed')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  next_attempt_at timestamptz not null default clock_timestamp(), lease_until timestamptz,lease_token uuid,
  provider_id text,last_error_code text,sent_at timestamptz,created_at timestamptz not null default clock_timestamp()
);
alter table support_private.notification_outbox enable row level security;
revoke all on support_private.notification_outbox from public,anon,authenticated,service_role;
create index notification_pending on support_private.notification_outbox(next_attempt_at) where status in('pending','processing');
create function support_private.queue_request_notification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into support_private.notification_outbox(request_id) values(new.id);
  return new;
end $$;
create trigger queue_account_request_notification after insert on support_private.account_requests
for each row execute function support_private.queue_request_notification();
insert into support_private.notification_outbox(request_id) select id from support_private.account_requests;

create function support_private.submit_support_request(p_category text,p_message text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=account_private.require_user();v_request support_private.account_requests%rowtype;v_kind text;
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
  end if;
  return jsonb_build_object('id',v_request.id,'kind',v_request.kind,'category',v_request.category,'status',v_request.status,'createdAt',v_request.created_at);
end $$;
create or replace function support_private.submit_account_request(p_kind text,p_message text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_kind is null or p_kind not in('support','data','deletion') then raise exception 'Choose a valid request type' using errcode='22023'; end if;
  return support_private.submit_support_request(case p_kind when 'support' then 'general' else p_kind end,p_message);
end $$;
create or replace function support_private.my_account_requests() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'category',category,'status',status,'createdAt',created_at,'updatedAt',updated_at)
    order by created_at desc),'[]'::jsonb) from(select * from support_private.account_requests where user_id=auth.uid() order by created_at desc limit 30) requests;
$$;

create function account_private.admin_users(p_search text,p_limit integer,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform account_private.require_admin();
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 or char_length(coalesce(p_search,''))>200 then raise exception 'Invalid user search' using errcode='22023'; end if;
  return (with matching as(
    select u.id,u.email,u.created_at,u.last_sign_in_at,u.email_confirmed_at,m.role,m.status,p.nickname,p.public_leaderboard,p.share_picks
    from auth.users u join account_private.memberships m on m.user_id=u.id left join weekly_private.players p on p.user_id=u.id
    where coalesce(p_search,'')='' or u.email ilike '%'||p_search||'%' or p.nickname ilike '%'||p_search||'%'
  ) select jsonb_build_object('total',(select count(*) from matching),'users',coalesce((select jsonb_agg(jsonb_build_object(
    'userId',id,'email',email,'createdAt',created_at,'lastSignInAt',last_sign_in_at,'emailConfirmed',email_confirmed_at is not null,
    'role',role,'status',status,'nickname',coalesce(nickname,''),'publicLeaderboard',coalesce(public_leaderboard,false),'sharePicks',coalesce(share_picks,false))
    order by created_at desc,id) from(select * from matching order by created_at desc,id limit p_limit offset p_offset) page),'[]'::jsonb)));
end $$;
create function account_private.admin_support_requests(p_status text,p_limit integer,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform account_private.require_admin();
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 or (p_status is not null and p_status not in('pending','in_review','resolved','closed')) then raise exception 'Invalid request search' using errcode='22023'; end if;
  return(with matching as(select r.*,coalesce(u.email,r.contact_email) email,o.status notification_status from support_private.account_requests r
    left join auth.users u on u.id=r.user_id left join support_private.notification_outbox o on o.request_id=r.id where p_status is null or r.status=p_status)
    select jsonb_build_object('total',(select count(*) from matching),'requests',coalesce((select jsonb_agg(jsonb_build_object('id',id,'userId',user_id,
      'email',email,'kind',kind,'category',category,'message',message,'status',status,'createdAt',created_at,'updatedAt',updated_at,
      'adminNote',admin_note,'notificationStatus',notification_status) order by created_at desc,id) from(select * from matching order by created_at desc,id limit p_limit offset p_offset) page),'[]'::jsonb)));
end $$;
create function account_private.admin_update_request(p_request_id uuid,p_status text,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=account_private.require_admin();v_old text;v_category text;
begin
  if p_status is null or p_status not in('pending','in_review','resolved','closed') or char_length(coalesce(p_note,''))>500 then raise exception 'Invalid request update' using errcode='22023'; end if;
  select status,category into v_old,v_category from support_private.account_requests where id=p_request_id for update;
  if not found then raise exception 'Request not found' using errcode='22023'; end if;
  if v_category='deletion' and p_status='resolved' then raise exception 'Deletion requires the protected account-removal process; it is not enabled by a request status change' using errcode='22023'; end if;
  update support_private.account_requests set status=p_status,admin_note=coalesce(p_note,''),updated_at=clock_timestamp() where id=p_request_id;
  insert into account_private.audit_log(actor_id,target_user_id,action,details) select v_actor,user_id,'support_status',jsonb_build_object('requestId',id,'from',v_old,'to',p_status) from support_private.account_requests where id=p_request_id;
  return jsonb_build_object('id',p_request_id,'status',p_status,'updatedAt',clock_timestamp());
end $$;
create function account_private.admin_set_account_status(p_user_id uuid,p_status text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=account_private.require_admin();v_old text;v_role text;
begin
  if p_status is null or p_status not in('active','suspended') or char_length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Choose a status and explain the change' using errcode='22023'; end if;
  select status,role into v_old,v_role from account_private.memberships where user_id=p_user_id for update;
  if not found then raise exception 'User not found' using errcode='22023'; end if;
  if p_user_id=v_actor or v_role='admin' then raise exception 'Administrator accounts require the protected provisioning process' using errcode='42501'; end if;
  if v_old='deletion_pending' then raise exception 'Review the pending deletion before changing account status' using errcode='22023'; end if;
  update account_private.memberships set status=p_status,updated_at=clock_timestamp() where user_id=p_user_id;
  insert into account_private.audit_log(actor_id,target_user_id,action,details) values(v_actor,p_user_id,'account_status',jsonb_build_object('from',v_old,'to',p_status,'reason',btrim(p_reason)));
  return account_private.context(p_user_id);
end $$;
create function account_private.admin_moderate_nickname(p_user_id uuid,p_nickname text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=account_private.require_admin();v_old text;v_name text:=btrim(p_nickname);
begin
  if v_name is null or char_length(v_name) not between 2 and 30 or v_name~'[[:cntrl:]]' or char_length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Enter a valid nickname and moderation reason' using errcode='22023'; end if;
  if not account_private.active_user(p_user_id) then raise exception 'Reactivate the account before changing its nickname' using errcode='22023'; end if;
  perform 1 from account_private.memberships where user_id=p_user_id for update;
  select coalesce(p.nickname,(select nickname from cfp_private.entries where user_id=p_user_id order by season desc limit 1)) into v_old from auth.users u left join weekly_private.players p on p.user_id=u.id where u.id=p_user_id;
  if lower(v_old)=lower(v_name) then raise exception 'Choose a different nickname' using errcode='22023'; end if;
  update account_private.memberships set blocked_nickname=v_old,updated_at=clock_timestamp() where user_id=p_user_id;
  insert into weekly_private.players(user_id,nickname,public_leaderboard) values(p_user_id,v_name,exists(select from cfp_private.entries where user_id=p_user_id))
    on conflict(user_id) do update set nickname=excluded.nickname;
  insert into account_private.audit_log(actor_id,target_user_id,action,details) values(v_actor,p_user_id,'nickname_moderation',jsonb_build_object('reason',btrim(p_reason)));
  return jsonb_build_object('userId',p_user_id,'nickname',v_name);
end $$;
create function account_private.admin_action_history(p_limit integer,p_offset integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform account_private.require_admin();
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset<0 then raise exception 'Invalid history page' using errcode='22023'; end if;
  return jsonb_build_object('total',(select count(*) from account_private.audit_log),'actions',coalesce((select jsonb_agg(jsonb_build_object('id',id,
    'actorId',actor_id,'targetUserId',target_user_id,'action',action,'details',details,'createdAt',created_at) order by created_at desc,id)
    from(select * from account_private.audit_log order by created_at desc,id limit p_limit offset p_offset) page),'[]'::jsonb));
end $$;

-- Protected operator-only provisioning; no registration or admin browser can
-- choose its own role, and no password/hash is queried or stored here.
create function account_private.provision_administrator(p_email text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid;
begin
  if p_email is null or char_length(btrim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'Supply a verified administrator email and provisioning reason' using errcode='22023'; end if;
  if (select count(*) from auth.users where lower(email)=lower(btrim(p_email)) and email_confirmed_at is not null)<>1 then
    raise exception 'The designated email must identify exactly one confirmed account' using errcode='22023'; end if;
  select id into v_user from auth.users where lower(email)=lower(btrim(p_email)) and email_confirmed_at is not null;
  if v_user is null or not exists(select from auth.mfa_factors where user_id=v_user and status::text='verified' and factor_type::text='totp') then
    raise exception 'The account must verify its email and enroll a TOTP authenticator first' using errcode='22023'; end if;
  insert into account_private.memberships(user_id,role,status) values(v_user,'admin','active') on conflict(user_id) do update set role='admin',status='active',updated_at=clock_timestamp();
  insert into account_private.audit_log(target_user_id,action,details) values(v_user,'protected_admin_provision',jsonb_build_object('reason',btrim(p_reason)));
  return jsonb_build_object('userId',v_user,'role','admin');
end $$;

create function support_private.service_claim_support_notifications(p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid notification batch' using errcode='22023'; end if;
  update support_private.notification_outbox set status='failed',lease_until=null,lease_token=null,last_error_code='lease_exhausted'
    where status='processing' and attempts>=5 and lease_until<clock_timestamp();
  with due as(select id from support_private.notification_outbox where attempts<5 and next_attempt_at<=clock_timestamp()
    and (status='pending' or (status='processing' and lease_until<clock_timestamp())) order by next_attempt_at,id limit p_limit for update skip locked),
    claimed as(update support_private.notification_outbox o set status='processing',attempts=attempts+1,lease_until=clock_timestamp()+interval '10 minutes',lease_token=gen_random_uuid()
      from due where o.id=due.id returning o.*)
    select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'requestId',r.id,'category',r.category,'createdAt',r.created_at,'attempt',o.attempts,'leaseToken',o.lease_token)),'[]'::jsonb)
      into v_result from claimed o join support_private.account_requests r on r.id=o.request_id;
  return v_result;
end $$;
create function support_private.service_complete_support_notification(p_notification_id uuid,p_lease_token uuid,p_succeeded boolean,p_provider_id text,p_error_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row support_private.notification_outbox%rowtype;
begin
  if p_succeeded is null or char_length(coalesce(p_provider_id,''))>120 or char_length(coalesce(p_error_code,''))>120 then raise exception 'Invalid notification result' using errcode='22023'; end if;
  select * into v_row from support_private.notification_outbox where id=p_notification_id and lease_token=p_lease_token and status='processing' and lease_until>clock_timestamp() for update;
  if not found then raise exception 'Notification lease expired or not found' using errcode='22023'; end if;
  update support_private.notification_outbox set status=case when p_succeeded then 'sent' when attempts>=5 then 'failed' else 'pending' end,
    provider_id=case when p_succeeded then p_provider_id end,last_error_code=case when p_succeeded then null else coalesce(p_error_code,'delivery_failed') end,
    sent_at=case when p_succeeded then clock_timestamp() end,lease_until=null,lease_token=null,
    next_attempt_at=clock_timestamp()+make_interval(mins=>least(60,(power(2,attempts))::integer)) where id=p_notification_id returning * into v_row;
  return jsonb_build_object('id',v_row.id,'status',v_row.status,'nextAttemptAt',v_row.next_attempt_at);
end $$;
create function support_private.service_submit_guest_request(p_email text,p_category text,p_message text,p_client_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_request support_private.account_requests%rowtype;
begin
  if p_email is null or char_length(p_email)>254 or p_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or
      p_category is null or p_category not in('access','teams','contest','profile','data','general') or p_message is null or char_length(btrim(p_message)) not between 1 and 2000 or
      p_client_hash is null or p_client_hash!~'^[a-f0-9]{64}$' then raise exception 'Invalid support request' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtext(p_client_hash),145813);
  if(select count(*) from support_private.account_requests where client_hash=p_client_hash and created_at>statement_timestamp()-interval '1 hour')>=6 then
    raise exception 'Too many requests. Please try again later.' using errcode='22023'; end if;
  insert into support_private.account_requests(kind,category,message,contact_email,client_hash) values(case p_category when 'data' then 'data' else 'support' end,p_category,btrim(p_message),lower(btrim(p_email)),p_client_hash) returning * into v_request;
  return jsonb_build_object('id',v_request.id,'category',v_request.category,'status',v_request.status,'createdAt',v_request.created_at);
end $$;

-- Public API is invoker-only; privileged implementations stay in private schemas.
create function public.account_context() returns jsonb language sql stable set search_path='' as $$select account_private.account_context();$$;
create function public.save_account_profile(p_nickname text,p_public boolean,p_share_picks boolean) returns jsonb language sql set search_path='' as $$select account_private.save_account_profile(p_nickname,p_public,p_share_picks);$$;
create function public.account_has_entitlement(p_feature text) returns boolean language sql stable set search_path='' as $$select account_private.has_entitlement(p_feature);$$;
create function public.submit_support_request(p_category text,p_message text) returns jsonb language sql set search_path='' as $$select support_private.submit_support_request(p_category,p_message);$$;
create function public.admin_users(p_search text default '',p_limit integer default 50,p_offset integer default 0) returns jsonb language sql stable set search_path='' as $$select account_private.admin_users(p_search,p_limit,p_offset);$$;
create function public.admin_support_requests(p_status text default null,p_limit integer default 50,p_offset integer default 0) returns jsonb language sql stable set search_path='' as $$select account_private.admin_support_requests(p_status,p_limit,p_offset);$$;
create function public.admin_update_request(p_request_id uuid,p_status text,p_note text default '') returns jsonb language sql set search_path='' as $$select account_private.admin_update_request(p_request_id,p_status,p_note);$$;
create function public.admin_set_account_status(p_user_id uuid,p_status text,p_reason text) returns jsonb language sql set search_path='' as $$select account_private.admin_set_account_status(p_user_id,p_status,p_reason);$$;
create function public.admin_moderate_nickname(p_user_id uuid,p_nickname text,p_reason text) returns jsonb language sql set search_path='' as $$select account_private.admin_moderate_nickname(p_user_id,p_nickname,p_reason);$$;
create function public.admin_action_history(p_limit integer default 50,p_offset integer default 0) returns jsonb language sql stable set search_path='' as $$select account_private.admin_action_history(p_limit,p_offset);$$;
create function public.service_claim_support_notifications(p_limit integer default 20) returns jsonb language sql set search_path='' as $$select support_private.service_claim_support_notifications(p_limit);$$;
create function public.service_complete_support_notification(p_notification_id uuid,p_lease_token uuid,p_succeeded boolean,p_provider_id text default null,p_error_code text default null) returns jsonb language sql set search_path='' as $$select support_private.service_complete_support_notification(p_notification_id,p_lease_token,p_succeeded,p_provider_id,p_error_code);$$;
create function public.service_submit_guest_request(p_email text,p_category text,p_message text,p_client_hash text) returns jsonb language sql set search_path='' as $$select support_private.service_submit_guest_request(p_email,p_category,p_message,p_client_hash);$$;

revoke all on all functions in schema account_private from public,anon,authenticated,service_role;
revoke all on function support_private.queue_request_notification(),support_private.submit_support_request(text,text),
  support_private.service_claim_support_notifications(integer),support_private.service_complete_support_notification(uuid,uuid,boolean,text,text),support_private.service_submit_guest_request(text,text,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.account_context(),public.save_account_profile(text,boolean,boolean),public.account_has_entitlement(text),public.submit_support_request(text,text),
  public.admin_users(text,integer,integer),public.admin_support_requests(text,integer,integer),public.admin_update_request(uuid,text,text),
  public.admin_set_account_status(uuid,text,text),public.admin_moderate_nickname(uuid,text,text),public.admin_action_history(integer,integer),
  public.service_claim_support_notifications(integer),public.service_complete_support_notification(uuid,uuid,boolean,text,text),public.service_submit_guest_request(text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function account_private.account_context(),account_private.save_account_profile(text,boolean,boolean),account_private.has_entitlement(text),
  support_private.submit_support_request(text,text),account_private.admin_users(text,integer,integer),account_private.admin_support_requests(text,integer,integer),
  account_private.admin_update_request(uuid,text,text),account_private.admin_set_account_status(uuid,text,text),account_private.admin_moderate_nickname(uuid,text,text),account_private.admin_action_history(integer,integer),
  public.account_context(),public.save_account_profile(text,boolean,boolean),public.account_has_entitlement(text),public.submit_support_request(text,text),
  public.admin_users(text,integer,integer),public.admin_support_requests(text,integer,integer),public.admin_update_request(uuid,text,text),
  public.admin_set_account_status(uuid,text,text),public.admin_moderate_nickname(uuid,text,text),public.admin_action_history(integer,integer) to authenticated;
grant usage on schema support_private to service_role;
grant execute on function account_private.provision_administrator(text,text),support_private.service_claim_support_notifications(integer),support_private.service_complete_support_notification(uuid,uuid,boolean,text,text),support_private.service_submit_guest_request(text,text,text,text),
  public.service_claim_support_notifications(integer),public.service_complete_support_notification(uuid,uuid,boolean,text,text),public.service_submit_guest_request(text,text,text,text) to service_role;

-- Optional TOTP protects private account operations at the backend too. Users
-- without enrolled factors retain the existing simple single-factor flow.
create function account_private.session_authorized() returns boolean
language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_claims jsonb;v_session uuid;
begin
  if v_user is null or not exists(select from auth.users where id=v_user) then return false; end if;
  if not exists(select from auth.mfa_factors where user_id=v_user and status::text='verified' and factor_type::text='totp') then return true; end if;
  v_claims:=coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  if v_claims->>'aal' is distinct from 'aal2' or coalesce(v_claims->>'session_id','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  v_session:=(v_claims->>'session_id')::uuid;
  return exists(select from auth.sessions where id=v_session and user_id=v_user and aal::text='aal2' and(not_after is null or not_after>statement_timestamp()));
end $$;
create or replace function account_private.require_user() returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
  if not account_private.session_authorized() then raise exception 'Sign in and complete any authenticator verification to continue' using errcode='42501'; end if;
  return auth.uid();
end $$;
create function account_private.protect_owner_read() returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is not null then perform account_private.require_user(); end if;
end $$;
create or replace function public.weekly_entry(p_season integer) returns jsonb
language plpgsql stable set search_path='' as $$begin perform account_private.protect_owner_read();return weekly_private.entry(p_season);end $$;
create or replace function public.weekly_entry_with_sharing(p_season integer) returns jsonb
language plpgsql stable set search_path='' as $$begin perform account_private.protect_owner_read();return weekly_private.entry_with_sharing(p_season);end $$;
create or replace function public.cfp_my_entry(p_season integer) returns jsonb
language plpgsql stable set search_path='' as $$begin perform account_private.protect_owner_read();return cfp_private.my_entry(p_season);end $$;
create or replace function public.my_account_requests() returns jsonb
language plpgsql stable set search_path='' as $$begin perform account_private.protect_owner_read();return support_private.my_account_requests();end $$;
create or replace function account_private.has_entitlement(p_feature text) returns boolean
language sql stable security definer set search_path='' as $$
  select account_private.session_authorized() and account_private.active_user(auth.uid()) and exists(select from account_private.entitlements
    where user_id=auth.uid() and feature=p_feature and revoked_at is null and starts_at<=statement_timestamp()
      and(ends_at is null or ends_at>statement_timestamp()));
$$;
revoke all on function account_private.session_authorized(),account_private.protect_owner_read() from public,anon,authenticated,service_role;
grant execute on function account_private.session_authorized(),account_private.protect_owner_read() to authenticated;
drop policy own_team_preference on public.my_team_preferences;
create policy own_team_preference on public.my_team_preferences for all to authenticated
  using((select auth.uid())=user_id and (select account_private.session_authorized()))
  with check((select auth.uid())=user_id and (select account_private.session_authorized()));

create function account_private.reject_audit_mutation() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Administrative action history is append-only' using errcode='42501'; end $$;
revoke all on function account_private.reject_audit_mutation() from public,anon,authenticated,service_role;
create trigger account_audit_append_only before update or delete on account_private.audit_log
for each row execute function account_private.reject_audit_mutation();
