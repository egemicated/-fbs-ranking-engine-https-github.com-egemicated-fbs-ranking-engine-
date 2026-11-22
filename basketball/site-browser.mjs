import { publicView, siteRecord } from './site-client.mjs';
import { escape, panel, teamHref, teamLink } from './preview-ui.mjs';
import { publicBasketballLinks } from './site-view.mjs';
import { predictBasketball } from './model-forecast.js';

const main = document.getElementById('main');
const url = new URL(location.href);
const route = url.pathname.replace(/\/$/, '');

async function search() {
  const query = (url.searchParams.get('q') ?? '').trim().slice(0,80);
  const target = main.querySelector('[data-public-team-search]');
  if (!query) return;
  const index = await siteRecord('index.json');
  const requested = Number(url.searchParams.get('season'));
  const year = index.years.includes(requested) ? requested : index.currentSeason;
  const [record,football] = await Promise.all([
    siteRecord(year + '/season.json'),
    fetch('/data/rankings.json').then(response => response.ok ? response.json() : {}),
  ]);
  const normalized = query.toLowerCase();
  const match = team => [team.name,team.school,team.mascot].join(' ').toLowerCase().includes(normalized);
  const footballTeams = [...(football.rankings ?? []), ...(football.fcsRankings ?? [])].filter(match).slice(0,12);
  const basketballTeams = record.snapshot.teams.filter(match).slice(0,12);
  const display = rows => rows.length ? '<ul>' + rows.map(link => '<li>' + link + '</li>').join('') + '</ul>'
    : '<p>No matching teams.</p>';
  target.innerHTML = panel('Football',display(footballTeams.map(t =>
    '<a href="/team/' + encodeURIComponent(t.id) + '/">' + escape(t.name ?? t.school) + '</a>')))
    + panel('Basketball',publicBasketballLinks(display(basketballTeams.map(t => teamLink(t, year)))));
}

async function start() {
  if (route === '/find-team') return search();
  if (!route.startsWith('/basketball')) return;
  if (route === '/basketball/scoreboard') return import('./scoreboard.mjs');
  let page;
  if (url.search || route.endsWith('/march-madness')) {
    page = await publicView(url);
    if (!page?.markup) throw Error('The requested season or team is unavailable');
    main.innerHTML = page.markup;
    if (/^#basketball-game-\d+$/.test(url.hash)) document.getElementById(url.hash.slice(1))?.scrollIntoView();
  }
  await import('./preview-interiors.js');
  if (route.endsWith('/conferences')) await import('./conference.js');
  if (route.endsWith('/matchup-lab')) await import('./matchup.js');
  if (!route.endsWith('/march-madness')) return;
  const { mountBasketballBracket } = await import('./basketball-bracket.js');
  const { snapshot } = page.ctx;
  let storage;
  try { storage = window.localStorage; } catch {}
  mountBasketballBracket(document.querySelector('#full-court-bracket'), {
    season: snapshot.season, rankings: snapshot.teams, modelAsOf: snapshot.asOf, storage, publicPractice: true,
    teamHref: (id,year) => publicBasketballLinks(teamHref(id,year)),
    matchupHref: (a,b,season) => '/basketball/matchup-lab/?' + new URLSearchParams({a,b,season,venue:'neutral'}),
    forecast: (a,b) => snapshot.teams.some(t=>t.id===a) && snapshot.teams.some(t=>t.id===b)
      ? predictBasketball(snapshot,{home:a,away:b,neutral:true}).homeWinProbability : null,
  });
}

start().catch(() => {
  const notice = document.createElement('p');
  notice.setAttribute('role','status');
  notice.className = 'gd-empty';
  notice.textContent = 'Could not load this view. Reload the page to try again.';
  const loading = main.querySelector('[data-bracket-loading]');
  if (loading) loading.replaceWith(notice);
  else main.prepend(notice);
});
