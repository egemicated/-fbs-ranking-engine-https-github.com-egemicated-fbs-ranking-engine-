-- Public participant selections are released separately at each confirmed kickoff.
-- Owner entries, pregame forecasts, and existing picks keep their original data.
create or replace function weekly_private.player_picks(p_season integer, p_public_pick_id uuid, p_season_type text, p_week integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nickname', player.nickname, 'picks', coalesce((
    select jsonb_agg(jsonb_build_object('gameId', g.id, 'teamId', p.team_id, 'week', g.week, 'seasonType', g.season_type,
      'home', g.home_id, 'away', g.away_id, 'homeName', g.home_name, 'awayName', g.away_name,
      'startDate', g.kickoff, 'modelTeam', g.model_team_id, 'status', g.status,
      'homePoints', g.home_points, 'awayPoints', g.away_points, 'winner', g.winner_id) order by g.kickoff, g.id)
    from weekly_private.picks p join weekly_private.games g on (g.season, g.id) = (p.season, p.game_id)
    where p.user_id = player.user_id and p.season = p_season and not g.start_time_tbd
      and g.kickoff <= statement_timestamp()
      and p.updated_at < g.kickoff and g.model_team_id is not null and g.void_reason is null
      and (p_season_type is null or g.season_type = p_season_type) and (p_week is null or g.week = p_week)
  ), '[]'::jsonb))
  from weekly_private.players player
  where player.public_pick_id = p_public_pick_id and player.public_leaderboard and player.share_picks;
$$;

create or replace function weekly_private.entry_with_sharing(p_season integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select weekly_private.entry(p_season) || coalesce((
    select jsonb_build_object('sharePicks', share_picks, 'sharePicksImmediately', false)
    from weekly_private.players where user_id = (select auth.uid())
  ), '{"sharePicks":false,"sharePicksImmediately":false}'::jsonb);
$$;

create or replace function weekly_private.save_picks_with_sharing(
  p_season integer, p_nickname text, p_picks jsonb, p_public boolean, p_share_picks boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform weekly_private.save_picks(p_season, p_nickname, p_picks, p_public);
  update weekly_private.players set share_picks = coalesce(p_public and p_share_picks, false),
    share_picks_immediately = false where user_id = (select auth.uid());
  return weekly_private.entry_with_sharing(p_season);
end;
$$;

-- Preserve the earlier client RPC while applying the same kickoff privacy rule.
create or replace function weekly_private.save_picks_with_immediate_sharing(
  p_season integer, p_nickname text, p_picks jsonb, p_public boolean, p_share_picks boolean
)
returns jsonb language sql security definer set search_path = '' as $$
  select weekly_private.save_picks_with_sharing(p_season, p_nickname, p_picks, p_public, p_share_picks);
$$;

alter table public.my_team_preferences add column team_ids text[] not null default '{}';
update public.my_team_preferences set team_ids = array[team_id];

create function public.synchronize_my_team_preferences()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if cardinality(new.team_ids) = 0 then new.team_ids := array[new.team_id]; end if;
  elsif new.team_ids is not distinct from old.team_ids and new.team_id is distinct from old.team_id then
    new.team_ids := array_prepend(new.team_id, array_remove(old.team_ids, new.team_id));
  end if;
  if cardinality(new.team_ids) not between 1 and 20 or array_ndims(new.team_ids) is distinct from 1
      or exists (select 1 from unnest(new.team_ids) value where value is null or value !~ '^[0-9]{1,32}$')
      or (select count(distinct value) from unnest(new.team_ids) value) <> cardinality(new.team_ids) then
    raise exception 'Choose up to 20 different teams' using errcode = '22023';
  end if;
  new.team_id := new.team_ids[1];
  if tg_op = 'UPDATE' and new.team_id is distinct from old.team_id then new.seen_updates := null; end if;
  return new;
end;
$$;
revoke all on function public.synchronize_my_team_preferences() from public, anon, authenticated, service_role;
drop trigger reset_my_team_seen_updates on public.my_team_preferences;
create trigger synchronize_my_team_preferences before insert or update on public.my_team_preferences
for each row execute function public.synchronize_my_team_preferences();

create schema support_private;
revoke all on schema support_private from public, anon, authenticated, service_role;
grant usage on schema support_private to authenticated;
create table support_private.account_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('support', 'data', 'deletion')),
  message text not null check (char_length(message) between 1 and 2000),
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  created_at timestamptz not null default clock_timestamp()
);
create unique index one_pending_account_request on support_private.account_requests(user_id, kind) where status = 'pending';
alter table support_private.account_requests enable row level security;
revoke all on table support_private.account_requests from public, anon, authenticated, service_role;

create function support_private.submit_account_request(p_kind text, p_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_request support_private.account_requests%rowtype;
begin
  if v_user is null then raise exception 'Sign in to send an account request' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('support', 'data', 'deletion') or p_message is null
      or char_length(btrim(p_message)) not between 1 and 2000 then
    raise exception 'Choose a request type and enter a message of up to 2000 characters' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext(v_user::text), hashtext(p_kind));
  select * into v_request from support_private.account_requests where user_id = v_user and kind = p_kind and status = 'pending';
  if not found then
    insert into support_private.account_requests(user_id, kind, message) values (v_user, p_kind, btrim(p_message)) returning * into v_request;
  end if;
  return jsonb_build_object('id',v_request.id,'kind',v_request.kind,'status',v_request.status,'createdAt',v_request.created_at);
end;
$$;
create function support_private.my_account_requests()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'status', status, 'createdAt', created_at)
    order by created_at desc), '[]'::jsonb)
  from (select * from support_private.account_requests where user_id = (select auth.uid()) order by created_at desc limit 20) requests;
$$;
create function public.submit_account_request(p_kind text, p_message text)
returns jsonb language sql set search_path = '' as $$
  select support_private.submit_account_request(p_kind, p_message);
$$;
create function public.my_account_requests()
returns jsonb language sql stable set search_path = '' as $$
  select support_private.my_account_requests();
$$;
revoke all on function support_private.submit_account_request(text,text), support_private.my_account_requests(),
  public.submit_account_request(text,text), public.my_account_requests() from public, anon, authenticated, service_role;
grant execute on function support_private.submit_account_request(text,text), support_private.my_account_requests(),
  public.submit_account_request(text,text), public.my_account_requests() to authenticated;
