import { predictBasketball } from './model-forecast.js';
import { action, accent, banner, basketballHref as link, dayKey, empty, escape as e, fmt, has, input, matchupHref,
  metric, ordinal, panel, pct, seasonLabel, selector, stamp, teamHref, teamIdentity, teamLink, teamRecord } from './preview-ui.mjs';

const models = {
  sor: ['Strength of Record', 'sorRank', 'sorScore'],
  predictive: ['Predictive Strength', 'predictiveRank', 'predictiveScore'],
  performance: ['Performance Experimental', 'performanceRank', 'performanceScore'],
};
const formatValue = (value, model) => fmt(value, model === 'sor' ? 3 : 1);
const order = field => (a,b) => (a[field] ?? Infinity) - (b[field] ?? Infinity) || a.name.localeCompare(b.name);
const amount = value => Number.isFinite(value) ? new Intl.NumberFormat('en-US').format(value) : '—';

export function portal() {
  return `<section class="fc-hero"><div class="wrap fc-hero-content"><div>
    <p class="fc-kicker">The Games Decide · Independent college sports analytics</p>
    <h1>Results over<span>reputation.</span></h1><p>See what teams have earned, who they beat, and what the next matchup might bring.</p>
    </div></div></section><div class="wrap fc-content fc-grid">
    <article class="fc-portal-card"><h2>College Football</h2><p>FBS and FCS rankings, matchups, picks, and the road to the playoff.</p>${action('/football/', 'Explore football')}</article>
    <article class="fc-portal-card"><h2>College Basketball</h2><p>Division I rankings, team and conference analysis, and the road to March Madness.</p>${action('/basketball/', 'Explore basketball')}</article>
    </div>`;
}

const fresh = ctx => ctx.snapshot ? `<p class="fc-fresh">${seasonLabel(ctx.year)} · Provider snapshot <strong>${stamp(ctx.snapshot.asOf)}</strong>
  · ${ctx.historical ? 'Retrospective season analysis' : 'Private publication'} · ${e(ctx.snapshot.modelVersion)}</p>` : '';
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
const back = (view, ctx, page, total, flags = {}) => {
  const pages = Math.max(1, Math.ceil(total / 24));
  return pages > 1 ? `<nav class="fc-page-nav" aria-label="Results pages">
    ${page > 1 ? action(link(view, {...flags,season:ctx.year,p:page-1}), 'Previous', true) : ''}
    <span>Page ${page} of ${pages}</span>${page < pages ? action(link(view,{...flags,season:ctx.year,p:page+1}),'Next',true) : ''}</nav>` : '';
};
const pageFor = (query, rows) => {
  const page = Math.min(Math.max(1,Math.ceil(rows.length/24)),Math.max(1,Number.parseInt(query.get('p'),10)||1));
  return { page, shown:rows.slice((page-1)*24,page*24) };
};
const teamById = (ctx, id, name) => ctx.teams.get(id) ?? {name:name ?? 'Unknown team'};
const dateLabels = games => games.filter(g=>g.startDate).map(g=>dayKey(g.startDate));
const rate = (a,b) => a+b>0 ? a/(a+b) : null;

function card(team, year) {
  return `<a class="fc-team-card" style="--fc-accent:${accent(team)}" href="${teamHref(team.id,year)}">
    <span>${teamIdentity(team)}<small>${e(team.conference ?? 'Unassigned')} · ${teamRecord(team)}</small></span>
    <span class="fc-team-rank" aria-label="SOR rank ${team.sorRank ?? 'unavailable'}">${ordinal(team.sorRank)}</span></a>`;
}
function gameTable(ctx,games,{picks=false,subject=null}={}) {
  if (!games.length) return empty('No games match these filters.');
  return table('College basketball games', ['Tipoff / status','Away','Home','Final / forecast'],games.map(game=>{
    const h = teamById(ctx,game.home,game.homeName), a = teamById(ctx,game.away,game.awayName);
    const record = ctx.forecasts.get(game.id);
    const winner = game.completed ? (game.homePoints>game.awayPoints ? h.name : a.name) : null;
    const favorite = record ? record.homeWinProbability > .5 ? h : a : null;
    const eligible = record ? ctx.forecastReportById.get(game.id)?.status !== 'excluded' : false;
    const gameStatus = game.completed ? 'Final'
      : game.status === 'scheduled' && !game.startTimeTbd && Date.parse(game.startDate) < Date.now()
        ? 'Awaiting final' : game.status === 'scheduled' ? 'Scheduled' : String(game.status ?? 'Unconfirmed').replaceAll('_',' ');
    const teamWins = subject ? (subject === game.home ? game.homePoints>game.awayPoints : game.awayPoints>game.homePoints) : null;
    const result = winner ? `<strong>${game.awayPoints}–${game.homePoints}</strong> ${subject
      ? `<span class="${teamWins?'fc-win':'fc-loss'}">${teamWins?'W':'L'}</span>` : ''} <small>${e(winner)} wins</small>` : picks ? '' : '—';
    const pick = record && eligible ? `<strong>${e(favorite.name)} · ${pct(Math.max(record.homeWinProbability,1-record.homeWinProbability))}</strong>
      <small>Saved ${stamp(record.capturedAt)}${game.completed ? ` · ${ctx.forecastReportById.get(game.id)?.right === 1 ? 'Correct' : 'Miss'}` : ''}</small>`
      : record ? '<small>Saved forecast excluded</small>' : '<small>No saved pre-tipoff forecast</small>';
    const matchup = h.id && a.id ? `<small><a href="${matchupHref(h.id,a.id,ctx.year,game.neutral?'neutral':'home')}">Matchup Lab</a></small>` : '';
    const boxes = game.completed && game.box?.away && game.box?.home ? `<details class="fc-box">
      <summary>Team box score</summary><dl>${[['possessions','Possessions'],['offensiveRebounds','Off. rebounds'],
      ['defensiveRebounds','Def. rebounds'],['turnovers','Turnovers']].map(([key,label])=>
        `<dt>${label}</dt><dd>${amount(game.box.away[key])} / ${amount(game.box.home[key])}</dd>`).join('')}</dl>
      <small>Away / home</small></details>` : '';
    return values([
      {value:`<strong class="fc-chip">${e(gameStatus)}</strong><small>${game.startTimeTbd ? `${e(game.startDate ? dayKey(game.startDate) : '')} · Time TBD` : stamp(game.startDate)}</small>`,cls:'fc-game-meta'},
      teamLink(a,ctx.year),teamLink(h,ctx.year),
      {value:`${result}${picks ? pick : ''}${matchup}${boxes}`,cls:'fc-game-meta'}
    ]);
  }));
}

function homepage(ctx) {
  if (!ctx.snapshot) return banner('College Basketball','Division I men’s basketball intelligence.') + content(ctx,noData());
  const top = [...ctx.teams.values()].filter(t=>t.sorRank).sort(order('sorRank')).slice(0,5);
  const provisional = !ctx.historical && [...ctx.teams.values()].some(team=>team.provisional);
  const upcoming = ctx.dataset.games.filter(g=>!g.completed && g.status==='scheduled' && g.startDate &&
    Date.parse(g.startDate)>Date.now()).sort((a,b)=>a.startDate.localeCompare(b.startDate));
  const latest = ctx.dataset.games.filter(g=>g.completed && g.divisionOne).sort((a,b)=>b.startDate.localeCompare(a.startDate));
  const matchup = upcoming.find(g=>ctx.forecasts.has(g.id));
  const strength = [...ctx.teams.values()].sort(order('predictiveRank')).find(t=>t.predictiveRank);
  const performance = [...ctx.teams.values()].sort(order('performanceRank')).find(t=>t.performanceRank);
  const conf = conferenceData(ctx);
  const confSummary = [...conf.records].sort((a,b)=>(rate(b[1].wins,b[1].losses)??0)-(rate(a[1].wins,a[1].losses)??0)).slice(0,5);
  const highlight = matchup ? gameTable(ctx,[matchup],{picks:true}) : empty('No eligible saved pre-tipoff forecast in this publication.');
  return `<section class="fc-hero"><div class="wrap fc-hero-content">
    <div><p class="fc-kicker">${seasonLabel(ctx.year)} · Division I Men’s Basketball</p><h1>College <span>Basketball.</span></h1>
    <p>Independent rankings, opponent-adjusted forecasts, and the road to March Madness. See the games that put teams where they stand.</p>
    <div class="fc-actions">${action(link('rankings',{season:ctx.year}),'Explore rankings')}${action(link('march-madness',{season:ctx.year}),'March Madness',true)}</div></div>
    <aside class="fc-top" aria-label="Top five Strength of Record"><h2>SOR Top Five</h2>
    ${top.map(t=>`<a class="fc-top-row" href="${teamHref(t.id,ctx.year)}" style="--fc-accent:${accent(t)}">
      <span>${t.sorRank}</span>${teamIdentity(t)}<span>${teamRecord(t)}</span></a>`).join('')}
    ${top.length ? '' : '<p>No rankings available.</p>'}</aside></div></section>
    ${content(ctx,`<div class="fc-grid">
      <div class="fc-stack">${panel('Recent finals',gameTable(ctx,latest.slice(0,5)))}
      ${panel('Upcoming games',gameTable(ctx,upcoming.slice(0,5)),'Times shown in Mountain Time')}
      ${panel('Find a team',`<form class="fc-form" action="${link('teams')}" method="get">${yearField(ctx)}${input('q','School or mascot','','search')}<button>Search teams</button></form>`)}</div>
      <div class="fc-stack">${panel('Featured forecast',highlight)}${panel('Model leaders',`<div class="fc-metrics">
        ${metric('Predictive Strength', strength?.name ?? 'Unavailable', strength ? ordinal(strength.predictiveRank) : '')}
        ${metric('Performance Experimental', performance?.name ?? 'Unavailable', performance ? ordinal(performance.performanceRank) : '')}
        </div><p class="fc-note">${provisional ? 'Early-season ranks are provisional. ' : ''}${ctx.editions.length>1 ? 'Ranking movement is available in Ranking History.' : 'Movement will appear after a second saved edition.'}</p>`)}
      ${panel('Conference results', confSummary.length ? table('Nonconference results',['Conference','W–L'],confSummary.map(([name,r])=>values([`<a href="${link('conferences',{season:ctx.year,a:name})}">${e(name)}</a>`,`${r.wins}–${r.losses}`]))) : empty('No qualifying interconference results.'))}
      ${panel('Model report',`<div class="fc-metrics">${metric('Saved forecasts',amount(ctx.report.forecasts))}${metric('Graded accuracy',pct(ctx.report.accuracy),ctx.report.graded ? `${ctx.report.graded} games` : 'Awaiting results')}</div>${action(link('model-reports',{season:ctx.year}),'Open model report',true)}`)}
      </div></div>`)}`;
}

function rankings(ctx,query,directory=false) {
  const view = directory?'teams':'rankings';
  const model = Object.hasOwn(models,query.get('model')) ? query.get('model') : 'sor';
  const [name,rank,score] = models[model], conf=orderFilter(query.get('conf')??''), q=orderFilter(query.get('q')??'');
  const sort = query.get('sort') ?? 'rank';
  let rows = [...ctx.teams.values()].filter(t=>(!q||has(t,q))&&(!conf||t.conference===conf));
  rows.sort(sort==='name' ? (a,b)=>a.name.localeCompare(b.name) : sort==='sos'
    ? (a,b)=>(b.scheduleStrength??-1)-(a.scheduleStrength??-1)||order(rank)(a,b) : order(rank));
  const {page,shown}=pageFor(query,rows);
  const prev = ctx.editions.length>1 ? ctx.editions.at(-2)?.teams : null;
  const body = directory ? `<div class="fc-cards">${shown.map(t=>card(t,ctx.year)).join('')}</div>` : table(name,
    ['Rank','Team','Record','Score',{text:'Opp. Colley',phone:false},{text:'Off / Def per 100',phone:false}],shown.map(t=>{
      const movement = model==='sor' && t.sorRank && prev?.[t.id] ? prev[t.id]-t.sorRank : null;
      return values([`<strong>${ordinal(t[rank])}</strong>${movement!==null ? ` <span class="fc-chip" aria-label="Rank movement ${movement}">${movement>0?'↑'+movement:movement<0?'↓'+(-movement):'↔'}</span>` : ''}`,
        `${teamLink(t,ctx.year)}<small>${e(t.conference??'Unassigned')}${t.provisional?' · Provisional':''}</small>`,
        teamRecord(t), formatValue(t[score],model), {value:fmt(t.scheduleStrength,3),cls:'fc-hide-phone'},
        {value:`${fmt(t.adjustedOffense)} / ${fmt(t.adjustedDefense)}`,cls:'fc-hide-phone'}]);
    }));
  return banner(directory?'Teams':'Basketball rankings',directory?'Search NCAA Division I men’s teams by school, mascot, or conference.':'Three rankings for three different questions.')
  + content(ctx,form(seasonField(ctx)+input('q','School or mascot',q,'search')+confFilter(ctx,conf)
    +(directory?'':selector('model','Model',Object.entries(models).map(([key,val])=>[key,val[0]]),model))
    +selector('sort','Sort by',[['rank','Rank'],['name','Team name'],['sos','Schedule strength']],sort))
    + panel(directory?'Division I team directory':name,rows.length
      ? body+back(view,ctx,page,rows.length,{model,q,conf,sort}) : empty('No teams match your filters.'),resultCount(rows,ctx,directory)));
}

function resultCount(rows, ctx, directory) {
  return `${rows.length} ${rows.length===1?'team':'teams'}${directory?'':' · Opponent Colley measures schedule difficulty'}${ctx.historical?' · Retrospective':''}`;
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
      ${estimate.provisional ? 'Early-season estimate. ' : ''}Hypothetical matchup.</p></div>`,ctx.snapshot.modelConfig.id)
    +`<div class="fc-grid fc-gap">${panel('Team evidence',table('Matchup statistics',['Metric',h.name,a.name],fields.map(([label,format])=>
      values([e(label),format(h),format(a)]))))}
    ${panel('Head-to-head this season', gameTable(ctx,paired)+`<div class="fc-actions">${action(link('methodology',{season:ctx.year}),'How forecasts work',true)}</div>`)}</div>`);
}

function conferenceData(ctx) {
  const records = new Map(ctx.conferences.map(name=>[name,{wins:0,losses:0,predictive:[],teams:0}]));
  const head = new Map();
  for (const t of ctx.teams.values()) {
    const r=records.get(t.conference); if(!r) continue;
    r.teams++; if (Number.isFinite(t.predictiveScore)) r.predictive.push(t.predictiveScore);
  }
  for(const game of ctx.dataset.games) {
    if(!game.completed || !game.divisionOne || game.conferenceGame) continue;
    const h=ctx.teams.get(game.home)?.conference, a=ctx.teams.get(game.away)?.conference;
    if(!h||!a||h===a||!records.has(h)||!records.has(a)) continue;
    const winner = game.homePoints>game.awayPoints?h:a, loser=winner===h?a:h;
    records.get(winner).wins++; records.get(loser).losses++;
    for(const [x,y] of [[h,a],[a,h]]) {
      const key=x+'\0'+y, row=head.get(key)??{wins:0,losses:0,games:[]};
      row[x===winner?'wins':'losses']++; row.games.push(game); head.set(key,row);
    }
  }
  return {records,head};
}
function conferences(ctx,query) {
  const {records,head}=conferenceData(ctx), conf=ctx.conferences, a=query.get('a')??'', b=query.get('b')??'';
  const quality = ctx.conferenceQuality;
  const filter = form(seasonField(ctx)+selector('a','Conference A',[['','All conferences'],...conf.map(c=>[c,c])],a)
    +selector('b','Conference B',[['','All opponents'],...conf.map(c=>[c,c])],b),'Compare');
  const ranks=table('Conference nonconference records',['Conference','D-I teams','W–L','Win %','Mean predictive score'],[...records]
    .sort((x,y)=>(rate(y[1].wins,y[1].losses)??-1)-(rate(x[1].wins,x[1].losses)??-1))
    .map(([name,r])=>values([`<a href="${link('conferences',{season:ctx.year,a:name})}">${e(name)}</a>`,String(r.teams),
      `${r.wins}–${r.losses}`,pct(rate(r.wins,r.losses)),fmt(r.predictive.length ? r.predictive.reduce((sum,x)=>sum+x,0)/r.predictive.length : null,3)])));
  const opts = a && records.has(a) ? (b && records.has(b) ? head.get(a+'\0'+b)?.games??[]
    : [...head].filter(([key])=>key.startsWith(a+'\0')).flatMap(([,r])=>r.games)) : [];
  const details = a && records.has(a) ? panel(b?`${a} vs ${b}`:`${a} results`,gameTable(ctx,opts)) : '';
  const members = a && records.has(a) ? [...ctx.teams.values()].filter(t=>t.conference===a).sort(order('sorRank')) : [];
  const ranked = members.filter(t=>t.sorRank);
  const meanRank = ranked.length ? ranked.reduce((sum,t)=>sum+t.sorRank,0)/ranked.length : null;
  const membership = members.length ? panel(`${a} membership`,table('Conference member rankings',
    ['Team','Conference record','SOR rank','Predictive rank','Opp. Colley'],members.map(t=>values([
      teamLink(t,ctx.year),`${t.conferenceWins??0}–${t.conferenceLosses??0}`,ordinal(t.sorRank),
      ordinal(t.predictiveRank),fmt(t.scheduleStrength,3)]))),`Average national SOR rank ${fmt(meanRank)} across ${ranked.length} ranked members.`) : '';
  const qualityTable = table('Opponent-adjusted nonconference quality',
    ['Conference','W–L','Reference wins','Win surplus','Surplus / game','Predictive median','Predictive middle 50%'],
    [...quality.rows].sort((x,y)=>(y.nonconference.surplusPerGame??-2)-(x.nonconference.surplusPerGame??-2))
      .map(({conference,nonconference:r,predictive})=>values([
        `<a href="${link('conferences',{season:ctx.year,a:conference})}">${e(conference)}</a>`,
        `${r.wins}–${r.losses}`,fmt(r.expectedWins,2),fmt(r.winSurplus,2),
        `${fmt(r.surplusPerGame,3)}${r.limitedSample ? '<small>Small sample</small>' : ''}`,
        fmt(predictive.median,3),`${fmt(predictive.q1,3)} to ${fmt(predictive.q3,3)}`])));
  const matrix = table('Conference head-to-head record',['Conference',...conf],conf.map(x =>
    `<tr><th scope="row"><span>${e(x)}</span></th>${conf.map(y=>{
      const row=head.get(x+'\0'+y);
      if(!row) return '<td><span>—</span></td>';
      const style=row.wins===row.losses?'even':row.wins>row.losses?'warm':'cool';
      return `<td class="fc-heat-${style}"><a aria-label="${e(x)} vs ${e(y)}, ${row.wins} wins and ${row.losses} losses"
      href="${link('conferences',{season:ctx.year,a:x,b:y})}">${row.wins}–${row.losses}</a></td>`;
    }).join('')}</tr>`),'fc-heat');
  return banner('Conference Strength','Actual nonconference results alongside independently calculated team strength.')
    +content(ctx,filter+`<div class="fc-stack">${details}${membership}${panel('Conference summary',ranks,'Winning percentage uses D-I games between different conferences.')}
    ${panel('Opponent-adjusted conference results',qualityTable,'Win surplus shows actual wins minus the average D-I reference team’s expected wins against the same opponents at the same venues.')}
    ${panel('Head-to-head matrix',matrix,'Rows show wins and losses against each column. Blue is a winning record, tan is a losing record.')}</div>`);
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
  if (view==='teams') return rankings(ctx,query,true);
  if (view==='matchup-lab') return matchup(ctx,query);
  if (view==='conferences') return conferences(ctx,query);
  if (view==='scoreboard') return slate(ctx,query);
  if (view==='picks') return slate(ctx,query,true);
  if (view==='model-reports') return modelReport(ctx);
  if (view==='ranking-history') return history(ctx,query);
  if (view==='methodology') return methodology(ctx);
  if (view==='contest') return banner('Beat the Model','Basketball picks use a separate local practice profile.')+content(ctx,pickBoard);
  if (view==='march-madness') return banner('March Madness','Explore the official, projected, and practice brackets.')+content(ctx,'<div id="full-court-bracket"></div>');
  return null;
}
