create function weekly_private.community_picks(p_season integer, p_season_type text, p_week integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  with saved_games as (
    select g.id, g.home_id, g.away_id
    from weekly_private.picks own
    join weekly_private.games g on g.season = own.season and g.id = own.game_id
    where own.user_id = (select auth.uid()) and own.season = p_season
      and g.season_type = p_season_type and g.week = p_week
      and own.team_id in (g.home_id, g.away_id)
      and g.void_reason is null and not g.start_time_tbd
      and g.model_team_id is not null and g.model_captured_at < g.kickoff
  ), tallies as (
    select g.id, count(*) as participants,
      count(*) filter (where p.team_id = g.home_id) as home_picks,
      count(*) filter (where p.team_id = g.away_id) as away_picks
    from saved_games g
    join weekly_private.picks p on p.season = p_season and p.game_id = g.id
      and p.team_id in (g.home_id, g.away_id)
    group by g.id
  )
  -- With fewer than three participants a split would reveal the only other person's pick.
  select coalesce(jsonb_agg(jsonb_build_object(
    'gameId', id, 'participants', participants,
    'homePicks', case when participants >= 3 then home_picks end,
    'awayPicks', case when participants >= 3 then away_picks end
  ) order by id), '[]'::jsonb)
  from tallies;
$$;

create function public.weekly_community_picks(p_season integer, p_season_type text, p_week integer)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select weekly_private.community_picks(p_season, p_season_type, p_week);
$$;

revoke all on function weekly_private.community_picks(integer, text, integer),
  public.weekly_community_picks(integer, text, integer) from public, anon, authenticated, service_role;
grant execute on function weekly_private.community_picks(integer, text, integer),
  public.weekly_community_picks(integer, text, integer) to authenticated;
