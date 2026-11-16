alter table public.my_team_preferences
  add column seen_updates jsonb,
  add constraint my_team_seen_updates_shape check (
    seen_updates is null or (
      jsonb_typeof(seen_updates) = 'object'
      and coalesce(seen_updates ->> 'revision' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$', false)
      and seen_updates ->> 'teamId' is not distinct from team_id
      and octet_length(seen_updates::text) <= 24576
    )
  );

create function public.reset_my_team_seen_updates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.team_id is distinct from old.team_id then
    new.seen_updates := null;
  end if;
  return new;
end;
$$;

revoke all on function public.reset_my_team_seen_updates() from public, anon, authenticated, service_role;

create trigger reset_my_team_seen_updates
before update of team_id on public.my_team_preferences
for each row execute function public.reset_my_team_seen_updates();
