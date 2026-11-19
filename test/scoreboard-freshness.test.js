import test from 'node:test';
import assert from 'node:assert/strict';
import { readScoreboardSlate, reconcileScoreboardSlate, loadScoreboard, scoreboardDelayedGames, scoreboardSignature, scoreboardTimestamp } from '../frontend/scoreboard.js';

const start='2026-11-19T00:00:00Z';
function event({id='401866467',state='pre',name='STATUS_SCHEDULED',completed=false,scores=[undefined,undefined],date=start,timeValid=true}={}){
  return{id,date,competitions:[{date,timeValid,dateValid:true,status:{type:{state,name,completed,shortDetail:completed?'Final':'Scheduled'}},competitors:['away','home'].map((homeAway,index)=>({homeAway,score:scores[index],team:{id:index?'113':'2006',displayName:index?'Massachusetts':'Akron'}}))}]};
}
const feed=events=>({season:{year:2026,type:2},week:{number:12},leagues:[{calendar:[]}],events});

test('scoreboard distinguishes scheduled, live, final, postponement and incomplete final scores',()=>{
  const slate=readScoreboardSlate(feed([
    event(),event({id:'2',state:'in',name:'STATUS_IN_PROGRESS'}),
    event({id:'3',state:'post',name:'STATUS_FINAL',completed:true,scores:['34','33']}),
    event({id:'4',name:'STATUS_POSTPONED'}),event({id:'5',state:'post',name:'STATUS_FINAL',completed:true}),
    event({id:'6',state:'post',name:'STATUS_FINAL',completed:true,scores:['0','0']}),
  ]));
  assert.deepEqual(slate.games.map(game=>game.state),['upcoming','live','final','changed','changed','final']);
  assert.equal(slate.games[4].detail,'Final score not reported');
  assert.deepEqual(slate.games[2].teams.map(team=>team.score),['34','33']);
  assert.equal(slate.needsPlay,true);
});

test('a final may be corrected but a stale scheduled/live response cannot undo the same confirmed final',()=>{
  const previous=readScoreboardSlate(feed([event({state:'post',name:'STATUS_FINAL',completed:true,scores:['34','33']})]));
  for(const incoming of [event(),event({state:'in',name:'STATUS_IN_PROGRESS',scores:['7','3']})]){
    const reconciled=reconcileScoreboardSlate(readScoreboardSlate(feed([incoming])),previous);
    assert.equal(reconciled.games[0].state,'final');assert.equal(reconciled.retainedFinals,1);
    assert.deepEqual(reconciled.games[0].teams.map(team=>team.score),['34','33']);
    assert.equal(reconciled.needsPlay,false);
  }
  const correction=reconcileScoreboardSlate(readScoreboardSlate(feed([event({state:'post',name:'STATUS_FINAL',completed:true,scores:['35','33']})])),previous);
  assert.equal(correction.games[0].teams[0].score,'35');
  const rescheduled=reconcileScoreboardSlate(readScoreboardSlate(feed([event({date:'2026-11-20T00:00:00Z'})])),previous);
  assert.equal(rescheduled.games[0].state,'upcoming');
});

test('confirmed past kickoffs warn about delayed source status but TBD times and future games do not',()=>{
  const slate=readScoreboardSlate(feed([event(),event({id:'2',timeValid:false}),event({id:'3',date:'2026-11-20T00:00:00Z'})]));
  assert.deepEqual(scoreboardDelayedGames(slate,Date.parse('2026-11-19T01:00:00Z')).map(game=>game.id),['401866467']);
  assert.equal(scoreboardDelayedGames(slate,Date.parse(start)+15*60_000).length,0);
});

test('polls request an uncached feed and record response receipt separately from source update time',async()=>{
  const calls=[],timestamp=Date.parse('2026-11-19T13:00:00Z');
  const slate=await loadScoreboard(undefined,undefined,{now:()=>timestamp,fetcher:async(url,options)=>{
    calls.push({url,options});return{ok:true,json:async()=>feed([event()])};
  }});
  assert.equal(calls.length,1);assert.equal(calls[0].options.cache,'no-store');
  assert.equal(slate.receivedAt,'2026-11-19T13:00:00.000Z');
  assert.equal(slate.sourceUpdatedAt,undefined);
  assert.equal(scoreboardTimestamp(null),'Not reported');
  assert.match(scoreboardTimestamp(timestamp),/6:00:00 AM MST/);
  assert.match(scoreboardTimestamp('2026-07-19T13:00:00Z'),/7:00:00 AM MDT/);
});

test('duplicate and malformed events are counted without inventing results; response ordering is not a score change',()=>{
  const a=event(),b=event({id:'2'});
  const slate=readScoreboardSlate(feed([a,b,a,{id:'invalid',competitions:[]}]));
  assert.equal(slate.games.length,2);assert.equal(slate.duplicateEvents,1);assert.equal(slate.invalidEvents,1);
  assert.equal(scoreboardSignature(slate),scoreboardSignature({...slate,games:[...slate.games].reverse()}));
  assert.notEqual(scoreboardSignature(slate),scoreboardSignature(readScoreboardSlate(feed([event({state:'in'}),b]))));
});

test('completed slates also retain finals across default-feed regressions and reject temporary empty responses',async()=>{
  const previous=readScoreboardSlate(feed([event({state:'post',name:'STATUS_FINAL',completed:true,scores:['34','33']})]));
  const options={now:()=>Date.parse('2026-11-19T13:00:00Z'),fetcher:async()=>({ok:true,json:async()=>feed([event()])})};
  const result=await loadScoreboard(undefined,previous,options);
  assert.equal(result.games[0].state,'final');assert.equal(result.retainedFinals,1);
  await assert.rejects(loadScoreboard(undefined,previous,{...options,fetcher:async()=>({ok:true,json:async()=>feed([])})}),/temporarily empty/);
});

test('an absent ESPN time-confirmation flag stays TBD instead of implying a confirmed kickoff',()=>{
  const game=event();delete game.competitions[0].timeValid;
  const slate=readScoreboardSlate(feed([game]));
  assert.equal(slate.games[0].timeTbd,true);
  assert.deepEqual(scoreboardDelayedGames(slate,Date.parse('2026-11-19T13:00:00Z')),[]);
});
