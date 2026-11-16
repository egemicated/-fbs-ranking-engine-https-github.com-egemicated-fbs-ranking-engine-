begin;
set local plpgsql.check_asserts = on;
insert into auth.users (id) values
  ('60000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', true);
do $$
begin
  insert into public.my_team_preferences (user_id, team_id)
  values ('60000000-0000-4000-8000-000000000001', '252');
  update public.my_team_preferences
  set seen_updates = '{"revision":"60000000-0000-4000-8000-000000000003","teamId":"252","season":2026}'
  where team_id = '252' and seen_updates is null;
  assert found;
  assert (select seen_updates ->> 'season' from public.my_team_preferences) = '2026';
  update public.my_team_preferences
  set seen_updates = null
  where seen_updates ->> 'revision' = '60000000-0000-4000-8000-000000000004';
  assert not found;
  begin
    update public.my_team_preferences set seen_updates = '{"revision":"60000000-0000-4000-8000-000000000003","teamId":"26"}';
    raise exception 'Mismatched favorite accepted';
  exception when check_violation then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000002', true);
do $$
begin
  assert not exists (select seen_updates from public.my_team_preferences);
  update public.my_team_preferences set seen_updates = null where team_id = '252';
  assert not found;
end;
$$;

select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', true);
do $$
begin
  update public.my_team_preferences set team_id = '26' where team_id = '252';
  assert found;
  assert (select seen_updates is null from public.my_team_preferences where team_id = '26');
end;
$$;
rollback;
