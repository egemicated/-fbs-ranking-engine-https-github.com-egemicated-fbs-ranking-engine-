import { predictBasketball } from './model-forecast.js';
import { action, accent, banner, basketballHref as link, dayKey, empty, escape as e, fmt, has, input, matchupHref,
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
const noData = () => empty('This season has no validated basketball data in the private cache.');
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
const viewTabs = (label,tabs,selected) => `<nav class="fc-view-tabs" aria-label="${e(label)}">${tabs.map(([key,name,href]) =>
  `<a href="${e(href)}"${key===selected ? ' aria-current="page"' : ''}>${e(name)}</a>`).join('')}</nav>`;
const teamById = (ctx, id, name) => ctx.teams.get(id) ?? {name:name ?? 'Unknown team'};
const dateLabels = games => games.filter(g=>g.startDate).map(g=>dayKey(g.startDate));

function card(team, year) {
  return `<a class="fc-team-card" data-team-card style="--fc-accent:${accent(team)}" href="${teamHref(team.id,year)}">
    <span>${teamIdentity(team)}<small>${e(team.conference ?? 'Unassigned')} · ${teamRecord(team)}</small></span>
    <span class="fc-team-rank" aria-label="SOR rank ${team.sorRank ?? 'unavailable'}">${ordinal(team.sorRank)}</span></a>`;
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
    const box = !compact && game.completed && game.box?.away && game.box?.home ? `<details class="fc-box">
      <summary>Team box score</summary><dl>${[['possessions','Possessions'],['offensiveRebounds','Off. rebounds'],
      ['defensiveRebounds','Def. rebounds'],['turnovers','Turnovers']].map(([key,label])=>
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
  return `<section class="fc-hero fc-hoops-hero"><div class="wrap fc-hero-content">
    <div><p class="fc-kicker">${seasonLabel(ctx.year)} · Men’s Division I</p><h1>College <span>Basketball</span></h1>
    <p>See how teams earned their rank, follow the games, and compare what the model expects next.</p>
    <div class="fc-actions">${action(path('rankings'),'Explore rankings')}${action(board,'View scoreboard',true)}</div>
    <p class="fc-snapshot-line"><time datetime="${e(ctx.snapshot.asOf)}">${stamp(ctx.snapshot.asOf)}</time> snapshot
      ${provisional ? ' · Early-season rankings' : ctx.historical ? ' · Retrospective' : ''}</p></div>
    <aside class="fc-top" aria-label="Top five Strength of Record"><h2>SOR Top Five</h2>
    ${top.map(t=>`<a class="fc-top-row" href="${teamHref(t.id,ctx.year)}" style="--fc-accent:${accent(t)}">
      <span>${t.sorRank}</span>${teamIdentity(t)}<span>${teamRecord(t)}</span></a>`).join('')}
    ${top.length ? `<a class="fc-top-all" href="${path('rankings')}">Explore the Top 25 <span aria-hidden="true">→</span></a>`
      : '<p>No rankings available.</p>'}</aside></div></section>
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
    }), 'fc-ranking-table') : empty(filtered ? 'No teams match your filters.' : 'No ranked teams are available for this model.');
  const resultsId = '#basketball-ranking-results';
  const current = {season:ctx.year,model,q,conf,sort,all:all ? '1' : ''};
  const rankingsLink = params => link('rankings',{...current,...params})+resultsId;
  const tabs = viewTabs('Ranking models',Object.entries(models).map(([key,value]) =>
    [key,value[0],rankingsLink({model:key})]),model);
  const filters = `<form class="fc-form fc-results-filters" method="get" action="${resultsId}">
    <input type="hidden" name="model" value="${model}">${all ? '<input type="hidden" name="all" value="1">' : ''}
    ${seasonField(ctx)}${input('q','School or mascot',q,'search')}${confFilter(ctx,conf)}
    ${selector('sort','Sort by',[['rank','Rank'],['name','Team name'],['sos','Schedule strength']],sort)}
    <button>Apply filters</button>
    ${filtered ? action(rankingsLink({q:'',conf:'',sort:''}),'Clear filters',true)
      : action(rankingsLink({all:all ? '' : '1'}),all ? 'Show Top 25' : `Show all ${teams.length} teams`,true)}</form>`;
  const tableTitle = filtered ? 'Filtered rankings' : all ? 'All teams' : 'Top 25';
  const movementNote = prev && model === 'sor' ? ` · Compared with ${stamp(ctx.editions.at(-2).asOf)}` : '';
  const context = panel('Behind the rankings',`<p>${name === 'Strength of Record'
    ? 'Opponent Colley is the average rating of the Division I teams on a team’s schedule. Higher values indicate stronger opponents.'
    : 'Adjusted offense and defense show points scored and allowed per 100 possessions.'}</p>
    <dl class="fc-ranking-context"><dt>Division I teams</dt><dd>${amount(teams.length)}</dd>
    <dt>Completed games used</dt><dd>${amount(ctx.snapshot.gamesUsed)}</dd></dl>
    ${action(link('methodology',{season:ctx.year}),'See how rankings are calculated',true)}`);
  return banner('Basketball rankings','Compare what teams have earned, how they project and how they have performed.')
    + content(ctx,`<section id="basketball-ranking-results" class="fc-interior-anchor">
      ${tabs}<div class="fc-ranking-heading"><h2>${name}</h2><p>${description}</p></div>${filters}
      <div class="fc-rank-layout">${panel(tableTitle,tableBody,`${shown.length} teams shown${movementNote}`)}
      <aside>${context}</aside></div></section>`);
}

function directory(ctx,query) {
  const q = orderFilter(query.get('q')??'');
  const conf = orderFilter(query.get('conf')??'');
  const letter = /^[A-Z]$/.test(query.get('letter')??'') ? query.get('letter') : '';
  const group = [...ctx.teams.values()].filter(t => (!q || has(t,q)) && (!conf || t.conference === conf)).sort(teamOrder);
  const initial = team => team.name.charAt(0).toUpperCase();
  const initials = new Set(group.map(initial));
  const records = letter ? group.filter(team => initial(team) === letter) : group;
  const limit = Math.min(ctx.teams.size,Math.max(24,Number.parseInt(query.get('limit'),10) || 24));
  const shown = records.slice(0,limit);
  const directoryLink = params => link('teams',{season:ctx.year,q,conf,letter,...params})+'#basketball-team-results';
  const letters = [['','All'],...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(a => [a,a])];
  const alphabet = `<nav class="fc-alphabet" aria-label="Filter teams by first letter">
    ${letters.map(([value,label]) => value && !initials.has(value) && value !== letter
      ? `<span class="fc-letter-missing">${label}</span>`
      : `<a href="${e(directoryLink({letter:value}))}" data-team-letter="${value}"${value===letter ? ' aria-current="true"' : ''}>${label}</a>`).join('')}</nav>`;
  const resultText = `${records.length} ${records.length===1 ? 'team' : 'teams'}${shown.length < records.length ? ` · Showing ${shown.length}` : ''}`;
  const more = shown.length < records.length
    ? `<div class="fc-show-more"><a class="fc-action fc-secondary" data-team-more href="${e(directoryLink({limit:limit+24}))}">Show more teams</a></div>` : '';
  const results = `<div data-team-results>${alphabet}
    ${panel('Division I teams',shown.length ? `<div class="fc-cards">${shown.map(t=>card(t,ctx.year)).join('')}</div>${more}`
      : empty('No teams match your filters.'),resultText)}
    <span data-team-count class="fc-visually-hidden">${resultText}</span></div>`;
  return banner('Basketball teams','Browse Division I teams by conference, school or mascot.')
    + content(ctx,`<section id="basketball-team-results" class="fc-interior-anchor" data-team-browser>
      <form class="fc-form fc-results-filters" method="get" action="#basketball-team-results" data-team-filters>
        ${seasonField(ctx)}${input('q','School or mascot',q,'search')}${confFilter(ctx,conf)}<button>Apply filters</button>
      </form><p class="fc-visually-hidden" data-team-announcement role="status"></p>
      <p class="fc-empty" data-team-error role="alert" hidden>Could not update the teams. Try applying your filters again.</p>
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
  return banner(`${t.name}${t.mascot?' '+t.mascot:''}`,`${t.conference??'Unassigned'} · ${teamRecord(t)}${t.provisional ? ' · Provisional ranks':''}`)
    + content(ctx,evidence+`<div class="fc-actions fc-date-links" aria-label="Team seasons">${ctx.teamSeasons(t.id)
      .filter(year=>year!==ctx.year).map(year=>action(teamHref(t.id,year),seasonLabel(year),true)).join('')}</div>
    <div class="fc-grid"><div class="fc-stack">${panel('Completed games',gameTable(ctx,finals,{picks:true,subject:t.id}))}
    ${panel('Upcoming games',gameTable(ctx,upcoming,{picks:true,subject:t.id}))}</div><div class="fc-stack">
    ${panel('Efficiency and tempo',`<div class="fc-metrics">${metric('Adj. offense',fmt(t.adjustedOffense),'Points per 100')}
      ${metric('Adj. defense',fmt(t.adjustedDefense),'Points allowed per 100')}${metric('Tempo',fmt(t.tempo),'Possessions')}
      ${metric('Box score coverage',amount(t.boxGames))}</div>`)}
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

function matchup(ctx, query) {
  const byName = [...ctx.teams.values()].sort((a,b)=>a.name.localeCompare(b.name));
  const first = query.get('a'), second=query.get('b');
  const h=ctx.teams.get(first)??(!first?byName[0]:null), a=ctx.teams.get(second)??(!second?byName.find(t=>t?.id!==h?.id):null);
  const venue = ['home','away','neutral'].includes(query.get('venue')) ? query.get('venue') : 'neutral';
  const opts = byName.map(t=>[t.id,t.name]);
  const choice = form(seasonField(ctx)+selector('a','Team A',opts.filter(([id])=> id!==a?.id || id===h?.id),h?.id)
    +selector('b','Team B',opts.filter(([id])=> id!==h?.id || id===a?.id),a?.id)
    +selector('venue','Venue',[['home','Team A home'],['away','Team B home'],['neutral','Neutral court']],venue), 'Compare teams');
  if (!h || !a || h.id===a.id) return banner('Matchup Lab','Compare two different teams in the selected season.') + content(ctx,choice
    +panel('Choose a different opponent',empty('Two different Division I teams are required.')));
  const estimate = predictBasketball(ctx.snapshot,{home:h.id,away:a.id,neutral:venue==='neutral',venue});
  const fields = [['Overall record',teamRecord],['SOR rank',t=>ordinal(t.sorRank)],['Predictive rank',t=>ordinal(t.predictiveRank)],
    ['Schedule strength',t=>fmt(t.scheduleStrength,3)],['Adjusted offense',t=>fmt(t.adjustedOffense)],
    ['Adjusted defense',t=>fmt(t.adjustedDefense)],['Tempo',t=>fmt(t.tempo)]];
  const paired=ctx.dataset.games.filter(g=>g.completed && (g.home===h.id&&g.away===a.id||g.home===a.id&&g.away===h.id));
  return banner('Matchup Lab','Explore how two teams match up under basketball’s own prediction model.')+content(ctx,choice
    +panel('Win probability',`<div class="fc-average"><div><span>${teamLink(h,ctx.year)} <strong>${pct(estimate.homeWinProbability)}</strong></span>
      <span>${teamLink(a,ctx.year)} <strong>${pct(estimate.awayWinProbability)}</strong></span></div>
      <div class="fc-probability" aria-hidden="true"><span style="width:${estimate.homeWinProbability*100}%"></span></div>
      <p>${estimate.homeMargin!==null ? `Expected margin: ${e(estimate.homeMargin<0?a.name:h.name)} by ${fmt(Math.abs(estimate.homeMargin))} points. ` : ''}
      ${estimate.estimatedPossessions!==null ? `Estimated tempo: ${fmt(estimate.estimatedPossessions)} possessions. ` : ''}
      ${estimate.provisional ? 'Early-season estimate. ' : ''}Hypothetical matchup.</p></div>`,'Current matchup estimate')
    +`<div class="fc-grid fc-gap">${panel('Team evidence',table('Matchup statistics',['Metric',h.name,a.name],fields.map(([label,format])=>
      values([e(label),format(h),format(a)]))))}
    ${panel('Head-to-head this season', gameTable(ctx,paired)+`<div class="fc-actions">${action(link('methodology',{season:ctx.year}),'How forecasts work',true)}</div>`)}</div>`);
}

const conferenceModes = {
  overview:'Overview', head:'Head-to-Head', strength:'Team Strength', trends:'Trends',
};
const conferenceColumns = [
  ['conference','Conference',row=>row.conference], ['teams','D-I teams',row=>row.teams],
  ['wins','Wins',row=>row.nonconference.wins], ['losses','Losses',row=>row.nonconference.losses],
  ['rate','Win %',row=>row.nonconference.winRate], ['predictive','Mean predictive strength',row=>row.predictive.mean],
];
const conferenceTitle = (conference,href) => `<a href="${e(href)}">${e(conference)}</a>`;
const winRateBar = value => Number.isFinite(value)
  ? `<span class="fc-win-rate">${pct(value)}<span aria-hidden="true"><i style="width:${100*value}%"></i></span></span>` : '—';
const conferenceRecords = (ctx,query,href) => {
  const quality = ctx.conferenceQuality;
  const [sort,,value] = conferenceColumns.find(([key])=>key===query.get('sort')) ?? conferenceColumns[4];
  const ascending = query.has('direction') ? query.get('direction') === 'asc' : sort === 'conference';
  const rows = [...quality.rows].sort((a,b) => {
    const x = value(a), y = value(b);
    if (x == null || y == null) return Number(x == null) - Number(y == null) || a.conference.localeCompare(b.conference);
    return (ascending ? 1 : -1) * (typeof x === 'string' ? x.localeCompare(y) : x - y) || a.conference.localeCompare(b.conference);
  });
  const records = `<div class="fc-table-wrap" role="region" aria-label="Sortable conference results" tabindex="0">
    <table class="fc-table fc-conference-table"><thead><tr>${conferenceColumns.map(([key,label])=>{
      const active = key === sort;
      const next = active ? !ascending : key === 'conference';
      return `<th scope="col"${active ? ` aria-sort="${ascending?'ascending':'descending'}"` : ''}>
        <a href="${e(href({sort:key,direction:next?'asc':'desc'}))}">${label}
        <span aria-hidden="true">${active ? ascending?'↑':'↓':'↕'}</span></a></th>`;
    }).join('')}</tr></thead><tbody>${rows.map(row => `<tr><th scope="row">
      ${conferenceTitle(row.conference,href({view:'strength',a:row.conference}))}</th><td>${row.teams}</td>
      <td>${row.nonconference.wins}</td><td>${row.nonconference.losses}</td><td>${winRateBar(row.nonconference.winRate)}</td>
      <td>${fmt(row.predictive.mean,3)}</td></tr>`).join('')}</tbody></table></div>`;
  const adjusted = table('Opponent-adjusted nonconference results',
    ['Conference','W–L','Rated games','Reference wins','Win surplus','Surplus / game'],
    [...quality.rows].sort((a,b)=>(b.nonconference.surplusPerGame??-Infinity)-(a.nonconference.surplusPerGame??-Infinity)
      || a.conference.localeCompare(b.conference)).map(({conference,nonconference:r})=>values([
        conferenceTitle(conference,href({view:'strength',a:conference})),`${r.wins}–${r.losses}`,String(r.sample),fmt(r.expectedWins,2),
        fmt(r.winSurplus,2),`${fmt(r.surplusPerGame,3)}${r.limitedSample ? '<small>Small sample</small>' : ''}`])));
  return `<div class="fc-stack">${panel('Conference records',`<p class="fc-table-hint">Scroll the table to see all columns.</p>${records}`,
    `${quality.rows.length} conferences · ${amount(quality.gameCount)} completed Division I games between conferences`)}
    ${panel('Opponent-adjusted results',`<details><summary>View win surplus and rated-game coverage</summary>
      <p>${e(quality.method)} ${e(quality.sampleNote)}</p>${adjusted}</details>`)}</div>`;
};

function conferenceGames(ctx,a,b) {
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
      ${b ? `<div class="fc-compare-swap">${action(href({a:b,b:a}),'Swap conferences',true)}</div>` : ''}
      ${gameTable(ctx,games.slice(0,limit))}
      ${limit < games.length ? `<div class="fc-show-more">${action(href({limit:limit+12}),'Show more games',true)}</div>` : ''}`
    : empty('No completed Division I games match this conference pairing.'),
    stats?.games ? `Showing ${limit} of ${stats.games} games, most recent first` : '') : '';
  const matrix = table('Head-to-head conference record',['Conference',...ctx.conferences],ctx.conferences.map(x =>
    `<tr><th scope="row"><span>${e(x)}</span></th>${ctx.conferences.map(y=>{
      const row=quality.matrix[x]?.[y];
      if(!row) return '<td><span>—</span></td>';
      const style=row.wins===row.losses?'even':row.wins>row.losses?'warm':'cool';
      return `<td class="fc-heat-${style}"><a aria-label="${e(x)} vs ${e(y)}, ${row.wins} wins and ${row.losses} losses"
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
    </div>${table('Conference member rankings',
    ['Team','Conference W–L','SOR rank','Predictive rank','Predictive score'],members.map(team=>values([
      teamLink(team,ctx.year),`${team.conferenceWins??0}–${team.conferenceLosses??0}`,ordinal(team.sorRank),
      ordinal(team.predictiveRank),fmt(team.predictiveScore,3)])),'fc-conference-table')}`,
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
  return `<div class="fc-stack">${panel(`${a} by season`,table('Historical nonconference results',
    ['Season','Division I teams','W–L','Win %','Mean predictive strength'],years.map(({season,historical,row})=>values([
      `${seasonLabel(season)}<small>${historical ? 'Retrospective' : 'Season to date'}</small>`,row ? String(row.teams) : '—',
      row ? `${row.nonconference.wins}–${row.nonconference.losses}` : '—',
      winRateBar(row?.nonconference.winRate),fmt(row?.predictive.mean,3)])),'fc-conference-table'),
      'Conference membership comes from each selected season. Current records include only games available in the latest snapshot.')}
    ${panel('Recent SOR movement',changes.length ? table('Conference team rank changes',['Team','Previous','Current','Change'],
      changes.map(({team,from,to})=>values([teamLink(team,ctx.year),ordinal(from),ordinal(to),from>to ? `↑ ${from-to}` : `↓ ${to-from}`])))
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
  const tabs = viewTabs('Conference analysis',Object.entries(conferenceModes).map(([key,label])=>
    [key,label,href({view:key,b:key==='head'?b:''})]),view);
  const options = ctx.conferences.map(name=>[name,name]);
  const filters = `<form class="fc-form fc-results-filters" method="get" action="${anchor}">
    <input type="hidden" name="view" value="${view}">${seasonField(ctx)}
    ${view === 'overview' ? '' : selector('a',view==='head'?'Conference A':'Conference',
      view==='head'?[['','Choose a conference'],...options]:options, selected)}
    ${view === 'head' ? selector('b','Conference B',[['','All opponents'],...options.filter(([name])=>name!==selected)],b) : ''}
    <button>${view === 'head' ? 'Compare' : 'Apply filters'}</button></form>`;
  const detail = view==='head' ? conferenceHead(ctx,query,selected,b,href)
    : view==='strength' ? conferenceStrength(ctx,selected)
    : view==='trends' ? conferenceTrends(ctx,selected) : conferenceRecords(ctx,query,href);
  return banner('Conference Strength','Compare nonconference results, opponent quality and predictive team strength.')
    +content(ctx,`<section id="basketball-conference-results" class="fc-interior-anchor">${tabs}${filters}${detail}</section>`);
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
  return banner(picks?'Daily Picks':'Scoreboard',picks?'Saved basketball forecasts captured before a confirmed tipoff.':'Provider-published schedules and final results. Times shown in Mountain Time.')
    +content(ctx,form(seasonField(ctx)+input('date','Game date',date,'date')+confFilter(ctx,conf))
    +`<div class="fc-actions fc-date-links">${action(link(view,{season:ctx.year,date:adjacent(-1),conf}),'Previous day',true)}${action(link(view,{season:ctx.year,date:adjacent(1),conf}),'Next day',true)}</div>`
    +panel(date??'Games',gameTable(ctx,rows,{picks}),`${rows.length} games · Provider snapshot ${stamp(ctx.snapshot.asOf)}`));
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
  return banner('Model Report Card','Results for saved forecasts and a separate test on historical seasons.')+content(ctx,form(seasonField(ctx),'Show season')+`<div class="fc-stack">
    ${panel('Saved prospective forecasts',`<div class="fc-metrics">${metric('Graded',amount(live.graded))}${metric('Pending',amount(live.pending))}
      ${metric('Accuracy',pct(live.accuracy))}${metric('Brier score',fmt(live.brier,4))}
      ${metric('Excluded',amount(live.excluded))}${metric('Finals without a saved pick',amount(live.missing))}</div>${reportDetail}`)}
    ${moments}
    ${panel('Historical replay · holdout',past ? `<div class="fc-metrics">${metric('Games',amount(past.games))}${metric('Accuracy',pct(past.accuracy))}
      ${metric('Brier score',fmt(past.brier,4))}${metric('Log loss',fmt(past.logLoss,4))}
      ${metric('Margin MAE',fmt(past.marginMae,2))}${metric('Calibration gap',pct(past.calibrationError))}</div>${rows(past)}
      <p class="fc-note">Replayed using only information available before each game. These predictions are separate from the saved forecast record.</p>`
      : empty('Reproducible historical validation is not available in the local artifact yet.'))}</div>`);
}
function history(ctx,query) {
  const selected=ctx.editions.find(ed=>ed.asOf===query.get('edition'))??ctx.editions.at(-1);
  const previous=ctx.editions.find(ed=>ed.asOf===query.get('compare'))
    ??(selected?ctx.editions[ctx.editions.indexOf(selected)-1]:null);
  const rows=selected ? Object.entries(selected.teams).sort((a,b)=>a[1]-b[1]).slice(0,50) : [];
  const entries = ctx.editions.map(ed=>[ed.asOf,stamp(ed.asOf)]);
  const change = (prior,rank) => prior ? prior===rank?'↔':prior>rank?'↑'+(prior-rank):'↓'+(rank-prior):'—';
  return banner('Ranking History','Compare timestamped, saved basketball rankings. Historical season analyses are labeled separately.')
    +content(ctx,form(seasonField(ctx)+(selected?selector('edition','Edition',entries,selected.asOf):'')
      +(previous?selector('compare','Compare with',entries,previous.asOf):''))+panel('Saved SOR editions',rows.length
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
