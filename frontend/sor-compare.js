import { navigateApp } from './clean-navigation.js';
import { routeHref } from './clean-routes.js';
import { formatNumber, formatProbability, formatRecord } from './format.js?v=1';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const requests = new Map();
const position = team => Number.isInteger(team?.displayRank) && team.displayRank > 0 ? team.displayRank :
  Number.isInteger(team?.sorRank) && team.sorRank > 0 ? team.sorRank : null;
const rankLabel = value => Number.isInteger(value) && value > 0 ? '#'+value : '—';

function resultEvidence(team,details,byId,games) {
  return (details?.contributions ?? []).map(game=>{
    const opponent=byId.get(game.opponentId);
    const fixture=games.get(game.gameId);
    return { ...game, opponent, venue:fixture ? fixture.neutral ? 'neutral' : fixture.home===team.id ? 'home' : 'away' : null };
  });
}

export function explainSorComparison(snapshot,a,b,detailsA,detailsB,fixtures=[]) {
  const population=a?.division==='fcs'?snapshot.fcsRankings:snapshot.rankings;
  if(!a||!b||a.id===b.id||a.division!==b.division||!['fbs','fcs'].includes(a.division)||
    !population?.some(team=>team.id===a.id)||!population?.some(team=>team.id===b.id)) {
    throw new Error('Choose two different teams in the same subdivision');
  }
  if(![a.sor,b.sor].every(Number.isFinite)||![position(a),position(b)].every(Number.isInteger)) {
    throw new Error('Published Strength of Record is unavailable for this comparison');
  }
  const byId=new Map([...snapshot.rankings,...(snapshot.fcsRankings??[])].map(team=>[team.id,team]));
  const games=new Map(fixtures.map(game=>[game.id,game]));
  const evidenceA=resultEvidence(a,detailsA,byId,games),evidenceB=resultEvidence(b,detailsB,byId,games);
  const sortWins=rows=>rows.filter(row=>row.result==='W').sort((left,right)=>
    (right.opponentAchievement??-Infinity)-(left.opponentAchievement??-Infinity)||left.gameId.localeCompare(right.gameId)).slice(0,3);
  const opponentsB=new Map();
  for(const row of evidenceB) {
    if(!opponentsB.has(row.opponentId))opponentsB.set(row.opponentId,[]);
    opponentsB.get(row.opponentId).push(row);
  }
  const common=evidenceA.filter(row=>opponentsB.has(row.opponentId)).map(row=>({
    opponentId:row.opponentId,name:row.opponentName,a:[row],b:opponentsB.get(row.opponentId),
  }));
  const headToHead=evidenceA.filter(row=>row.opponentId===b.id);
  const compared=[a,b].sort((left,right)=>position(left)-position(right));
  const tied=position(a)===position(b);
  const higher=compared[0],lower=compared[1];
  const dHigher=higher.id===a.id?detailsA:detailsB,dLower=lower.id===a.id?detailsA:detailsB;
  const probabilityText=value=>formatProbability(value,2);
  const narrative=tied ? `${a.name} and ${b.name} share SOR rank ${rankLabel(position(a))}. Their calculated SOR scores fall within the model’s ranking tolerance.` :
    `${higher.name} ranks above ${lower.name} because an average ${a.division.toUpperCase()} reference team has a smaller chance of matching its achieved record against its schedule. That chance is ${probabilityText(dHigher?.sorTailProbability)} for ${higher.name} and ${probabilityText(dLower?.sorTailProbability)} for ${lower.name}.`;
  const sosOrder=[...population].sort((left,right)=>right.achievementScheduleStrength-left.achievementScheduleStrength||
    position(left)-position(right)||left.id.localeCompare(right.id));
  const sosRanks=new Map(sosOrder.map((team,index)=>[team.id,index+1]));
  return { a,b,detailsA,detailsB,narrative,tied,common,headToHead,sosRanks,
    bestA:sortWins(evidenceA),bestB:sortWins(evidenceB),lossesA:evidenceA.filter(row=>row.result==='L'),
    lossesB:evidenceB.filter(row=>row.result==='L'),asOf:snapshot.asOf,season:snapshot.season };
}

function stat(label,value) { return `<div><dt>${label}</dt><dd>${value}</dd></div>`; }
function evidenceRow(row) {
  const opponentRank=position(row.opponent);
  const rank=row.opponent?.division ? row.opponent.division.toUpperCase()+' '+rankLabel(opponentRank) : 'Rank unavailable';
  return `<li><a href="${routeHref(`team/${encodeURIComponent(row.opponentId)}`)}">${escapeHtml(row.opponentName)}</a>
    · ${row.result==='W'?'Won':row.result==='L'?'Lost':'Tied'}${row.finalMargin ? ' by '+Math.abs(row.finalMargin) : ''}
    · ${row.venue ? row.venue==='neutral'?'Neutral site':row.venue : 'Venue not reported'}
    <small>${rank} · Opponent record ${escapeHtml(row.opponentRecord??'Not reported')}</small></li>`;
}
function resultList(title,rows) {
  return `<details class="intelligence-evidence"><summary>${title} · ${rows.length}</summary>${rows.length ?
    `<ul>${rows.map(evidenceRow).join('')}</ul>` : '<p class="compact-note">No covered results in this category.</p>'}</details>`;
}
function teamCard(team,details,best,losses,sosRanks) {
  return `<section class="panel intelligence-panel intelligence-compare-team">
    <h3><a href="${routeHref(`team/${encodeURIComponent(team.id)}`)}">${escapeHtml(team.name)}</a></h3><p class="compact-note">${escapeHtml(team.conference)} · ${team.division.toUpperCase()}</p>
    <dl class="intelligence-stat-grid">
      ${stat('Published SOR rank',rankLabel(position(team)))}${stat('SOR score',formatNumber(team.sor,4))}
      ${stat('Overall record',formatRecord(team))}${stat('SOS rank',rankLabel(sosRanks.get(team.id)))}
      ${stat('Reference-team chance',escapeHtml(formatProbability(details?.sorTailProbability,2)))}
      ${stat('Expected reference wins',formatNumber(details?.sorExpectedWins,2))}
    </dl>
    ${resultList('Best wins by opponent Colley rating',best)}${resultList('Losses',losses)}
    <a class="intelligence-team-link" href="${routeHref(`team/${encodeURIComponent(team.id)}/model`)}">Team calculation details →</a>
    </section>`;
}
export function sorComparisonMarkup(comparison) {
  const {a,b}=comparison;
  const one=(title,rows)=>`<details class="panel intelligence-disclosure"><summary>${title}</summary><div>${rows}</div></details>`;
  return `<section class="panel intelligence-panel"><h2>Why ${escapeHtml(a.name)} and ${escapeHtml(b.name)} rank here</h2>
    <p>${escapeHtml(comparison.narrative)}</p>
    <p class="compact-note">SOR evaluates achieved results and the difficulty of matching each record. The reference team and schedule probabilities use this subdivision’s published method. Current opponent ranks are shown as supporting context.</p>
    ${a.division==='fcs'?'<p class="intelligence-note">FCS SOR remains Experimental. Its reference population is FCS and its probability coefficients transfer from the FBS calibration.</p>':''}
    ${a.division==='fbs'?`<a class="text-link" href="${routeHref(`compare/matchup/${encodeURIComponent(a.id)}/${encodeURIComponent(b.id)}/neutral`)}">Explore a future matchup →</a>`:
      '<a class="text-link" href="/weekly-picks/fcs/">FCS weekly predictions →</a>'}
    </section>
    <div class="intelligence-compare-grid">
    ${teamCard(a,comparison.detailsA,comparison.bestA,comparison.lossesA,comparison.sosRanks)}
    ${teamCard(b,comparison.detailsB,comparison.bestB,comparison.lossesB,comparison.sosRanks)}
    </div>
    ${one('Head-to-head results',comparison.headToHead.length?
      `<ul class="intelligence-evidence-list">${comparison.headToHead.map(evidenceRow).join('')}</ul><p class="compact-note">Head-to-head is part of the achieved record. SOR evaluates the full schedules with the same equation.</p>`:
      '<p class="compact-note">No head-to-head game appears in the published results.</p>')}
    ${one('Common opponents',comparison.common.length?`<div class="intelligence-common">${comparison.common.map(row=>`<section><h4>${escapeHtml(row.name)}</h4><p>${escapeHtml(a.name)} · ${row.a.map(x=>x.result+' '+Math.abs(x.finalMargin)+'-point margin'+(x.venue?' · '+x.venue:'')).join(', ')}</p><p>${escapeHtml(b.name)} · ${row.b.map(x=>x.result+' '+Math.abs(x.finalMargin)+'-point margin'+(x.venue?' · '+x.venue:'')).join(', ')}</p></section>`).join('')}</div>`:'<p class="compact-note">No common opponent appears in the published results.</p>')}
    <p class="compact-note">Best wins are ordered by the opponents’ current Colley ratings, which also supply SOS. Venue and point margins describe the games. SOR uses outcomes, opponent difficulty and venue, with no margin-of-victory weight.</p>`;
}
function read(url) {
  if(!requests.has(url))requests.set(url,fetch(url).then(response=>{
    if(!response.ok)throw new Error('Team evidence unavailable');
    return response.json();
  }).catch(error=>{requests.delete(url);throw error;}));
  return requests.get(url);
}
export function mountSorComparison(container,{snapshot,dataRoot='',division='fbs',a,b,onNavigate}={}) {
  let active=true,version=0;
  const cohort=division==='fcs'?'fcs':'fbs';
  const population=cohort==='fcs'?snapshot.fcsRankings??[]:snapshot.rankings??[];
  const byId=new Map(population.map(team=>[team.id,team]));
  let selectedA=byId.has(a)?a:population[0]?.id;
  let selectedB=byId.has(b)&&b!==selectedA?b:population.find(team=>team.id!==selectedA)?.id;
  const invalid=a&&b&&a===b;
  const options=(selected,excluded)=>population.map(team=>`<option value="${escapeHtml(team.id)}"${team.id===selected?' selected':''}${team.id===excluded?' disabled':''}>${escapeHtml(team.name)}</option>`).join('');
  const controls=()=>`<div class="intelligence-toolbar"><label>Division<select data-sor-field="division"><option value="fbs"${cohort==='fbs'?' selected':''}>FBS</option><option value="fcs"${cohort==='fcs'?' selected':''}>FCS</option></select></label>
    <label>Team A<select data-sor-field="a">${options(selectedA,selectedB)}</select></label>
    <label>Team B<select data-sor-field="b">${options(selectedB,selectedA)}</select></label></div>`;
  container.innerHTML=`<div class="intelligence-tools"><h2>Compare earned rankings</h2>${controls()}${invalid?'<p class="intelligence-note">Choose a different opponent to compare two earned rankings.</p>':''}<div data-sor-evidence role="status">Loading schedule evidence…</div></div>`;
  const target=container.querySelector('[data-sor-evidence]');
  async function render() {
    const request=++version;
    if(!selectedA||!selectedB||selectedA===selectedB) {target.textContent='Choose two different teams in the same subdivision.';return;}
    target.setAttribute('aria-busy','true');
    try {
      const root=dataRoot?.replace(/\/$/,'')??'';
      const url=id=>`${snapshot.teamDetailsPath}/${encodeURIComponent(id)}.json`;
      const endpoint=cohort==='fcs'?'weekly-fcs-picks':'weekly-picks';
      const [left,right,slate]=await Promise.all([read(url(selectedA)),read(url(selectedB)),
        read(root?`${root}/${endpoint}.json`:`/${endpoint}`).catch(()=>null)]);
      if(!active||request!==version||!target.isConnected)return;
      if([left,right].some(details=>details.publicationHash!==snapshot.publicationHash))throw new Error('Team evidence does not match published rankings');
      target.innerHTML=sorComparisonMarkup(explainSorComparison(snapshot,byId.get(selectedA),byId.get(selectedB),left,right,slate?.games??[]));
    } catch {
      if(active&&request===version)target.innerHTML='<p role="status">The matching team evidence is unavailable. Reload after the next successful publication.</p>';
    } finally {if(active&&request===version)target.removeAttribute('aria-busy');}
  }
  function change(event) {
    const field=event.target.dataset.sorField;
    if(!field)return;
    const next={division:cohort,a:selectedA,b:selectedB,[field]:event.target.value};
    if(field==='division') {delete next.a;delete next.b;}
    if(next.a && next.a===next.b)return;
    if(onNavigate)onNavigate(next);
    else navigateApp(`sor-compare/${next.division}/${next.a ?? ''}/${next.b ?? ''}`);
  }
  container.addEventListener('change',change);
  void render();
  return ()=>{active=false;version++;container.removeEventListener('change',change);};
}
