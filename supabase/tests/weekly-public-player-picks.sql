-- Run after the weekly contest migrations. Fixtures are rolled back.
begin;
set local plpgsql.check_asserts = on;
insert into auth.users(id) values
  ('20000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002');

set local role service_role;
do $$
declare
  v_now timestamptz := clock_timestamp();
  v_game jsonb;
begin
  v_game := jsonb_build_object('id', 'first', 'week', 11, 'seasonType', 'regular',
    'home', 'A', 'away', 'B', 'homeName', 'Alpha Team', 'awayName', 'Beta Team',
    'neutral', false, 'startDate', v_now + interval '2 days', 'status', 'scheduled',
    'modelTeam', 'A', 'homeWinProbability', .7, 'modelCapturedAt', v_now - interval '2 hours');
  perform public.weekly_sync(2099, v_now, jsonb_build_array(v_game,
    v_game || jsonb_build_object('id', 'later', 'startDate', v_now + interval '2 days'),
    v_game || jsonb_build_object('id', 'next-week', 'week', 12, 'startDate', v_now + interval '3 days'),
    v_game || jsonb_build_object('id', 'voided', 'startDate', v_now + interval '4 days'),
    v_game || jsonb_build_object('id', 'bowl', 'seasonType', 'postseason', 'startDate', v_now + interval '5 days')));
end;
$$;

reset role;
-- Keep this legacy sharing fixture on its original kickoff deadline.
update weekly_private.deadlines set lock_at = null where season = 2099;

set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
  perform public.weekly_save_picks(2099, 'First Player', '{"first":"B","later":"A","next-week":"A","voided":"B","bowl":"B"}', true);
  assert public.weekly_entry_with_sharing(2099) -> 'sharePicks' = 'false'::jsonb, 'legacy player sharing defaults off';
  assert not (public.weekly_leaderboard(2099) -> 'rows' -> 0 ? 'publicPickId'), 'leaderboard consent alone creates no public link';
  assert not (public.weekly_entry(2099) ? 'sharePicks'), 'legacy entry response is unchanged';
  perform set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
  assert public.weekly_entry_with_sharing(2099) -> 'picks' = '{}'::jsonb;
  perform public.weekly_save_picks_with_sharing(2099, 'Second Player', '{"first":"A"}', false, true);
  assert not (public.weekly_leaderboard(2099) -> 'me' ? 'publicPickId'), 'sharing alone does not publish a private player';
end;
$$;

reset role;
do $$
begin
  perform set_config('weekly_share.first_id', (select public_pick_id::text from weekly_private.players
    where user_id = '20000000-0000-4000-8000-000000000001'), true);
  perform set_config('weekly_share.second_id', (select public_pick_id::text from weekly_private.players
    where user_id = '20000000-0000-4000-8000-000000000002'), true);
end;
$$;

set local role anon;
do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  assert not has_function_privilege('public.weekly_entry_with_sharing(integer)', 'execute');
  assert not has_function_privilege('public.weekly_save_picks_with_sharing(integer,text,jsonb,boolean,boolean)', 'execute');
  assert not has_table_privilege('weekly_private.players', 'select');
  assert public.weekly_player_picks(2099, current_setting('weekly_share.first_id')::uuid) is null, 'direct URL requires sharing consent';
  assert public.weekly_player_picks(2099, current_setting('weekly_share.second_id')::uuid) is null, 'direct URL requires public leaderboard consent';
end;
$$;

set local role authenticated;
do $$
declare v_entry jsonb;
begin
  perform set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
  v_entry := public.weekly_save_picks_with_sharing(2099, 'First Player', '{}', true, true);
  assert v_entry -> 'sharePicks' = 'true'::jsonb and
    (select count(*) from jsonb_object_keys(v_entry -> 'picks')) = 5;
  perform public.weekly_save_picks(2099, 'First Player', '{"later":"B"}', true);
  assert public.weekly_entry_with_sharing(2099) -> 'sharePicks' = 'true'::jsonb, 'older client preserves existing sharing';
  begin
    perform public.weekly_save_picks_with_sharing(2099, 'Changed Name', '{"later":"not-a-team"}', false, false);
    raise exception 'invalid pick was accepted';
  exception when invalid_parameter_value then null;
  end;
  assert public.weekly_entry_with_sharing(2099) ->> 'nickname' = 'First Player';
  assert public.weekly_entry_with_sharing(2099) -> 'sharePicks' = 'true'::jsonb, 'invalid batch rolls back consent changes';
end;
$$;

set local role anon;
do $$
declare
  v_id uuid := current_setting('weekly_share.first_id')::uuid;
  v_public jsonb;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  assert v_id <> '20000000-0000-4000-8000-000000000001'::uuid and v_id <> current_setting('weekly_share.second_id')::uuid;
  assert public.weekly_leaderboard(2099) -> 'rows' -> 0 ->> 'publicPickId' = v_id::text;
  v_public := public.weekly_player_picks(2099, v_id, 'regular', 11);
  assert v_public = '{"nickname":"First Player","picks":[]}'::jsonb, 'before kickoff, no picked winner is public';
  assert public.weekly_player_picks(2099, '20000000-0000-4000-8000-000000000001') is null, 'account ID cannot retrieve public picks';
end;
$$;

reset role;
-- Move selected fixtures through kickoff while keeping genuine pregame saves.
update weekly_private.picks set captured_at = captured_at - interval '10 days', updated_at = updated_at - interval '10 days'
  where season = 2099 and game_id <> 'later';
update weekly_private.games set kickoff = kickoff - interval '10 days', model_captured_at = model_captured_at - interval '10 days'
  where season = 2099 and id <> 'later';
update weekly_private.games set status = 'final', home_points = 14, away_points = 21, winner_id = 'B'
  where season = 2099 and id = 'first';
update weekly_private.games set void_reason = 'Game changed' where season = 2099 and id = 'voided';

set local role anon;
do $$
declare
  v_id uuid := current_setting('weekly_share.first_id')::uuid;
  v_scope jsonb;
  v_pick jsonb;
begin
  v_scope := public.weekly_player_picks(2099, v_id, 'regular', 11);
  assert jsonb_array_length(v_scope -> 'picks') = 1, 'future and voided games stay out of a mixed week';
  v_pick := v_scope -> 'picks' -> 0;
  assert v_pick ->> 'gameId' = 'first' and v_pick ->> 'teamId' = 'B' and v_pick ->> 'modelTeam' = 'A' and
    v_pick ->> 'homeName' = 'Alpha Team' and v_pick ->> 'awayName' = 'Beta Team' and v_pick ->> 'winner' = 'B' and
    v_pick -> 'awayPoints' = '21'::jsonb;
  assert not (v_pick ?| array['userId','email','capturedAt','updatedAt']), 'public response omits identity and pick timestamps';
  assert public.weekly_player_picks(2099, v_id, 'regular', 12) -> 'picks' -> 0 ->> 'gameId' = 'next-week';
  assert public.weekly_player_picks(2099, v_id, 'postseason', 11) -> 'picks' -> 0 ->> 'gameId' = 'bowl';
  assert jsonb_array_length(public.weekly_player_picks(2099, v_id) -> 'picks') = 3;
  assert public.weekly_player_picks(2098, v_id) -> 'picks' = '[]'::jsonb;
end;
$$;

set local role authenticated;
do $$
declare v_id uuid := current_setting('weekly_share.first_id')::uuid;
begin
  perform set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
  perform public.weekly_save_picks_with_sharing(2099, 'First Player', '{}', true, false);
  assert public.weekly_player_picks(2099, v_id) is null, 'turning off sharing immediately revokes an existing link';
  assert not (public.weekly_leaderboard(2099) -> 'rows' -> 0 ? 'publicPickId');
  assert public.weekly_entry_with_sharing(2099) -> 'picks' ->> 'first' = 'B', 'revocation preserves private picks';
  perform public.weekly_save_picks_with_sharing(2099, 'First Player', '{}', true, true);
  perform public.weekly_save_picks(2099, 'First Player', '{}');
  assert public.weekly_player_picks(2099, v_id) is null, 'removing leaderboard consent immediately revokes the link too';
  assert public.weekly_entry_with_sharing(2099) -> 'sharePicks' = 'true'::jsonb, 'legacy default argument leaves the new preference intact';
  assert public.weekly_leaderboard(2099) -> 'rows' = '[]'::jsonb;
end;
$$;

rollback;
