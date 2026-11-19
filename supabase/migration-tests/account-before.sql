-- Disposable baseline loaded BEFORE the account migration in a random local DB.
set plpgsql.check_asserts=on;
insert into auth.users(id,email,email_confirmed_at) values('a9000000-0000-4000-8000-000000000001','migration@example.invalid',clock_timestamp());
insert into cfp_private.contests(season,lock_at,slots) values(2087,clock_timestamp()+interval '1 day','[]');
insert into cfp_private.entries(season,user_id,nickname,picks) values(2087,'a9000000-0000-4000-8000-000000000001','Historical Nickname','{"final":"original"}');
insert into weekly_private.publications(season,observed_at) values(2087,clock_timestamp());
insert into weekly_private.games(season,id,week,season_type,home_id,away_id,home_name,away_name,neutral,kickoff,status,model_team_id,model_captured_at,home_probability,start_time_tbd)
values(2087,'migrating',1,'regular','h','a','Home','Away',false,clock_timestamp()+interval '1 day','scheduled','h',clock_timestamp()-interval '3 days',.7,false);
insert into weekly_private.players(user_id,nickname,public_leaderboard,share_picks) values('a9000000-0000-4000-8000-000000000001','Historical Nickname',true,true);
insert into weekly_private.picks(season,game_id,user_id,team_id,captured_at,updated_at) values(2087,'migrating','a9000000-0000-4000-8000-000000000001','a',clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days');
update weekly_private.games set kickoff=clock_timestamp()-interval '1 day',status='final',home_points=10,away_points=17,winner_id='a' where season=2087;
update cfp_private.contests set lock_at=clock_timestamp()-interval '1 day' where season=2087;
insert into public.my_team_preferences(user_id,team_id,team_ids) values('a9000000-0000-4000-8000-000000000001','252',array['252','254']);
insert into support_private.account_requests(user_id,kind,message) values('a9000000-0000-4000-8000-000000000001','support','Disposable pre-migration request');
insert into support_private.account_requests(user_id,kind,message) values('a9000000-0000-4000-8000-000000000001','deletion','Disposable pre-migration deletion request');
create schema migration_test;
create table migration_test.baseline(name text primary key,rows jsonb not null);
insert into migration_test.baseline(name,rows)
select 'auth.users',jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from auth.users t union all
select 'cfp_private.contests',jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from cfp_private.contests t union all
select 'cfp_private.entries',jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from cfp_private.entries t union all
select 'weekly_private.publications',jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from weekly_private.publications t union all
select 'weekly_private.games',jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from weekly_private.games t union all
select 'weekly_private.players',jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from weekly_private.players t union all
select 'weekly_private.picks',jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from weekly_private.picks t union all
select 'public.my_team_preferences',jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.my_team_preferences t union all
select 'support_private.account_requests',jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from support_private.account_requests t;
