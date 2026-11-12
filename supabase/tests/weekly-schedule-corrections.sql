-- Run after the weekly contest migrations in a disposable database.
begin;
set local plpgsql.check_asserts = on;
insert into auth.users(id) values ('70000000-0000-4000-8000-000000000001');

set local role service_role;
do $$
declare
  v_now timestamptz := clock_timestamp();
  v_game jsonb;
  v_games jsonb;
begin
  v_game := jsonb_build_object('week', 11, 'seasonType', 'regular',
    'home', 'A', 'away', 'B', 'homeName', 'Alpha Team', 'awayName', 'Beta Team',
    'neutral', false, 'startDate', v_now + interval '3 days',
    'modelTeam', 'A', 'homeWinProbability', .7, 'modelCapturedAt', v_now - interval '4 days');
  select jsonb_object_agg(id, v_game || jsonb_build_object('id', id, 'status', status)) into v_games
    from (values ('earlier', 'scheduled'), ('later', 'scheduled'), ('new-past', 'scheduled'),
      ('old-past', 'scheduled'), ('new-pending', 'scheduled'), ('old-pending', 'pending'),
      ('opponent', 'scheduled'), ('week', 'scheduled'), ('season-type', 'scheduled')) fixtures(id, status);
  perform public.weekly_sync(2097, v_now, (select jsonb_agg(value) from jsonb_each(v_games)));
  perform set_config('weekly_schedule_test.source', v_games::text, true);
  perform set_config('weekly_schedule_test.observed', v_now::text, true);
end;
$$;

set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000001', true);
  perform public.weekly_save_picks(2097, 'Schedule Tester',
    '{"earlier":"B","later":"B","new-past":"A","old-past":"A","new-pending":"A","opponent":"A","week":"A","season-type":"A"}', true);
end;
$$;

reset role;
-- Move one existing fixture through kickoff while retaining a genuine pregame pick.
update weekly_private.picks set captured_at = captured_at - interval '2 days', updated_at = updated_at - interval '2 days'
  where season = 2097 and game_id = 'old-past';
update weekly_private.games set kickoff = clock_timestamp() - interval '1 day'
  where season = 2097 and id = 'old-past';

set local role service_role;
do $$
declare
  v_now timestamptz := current_setting('weekly_schedule_test.observed')::timestamptz;
  v_source jsonb := current_setting('weekly_schedule_test.source')::jsonb;
  v_changes jsonb;
begin
  v_changes := jsonb_build_object(
    'earlier', jsonb_build_object('startDate', v_now + interval '2 days'),
    'later', jsonb_build_object('startDate', v_now + interval '4 days', 'modelTeam', 'B',
      'homeWinProbability', .25, 'modelCapturedAt', v_now - interval '1 hour'),
    'new-past', jsonb_build_object('startDate', v_now - interval '1 day'),
    'old-past', jsonb_build_object('startDate', v_now + interval '4 days'),
    'new-pending', jsonb_build_object('startDate', v_now + interval '4 days', 'status', 'pending'),
    'old-pending', jsonb_build_object('startDate', v_now + interval '4 days', 'status', 'scheduled'),
    'opponent', jsonb_build_object('startDate', v_now + interval '4 days', 'away', 'C', 'awayName', 'Gamma Team'),
    'week', jsonb_build_object('startDate', v_now + interval '4 days', 'week', 12),
    'season-type', jsonb_build_object('startDate', v_now + interval '4 days', 'seasonType', 'postseason'));
  assert public.weekly_sync(2097, clock_timestamp(), (
    select jsonb_agg(value || (v_changes -> key)) from jsonb_each(v_source)
  )) = '{"updated":9,"stale":false}'::jsonb;
  assert public.weekly_sync(2097, v_now, (select jsonb_agg(value) from jsonb_each(v_source)))
    = '{"updated":0,"stale":true}'::jsonb;
end;
$$;

set local role authenticated;
do $$
declare
  v_now timestamptz := current_setting('weekly_schedule_test.observed')::timestamptz;
  v_games jsonb := public.weekly_contest(2097) -> 'games';
  v_earlier jsonb;
  v_later jsonb;
begin
  select g into v_earlier from jsonb_array_elements(v_games) g where g ->> 'id' = 'earlier';
  select g into v_later from jsonb_array_elements(v_games) g where g ->> 'id' = 'later';
  assert (v_earlier ->> 'startDate')::timestamptz = v_now + interval '2 days'
    and v_earlier -> 'locked' = 'false'::jsonb and v_earlier -> 'eligible' = 'true'::jsonb;
  assert (v_later ->> 'startDate')::timestamptz = v_now + interval '4 days'
    and v_later -> 'locked' = 'false'::jsonb and v_later -> 'eligible' = 'true'::jsonb;
  assert v_later ->> 'modelTeam' = 'A' and v_later -> 'homeWinProbability' = '0.7'::jsonb
    and (v_later ->> 'modelCapturedAt')::timestamptz = v_now - interval '4 days',
    'a pregame correction keeps the original forecast even when the source sends new odds';
  assert (select count(*) from jsonb_array_elements(v_games) g
    where g ->> 'voidReason' = 'Matchup or kickoff changed after picks were saved' and g -> 'locked' = 'true'::jsonb) = 7,
    'moves across kickoff, pending status, changed opponents, weeks and season types remain voided';
  assert public.weekly_entry(2097) -> 'picks' ->> 'earlier' = 'B'
    and public.weekly_entry(2097) -> 'picks' ->> 'later' = 'B';
  assert public.weekly_leaderboard(2097, 'regular', 11) -> 'me' -> 'picked' = '2'::jsonb;
  perform public.weekly_save_picks(2097, 'Schedule Tester', '{"earlier":"A","later":"A"}', true);
  assert public.weekly_entry(2097) -> 'picks' ->> 'earlier' = 'A'
    and public.weekly_entry(2097) -> 'picks' ->> 'later' = 'A', 'picks can still be edited before the corrected kickoff';
end;
$$;
rollback;
