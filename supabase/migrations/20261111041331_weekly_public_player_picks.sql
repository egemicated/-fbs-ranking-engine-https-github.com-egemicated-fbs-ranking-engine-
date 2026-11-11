alter table weekly_private.players
  add column share_picks boolean not null default false,
  add column public_pick_id uuid not null default gen_random_uuid(),
  add constraint weekly_players_public_pick_id_key unique (public_pick_id);

create function weekly_private.entry_with_sharing(p_season integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select weekly_private.entry(p_season) || jsonb_build_object('sharePicks', coalesce((
    select share_picks from weekly_private.players where user_id = (select auth.uid())
  ), false));
$$;

create function weekly_private.save_picks_with_sharing(
  p_season integer, p_nickname text, p_picks jsonb, p_public boolean, p_share_picks boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform weekly_private.save_picks(p_season, p_nickname, p_picks, p_public);
  update weekly_private.players set share_picks = coalesce(p_share_picks, false)
    where user_id = (select auth.uid());
  return weekly_private.entry_with_sharing(p_season);
end;
$$;

create or replace function weekly_private.leaderboard(p_season integer, p_season_type text, p_week integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  with games as (
    select * from weekly_private.games where season = p_season and model_team_id is not null and void_reason is null
      and (p_season_type is null or season_type = p_season_type) and (p_week is null or week = p_week)
  ), scores as (
    select p.user_id, count(*) as picked,
      count(*) filter (where g.winner_id is not null) as graded,
      count(*) filter (where p.team_id = g.winner_id) as correct,
      count(*) filter (where g.winner_id is not null and g.model_team_id = g.winner_id) as model_correct
    from weekly_private.picks p join games g on (g.season, g.id) = (p.season, p.game_id)
    where p.updated_at < g.kickoff group by p.user_id
  ), public_scores as (
    select s.*, player.nickname, rank() over (order by s.correct desc) as rank,
      case when player.share_picks then player.public_pick_id end as public_pick_id
    from scores s join weekly_private.players player using (user_id)
    where player.public_leaderboard
  ), visible as (
    select * from public_scores order by rank, nickname, user_id limit 100
  ), my_score as (
    select s.*, player.nickname, public.rank, public.public_pick_id from scores s
    join weekly_private.players player using (user_id)
    left join public_scores public using (user_id)
    where s.user_id = (select auth.uid())
  )
  select jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object(
      'rank', rank, 'nickname', nickname, 'points', correct, 'correct', correct, 'graded', graded,
      'picked', picked, 'modelCorrect', model_correct, 'compared', graded, 'beatModel', correct > model_correct,
      'isYou', coalesce(user_id = (select auth.uid()), false)) ||
      case when public_pick_id is not null then jsonb_build_object('publicPickId', public_pick_id) else '{}'::jsonb end
      order by rank, nickname, user_id) from visible), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', rank, 'nickname', nickname, 'points', correct, 'correct', correct,
      'graded', graded, 'picked', picked, 'modelCorrect', model_correct, 'compared', graded,
      'beatModel', correct > model_correct, 'isYou', true) ||
      case when public_pick_id is not null then jsonb_build_object('publicPickId', public_pick_id) else '{}'::jsonb end from my_score),
    'model', (select jsonb_build_object('correct', count(*) filter (where model_team_id = winner_id),
      'graded', count(*) filter (where winner_id is not null)) from games));
$$;

create function weekly_private.player_picks(p_season integer, p_public_pick_id uuid, p_season_type text, p_week integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nickname', player.nickname, 'picks', coalesce((
    select jsonb_agg(jsonb_build_object('gameId', g.id, 'teamId', p.team_id, 'week', g.week, 'seasonType', g.season_type,
      'home', g.home_id, 'away', g.away_id, 'homeName', g.home_name, 'awayName', g.away_name,
      'startDate', g.kickoff, 'modelTeam', g.model_team_id, 'status', g.status,
      'homePoints', g.home_points, 'awayPoints', g.away_points, 'winner', g.winner_id) order by g.kickoff, g.id)
    from weekly_private.picks p join weekly_private.games g on (g.season, g.id) = (p.season, p.game_id)
    where p.user_id = player.user_id and p.season = p_season and g.kickoff <= statement_timestamp()
      and p.updated_at < g.kickoff and g.model_team_id is not null and g.void_reason is null
      and (p_season_type is null or g.season_type = p_season_type) and (p_week is null or g.week = p_week)
  ), '[]'::jsonb))
  from weekly_private.players player
  where player.public_pick_id = p_public_pick_id and player.public_leaderboard and player.share_picks;
$$;

create function public.weekly_entry_with_sharing(p_season integer)
returns jsonb language sql stable set search_path = '' as $$
  select weekly_private.entry_with_sharing(p_season);
$$;
create function public.weekly_save_picks_with_sharing(
  p_season integer, p_nickname text, p_picks jsonb, p_public boolean, p_share_picks boolean
)
returns jsonb language sql set search_path = '' as $$
  select weekly_private.save_picks_with_sharing(p_season, p_nickname, p_picks, p_public, p_share_picks);
$$;
create function public.weekly_player_picks(
  p_season integer, p_public_pick_id uuid, p_season_type text default null, p_week integer default null
)
returns jsonb language sql stable set search_path = '' as $$
  select weekly_private.player_picks(p_season, p_public_pick_id, p_season_type, p_week);
$$;

revoke all on function weekly_private.entry_with_sharing(integer),
  weekly_private.save_picks_with_sharing(integer, text, jsonb, boolean, boolean),
  weekly_private.player_picks(integer, uuid, text, integer),
  public.weekly_entry_with_sharing(integer), public.weekly_save_picks_with_sharing(integer, text, jsonb, boolean, boolean),
  public.weekly_player_picks(integer, uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function weekly_private.entry_with_sharing(integer),
  weekly_private.save_picks_with_sharing(integer, text, jsonb, boolean, boolean),
  public.weekly_entry_with_sharing(integer), public.weekly_save_picks_with_sharing(integer, text, jsonb, boolean, boolean)
  to authenticated;
grant execute on function weekly_private.player_picks(integer, uuid, text, integer),
  public.weekly_player_picks(integer, uuid, text, integer) to anon, authenticated;
