import { dayKey } from './preview-ui.mjs';
import { renderBasketball } from './preview-views.mjs';

const teamId = /^ncaam-d1:(\d+)$/;
const officialOrigin = 'https://www.thegamesdecide.com';
const emptyGames = { games: [], forecasts: [], grades: [] };
const routeId = path => decodeURIComponent(path).replace(/^\/basketball\/?|\/+$/g, '');
const includes = (game,id) => game.home === id || game.away === id;
export const publicBasketballLinks = markup => markup.replace(/\/basketball\/teams\/ncaam-d1%3A(\d+)\//gi, '/basketball/teams/$1/');

export function basketballPublicView(fetchRecord, index) {
  const teamLookup = (year, id) => {
    const key = teamId.exec(id)?.[1];
    return key && index.directory[year].teams.includes(id)
      ? fetchRecord(year + '/teams/' + key + '.json') : null;
  };

  return async value => {
    const url = new URL(value, officialOrigin);
    const view = routeId(url.pathname).replace(/^teams\/(\d+)$/, 'teams/ncaam-d1:$1');
    const query = url.searchParams;
    const requested = Number(query.get('season'));
    const year = index.years.includes(requested) ? requested : index.currentSeason;
    const directory = index.directory[year];
    const current = await fetchRecord(year + '/season.json');
    const { snapshot, editions, conferenceQuality, modelReport, home } = current;
    const historical = directory.historical;
    const conferences = conferenceQuality.rows.map(row => row.conference);
    const teams = new Map(snapshot.teams.map(team => [team.id, team]));
    const ctx = {
      year, snapshot, editions, conferenceQuality, teams, conferences, historical, publicSite: true,
      report: { ...modelReport.totals, games: [] },
      teamSeasons: id => index.years.filter(y => index.directory[y].teams.includes(id)),
      seasons: index.years,
      validation: index.validation,
      dataset: { games: [], playerStats: {} },
      slateDates: directory.dates,
    };
    let group = emptyGames;
    if (view === 'picks') {
      const date = query.get('date') ?? (directory.dates.includes(dayKey(Date.now())) ? dayKey(Date.now()) : undefined);
      if (date && directory.dates.includes(date)) group = await fetchRecord(year + '/slate/' + date + '.json');
    } else if (view.startsWith('teams/')) {
      const id = view.slice(6);
      const profile = await teamLookup(year, id);
      if (!profile) return null;
      group = profile;
      teams.set(id, { ...teams.get(id), schedule: profile.best });
      ctx.dataset.playerStats[id] = profile.players;
      ctx.dataset.teamStats = { [id]: profile.stats };
    } else if (view === 'matchup-lab') {
      const byName = [...teams.values()].sort((a,b) => a.name.localeCompare(b.name));
      const a = query.get('a') || byName[0]?.id;
      const b = query.get('b') || byName.find(team=>team.id !== a)?.id;
      if (a && b && a !== b && teams.has(a) && teams.has(b)) {
        const profiles = await Promise.all([teamLookup(year, a), teamLookup(year, b)]);
        const pairings = profiles.flatMap(profile => profile?.games ?? []).filter(game => includes(game,a) && includes(game,b));
        group = { ...emptyGames, games: [...new Map(pairings.map(game => [game.id,game])).values()] };
        ctx.dataset.playerStats = { [a]: profiles[0]?.players, [b]: profiles[1]?.players };
      }
    } else if (view === 'conferences') {
      const selected = conferences.indexOf(query.get('a'));
      const reference = query.get('view');
      if (reference === 'trends') {
        ctx.conferenceHistory = await Promise.all(index.years.map(async season => ({
          season, historical:index.directory[season].historical,
          quality:(await fetchRecord(season + '/season.json')).conferenceQuality,
        })));
      }
      if (!historical && selected >= 0 && (reference === 'head' || (!reference && query.has('b')))) {
        group = await fetchRecord(year + '/conferences/' + selected + '.json');
        ctx.conferenceDisplayEvidence = true;
      }
    } else if (view === 'model-reports') {
      group = modelReport;
      const grades = new Map(group.grades);
      ctx.report.games = modelReport.gradeOrder.map(gameId => ({gameId,...grades.get(gameId)}));
    } else if (!view) {
      group = home;
    }
    ctx.dataset.games = group.games;
    ctx.forecasts = new Map(group.forecasts);
    ctx.forecastReportById = new Map(group.grades);
    const markup = renderBasketball(ctx, view, query);
    return { title:teams.get(view.slice(6))?.name, ctx, view, markup:markup && publicBasketballLinks(markup) };
  };
}
