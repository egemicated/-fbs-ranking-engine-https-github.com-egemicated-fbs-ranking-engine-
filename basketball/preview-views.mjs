import { matchupTeamCard } from '../frontend/platform-presentation.js';
import { predictBasketball } from './model-forecast.js';
import { conferenceDataCell, conferenceNameCell, conferenceSortArrow, conferenceSortControl,
  conferenceViewTabs, nextConferenceSort, orderConferenceRows } from '../frontend/conference-display.js';
import { action, accent, banner, basketballHref as link, dayKey, empty, escape as e, fmt, has, input, matchupHref, mtDate, pageHero,
  metric, ordinal, panel, pct, seasonLabel, selector, stamp, teamHref, teamIdentity, teamLink, teamRecord } from './preview-ui.mjs';

const models = {
  sor: ['Strength of Record', 'sorRank', 'sorScore', 'SOR score',
    'What a team has earned. SOR measures how difficult it would be for an average Division I team to match the same win total against the same opponents at the same venues.'],
  predictive: ['Predictive Strength', 'predictiveRank', 'predictiveScore', 'Predictive score',
    'How strong a team projects to be. Predictive Strength uses results and adjusted scoring efficiency to estimate future matchups.'],
  performance: ['Performance Experimental', 'performanceRank', 'performanceScore', 'Performance score',
    'How well a team has performed. This experimental ranking summarizes adjusted scoring efficiency in games with usable box data.'],
};
const formatValue = (value, model) => fmt(value, model === 'sor' ? 3 : 1);
const order = field => (a,b) => (a[field] ?? Infinity) - (b[field] ?? Infinity) || a.name.localeCompare(b.name);
const amount = value => Number.isFinite(value) ? new Intl.NumberFormat('en-US').format(value) : '—';

export function portal({ football, basketball } = {}) {
  const footballLeader = football?.rankings?.find(team => (team.displayRank ?? team.rank) === 1);
  const basketballLeader = basketball?.snapshot?.teams.find(team => team.sorRank === 1);
  const sports = [
    { key:'football', title:'College football', detail:'FBS and FCS', leaderLabel:'FBS SOR leader', leader:footballLeader,
      year:football?.season, href:'/football/', rankings:'/rankings',
      description:'Follow the rankings, compare matchups, and see how the playoff field could shape up.' },
    { key:'basketball', title:'College basketball', detail:'Men’s Division I', leaderLabel:'D-I SOR leader', leader:basketballLeader,
      year:basketball?.snapshot && seasonLabel(basketball.snapshot.season), href:'/basketball/',
      rankings:link('rankings'), description:'Track results, compare teams, and explore the road to March Madness.' },
  ];
  return `<div class="fc-sports-portal"><div class="wrap">
    <header class="fc-portal-intro"><p class="fc-kicker">The Games Decide · Independent college sports analytics</p>
      <h1>Results over <em>reputation.</em></h1>
      <p>See what teams have earned, who they beat, and what the next matchup might bring.</p></header>
    <div class="fc-portal-grid">${sports.map(sport => `<article class="fc-sport-panel fc-sport-panel-${sport.key}">
      <div class="fc-portal-division"><span>${sport.detail}</span>${sport.year ? `<span>${sport.year}</span>` : ''}</div>
      <div class="fc-portal-story"><h2>${sport.title}</h2><p>${sport.description}</p>
        ${action(sport.href,`Explore ${sport.key}`)}</div>
      ${sport.leader ? `<a class="fc-portal-leader" href="${sport.rankings}"><span><small>${sport.leaderLabel}</small>
        <strong>#1 ${e(sport.leader.name)}</strong></span><strong>${teamRecord(sport.leader)}</strong>
        <span aria-hidden="true">→</span></a>` : ''}
    </article>`).join('')}</div>
  </div></div>`;
}

const fresh = ctx => ctx.snapshot ? `<p class="fc-fresh">${seasonLabel(ctx.year)} · Data snapshot
  <time datetime="${e(ctx.snapshot.asOf)}">${stamp(ctx.snapshot.asOf)}</time>${ctx.historical ? ' · Retrospective season analysis' : ''}</p>` : '';
const content = (ctx, body) => `<div class="wrap fc-content">${fresh(ctx)}${body}</div>`;
const refreshedView = (ctx, view, fields, contents, submit = 'Apply filters') => content(ctx,
  `<div data-view-refresh>
    <form class="fc-form fc-results-filters" method="get" action="${e(link(view))}" data-view-filters>${fields}<button>${submit}</button></form>
    <p class="sr-only" data-view-announcement role="status"></p><p class="gd-empty" data-view-error role="alert" hidden></p>
    <div data-view-results>${contents}</div>
  </div>`);
const noData = () => empty('No validated basketball data is available for this season.');
const form = (fields, label = 'Apply filters') => `<form class="fc-form" method="get">${fields}<button>${label}</button></form>`;
const seasonField = ctx => selector('season','Season',ctx.seasons.map(year => [year,seasonLabel(year)]),ctx.year);
const yearField = ({year}) => `<input type="hidden" name="season" value="${year}">`;
const table = (summary, columns, rows, extra = '') => `<div class="fc-table-wrap" role="region" aria-label="${e(summary)}" tabindex="0">
  <table class="fc-table ${extra}"><thead><tr>${columns.map(col => `<th scope="col"${col.phone === false ? ' class="fc-hide-phone"' : ''}>${e(col.text ?? col)}</th>`).join('')}</tr></thead>
  <tbody>${rows.join('')}</tbody></table></div>`;
const values = data => `<tr>${data.map(cell => typeof cell === 'string' ? `<td>${cell}</td>` :
  `<td class="${cell.cls ?? ''}">${cell.value}</td>`).join('')}</tr>`;
const confFilter = (ctx, selected) => selector('conf','Conference',[['','All conferences'],...ctx.conferences.map(c=>[c,c])],selected);
const orderFilter = data => data.trim().slice(0,90);
const teamOrder = (a,b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id));
const teamById = (ctx, id, name) => ctx.teams.get(id) ?? {name:name ?? 'Unknown team'};
const dateLabels = games => games.filter(g=>g.startDate).map(g=>dayKey(g.startDate));

function card(team, year) {
  const sor = Number.isFinite(team.sorScore) ? ` · ${formatValue(team.sorScore,'sor')} SOR` : '';
  return `<a class="fc-team-card gd-team-card" data-team-card style="--team-accent:${accent(team)}" href="${teamHref(team.id,year)}">
    <span class="gd-team-card-identity">${teamIdentity(team)}<small>${e(team.conference ?? 'Unassigned')}</small><small>${teamRecord(team)}${sor}</small></span>
    <span class="fc-team-rank gd-team-card-rank" aria-label="SOR rank ${team.sorRank ?? 'unavailable'}">${ordinal(team.sorRank)}</span></a>`;
}
function gameTable(ctx,games,{picks=false,subject=null,compact=false}={}) {
  if (!games.length) return empty('No games match these filters.');
  return `<div class="fc-games${compact ? ' fc-games-compact' : ''}"><ul aria-label="College basketball games">${games.map(game => {
    const home = teamById(ctx,game.home,game.homeName);
    const away = teamById(ctx,game.away,game.awayName);
    const scored = Number.isFinite(game.homePoints) && Number.isFinite(game.awayPoints);
    const winner = game.completed && scored && game.homePoints !== game.awayPoints
      ? (game.homePoints > game.awayPoints ? 'home' : 'away') : '';
    const gameStatus = game.completed ? 'Final'
      : game.status === 'in_progress' ? 'In progress at last update'
      : game.status === 'scheduled' && !game.startTimeTbd && Date.parse(game.startDate) < Date.now()
        ? 'Awaiting final' : game.status === 'scheduled' ? 'Scheduled' : String(game.status ?? 'Unconfirmed').replaceAll('_',' ');
    const time = game.startTimeTbd
      ? (game.startDate ? `${dayKey(game.startDate)} · Time TBD` : 'Tipoff TBD') : stamp(game.startDate);
    const teamLine = (team,side,points) => `<div class="fc-game-team${winner === side ? ' fc-game-winner' : ''}"
      style="--fc-accent:${accent(team)}"><div><small>${side === 'away' ? 'Away' : 'Home'}</small>${teamLink(team,ctx.year)}</div>
      ${winner === side ? '<span class="fc-visually-hidden">Winner</span>' : ''}
      ${scored ? `<strong class="fc-game-score">${points}</strong>` : ''}</div>`;
    const record = ctx.forecasts.get(game.id);
    const report = ctx.forecastReportById.get(game.id);
    const probability = record?.homeWinProbability;
    const favorite = probability > .5 ? home : away;
    const grade = [0,1].includes(report?.right) ? (report.right === 1 ? ' · Correct' : ' · Miss') : '';
    const pick = record && report?.status === 'excluded' ? '<small>Saved forecast excluded</small>'
      : Number.isFinite(probability)
        ? `<strong>${probability === .5 ? 'Even matchup' : e(favorite.name)} · ${pct(Math.max(probability,1-probability))}</strong>
          <small>Saved ${stamp(record.capturedAt)}${grade}</small>`
        : '<small>No saved pre-tipoff forecast</small>';
    const matchup = home.id && away.id ? `<a href="${matchupHref(home.id,away.id,ctx.year,game.neutral?'neutral':'home')}">Matchup Lab</a>` : '';
    const boxStats = [['possessions','Possessions'],['fieldGoalsMade','Field goals made'],
      ['fieldGoalsAttempted','Field goals attempted'],['threePointsMade','3-pointers made'],['freeThrowsMade','Free throws made'],
      ['offensiveRebounds','Off. rebounds'],['defensiveRebounds','Def. rebounds'],['assists','Assists'],
      ['turnovers','Turnovers'],['steals','Steals'],['blocks','Blocks'],['fouls','Fouls']];
    const evidence = game.boxEvidence;
    const box = !compact && evidence ? `<details class="fc-box"><summary>Team box-score evidence</summary>
      <dl>${[['shooting','Effective field goal %'],['reboundShare','Offensive rebound %'],['turnoverRate','Turnover rate']].map(([key,label]) =>
        `<dt>${label}</dt><dd>${pct(evidence.away[key])} / ${pct(evidence.home[key])}</dd>`).join('')}</dl>
      <small>Away / home</small></details>`
      : !compact && game.completed && game.box?.away && game.box?.home ? `<details class="fc-box">
      <summary>Team box score</summary><dl>${boxStats.map(([key,label])=>
        `<dt>${label}</dt><dd>${amount(game.box.away[key])} / ${amount(game.box.home[key])}</dd>`).join('')}</dl>
      <small>Away / home</small></details>` : '';
    const subjectWon = subject && winner ? game[winner] === subject : null;
    const result = subjectWon === null ? '' : `<span class="${subjectWon?'fc-win':'fc-loss'}">${subjectWon?'Win':'Loss'}</span>`;
    return `<li class="fc-game"><div class="fc-game-tipoff"><span class="fc-chip${game.completed ? ' fc-final' : ''}">${e(gameStatus)}</span>
      <small>${e(time)}</small>${game.neutral ? '<small>Neutral court</small>' : ''}${result}</div>
      <div class="fc-game-teams">${teamLine(away,'away',game.awayPoints)}${teamLine(home,'home',game.homePoints)}</div>
      ${picks || matchup || box ? `<div class="fc-game-actions">${picks ? `<div>${pick}</div>` : ''}${matchup}${box}</div>` : ''}</li>`;
  }).join('')}</ul></div>`;
}

function homepage(ctx) {
  if (!ctx.snapshot) return banner('College Basketball','Division I men’s basketball intelligence.') + content(ctx,noData());
  const teams = [...ctx.teams.values()];
  const top = teams.filter(t=>t.sorRank).sort(order('sorRank')).slice(0,5);
  const provisional = !ctx.historical && teams.some(team=>team.provisional);
  const upcoming = ctx.dataset.games.filter(g=>!g.completed && g.status==='scheduled' && g.startDate &&
    Date.parse(g.startDate)>Date.now()).sort((a,b)=>a.startDate.localeCompare(b.startDate));
  const latest = ctx.dataset.games.filter(g=>g.completed && g.divisionOne).sort((a,b)=>b.startDate.localeCompare(a.startDate));
  const savedUpcoming = upcoming.flatMap(game => {
    const forecast = ctx.forecasts.get(game.id);
    return game.divisionOne && !game.startTimeTbd && Number.isFinite(forecast?.homeWinProbability)
      && ctx.forecastReportById.get(game.id)?.status !== 'excluded' &&
      Date.parse(forecast.capturedAt) < Date.parse(game.startDate) ? [{ game, forecast }] : [];
  });
  const featured = savedUpcoming.filter(({game})=>dayKey(game.startDate)===dayKey(savedUpcoming[0].game.startDate))
    .sort((a,b)=>Math.abs(a.forecast.homeWinProbability-.5)-Math.abs(b.forecast.homeWinProbability-.5))[0];
  const confSummary = (ctx.conferenceQuality?.rows ?? []).filter(row=>row.nonconference.games)
    .slice().sort((a,b)=>b.nonconference.winRate-a.nonconference.winRate || a.conference.localeCompare(b.conference)).slice(0,3);
  const dashboard = (title, href, label, contents, note = '') => `<section class="fc-panel fc-dashboard-panel">
    <header><div><h2>${title}</h2>${note ? `<p>${note}</p>` : ''}</div><a class="fc-view-link" href="${href}">${label}<span aria-hidden="true"> →</span></a></header>
    <div class="fc-panel-body">${contents}</div></section>`;
  const path = (view, params = {}) => link(view,{ season:ctx.year, ...params });
  const board = path('scoreboard');
  const hero = pageHero({
    sport:'basketball', category:'home', variant:'home', className:'fc-hoops-hero',
    title:'College', highlight:'Basketball', eyebrow:`${seasonLabel(ctx.year)} · Men’s Division I`,
    description:'See how teams earned their rank, follow the games, and compare what the model expects next.',
    actions:action(path('rankings'),'Explore rankings')+action(board,'View scoreboard',true),
    aside:`<aside class="fc-top" aria-label="Top five Strength of Record">
      <div class="fc-top-title"><h2>SOR Top Five</h2><div><time datetime="${e(ctx.snapshot.asOf)}">${mtDate.format(new Date(ctx.snapshot.asOf))} snapshot</time>
      ${provisional ? '<span>Provisional</span>' : ctx.historical ? '<span>Retrospective</span>' : ''}</div></div>
    ${top.map(t=>`<a class="fc-top-row" href="${teamHref(t.id,ctx.year)}" style="--fc-accent:${accent(t)}">
      <span>${t.sorRank}</span>${teamIdentity(t)}<span>${teamRecord(t)}</span></a>`).join('')}
    ${top.length ? `<a class="fc-top-all" href="${path('rankings')}">Explore the Top 25 <span aria-hidden="true">→</span></a>`
      : '<p>No rankings available.</p>'}</aside>`,
  });
  return `${hero}
    <div class="wrap fc-content fc-hoops-dashboard">
      ${featured ? featuredForecast(featured,ctx) : ''}
      <div class="fc-grid fc-activity-grid">
        ${dashboard('Recent finals',board,'Scoreboard',gameTable(ctx,latest.slice(0,3),{compact:true}))}
        ${dashboard('Upcoming games',board,'Scoreboard',gameTable(ctx,upcoming.slice(0,3),{compact:true}),'All times Mountain')}
      </div>
      ${dashboard('Model leaders',path('model-reports'),'Model report',`<div class="fc-model-rail">
        ${Object.entries(models).map(([id,[name,rank]])=>{
          const leader = teams.find(team=>team[rank]===1);
          return `<a href="${path('rankings',{model:id})}"><small>${name}</small>
            <strong>${leader ? `#1 ${e(leader.name)}` : 'Unavailable'}</strong></a>`;
        }).join('')}
        <a href="${path('model-reports')}"><small>Saved forecasts</small><strong>${amount(ctx.report.forecasts)}</strong>
          <small>${ctx.report.graded ? `${pct(ctx.report.accuracy)} correct · ${amount(ctx.report.graded)} graded`
            : 'Awaiting qualifying results'}</small></a></div>`)}
      <div class="fc-grid fc-basketball-more">
        ${dashboard('Conference results',path('conferences'),'Compare conferences',confSummary.length ?
          `<ul class="fc-conference-list" aria-label="Nonconference records">${confSummary.map(({conference,nonconference:r})=>
            `<li><a href="${path('conferences',{a:conference})}">${e(conference)}</a><b>${r.wins}–${r.losses}</b><span>${pct(r.winRate)}</span></li>`).join('')}</ul>`
          : empty('No qualifying interconference results.'),'Division I nonconference winning percentage')}
        <section class="fc-home-tournament"><div><p class="fc-kicker">NCAA tournament</p><h2>March Madness</h2>
          <p>Explore the projected field or practice filling out a bracket.</p></div>
          ${action(path('march-madness',{mode:'projection'}),'Explore the bracket')}</section>
      </div>
    </div>`;
}

function featuredForecast({game,forecast},ctx) {
  const home = teamById(ctx,game.home,game.homeName);
  const away = teamById(ctx,game.away,game.awayName);
  const probability = forecast.homeWinProbability;
  const prediction = probability === .5 ? 'Even matchup' : `${e(probability>.5 ? home.name : away.name)} ${pct(Math.max(probability,1-probability))}`;
  return `<section class="fc-featured-game"><div><p class="fc-kicker">Featured forecast</p>
    <h2>${e(away.name)} ${game.neutral ? 'vs.' : 'at'} ${e(home.name)}</h2>
    <p>${stamp(game.startDate)} · Saved ${stamp(forecast.capturedAt)}</p></div>
    <div class="fc-featured-prediction"><small>Saved win probability</small><strong>${prediction}</strong></div>
    <a class="fc-view-link" href="${matchupHref(home.id,away.id,ctx.year,game.neutral?'neutral':'home')}">Matchup Lab<span aria-hidden="true"> →</span></a></section>`;
}

function rankings(ctx,query) {
  const model = Object.hasOwn(models,query.get('model')) ? query.get('model') : 'sor';
  const [name,rank,score,scoreLabel,description] = models[model];
  const conf = orderFilter(query.get('conf')??'');
  const q = orderFilter(query.get('q')??'');
  const sort = ['name','sos'].includes(query.get('sort')) ? query.get('sort') : 'rank';
  const all = query.get('all') === '1';
  const filtered = Boolean(q || conf || sort !== 'rank');
  const teams = [...ctx.teams.values()];
  const rows = teams.filter(t=>(!q||has(t,q))&&(!conf||t.conference===conf));
  rows.sort(sort==='name' ? teamOrder : sort==='sos'
    ? (a,b)=>(b.scheduleStrength??-1)-(a.scheduleStrength??-1)||order(rank)(a,b) : order(rank));
  const shown = filtered || all ? rows : rows.filter(t => Number.isFinite(t[rank]) && t[rank] <= 25);
  const prev = ctx.editions.length>1 ? ctx.editions.at(-2)?.teams : null;
  const tableBody = shown.length ? table(name,
    ['Rank','Team','Record',scoreLabel,{text:'Opp. Colley',phone:false},{text:'Off / Def per 100',phone:false}],shown.map(t => {
      const movement = model==='sor' && t.sorRank && prev?.[t.id] ? prev[t.id]-t.sorRank : null;
      const movementText = movement > 0 ? `Up ${movement}` : movement < 0 ? `Down ${-movement}` : 'No change';
      return values([`<span class="fc-rank-marker${t[rank] <= 3 && t[rank] != null ? ' fc-rank-top' : ''}">${ordinal(t[rank])}</span>
        ${movement!==null ? `<span class="fc-rank-change" title="${movementText}" aria-label="${movementText}">${movement>0?'↑'+movement:movement<0?'↓'+(-movement):'↔'}</span>` : ''}`,
        `<div class="fc-ranked-team" style="--fc-accent:${accent(t)}">${teamLink(t,ctx.year)}<small>${e(t.conference??'Unassigned')}${t.provisional?' · Provisional':''}</small></div>`,
        teamRecord(t), formatValue(t[score],model), {value:fmt(t.scheduleStrength,3),cls:'fc-hide-phone'},
        {value:`${fmt(t.adjustedOffense)} / ${fmt(t.adjustedDefense)}`,cls:'fc-hide-phone'}]);
    }), 'fc-ranking-table') : empty(filtered ? 'No teams match these filters.' : 'No ranked teams are available for this model.');
  const resultsId = 'basketball-ranking-results';
  const current = {season:ctx.year,model,q,conf,sort,all:all ? '1' : ''};
  const rankingsLink = params => link('rankings',{...current,...params});
  const tabs = `<nav class="fc-view-tabs gd-team-list-tabs" data-ranking-tabs aria-label="Ranking models">
    ${Object.entries(models).map(([key,value]) =>
      `<a href="${e(rankingsLink({model:key}))}" data-ranking-model="${key}"${key===model ? ' aria-current="page"' : ''}>${value[0]}</a>`).join('')}</nav>`;
  const filters = `<form class="fc-form fc-results-filters gd-team-filters" method="get" action="${link('rankings')}" data-team-filters>
    <input type="hidden" name="model" value="${model}">${all ? '<input type="hidden" name="all" value="1">' : ''}
    ${seasonField(ctx)}${input('q','School or mascot',q,'search')}${confFilter(ctx,conf)}
    ${selector('sort','Sort by',[['rank','Rank'],['name','Alphabetical'],['sos','Schedule strength']],sort)}
    <button data-team-fallback>Apply filters</button>
    <span data-ranking-action>${filtered ? action(rankingsLink({q:'',conf:'',sort:''}),'Clear filters',true)
      : action(rankingsLink({all:all ? '' : '1'}),all ? 'Show Top 25' : `Show all ${teams.length} teams`,true)}</span></form>`;
  const tableTitle = filtered ? 'Filtered rankings' : all ? 'All teams' : 'Top 25';
  const movementNote = prev && model === 'sor' ? ` · Compared with ${stamp(ctx.editions.at(-2).asOf)}` : '';
  const context = panel('Behind the rankings',`<p>${name === 'Strength of Record'
    ? 'Opponent Colley is the average rating of the Division I teams on a team’s schedule. Higher values indicate stronger opponents.'
    : 'Adjusted offense and defense show points scored and allowed per 100 possessions.'}</p>
    <dl class="fc-ranking-context"><dt>Division I teams</dt><dd>${amount(teams.length)}</dd>
    <dt>Completed games used</dt><dd>${amount(ctx.snapshot.gamesUsed)}</dd></dl>
    ${action(link('methodology',{season:ctx.year}),'See how rankings are calculated',true)}`);
  return banner('Rankings','Compare what teams have earned, how they project and how they have performed.')
    + content(ctx,`<section id="${resultsId}" class="fc-interior-anchor" data-ranking-browser>
      ${tabs}<div class="fc-ranking-heading" data-ranking-heading><h2>${name}</h2><p>${description}</p></div>
      <div class="fc-rank-layout gd-team-rank-layout"><div>${filters}
        <p class="fc-visually-hidden" data-team-announcement role="status"></p>
        <p class="fc-empty" data-team-error role="alert" hidden>Could not update rankings. The last results remain available.</p>
        <div data-team-results>${panel(tableTitle,tableBody,`${shown.length} teams shown${movementNote}`)}
          <span data-team-count class="fc-visually-hidden">${shown.length} teams shown. ${name}.</span></div>
      </div><aside data-ranking-context>${context}</aside></div></section>`);
}

function directory(ctx,query) {
  const q = orderFilter(query.get('q')??'');
  const conf = orderFilter(query.get('conf')??'');
  const sort = query.get('sort') === 'name' ? 'name' : 'rank';
  const letter = /^[A-Z]$/.test(query.get('letter')??'') ? query.get('letter') : '';
  const group = [...ctx.teams.values()].filter(t => (!q || has(t,q)) && (!conf || t.conference === conf))
    .sort(sort === 'name' ? teamOrder : order('sorRank'));
  const initial = team => team.name.charAt(0).toUpperCase();
  const initials = new Set(group.map(initial));
  const records = letter ? group.filter(team => initial(team) === letter) : group;
  const limit = Math.min(ctx.teams.size,Math.max(24,Number.parseInt(query.get('limit'),10) || 24));
  const shown = records.slice(0,limit);
  const directoryLink = params => link('teams',{season:ctx.year,q,conf,sort,letter,...params});
  const letters = [['','All'],...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(a => [a,a])];
  const alphabet = sort === 'name' || letter ? `<nav class="fc-alphabet" aria-label="Filter teams by first letter">
    ${letters.map(([value,label]) => value && !initials.has(value) && value !== letter
      ? `<span class="fc-letter-missing">${label}</span>`
      : `<a href="${e(directoryLink({letter:value}))}" data-team-letter="${value}"${value===letter ? ' aria-current="true"' : ''}>${label}</a>`).join('')}</nav>` : '';
  const resultText = shown.length < records.length ? `${shown.length} of ${records.length} teams shown` :
    `${records.length} of ${ctx.teams.size} teams`;
  const more = shown.length < records.length
    ? `<div class="fc-show-more"><a class="fc-action fc-secondary" data-team-more href="${e(directoryLink({limit:limit+24}))}">Show more teams</a></div>` : '';
  const results = `<div data-team-results>${alphabet}
    <div class="gd-team-list-heading"><h2>Division I teams</h2><p data-team-count>${resultText}</p></div>
    ${shown.length ? `<div class="fc-cards gd-team-grid">${shown.map(t=>card(t,ctx.year)).join('')}</div>${more}`
      : empty('No teams match these filters.')}</div>`;
  return banner('Teams','Browse Division I teams by conference, school, or mascot.')
    + content(ctx,`<section id="basketball-team-results" class="fc-interior-anchor" data-team-browser>
      <form class="fc-form fc-results-filters gd-team-filters" method="get" action="${link('teams')}" data-team-filters>
        ${seasonField(ctx)}${input('q','School or mascot',q,'search')}${confFilter(ctx,conf)}
        ${selector('sort','Sort by',[['rank','Rank'],['name','Alphabetical']],sort)}<button data-team-fallback>Apply filters</button>
      </form><p class="fc-visually-hidden" data-team-announcement role="status"></p>
      <p class="fc-empty" data-team-error role="alert" hidden>Could not update the teams. The last results remain available.</p>
      ${results}</section>`);
}

function teamPage(ctx,t) {
  const schedule = ctx.dataset.games.filter(g=>g.home===t.id||g.away===t.id);
  const finals = schedule.filter(g=>g.completed).reverse();
  const upcoming = schedule.filter(g=>!g.completed && !['cancelled','postponed'].includes(g.status) && g.startDate && Date.parse(g.startDate)>Date.now());
  const best = [...(t.schedule??[])].filter(x=>String(x.result).toLowerCase().startsWith('w'))
    .sort((a,b)=>(b.opponentRating??-1)-(a.opponentRating??-1)).slice(0,5);
  const ordered = [...ctx.teams.values()].filter(row=>row.conference===t.conference && row.sorRank).sort(order('sorRank'));
  const conferenceRank = ordered.indexOf(t)+1;
  const recent = finals.slice(0,5);
  const recentWins = recent.filter(g=>g.home===t.id ? g.homePoints>g.awayPoints : g.awayPoints>g.homePoints).length;
  const editions = ctx.editions.filter(ed=>ed.teams[t.id]!=null).slice(-6).reverse();
  const evidence = `<div class="fc-metrics">${metric('Record',teamRecord(t))}${metric('SOR rank',ordinal(t.sorRank),fmt(t.sorScore,3))}
    ${metric('Predictive rank',ordinal(t.predictiveRank))}${metric('Performance rank',ordinal(t.performanceRank),'Experimental')}
    ${metric('Conference position',conferenceRank?ordinal(conferenceRank):'—', t.conference ?? 'Unassigned')}
    ${metric('Conference record',`${t.conferenceWins??0}–${t.conferenceLosses??0}`)}
    ${metric('Last five',recent.length ? `${recentWins}–${recent.length-recentWins}` : '—',`${recent.length} qualifying finals`)}</div>`;
  return pageHero({sport:'basketball',category:'team',variant:'profile',headingHtml:teamIdentity(t),
    eyebrow:`${t.conference ?? 'Division I'} · ${seasonLabel(ctx.year)}`,
    metadata:`${teamRecord(t)} overall${t.provisional ? ' · Provisional ranks' : ''}`})
    + content(ctx,evidence+`<div class="fc-actions fc-date-links" aria-label="Team seasons">${ctx.teamSeasons(t.id)
      .filter(year=>year!==ctx.year).map(year=>action(teamHref(t.id,year),seasonLabel(year),true)).join('')}</div>
    <div class="fc-grid"><div class="fc-stack">${panel(ctx.publicSite ? 'Recent completed games' : 'Completed games',gameTable(ctx,finals,{picks:true,subject:t.id}))}
    ${panel('Upcoming games',gameTable(ctx,upcoming,{picks:true,subject:t.id}))}
    ${panel('Player leaders',playerLeaders(ctx,t,false))}</div><div class="fc-stack">
    ${panel('Efficiency and tempo',`<div class="fc-metrics">${metric('Adj. offense',fmt(t.adjustedOffense),'Points per 100')}
      ${metric('Adj. defense',fmt(t.adjustedDefense),'Points allowed per 100')}${metric('Tempo',fmt(t.tempo),'Possessions')}
      ${metric('Box score coverage',amount(t.boxGames))}</div>`)}
    ${fourFactors(t)}
    ${teamStatDetails(ctx.dataset.teamStats?.[t.id])}
    ${panel('Strength of Record evidence',`<div class="fc-metrics">${metric('D-I record',`${t.diWins??0}–${t.diLosses??0}`)}
      ${metric('Reference expected wins',fmt(t.expectedWins,2))}${metric('Opponent Colley',fmt(t.scheduleStrength,3))}
      ${metric('Chance to match record',pct(t.sorOpponentWinProbability))}</div>
      <p class="fc-note">The score asks how hard it would be for the reference team to match this record against the same D-I opponents at the same venues.</p>${action(link('methodology',{season:ctx.year}),'See the formula',true)}`)}
    ${panel('Quality wins',best.length?table('Best wins',['Opponent','Venue','Opponent rating'],best.map(row=>values([
      teamLink(teamById(ctx,row.opponentId),ctx.year),e(row.venue),fmt(row.opponentRating,3)]))):empty('No completed D-I wins are recorded.'))}
    ${panel('Saved ranking history',editions.length ? table('Team ranking history',['Published edition','SOR rank'],
      editions.map(ed=>values([`<a href="${link('ranking-history',{season:ctx.year,edition:ed.asOf})}">${stamp(ed.asOf)}</a>`,ordinal(ed.teams[t.id])])))
      : empty('No timestamped editions were saved for this historical season.'))}
    </div></div>`);
}

function teamStatDetails(stats) {
  if (!stats) return '';
  const {scoring, record, divisionOne, possessions, tempo, adjustedNet} = stats;
  const average = total => scoring.games ? fmt(total/scoring.games) : '—';
  const locationRecord = key => teamRecord(record.venue[key]);
  const counts = [['totalRebounds','Rebounds'],['assists','Assists'],['steals','Steals'],['blocks','Blocks'],['fouls','Fouls']];
  const percentages = [['fieldGoalPct','Field goal %'],['threePointPct','3-point %'],['freeThrowPct','Free throw %'],
    ['trueShootingPct','True shooting %'],['threePointAttemptRate','3-point attempt rate'],['defensiveReboundPct','Defensive rebound %']];
  const compare = (side, type, key) => {
    const sample = divisionOne[side][type][key];
    if (!sample?.games) return '—';
    const value = type === 'ratios' ? pct(sample.value) : fmt(sample.total/sample.games);
    return `${value} <small>${sample.games} games</small>`;
  };
  return panel('Team statistics',
    `<div class="fc-metrics">${metric('Home',locationRecord('home'))}${metric('Road',locationRecord('road'))}
      ${metric('Neutral',locationRecord('neutral'))}${metric('Points / game',average(scoring.points))}
      ${metric('Allowed / game',average(scoring.pointsAllowed))}${metric('Margin / game',average(scoring.margin))}
      ${metric('Adjusted net efficiency',fmt(adjustedNet),'Per 100 possessions')}
      ${metric('Pace per 40 minutes',fmt(tempo.value),`${tempo.games} games with verified duration`)}
      ${metric('Possession coverage',amount(possessions.games),`${possessions.estimatedGames} estimated`)}</div>
      <details><summary>Box-score averages and rates</summary>
      ${table('Division I box-score averages',['Measure','Team','Opponents'],[
        ...counts.map(([key,label])=>values([label,compare('team','totals',key),compare('opponent','totals',key)])),
        ...percentages.map(([key,label])=>values([label,compare('team','ratios',key),compare('opponent','ratios',key)])),
      ])}</details>`,`${divisionOne.boxGames} games with a paired Division I box score`);
}

function fourFactors(team) {
  const factors = [
    ['effectiveFieldGoalRate','Effective field goal %'],['turnoverRate','Turnover rate'],
    ['offensiveReboundRate','Offensive rebound %'],['freeThrowRate','Free throw attempt rate'],
  ];
  const shown = side => name => {
    const value = team.fourFactors?.[side]?.[name];
    return Number.isFinite(value?.rate) ? `${pct(value.rate)} <small>${amount(value.games)} games</small>` : '—';
  };
  return panel('Four Factors',factors.some(([id])=>team.fourFactors?.offense?.[id] || team.fourFactors?.defense?.[id])
    ? table('Box-score-based Four Factors',['Measure','Team offense','Opponent offense'],factors.map(([id,label])=>
      values([e(label),shown('offense')(id),shown('defense')(id)])))
    : empty('No qualifying paired team box scores are available.'), 'Rates use covered Division I games.');
}

function playerLeaders(ctx,team,compact) {
  const players = ctx.dataset.playerStats?.[team.id] ?? [];
  if (!players.length) return empty('No player box scores are available for this team.');
  const coverage = 'Averages per recorded appearance. Coverage can vary by game. Availability is unverified.';
  if (compact) {
    const leaders = [['Points','points'],['Rebounds','rebounds'],['Assists','assists']].flatMap(([label,key])=>{
      const player = [...players].filter(row=>Number.isFinite(row[key])).sort((a,b)=>b[key]-a[key])[0];
      return player ? [values([label,e(player.name),fmt(player[key]),amount(player.games)])] : [];
    });
    return table('Player leaders',['Stat','Player','Per game','Games'],leaders)+`<p class="fc-note">${coverage}</p>`;
  }
  const recent = player => (player.recent ?? []).map(game=>
    `${fmt(game.points,0)} pts · ${fmt(game.rebounds,0)} reb · ${fmt(game.assists,0)} ast`).join(' / ');
  return table('Player season leaders',['Player','Games','Minutes','Points','Rebounds','Assists','TS%'],players.slice(0,10).map(player=>
    values([`<strong>${e(player.name)}</strong>${player.position ? `<small> · ${e(player.position)}</small>` : ''}
      ${recent(player) ? `<details><summary>Recent games</summary><p>${e(recent(player))}</p></details>` : ''}`,
      amount(player.games),fmt(player.minutes),fmt(player.points),fmt(player.rebounds),fmt(player.assists),pct(player.trueShootingPct)])))
    + `<p class="fc-note">${coverage}</p>`;
}

function basketballMatchupTeam(side, team, opponent, teams) {
  const picker = `<label><span class="sr-only">Team ${side.toUpperCase()}</span>
    <select name="${side}" data-matchup-team="${side}" required>
      <option value="" disabled${team ? '' : ' selected'}>Choose a team</option>
      ${teams.map(option => `<option value="${e(option.id)}"${option.id === team?.id ? ' selected' : option.id === opponent?.id ? ' disabled' : ''}>
        ${e([option.name,option.mascot].filter(Boolean).join(' '))}</option>`).join('')}
    </select></label>`;
  return matchupTeamCard({
    side,picker,heading:team ? teamIdentity(team) : 'Choose a team',
    attributes:`style="--team-accent:${accent(team)}"`,
    context:team ? `${teamRecord(team)} · ${Number.isFinite(team.sorRank) ? ordinal(team.sorRank)+' Strength of Record' : 'SOR rank unavailable'}` : '',
    strength:team ? `Predictive Strength <strong>${fmt(team.predictiveScore,3)}</strong> · ${ordinal(team.predictiveRank)}` : '',
  });
}

function matchup(ctx, query) {
  const byName = [...ctx.teams.values()].sort((a,b)=>a.name.localeCompare(b.name));
  const first = query.get('a'), second=query.get('b');
  const h=ctx.teams.get(first)??(!first?byName[0]:null), a=ctx.teams.get(second)??(!second?byName.find(t=>t?.id!==h?.id):null);
  const venue = ['home','away','neutral'].includes(query.get('venue')) ? query.get('venue') : 'neutral';
  const venues = [['neutral','Neutral court'],['home','Team A at home'],['away','Team B at home']];
  const valid = h && a && h.id !== a.id;
  const { estimate, details } = valid ? matchupResults(ctx,h,a,venue)
    : { estimate:'<h2>Choose a different opponent</h2><p>Two different Division I teams are required.</p>', details:'' };
  const announcement = valid ? `Matchup updated for ${h.name} and ${a.name}.` : 'Choose two different teams.';
  return banner('Matchup Lab','Explore how two teams match up under basketball’s own prediction model.',undefined,'tool')
    + content(ctx,`<section data-matchup-lab aria-label="Matchup controls and results">
      <form method="get" action="${link('matchup-lab')}" data-matchup-form="${ctx.year}">
        <div class="gd-matchup-toolbar">
          ${seasonField(ctx)}
          <div data-matchup-venue-fallback>${selector('venue','Venue',venues,venue)}</div>
          <div class="segmented compare-venue" role="group" aria-label="Game location" data-matchup-venue-buttons hidden>
            ${venues.map(([key,label])=>`<button type="button" data-matchup-venue-choice="${key}"${key===venue ? ' class="active"' : ''}
              aria-pressed="${key===venue}">${label}</button>`).join('')}
          </div>
          <button type="submit" class="button" data-matchup-manual>Compare teams</button>
        </div>
        <div class="compare-layout">
          ${basketballMatchupTeam('a',h,a,byName)}${basketballMatchupTeam('b',a,h,byName)}
          <section class="panel prediction-card gd-matchup-estimate" aria-label="Win probability" data-matchup-results
            data-matchup-announcement="${e(announcement)}">${estimate}</section>
        </div>
      </form>
      <p class="sr-only" role="status" data-matchup-status></p>
      <div class="gd-empty gd-matchup-error" role="alert" data-matchup-error hidden>
        <p>Could not update the matchup. Previous results are still shown.</p>
        <button type="button" class="button light small" data-matchup-retry>Retry</button>
      </div>
      <div data-matchup-details>${details}</div>
    </section>`);
}

function matchupResults(ctx,h,a,venue) {
  const estimate = predictBasketball(ctx.snapshot,{home:h.id,away:a.id,neutral:venue==='neutral',venue});
  const fields = [['Overall record',teamRecord],['SOR rank',t=>ordinal(t.sorRank)],['Predictive rank',t=>ordinal(t.predictiveRank)],
    ['Schedule strength',t=>fmt(t.scheduleStrength,3)],['Adjusted offense',t=>fmt(t.adjustedOffense)],
    ['Adjusted defense',t=>fmt(t.adjustedDefense)],['Tempo',t=>fmt(t.tempo)]];
  const paired=ctx.dataset.games.filter(g=>g.completed && (g.home===h.id&&g.away===a.id||g.home===a.id&&g.away===h.id));
  const {homeMargin, homeWinProbability, awayWinProbability, estimatedPossessions, provisional} = estimate;
  const leader = homeMargin > 0 ? h.name : a.name;
  const estimateMarkup = `<div class="eyebrow">${provisional ? 'Early-season matchup estimate' : 'Current matchup estimate'}</div>
    <h2>${!Number.isFinite(homeMargin) ? 'Win probability' : homeMargin === 0 ? 'Even matchup' : `${e(leader)} edge`}</h2>
    ${Number.isFinite(homeMargin) ? `<div class="prediction-number">${fmt(Math.abs(homeMargin))}<span> pts</span></div><p>Expected margin</p>` : ''}
    <div class="probability-track" aria-hidden="true"><span style="width:${homeWinProbability*100}%"></span></div>
    <div class="matchup-win-chances" role="group" aria-label="Model win chances">
    ${[[h,homeWinProbability],[a,awayWinProbability]].map(([team,chance])=>`<div class="matchup-win-chance">
      <span><a href="${e(teamHref(team.id,ctx.year))}">${e(team.name)}</a></span><strong>${pct(chance)}</strong>
      ${chance!==.5 ? `<small>${chance>.5 ? 'Model favorite' : 'Underdog'}</small>` : ''}</div>`).join('')}</div>
    <p>${Number.isFinite(estimatedPossessions) ? `Estimated tempo: ${fmt(estimatedPossessions)} possessions. ` : ''}
      Hypothetical matchup.</p>`;
  const details = `<div class="fc-grid fc-gap">${panel('Team evidence',table('Matchup statistics',['Metric',h.name,a.name],fields.map(([label,format])=>
      values([e(label),format(h),format(a)]))))}
    ${panel(ctx.publicSite ? 'Recent head-to-head' : 'Head-to-head this season', (paired.length ? gameTable(ctx,paired) :
       empty('No meeting appears in the available game details.'))+`<div class="fc-actions">${action(link('methodology',{season:ctx.year}),'How forecasts work',true)}</div>`)}</div>${matchupPlayers(ctx,[h,a])}`;
  return { estimate:estimateMarkup, details };
}

function matchupPlayers(ctx,teams) {
  return `<details class="panel player-fold matchup-players" data-matchup-players>
      <summary>Players to know</summary>
      <div class="panel-body">
        <div class="matchup-player-grid">${teams.map(team=>`<section class="matchup-player-team" style="--team-player-accent:${accent(team)}">
          <h3>${e(team.name)}</h3>${playerLeaders(ctx,team,true)}
        </section>`).join('')}</div>
      </div>
    </details>`;
}

const conferenceModes = {
  overview:'Overview', head:'Head-to-Head', strength:'Team Strength', trends:'Trends',
};
const conferenceColumns = [
  ['conference','Conference',row=>row.conference], ['teams','D-I teams',row=>row.teams],
  ['wins','Wins',row=>row.nonconference.wins], ['losses','Losses',row=>row.nonconference.losses],
  ['rate','Win %',row=>row.nonconference.winRate],
  ['predictive','Mean predictive strength',row=>row.predictive.mean,'Predictive strength'],
];
const conferenceTitle = (conference,href,asAction = false) =>
  `<a data-view-link href="${e(href)}"${asAction ? ' class="fc-action fc-secondary"' : ''}>${e(conference)}</a>`;
const winRateBar = value => Number.isFinite(value)
  ? `<span class="fc-win-rate">${pct(value)}<span aria-hidden="true"><i style="width:${100*value}%"></i></span></span>` : '—';
const conferenceTable = (summary, columns, rows) =>
  `<div class="fc-table-wrap gd-conference-records-region" role="region" aria-label="${e(summary)}" tabindex="0">
    <table class="fc-table fc-conference-table gd-conference-cards" role="table">
    <thead role="rowgroup"><tr role="row">${columns.map(label=>`<th scope="col">${e(label)}</th>`).join('')}</tr></thead>
    <tbody role="rowgroup">${rows.map(([heading,...cells])=>`<tr role="row">${conferenceNameCell(heading)}
      ${cells.map((cell,index)=>conferenceDataCell(columns[index+1],cell)).join('')}</tr>`).join('')}</tbody></table></div>`;
const conferenceRecords = (ctx,query,href) => {
  const quality = ctx.conferenceQuality;
  const [sort,,value] = conferenceColumns.find(([key])=>key===query.get('sort')) ?? conferenceColumns[4];
  const ascending = query.has('direction') ? query.get('direction') === 'asc' : sort === 'conference';
  const direction = ascending ? 'ascending' : 'descending';
  const rows = orderConferenceRows(quality.rows.map(row=>({...row,name:row.conference})),value,direction);
  const recordPart = {recordPart:true};
  const records = `<div data-gd-basketball-conferences="${ctx.year}">
    ${conferenceSortControl(conferenceColumns,sort,direction)}
    <p class="sr-only" role="status" data-gd-conference-announcement></p>
    <div class="fc-table-wrap gd-conference-records-region" role="region" aria-label="Sortable conference results" tabindex="0">
    <table class="fc-table fc-conference-table gd-conference-cards" role="table"><thead role="rowgroup"><tr role="row">${conferenceColumns.map(([key,label])=>{
      const next = nextConferenceSort(key,sort,direction);
      return `<th scope="col"${key === sort ? ` aria-sort="${direction}"` : ''}>
        <a data-gd-conference-column="${key}" href="${e(href({sort:key,direction:next==='ascending'?'asc':'desc'}))}">${e(label)}
        <span aria-hidden="true">${conferenceSortArrow(key,sort,direction)}</span></a></th>`;
    }).join('')}</tr></thead><tbody role="rowgroup">${rows.map(row => {
      const sortValues = Object.fromEntries(conferenceColumns.map(([key,,read])=>[key,read(row)]));
      return `<tr role="row" data-gd-conference-values="${e(JSON.stringify(sortValues))}">
        ${conferenceNameCell(conferenceTitle(row.conference,href({view:'strength',a:row.conference})),
          {label:'Record',value:`${row.nonconference.wins}–${row.nonconference.losses}`})}
        ${conferenceDataCell('Division I teams',row.teams)}
        ${conferenceDataCell('Wins',row.nonconference.wins,recordPart)}
        ${conferenceDataCell('Losses',row.nonconference.losses,recordPart)}
        ${conferenceDataCell('Win %',winRateBar(row.nonconference.winRate))}
        ${conferenceDataCell('Mean predictive strength',fmt(row.predictive.mean,3))}</tr>`;
    }).join('')}</tbody></table></div></div>`;
  const adjusted = conferenceTable('Opponent-adjusted nonconference results',
    ['Conference','W–L','Rated games','Reference wins','Win surplus','Surplus / game'],
    [...quality.rows].sort((a,b)=>(b.nonconference.surplusPerGame??-Infinity)-(a.nonconference.surplusPerGame??-Infinity)
      || a.conference.localeCompare(b.conference)).map(({conference,nonconference:r})=>[
        conferenceTitle(conference,href({view:'strength',a:conference})),`${r.wins}–${r.losses}`,String(r.sample),fmt(r.expectedWins,2),
        fmt(r.winSurplus,2),`${fmt(r.surplusPerGame,3)}${r.limitedSample ? '<small>Small sample</small>' : ''}`]));
  return `<div class="fc-stack">${panel('Conference records',records,
    `${quality.rows.length} conferences · ${amount(quality.gameCount)} completed Division I games between conferences`)}
    ${panel('Opponent-adjusted results',`<details><summary>View win surplus and rated-game coverage</summary>
      <p>${e(quality.method)} ${e(quality.sampleNote)}</p>${adjusted}</details>`)}</div>`;
};

function conferenceGames(ctx,a,b) {
  if (ctx.publicSite) return ctx.dataset.games.filter(game=>!b ||
    ctx.teams.get(game.home)?.conference === b || ctx.teams.get(game.away)?.conference === b)
    .slice().reverse();
  const evidence = new Map([...ctx.teams].map(([id,team])=>[id,new Map((team.schedule??[]).map(game=>[game.gameId,game]))]));
  return ctx.dataset.games.filter(game => {
    if (!game.completed || game.divisionOne === false || game.seasonType === 'preseason' || game.conferenceGame === true) return false;
    const home = ctx.teams.get(game.home)?.conference, away = ctx.teams.get(game.away)?.conference;
    if (!home || !away || home === away || (home !== a && away !== a) || (b && home !== b && away !== b)) return false;
    const x = evidence.get(game.home)?.get(game.id), y = evidence.get(game.away)?.get(game.id);
    return x?.opponentId === game.away && y?.opponentId === game.home &&
      ['W','L'].includes(x.result) && ['W','L'].includes(y.result) && x.result !== y.result;
  }).sort((x,y)=>Date.parse(y.startDate)-Date.parse(x.startDate));
}

function conferenceHead(ctx,query,a,b,href) {
  const quality = ctx.conferenceQuality;
  const games = a ? conferenceGames(ctx,a,b) : [];
  const limit = Math.min(games.length,Math.max(12,Number.parseInt(query.get('limit'),10)||12));
  const stats = b ? quality.matrix[a]?.[b] : quality.rows.find(row=>row.conference === a)?.nonconference;
  const matchup = a ? panel(b ? `${a} vs ${b}` : `${a} vs all opponents`, stats?.games
    ? `<div class="fc-metrics">${metric(`${a} W–L`,`${stats.wins}–${stats.losses}`)}
      ${metric('Win percentage',pct(stats.winRate))}${metric('Games rated for opponent quality',`${stats.sample} / ${stats.games}`)}
      ${metric('Opponent-adjusted win surplus',fmt(stats.winSurplus,2))}</div>
      ${b ? `<div class="fc-compare-swap">${conferenceTitle('Swap conferences',href({a:b,b:a}),true)}</div>` : ''}
      ${games.length ? gameTable(ctx,games.slice(0,limit)) : empty('Individual game details are outside the published evidence window.')}
      ${limit < games.length ? `<div class="fc-show-more">${conferenceTitle('Show more games',href({limit:limit+12}),true)}</div>` : ''}`
    : empty('No completed Division I games match this conference pairing.'),
    stats?.games ? `Showing ${limit} of ${stats.games} games, most recent first${ctx.publicSite && limit < stats.games ? ' · Limited display coverage' : ''}` : '') : '';
  const matrix = table('Head-to-head conference record',['Conference',...ctx.conferences],ctx.conferences.map(x =>
    `<tr><th scope="row"><span>${e(x)}</span></th>${ctx.conferences.map(y=>{
      const row=quality.matrix[x]?.[y];
      if(!row) return '<td><span>—</span></td>';
      const style=row.wins===row.losses?'even':row.wins>row.losses?'warm':'cool';
      return `<td class="fc-heat-${style}"><a data-view-link aria-label="${e(x)} vs ${e(y)}, ${row.wins} wins and ${row.losses} losses"
      href="${e(href({a:x,b:y}))}">${row.wins}–${row.losses}</a></td>`;
    }).join('')}</tr>`),'fc-heat fc-conference-table');
  return `<div class="fc-stack">${matchup}${panel('Head-to-head matrix',`<p class="fc-matrix-legend">
    <span class="fc-heat-warm">Winning record</span><span class="fc-heat-even">Even record</span><span class="fc-heat-cool">Losing record</span>
    <span>— No games</span></p><p class="fc-table-hint">Scroll the matrix to see all conferences.</p>${matrix}`,
    'Read across for each conference’s wins and losses. Choose a record to open the games.')}</div>`;
}

function conferenceStrength(ctx,a) {
  const selected = ctx.conferenceQuality.rows.find(row=>row.conference===a);
  if (!selected) return panel('Team strength',empty('Select a conference to see its ranked teams.'));
  const members = [...ctx.teams.values()].filter(team=>team.conference===a).sort(order('sorRank'));
  const ranked = members.filter(team=>Number.isFinite(team.sorRank));
  return panel(`${a} membership`,`<div class="fc-metrics">
    ${metric('Top 25 SOR teams',amount(ranked.filter(team=>team.sorRank<=25).length))}
    ${metric('Top 25 predictive teams',amount(members.filter(team=>Number.isFinite(team.predictiveRank)&&team.predictiveRank<=25).length))}
    ${metric('Median predictive strength',fmt(selected.predictive.median,3))}
    ${metric('Middle 50% of predictive scores',selected.rankedTeams ? `${fmt(selected.predictive.q1,3)} to ${fmt(selected.predictive.q3,3)}` : '—')}
    </div>${conferenceTable('Conference member rankings',
    ['Team','Conference W–L','SOR rank','Predictive rank','Predictive score'],members.map(team=>[
      teamLink(team,ctx.year),`${team.conferenceWins??0}–${team.conferenceLosses??0}`,ordinal(team.sorRank),
      ordinal(team.predictiveRank),fmt(team.predictiveScore,3)]))}`,
    `${ranked.length} of ${members.length} members with a Division I Strength of Record rank`);
}

function conferenceTrends(ctx,a) {
  const years = (ctx.conferenceHistory ?? [{season:ctx.year,historical:ctx.historical,quality:ctx.conferenceQuality}])
    .map(({season,historical,quality})=>({season,historical,row:quality.rows.find(row=>row.conference===a)}));
  const latest = ctx.editions.at(-1), previous = ctx.editions.at(-2);
  const changes = previous && latest ? [...ctx.teams.values()].filter(team=>team.conference===a).flatMap(team=>{
    const from = previous.teams[team.id], to = latest.teams[team.id];
    return Number.isFinite(from) && Number.isFinite(to) && from !== to ? [{team,from,to}] : [];
  }).sort((x,y)=>Math.abs(y.from-y.to)-Math.abs(x.from-x.to)||teamOrder(x.team,y.team)).slice(0,10) : [];
  return `<div class="fc-stack">${panel(`${a} by season`,conferenceTable('Historical nonconference results',
    ['Season','Division I teams','W–L','Win %','Mean predictive strength'],years.map(({season,historical,row})=>[
      `${seasonLabel(season)}<small>${historical ? 'Retrospective' : 'Season to date'}</small>`,row ? String(row.teams) : '—',
      row ? `${row.nonconference.wins}–${row.nonconference.losses}` : '—',
      winRateBar(row?.nonconference.winRate),fmt(row?.predictive.mean,3)])),
      'Conference membership comes from each selected season. Current records include only games available in the latest snapshot.')}
    ${panel('Recent SOR movement',changes.length ? conferenceTable('Conference team rank changes',['Team','Previous','Current','Change'],
      changes.map(({team,from,to})=>[teamLink(team,ctx.year),ordinal(from),ordinal(to),from>to ? `↑ ${from-to}` : `↓ ${to-from}`]))
      : empty(previous ? 'No matched members changed rank between these editions.' : 'Two saved ranking editions are needed to show movement.'),
      previous && latest ? `${stamp(previous.asOf)} to ${stamp(latest.asOf)}` : '')}</div>`;
}

function conferences(ctx,query) {
  const a = ctx.conferences.includes(query.get('a')) ? query.get('a') : '';
  const b = ctx.conferences.includes(query.get('b')) && query.get('b') !== a ? query.get('b') : '';
  const view = Object.hasOwn(conferenceModes,query.get('view')) ? query.get('view') : b ? 'head' : a ? 'strength' : 'overview';
  const selected = a || (['strength','trends'].includes(view) ? ctx.conferences[0] : '');
  const anchor = '#basketball-conference-results';
  const href = params => link('conferences',{season:ctx.year,view,a:selected,b,...params})+anchor;
  const tabs = conferenceViewTabs('Conference analysis',Object.entries(conferenceModes).map(([key,label])=>
    [key,label,href({view:key,b:key==='head'?b:''})]),view,{inPlace:true});
  const options = ctx.conferences.map(name=>[name,name]);
  const opponentChoices = [['','All opponents'],...options].map(([id,label])=>
    `<option value="${e(id)}"${id === b ? ' selected' : ''}${id && id === selected ? ' disabled' : ''}>${e(label)}</option>`).join('');
  const filters = `<form class="fc-form fc-results-filters" method="get" action="${e(link('conferences'))}" data-view-filters${view === 'head' ? ' data-view-explicit' : ''}>
    <input type="hidden" name="view" value="${view}">${seasonField(ctx)}
    ${view === 'overview' ? '' : selector('a',view==='head'?'Conference A':'Conference',
      view==='head'?[['','Choose a conference'],...options]:options, selected)}
    ${view === 'head' ? `<label>Conference B<select name="b">${opponentChoices}</select></label>` : ''}
    <button>${view === 'head' ? 'Compare' : 'Apply filters'}</button></form>`;
  const detail = view==='head' ? conferenceHead(ctx,query,selected,b,href)
    : view==='strength' ? conferenceStrength(ctx,selected)
    : view==='trends' ? conferenceTrends(ctx,selected) : conferenceRecords(ctx,query,href);
  return banner('Conference Strength','Compare nonconference results, opponent quality and predictive team strength.')
    +content(ctx,`<section id="basketball-conference-results" class="fc-interior-anchor" data-view-refresh>${tabs}${filters}
      <p class="sr-only" data-view-announcement role="status"></p><p class="gd-empty" data-view-error role="alert" hidden>Conference results could not be refreshed. Try again.</p>
      <div data-view-results>${detail}</div></section>`);
}

function slate(ctx, query, picks=false) {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(query.get('date')??'') && Number.isFinite(Date.parse(query.get('date')));
  const today = dayKey(Date.now());
  const latest = [...new Set(dateLabels(ctx.dataset.games.filter(g=>g.completed)))].sort().at(-1);
  const date = valid ? query.get('date') : ctx.historical ? latest : today;
  const conf=orderFilter(query.get('conf')??'');
  const day = date ? new Date(date+'T12:00:00Z') : new Date();
  const adjacent = step=>new Date(+day+step*86_400_000).toISOString().slice(0,10);
  const view=picks?'picks':'scoreboard';
  const rows = ctx.dataset.games.filter(g=>g.startDate&&dayKey(g.startDate)===date&&(!conf ||
    ctx.teams.get(g.home)?.conference===conf||ctx.teams.get(g.away)?.conference===conf));
  const dateLink = (step,label) => `<a class="fc-action fc-secondary" data-view-link="${step < 0 ? 'previous-day' : 'next-day'}" href="${e(link(view,{season:ctx.year,date:adjacent(step),conf}))}">${label}</a>`;
  return banner(picks?'Daily Picks':'Scoreboard',picks?'Saved basketball forecasts captured before a confirmed tipoff.':'Provider-published schedules and final results. Times shown in Mountain Time.')
    +refreshedView(ctx,view,seasonField(ctx)+input('date','Game date',date,'date')+confFilter(ctx,conf),
      `<div class="fc-actions fc-date-links">${dateLink(-1,'Previous day')}${dateLink(1,'Next day')}</div>`
      +panel(date??'Games',rows.length ? gameTable(ctx,rows,{picks}) : empty(ctx.publicSite && !ctx.slateDates?.includes(date)
        ? 'This date is outside the published daily scoreboard window.' : conf
        ? 'No published games match this date and conference. Choose another day or conference.'
        : 'No games appear in the published data for this date. Choose another day.'),
      `${rows.length} ${rows.length===1?'game':'games'} · Provider snapshot ${stamp(ctx.snapshot.asOf)}`));
}

function modelReport(ctx) {
  const live=ctx.report, past=ctx.validation?.holdout;
  const rows = (r)=> r.confidence?.length ? table('Calibration',['Confidence band','Games','Average confidence','Accuracy'],
    r.confidence.map(row=>values([row.lower!==undefined ? `${Math.round(row.lower*100)}–${Math.round((row.lower+.1)*100)}%` : e(row.label),
      amount(row.count??row.games),pct(row.meanConfidence??row.probability),pct(row.accuracy)]))) : '';
  const decisions = live.games.filter(g=>g.status==='graded');
  const confidence = x=>Math.max(x.homeWinProbability,1-x.homeWinProbability);
  const wins = decisions.filter(g=>g.right===1&&confidence(g)>=.7);
  const misses = decisions.filter(g=>g.right===0&&confidence(g)>=.7);
  const gameIndex = new Map(ctx.dataset.games.map(g=>[g.id,g]));
  const toGames = decisions=>decisions.map(g=>gameIndex.get(g.gameId)).filter(Boolean);
  const moments = live.graded ? `<div class="fc-grid fc-gap">
    ${panel('Confident wins',gameTable(ctx,toGames(wins.slice(-5)),{picks:true}),'Saved probability of at least 70%.')}
    ${panel('Upsets against the model',gameTable(ctx,toGames(misses.sort((a,b)=>confidence(b)-confidence(a)).slice(0,5)),{picks:true}),'The saved favorite had a win probability of at least 70%.')}</div>` : '';
  const reportDetail = live.graded ? rows(live)+gameTable(ctx,toGames(decisions.slice(-15)),{picks:true})
    : empty('No saved basketball forecast has reached a qualifying final yet.');
  return banner('Model Report Card','Results for saved forecasts and a separate test on historical seasons.')+
    refreshedView(ctx,'model-reports',seasonField(ctx),`<div class="fc-stack">
    ${panel('Saved prospective forecasts',`<div class="fc-metrics">${metric('Graded',amount(live.graded))}${metric('Pending',amount(live.pending))}
      ${metric('Accuracy',pct(live.accuracy))}${metric('Brier score',fmt(live.brier,4))}
      ${metric('Excluded',amount(live.excluded))}${metric('Finals without a saved pick',amount(live.missing))}</div>${reportDetail}`)}
    ${moments}
    ${panel('Historical replay · holdout',past ? `<div class="fc-metrics">${metric('Games',amount(past.games))}${metric('Accuracy',pct(past.accuracy))}
      ${metric('Brier score',fmt(past.brier,4))}${metric('Log loss',fmt(past.logLoss,4))}
      ${metric('Margin MAE',fmt(past.marginMae,2))}${metric('Calibration gap',pct(past.calibrationError))}</div>${rows(past)}
      <p class="fc-note">Replayed using only information available before each game. These predictions are separate from the saved forecast record.</p>`
      : empty('Reproducible historical validation is unavailable.'))}</div>`,'Show season');
}
function history(ctx,query) {
  const selected=ctx.editions.find(ed=>ed.asOf===query.get('edition'))??ctx.editions.at(-1);
  const previous=ctx.editions.find(ed=>ed.asOf===query.get('compare'))
    ??(selected?ctx.editions[ctx.editions.indexOf(selected)-1]:null);
  const rows=selected ? Object.entries(selected.teams).sort((a,b)=>a[1]-b[1]).slice(0,50) : [];
  const entries = ctx.editions.map(ed=>[ed.asOf,stamp(ed.asOf)]);
  const change = (prior,rank) => prior ? prior===rank?'↔':prior>rank?'↑'+(prior-rank):'↓'+(rank-prior):'—';
  return banner('Ranking History','Compare timestamped, saved basketball rankings. Historical season analyses are labeled separately.')
    +refreshedView(ctx,'ranking-history',seasonField(ctx)+(selected?selector('edition','Edition',entries,selected.asOf):'')
      +(entries.length > 1 ? selector('compare','Compare with',[['','Previous saved edition'],...entries],query.get('compare') ?? ''):''),
      panel('Saved SOR editions',rows.length
      ? table('Ranking movement',['Rank','Team','Prior rank','Move'],rows.map(([id,rank])=>values([
          ordinal(rank),teamLink(teamById(ctx,id),ctx.year),ordinal(previous?.teams[id]),change(previous?.teams[id],rank)])))
      : empty('No prospective editions are saved for this season. Use Rankings to see its retrospective season analysis.'),
      selected ? `${stamp(selected.asOf)} · ${selected.gamesUsed} eligible games` : ''));
}
function methodology(ctx) {
  return banner('Basketball methodology','Basketball models are trained and evaluated separately from football.')+content(ctx,`<div class="fc-stack">
    ${panel('Strength of Record','<p>For each completed Division I matchup we remove that game from the Colley network and estimate how an average Division I team would fare against the same opponent at the same venue. We combine these per-game probabilities with a Poisson-binomial calculation of matching or exceeding the actual win total. The rating is the negative base-10 log of that probability. Non-D-I results still count in the displayed overall record.</p>')}
    ${panel('Predictive Strength','<p>This model estimates win probability from basketball outcomes available before the matchup. Its candidates use a basketball-fitted venue effect, opponent-adjusted scoring margin, Elo, possession efficiency, form and rest. The held-out results report which features survived the selection process. Displayed point margin is an estimate. Exact score totals require separate validation.</p>'
      + (ctx.snapshot ? `<details><summary>Selected model coefficients</summary><pre class="fc-technical">${e(JSON.stringify(ctx.snapshot.modelConfig,null,2))}</pre></details>` : ''))}
    ${panel('Performance Experimental','<p>Offensive and defensive efficiency per 100 possessions use games with supported team box scores. Opponent-adjusted net efficiency provides the performance ranking. Tempo and the shooting, rebounding and turnover measures are shown as evidence rather than arbitrary ranking weights.</p>')}
    ${panel('Data and versions','<p>CollegeBasketballData supplies schedules, results and team box scores. Forecasts preserve the original capture time and model snapshot. Historical replays have a separate record. School names and team colors identify teams without using university marks.</p>')}
    </div>`);
}

export function renderBasketball(ctx, view, query, pickBoard) {
  if (!ctx.snapshot && !['methodology',''].includes(view)) return banner('Basketball data', 'Division I men’s basketball.')+content(ctx,noData());
  if (view.startsWith('teams/')) {
    const team=ctx.teams.get(view.slice(6)); return team?teamPage(ctx,team):null;
  }
  if (view==='') return homepage(ctx);
  if (view==='rankings') return rankings(ctx,query);
  if (view==='teams') return directory(ctx,query);
  if (view==='matchup-lab') return matchup(ctx,query);
  if (view==='conferences') return conferences(ctx,query);
  if (view==='scoreboard') return slate(ctx,query);
  if (view==='picks') return slate(ctx,query,true);
  if (view==='model-reports') return modelReport(ctx);
  if (view==='ranking-history') return history(ctx,query);
  if (view==='methodology') return methodology(ctx);
  if (view==='contest') return banner('Beat the Model','Basketball picks use a separate local practice profile.')+content(ctx,pickBoard);
  if (view==='march-madness') return `<div class="wrap bb-bracket-page" id="full-court-bracket">
    <header class="bb-bracket-topbar"><h1>March Madness</h1></header>
    <p role="status" data-bracket-loading>Loading bracket…</p></div>`;
  return null;
}
