-- Run in an isolated Supabase-shaped Postgres database with ON_ERROR_STOP.
begin;
set local plpgsql.check_asserts = on;
insert into auth.users (id) values
  ('50000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000002');

set local role anon;
do $$
begin
  assert not has_table_privilege('public.my_team_preferences', 'select');
  assert not has_table_privilege('public.my_team_preferences', 'insert');
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000001', true);
do $$
begin
  assert not exists (select 1 from public.my_team_preferences);
  insert into public.my_team_preferences (user_id, team_id) values ('50000000-0000-4000-8000-000000000001', '254');
  insert into public.my_team_preferences (user_id, team_id) values ('50000000-0000-4000-8000-000000000001', '26')
    on conflict (user_id) do update set team_id = excluded.team_id;
  assert (select count(*) from public.my_team_preferences) = 1;
  assert (select team_id from public.my_team_preferences) = '26';
  begin
    insert into public.my_team_preferences (user_id, team_id)
      values ('50000000-0000-4000-8000-000000000002', '2390');
    raise exception 'A user can insert another user’s team';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.my_team_preferences set user_id = '50000000-0000-4000-8000-000000000002';
    raise exception 'A user can transfer the team preference';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.my_team_preferences set team_id = 'not-a-team-id';
    raise exception 'An invalid team identifier was accepted';
  exception when check_violation then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '50000000-0000-4000-8000-000000000002', true);
do $$
begin
  assert not exists (select 1 from public.my_team_preferences);
  update public.my_team_preferences set team_id = '333' where user_id = '50000000-0000-4000-8000-000000000001';
  assert not found;
  delete from public.my_team_preferences where user_id = '50000000-0000-4000-8000-000000000001';
  assert not found;
  insert into public.my_team_preferences (user_id, team_id) values ('50000000-0000-4000-8000-000000000002', '333');
  assert (select team_id from public.my_team_preferences) = '333';
  delete from public.my_team_preferences where user_id = '50000000-0000-4000-8000-000000000002';
  assert found and not exists (select 1 from public.my_team_preferences);
end;
$$;

reset role;
do $$
begin
  assert (select team_id from public.my_team_preferences) = '26';
  delete from auth.users where id = '50000000-0000-4000-8000-000000000001';
  assert not exists (select 1 from public.my_team_preferences);
end;
$$;
rollback;
