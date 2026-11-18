-- Aggregate splits can disclose individual choices (for example, a unanimous
-- pregame tally). Apply the same kickoff and consent boundary as shared picks.
-- This replaces only the RPC implementation; no saved records are modified.
create or replace function weekly_private.community_picks(p_season integer, p_season_type text, p_week integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  with saved_games as (
    select g.id, g.home_id, g.away_id, g.kickoff
    from weekly_private.picks own
    join weekly_private.games g on g.season = own.season and g.id = own.game_id
    where own.user_id = (select auth.uid()) and own.season = p_season
      and g.season_type = p_season_type and g.week = p_week
      and own.team_id in (g.home_id, g.away_id) and own.updated_at < g.kickoff
      and g.void_reason is null and not g.start_time_tbd
      and g.status <> 'pending'
      and g.kickoff <= statement_timestamp()
      and g.model_team_id is not null and g.model_captured_at < g.kickoff
  ), tallies as (
    select g.id, count(*) as participants,
      count(*) filter (where p.team_id = g.home_id) as home_picks,
      count(*) filter (where p.team_id = g.away_id) as away_picks
    from saved_games g
    join weekly_private.picks p on p.season = p_season and p.game_id = g.id
      and p.team_id in (g.home_id, g.away_id) and p.updated_at < g.kickoff
    join weekly_private.players player on player.user_id = p.user_id
      and player.public_leaderboard and player.share_picks
    group by g.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'gameId', id, 'participants', participants,
    'homePicks', case when participants >= 3 then home_picks end,
    'awayPicks', case when participants >= 3 then away_picks end
  ) order by id), '[]'::jsonb)
  from tallies;
$$;

-- A pending/postponed game may retain an elapsed scheduled time. That time
-- does not confirm kickoff, so neither public endpoint releases its picks.
create or replace function weekly_private.player_picks(p_season integer, p_public_pick_id uuid, p_season_type text, p_week integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nickname', player.nickname, 'picks', coalesce((
    select jsonb_agg(jsonb_build_object('gameId', g.id, 'teamId', p.team_id, 'week', g.week, 'seasonType', g.season_type,
      'home', g.home_id, 'away', g.away_id, 'homeName', g.home_name, 'awayName', g.away_name,
      'startDate', g.kickoff, 'modelTeam', g.model_team_id, 'status', g.status,
      'homePoints', g.home_points, 'awayPoints', g.away_points, 'winner', g.winner_id) order by g.kickoff, g.id)
    from weekly_private.picks p join weekly_private.games g on (g.season, g.id) = (p.season, p.game_id)
    where p.user_id = player.user_id and p.season = p_season and not g.start_time_tbd
      and g.status <> 'pending' and g.kickoff <= statement_timestamp()
      and p.updated_at < g.kickoff and g.model_team_id is not null and g.void_reason is null
      and (p_season_type is null or g.season_type = p_season_type) and (p_week is null or g.week = p_week)
  ), '[]'::jsonb))
  from weekly_private.players player
  where player.public_pick_id = p_public_pick_id and player.public_leaderboard and player.share_picks;
$$;
