-- Run with psql -v ON_ERROR_STOP=1 against a disposable database with the
-- migration installed. All fixtures, including auth accounts, roll back.
begin;
set local plpgsql.check_asserts = on;
set local timezone = 'UTC';

insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003');

do $$
declare
  v_kickoff timestamptz := clock_timestamp() + interval '1 day';
  v_slots jsonb;
begin
  select jsonb_agg(jsonb_build_object('id', id, 'round', round, 'home', home, 'away', away,
    'homeFrom', home_from, 'awayFrom', away_from, 'kickoff', v_kickoff + (ordinal - 1) * interval '1 hour')
    order by ordinal) into v_slots
  from (values
    (1, 'r1-1', 1, 'Team 1', 'Team 2', null, null),
    (2, 'r1-2', 1, 'Team 3', 'Team 4', null, null),
    (3, 'r1-3', 1, 'Team 5', 'Team 6', null, null),
    (4, 'r1-4', 1, 'Team 7', 'Team 8', null, null),
    (5, 'qf-1', 2, 'Team 9', null, null, 'r1-1'),
    (6, 'qf-2', 2, 'Team 10', null, null, 'r1-2'),
    (7, 'qf-3', 2, 'Team 11', null, null, 'r1-3'),
    (8, 'qf-4', 2, 'Team 12', null, null, 'r1-4'),
    (9, 'sf-1', 3, null, null, 'qf-1', 'qf-2'),
    (10, 'sf-2', 3, null, null, 'qf-3', 'qf-4'),
    (11, 'final', 4, null, null, 'sf-1', 'sf-2')
  ) as slot(ordinal, id, round, home, away, home_from, away_from);
  perform set_config('cfp_test.bracket', jsonb_build_object('lockAt', v_kickoff, 'slots', v_slots)::text, true);
  perform set_config('cfp_test.home', '{"r1-1":"Team 1","r1-2":"Team 3","r1-3":"Team 5","r1-4":"Team 7",
    "qf-1":"Team 9","qf-2":"Team 10","qf-3":"Team 11","qf-4":"Team 12",
    "sf-1":"Team 9","sf-2":"Team 11","final":"Team 9"}', true);
  perform set_config('cfp_test.away', '{"r1-1":"Team 2","r1-2":"Team 4","r1-3":"Team 6","r1-4":"Team 8",
    "qf-1":"Team 2","qf-2":"Team 4","qf-3":"Team 6","qf-4":"Team 8",
    "sf-1":"Team 4","sf-2":"Team 8","final":"Team 8"}', true);
end;
$$;

set local role anon;
do $$
begin
  assert public.cfp_contest(2099) is null, 'contest is empty before publication';
  assert public.cfp_leaderboard(2099) = '[]'::jsonb, 'empty leaderboard';
  assert not has_function_privilege('public.cfp_my_entry(integer)', 'execute'), 'anon cannot read entries';
  assert not has_function_privilege('public.cfp_save_entry(integer,text,jsonb)', 'execute'), 'anon cannot save entries';
  assert not has_function_privilege('public.cfp_sync(integer,jsonb,jsonb,timestamptz)', 'execute'), 'anon cannot sync results';
  assert not has_table_privilege('cfp_private.entries', 'select'), 'anon cannot read private table';
end;
$$;

set local role service_role;
do $$
declare
  v_bracket jsonb := current_setting('cfp_test.bracket')::jsonb;
begin
  perform public.cfp_sync(2099, v_bracket, '{}'::jsonb);
  perform public.cfp_sync(2099, v_bracket, '{}'::jsonb);
  begin
    perform public.cfp_sync(2099, jsonb_set(v_bracket, '{slots,4,awayFrom}', '"r1-4"'), '{}'::jsonb);
    raise exception 'reused feeder accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

set local role authenticated;
do $$
declare
  v_home jsonb := current_setting('cfp_test.home')::jsonb;
begin
  assert not has_function_privilege('public.cfp_sync(integer,jsonb,jsonb,timestamptz)', 'execute'), 'player cannot sync results';
  assert not has_table_privilege('cfp_private.entries', 'select, insert, update'), 'player cannot access raw entries';
  assert jsonb_array_length(public.cfp_contest(2099) -> 'slots') = 11, 'official field is public';
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
  assert public.cfp_my_entry(2099) is null, 'first account starts without an entry';
  begin
    perform public.cfp_save_entry(2099, 'First', v_home - 'final');
    raise exception 'incomplete entry accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.cfp_save_entry(2099, 'First', jsonb_set(v_home, '{final}', '"Team 12"'));
    raise exception 'impossible winner accepted';
  exception when invalid_parameter_value then null;
  end;
  perform public.cfp_save_entry(2099, '  First  ', v_home);
  perform public.cfp_save_entry(2099, 'Updated', v_home);
  assert public.cfp_my_entry(2099) = jsonb_build_object('nickname', 'Updated', 'picks', v_home), 'one editable entry per account';
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
  assert public.cfp_my_entry(2099) is null, 'second account cannot see first account entry';
  perform public.cfp_save_entry(2099, 'Second', v_home);
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
  perform public.cfp_save_entry(2099, 'Third', current_setting('cfp_test.away')::jsonb);
  assert public.cfp_leaderboard(2099) = '[]'::jsonb, 'standings are private before lock';
end;
$$;

set local role service_role;
do $$
begin
  begin
    perform public.cfp_sync(2099, jsonb_set(current_setting('cfp_test.bracket')::jsonb, '{slots,0,home}', '"Replacement"'), '{}'::jsonb);
    raise exception 'bracket changed after entries exist';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.cfp_sync(2099, null, '{"r1-1":{"winner":"Team 1","homePoints":21,"awayPoints":14}}', clock_timestamp());
    raise exception 'result before kickoff accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

-- Move the test fixture through kickoff without waiting for the clock. Normal
-- readers and writers cannot perform this direct update on the private table.
reset role;
update cfp_private.contests c set lock_at = lock_at - interval '10 days', slots = (
  select jsonb_agg(jsonb_set(s.slot, '{kickoff}', to_jsonb((s.slot ->> 'kickoff')::timestamptz - interval '10 days'))
    order by s.ordinal)
  from jsonb_array_elements(c.slots) with ordinality s(slot, ordinal)
) where season = 2099;

set local role authenticated;
do $$
begin
  begin
    perform public.cfp_save_entry(2099, 'Late', current_setting('cfp_test.home')::jsonb);
    raise exception 'late entry accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

set local role service_role;
do $$
declare
  v_results jsonb;
  v_observed_at timestamptz := clock_timestamp() - interval '1 hour';
begin
  select jsonb_object_agg(key, jsonb_build_object('winner', value, 'homePoints', 21, 'awayPoints', 14))
    into v_results from jsonb_each_text(current_setting('cfp_test.home')::jsonb);
  begin
    perform public.cfp_sync(2099, null, v_results);
    raise exception 'results missing their source observation time accepted';
  exception when invalid_parameter_value then null;
  end;
  perform public.cfp_sync(2099, null, v_results, v_observed_at);
  perform public.cfp_sync(2099, null, v_results, v_observed_at);
  begin
    perform public.cfp_sync(2099, null, '{"r1-1":{"winner":"Team 2","homePoints":14,"awayPoints":21}}', v_observed_at + interval '1 minute');
    raise exception 'feeder correction omitted an affected result';
  exception when invalid_parameter_value then null;
  end;
  perform public.cfp_sync(2099, null, '{"r1-1":{"winner":"Team 2","homePoints":14,"awayPoints":21},
    "qf-1":{"winner":"Team 9","homePoints":21,"awayPoints":14}}', v_observed_at + interval '2 minutes');
  -- The leaderboard assertions below confirm this older capture does not undo the correction.
  perform public.cfp_sync(2099, null, v_results, v_observed_at + interval '1 minute');
  begin
    perform public.cfp_sync(2099, null, '{"qf-1":{"winner":"Team 9","homePoints":14,"awayPoints":21}}', v_observed_at + interval '3 minutes');
    raise exception 'score and winner mismatch accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

set local role authenticated;
do $$
declare
  v_board jsonb;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
  v_board := public.cfp_leaderboard(2099);
  assert v_board = '[{"rank":1,"nickname":"Second","points":27,"correct":10,"isYou":true},
    {"rank":1,"nickname":"Updated","points":27,"correct":10,"isYou":false},
    {"rank":3,"nickname":"Third","points":1,"correct":1,"isYou":false}]'::jsonb,
    'rank, points, ties, correction, and private leaderboard projection';
  assert (public.cfp_contest(2099) -> 'results' -> 'final' ->> 'winner') = 'Team 9', 'partial sync retained earlier results';
end;
$$;

set local role anon;
do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  assert public.cfp_leaderboard(2099) -> 0 -> 'isYou' = 'false'::jsonb, 'public viewers see no account IDs';
end;
$$;

rollback;
