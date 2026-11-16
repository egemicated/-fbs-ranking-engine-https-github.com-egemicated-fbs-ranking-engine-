create table public.my_team_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  team_id text not null check (team_id ~ '^[0-9]{1,32}$')
);

alter table public.my_team_preferences enable row level security;
revoke all on table public.my_team_preferences from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.my_team_preferences to authenticated;

create policy own_team_preference on public.my_team_preferences
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
