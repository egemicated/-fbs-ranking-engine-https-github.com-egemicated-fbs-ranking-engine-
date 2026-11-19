-- Compare every original field, including original pregame timestamps/choices.
set plpgsql.check_asserts=on;
do $$declare r record;actual jsonb;begin
  for r in select * from migration_test.baseline loop
    if r.name='support_private.account_requests' then
      select jsonb_agg(to_jsonb(t)-array['category','contact_email','client_hash','updated_at','admin_note'] order by (to_jsonb(t)-array['category','contact_email','client_hash','updated_at','admin_note'])::text)
        into actual from support_private.account_requests t;
    else
      execute format('select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from %s t',r.name) into actual;
    end if;
    assert actual=r.rows,'Account migration changed preexisting rows in '||r.name;
  end loop;
  assert(select role='user' and status='active' from account_private.memberships where user_id='a9000000-0000-4000-8000-000000000001');
  assert(select category='deletion' from support_private.account_requests where kind='deletion'),'Existing deletion requests retain the protected category';
  assert(select count(*)=2 from support_private.notification_outbox),'Existing pending requests each get one notification';
  assert(select count(*)=0 from account_private.entitlements),'Migration must not activate paid access';
end $$;
-- Safe cascade demonstration in this isolated DB only; no production deletion.
delete from auth.users where id='a9000000-0000-4000-8000-000000000001';
delete from weekly_private.games where season=2087;
delete from weekly_private.publications where season=2087;
delete from cfp_private.contests where season=2087;
drop schema migration_test cascade;
