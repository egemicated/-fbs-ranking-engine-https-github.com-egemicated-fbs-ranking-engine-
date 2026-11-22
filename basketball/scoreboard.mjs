import { mountScoreboard, reconcileScoreboardSlate } from '../frontend/scoreboard.js';
import { basketballHref, dayKey, escape, gameBoxScore, matchupHref, seasonLabel } from './preview-ui.mjs';

const dateLabel = new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'});
const dayMilliseconds = 86_400_000;
const teamId = /^ncaam-d1:(\d+)$/;
const emptyGroup = {games:[],forecasts:[],grades:[]};
const scheduleOptions = {includeLive:true,liveLabel:'In progress at last update',includeMyTeams:false,includeDay:false,
  includeChanges:true,rankedDivisions:['d1']};

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0,10) === value;
}

export function basketballScoreboardSelection(index, query, now = Date.now()) {
  const year = index.years.includes(Number(query.get('season'))) ? Number(query.get('season')) : index.currentSeason;
  const directory = index.directory[year];
  const day = query.get('date');
  const dates = directory.dates;
  return {year,date:validDate(day) ? day : dayKey(now),dates,historical:directory.historical,years:index.years};
}

function availableTeam(id, name, teams) {
  const ranked=teams.get(id);
  return ranked ?? (teamId.test(id) && typeof name==='string' && name.trim() ? {id,name} : null);
}

export function readBasketballScoreboardSlate({selection,snapshot,group=emptyGroup}, now=Date.now()) {
  const {year,date,dates,historical,years}=selection;
  if (year!==snapshot?.season || !validDate(date) || !Number.isFinite(Date.parse(snapshot.asOf)) ||
      !Array.isArray(snapshot.teams) || !Array.isArray(group.games) || !Array.isArray(group.forecasts) ||
      !Array.isArray(group.grades)) throw Error('Invalid published basketball schedule');
  const teams=new Map(snapshot.teams.map(team=>[team.id,{...team,division:'d1'}]));
  const scoresReported = game=>[game.homePoints,game.awayPoints].every(score=>Number.isSafeInteger(score)&&score>=0);
  const forecasts=new Map(group.forecasts), grades=new Map(group.grades);
  const seen=new Set(), games=[];
  let invalidEvents=0, duplicateEvents=0;
  for (const row of group.games) {
    const home=availableTeam(row?.home,row?.homeName,teams), away=availableTeam(row?.away,row?.awayName,teams);
    const start=Date.parse(row?.startDate);
    if (!teamId.test(row?.id) || !home || !away || home.id===away.id || !Number.isFinite(start) || dayKey(start)!==date) {
      invalidEvents++;
      continue;
    }
    if (seen.has(row.id)) { duplicateEvents++; continue; }
    seen.add(row.id);
    const final=row.completed===true && row.status==='final' && scoresReported(row);
    const state=final?'final':row.status==='in_progress'?'live':row.status==='scheduled'?'upcoming':'changed';
    const hasScore=final || state==='live' && scoresReported(row);
    const detail={final:'Final score not reported',unverified:'Final score not verified',postponed:'Postponed',cancelled:'Canceled'}[row.status];
    const saved=forecasts.get(row.id), grade=grades.get(row.id);
    const probability=saved?.homeWinProbability;
    const pick=Number.isFinite(probability) && probability>=0 && probability<=1 && Date.parse(saved.capturedAt)<start &&
      row.startTimeTbd===false && grade?.status!=='excluded' ? saved : null;
    games.push({id:row.id,state,start,timeTbd:row.startTimeTbd!==false,detail:state==='changed' ? detail : '',
      row:{...row,pick,date,season:year},teams:[{...away,score:hasScore?row.awayPoints:null},{...home,score:hasScore?row.homePoints:null}]});
  }
  const withinWindow=dates.length && dates[0]<=date && dates.at(-1)>=date;
  const noSlate=historical?'Daily scoreboards are unavailable for this historical season.'
    : withinWindow?'There are no games on this date in the publication.'
    : 'This date is outside the published daily scoreboard window.';
  const latestForecast=games.map(game=>game.row.pick?.capturedAt).filter(Boolean).sort().at(-1);
  return {key:`${year}:${date}`,year:String(year),date,years,title:dateLabel.format(new Date(date+'T12:00:00Z'))+' · '+seasonLabel(year),
    teams,games,invalidEvents,duplicateEvents,empty:games.length ? undefined : {upcoming:noSlate,final:'No published finals for this date.'},
    coverage:historical ? 'Historical daily slate unavailable' : undefined,
    publication:{season:year,asOf:snapshot.asOf},source:{scheduleAsOf:snapshot.asOf,rankingAsOf:snapshot.asOf},
    asOf:latestForecast ?? null, receivedAt:new Date(now).toISOString()};
}

const dateOffset = (date, days)=>new Date(Date.parse(date)+days*dayMilliseconds).toISOString().slice(0,10);
const boardHref = filters=>basketballHref('scoreboard',filters);

function slateControls(slate,filters) {
  const days = [[-1,'Previous day'],[1,'Next day']].map(([offset,label])=>
    `<a id="scoreboard-day-${offset<0?'previous':'next'}" class="button light small" data-scoreboard-day href="${escape(boardHref({
      season:slate.year,date:dateOffset(slate.date,offset),conf:filters.conference,
    }))}">${label}</a>`).join('');
  const seasons=slate.years.map(year=>`<option value="${year}"${String(year)===slate.year?' selected':''}>${seasonLabel(year)}</option>`).join('');
  return `<label for="scoreboard-season"><span id="scoreboard-season-label">Season</span><select id="scoreboard-season" name="season" aria-labelledby="scoreboard-season-label">${seasons}</select></label>
    <label for="scoreboard-date"><span>Game date</span><input id="scoreboard-date" type="date" name="date" value="${slate.date}"></label>
    <div class="scoreboard-day-links">${days}</div>`;
}

const format={
  title:'Basketball schedule',startTerm:'Tipoff',articleOrderKey:'ncaam-scoreboard-order-v1',favorites:false,
  sourceNote:'Published scores and tipoff times from CollegeBasketballData. Times use Mountain Time.',
  diagnosticsNote:'<p><a href="/basketball/picks/">Daily Picks</a> shows saved forecasts and their grading. The scoreboard shows the last published status for each game.</p>',
  savedTimeLabel:'Latest saved forecast on this slate',
  delayNote:'The latest status may appear in a later publication.',
  formatRank:rank=>Number.isInteger(rank)&&rank>=1&&rank<=25?`SOR #${rank}`:'',
  filterOptions:scheduleOptions, filterControls:slateControls,
  timeTbdDay:game=>dateLabel.format(new Date(game.row.date+'T12:00:00Z')),
  venue:game=>game.row.neutral?'Neutral court':'',
  details:game=>gameBoxScore(game.row),
  links(game) {
    const links=game.teams.filter(team=>team.published).map(team=>({
      href:basketballHref('teams/'+teamId.exec(team.id)[1],{season:game.row.season}),label:team.name,
    }));
    const [away,home]=game.teams;
    if (away.published && home.published) links.push({href:matchupHref(home.id,away.id,game.row.season,
      game.row.neutral?'neutral':'home'),label:'Matchup Lab'});
    links.push({href:basketballHref('picks',{season:game.row.season,date:game.row.date})+'#basketball-game-'+teamId.exec(game.id)[1],
      label:game.row.pick?'Saved prediction':'Daily Picks'});
    return links;
  },
};

async function sourceRecord(path,signal,cache='default') {
  const response=await fetch(path,{signal,cache});
  if (!response.ok) throw Error('Published basketball schedule unavailable');
  return response.json();
}

async function loadPublishedDay(signal, query) {
  const {version}=await sourceRecord('/basketball-data/latest.json',signal,'no-cache');
  if (!/^[a-f0-9]{24}$/.test(version)) throw Error('Invalid basketball publication version');
  const prefix='/basketball-data/'+version+'/';
  const index=await sourceRecord(prefix+'index.json',signal);
  const selection=basketballScoreboardSelection(index,query);
  const {year,date,dates}=selection;
  const [{snapshot},group]=await Promise.all([sourceRecord(prefix+year+'/season.json',signal),
    dates.includes(date) ? sourceRecord(prefix+year+'/slate/'+date+'.json',signal) : emptyGroup]);
  return {selection,snapshot,group};
}

function mountBasketballScoreboard(root) {
  const preview=root.dataset.scoreboardPreview || '';
  const loadSlate=async (signal,prior,query)=>{
    const bundle=preview ? await sourceRecord(preview+'?'+query,signal,'no-cache') : await loadPublishedDay(signal,query);
    const next=readBasketballScoreboardSlate(bundle);
    if (prior?.key===next.key && (Date.parse(next.source.scheduleAsOf)<Date.parse(prior.source.scheduleAsOf) ||
        !next.games.length && prior.games.length)) throw Error('The current basketball slate is temporarily unavailable');
    return reconcileScoreboardSlate(next,prior);
  };
  const url=()=>new URL(location.href);
  const filters=query=>({conference:(query.get('conf')??'').slice(0,100)});
  const current=url().searchParams;
  const board=mountScoreboard(root,(id,year,slate)=>slate.teams.get(id)?.sorRank,{
    format,loadSlate,initialQuery:current,initialFilters:filters(current),onFiltersChange(value){
      const next=url();
      if (value.conference) next.searchParams.set('conf',value.conference);
      else next.searchParams.delete('conf');
      if (next.href!==location.href) history.replaceState(history.state,'',next);
    },
  });
  let navigation=0;
  async function navigate(next, push, focus) {
    const requested=++navigation;
    const loaded=await board.selectSlate(next.searchParams,filters(next.searchParams));
    if (requested!==navigation) return;
    if (!loaded) {
      const input=root.querySelector('#scoreboard-date');
      const select=root.querySelector('#scoreboard-season');
      if (input) input.value=input.defaultValue;
      if (select) select.value=[...select.options].find(option=>option.defaultSelected)?.value ?? select.value;
      return;
    }
    if (push && next.href!==location.href) history.pushState(history.state,'',next);
    if (focus) root.querySelector('#'+focus)?.focus({preventScroll:true});
  }
  root.addEventListener('click',event=>{
    const link=event.target.closest('a[data-scoreboard-day]');
    if (!link || event.button!==0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    void navigate(new URL(link.href),true,link.id);
  });
  root.addEventListener('change',event=>{
    const input=event.target;
    if (!['scoreboard-season','scoreboard-date'].includes(input.id)) return;
    const next=url();
    if (input.name==='date'&&!validDate(input.value)) return;
    next.searchParams.set(input.name,input.value);
    if (input.name==='season') { next.searchParams.delete('conf'); next.searchParams.delete('date'); }
    void navigate(next,true,input.id);
  });
  window.addEventListener('popstate',()=>void navigate(url(),false));
}

if (typeof document!=='undefined') {
  const root=document.querySelector('[data-basketball-scoreboard]');
  if (root) mountBasketballScoreboard(root);
}
