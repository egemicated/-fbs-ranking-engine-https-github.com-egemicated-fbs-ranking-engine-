import assert from 'node:assert/strict';
import test from 'node:test';
import { createMyTeamsStore, normalizeMyTeamIds } from '../frontend/my-teams-store.js';
import { myTeamSummary } from '../frontend/my-teams.js';

test('My Teams preserves order, primary choice, and additions through the shared account store', async () => {
  let data = { signedIn:true,userId:'user',teamIds:['252'],primaryTeamId:'252' };
  const store = createMyTeamsStore({read:async()=>data,save:async(ids,user)=>{
    assert.equal(user,'user');data={...data,teamIds:ids,primaryTeamId:ids[0]??null};
  }});
  assert.deepEqual((await store.load()).teamIds,['252']);
  await store.save(['252','254','252']);
  assert.deepEqual(store.getIds(),['252','254']);
  await store.setPrimary('254');
  assert.deepEqual(store.getIds(),['254','252']);
  await store.remove('254');
  assert.equal((await store.load()).primaryTeamId,'252');
  const copy=store.getIds();copy.push('1');assert.deepEqual(store.getIds(),['252']);
});

test('guest preferences cannot be saved and stale account responses cannot replace the current account', async()=>{
  const guest=createMyTeamsStore({read:async()=>({signedIn:false,teamIds:[]}),save:async()=>assert.fail('guest save')});
  await assert.rejects(guest.save(['252']),/Sign in/);
  let finish;
  let calls=0;
  const store=createMyTeamsStore({read:()=>++calls===1 ? new Promise(resolve=>{finish=resolve;}) : Promise.resolve({signedIn:true,userId:'new',teamIds:['254'],primaryTeamId:'254'})});
  const stale=store.load();
  await store.load({force:true});finish({signedIn:true,userId:'old',teamIds:['252'],primaryTeamId:'252'});await stale;
  assert.deepEqual(store.getIds(),['254']);
  assert.throws(()=>normalizeMyTeamIds(['bad']),/20 teams/);
});

test('My Teams summaries distinguish saved forecasts, missing availability, and subdivision ranks',()=>{
  const team={id:'252',name:'BYU',division:'fbs',conference:'Big 12',wins:8,losses:2,sor:2.1,displayRank:12};
  const details={upcomingGames:[{homeId:'2305',awayId:'252',opponentName:'Kansas',venue:'away',startDate:'2026-11-21T17:00:00Z',winProbability:.75,probabilitySource:'saved'}]};
  const html=myTeamSummary(team,details,null,{teams:new Map([[team.id,team]]),primary:true});
  assert.match(html,/75\.0% saved pregame win chance/);
  assert.match(html,/Availability not reported/);
  assert.match(html,/href="\/matchup-lab\?a=2305&b=252&venue=home"/);
  assert.match(html,/Predictive rank<\/dt><dd>Not reported/);
});
