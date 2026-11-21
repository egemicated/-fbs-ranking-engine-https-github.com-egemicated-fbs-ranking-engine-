import { mountBasketballBracket } from '/basketball/basketball-bracket.js';
import { predictBasketball } from '/basketball/model-forecast.js';

const root = document.querySelector('#full-court-bracket');
const season = new URLSearchParams(location.search).get('season');
const query = season ? '?season=' + encodeURIComponent(season) : '';
try {
  const response = await fetch('/basketball-preview/bracket-data.json' + query, { credentials:'same-origin' });
  if (!response.ok) throw Error('No bracket publication');
  const {snapshot,profile} = await response.json();
  const year=snapshot.season;
  let storage;
  try {
    storage = window.localStorage;
  } catch {
    // Users can still practice when their browser restricts local storage.
  }
  mountBasketballBracket(root,{
    season:year,rankings:snapshot.teams,modelAsOf:snapshot.asOf,previewProfile:profile,storage,
    teamHref:(id,edition=year)=>'/basketball/teams/'+encodeURIComponent(id)+'/?season='+edition,
    matchupHref:(a,b,edition=year)=>'/basketball/matchup-lab/?'+new URLSearchParams({a,b,season:edition,venue:'neutral'}),
    forecast(a,b) {
      if (!snapshot.teams.some(t=>t.id===a)||!snapshot.teams.some(t=>t.id===b)) return null;
      return predictBasketball(snapshot,{home:a,away:b,neutral:true}).homeWinProbability;
    },
  });
} catch {
  root.textContent='Bracket data could not load. Reload the local page to retry.';
}
