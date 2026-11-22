import assert from 'node:assert/strict';
import test from 'node:test';
import { basketballScoreboardSelection, readBasketballScoreboardSlate } from '../basketball/scoreboard.mjs';
import { filterGames } from '../frontend/game-filters.js';

const date='2026-11-22';
const day={year:2027,date,dates:[date],historical:false,years:[2027,2026]};
const asOf='2026-11-23T13:30:00Z';
const team=(number,name,sorRank)=>({id:`ncaam-d1:${number}`,name,sorRank});
const snapshot={season:2027,asOf,teams:[team(1,'Butler',9),team(2,'Nebraska',27)]};
const game=(number,fields={})=>({id:`ncaam-d1:${number}`,home:'ncaam-d1:2',away:'ncaam-d1:1',
  homeName:'Nebraska',awayName:'Butler',startDate:'2026-11-22T17:00:00Z',startTimeTbd:false,
  status:'scheduled',completed:false,...fields});

test('basketball scoreboard uses a valid date and the selected published season',()=>{
  const index={currentSeason:2027,years:[2027,2026],directory:{
    2027:{dates:[date],historical:false},2026:{dates:[],historical:true},
  }};
  const clock=Date.parse('2026-11-23T05:20:00Z');
  assert.equal(basketballScoreboardSelection(index,new URLSearchParams('date=2026-11-31'),clock).date,date);
  assert.deepEqual(basketballScoreboardSelection(index,new URLSearchParams('season=2026&date=2025-11-10'),clock),
    {year:2026,date:'2025-11-10',dates:[],historical:true,years:[2027,2026]});
});

test('basketball scoreboard preserves actual states, verifies forecasts and keeps unknown opponents',()=>{
  const capturedAt='2026-11-21T13:38:00Z';
  const first=game(11,{status:'final',completed:true,awayPoints:69,homePoints:72});
  const result=readBasketballScoreboardSlate({selection:day,snapshot,group:{
    games:[first,first,game(12,{status:'in_progress',awayPoints:13,homePoints:15}),
      game(13,{status:'final',completed:true}),game(14,{away:'ncaam-d1:50',awayName:'Non-Division I College',startTimeTbd:true}),
      game(15,{home:'ncaam-d1:1'}),game(16),game(17,{status:'postponed'})],
    forecasts:[[first.id,{capturedAt,homeWinProbability:.45}],['ncaam-d1:14',{capturedAt,homeWinProbability:.45}],
      ['ncaam-d1:16',{capturedAt:asOf,homeWinProbability:.51}]],grades:[],
  }});
  assert.deepEqual(result.games.map(row=>row.state),['final','live','changed','upcoming','upcoming','changed']);
  assert.deepEqual(result.games[0].teams.map(row=>row.score),[69,72]);
  assert.deepEqual(result.games[1].teams.map(row=>row.score),[13,15]);
  assert.equal(result.games[2].teams[1].score,null);
  assert.equal(result.games[3].teams[0].name,'Non-Division I College');
  assert.ok(result.games[3].timeTbd);
  assert.equal(result.games[3].row.pick,null);
  assert.equal(result.games[4].row.pick,null);
  assert.equal(result.games[5].detail,'Postponed');
  assert.equal(result.asOf,capturedAt);
  assert.equal(result.source.scheduleAsOf,asOf);
  assert.equal(result.invalidEvents,1);
  assert.equal(result.duplicateEvents,1);
  const ranked=filterGames(result.games.map(row=>row.row),{ranked:true},{teams:result.teams,rankedDivisions:['d1']});
  assert.ok(ranked.length>0 && ranked.every(row=>row.away==='ncaam-d1:1'));
});

test('basketball scoreboard distinguishes an empty day from unavailable historical coverage',()=>{
  const withinWindow={...day,date:'2026-11-23',dates:[date,'2026-11-24']};
  assert.match(readBasketballScoreboardSlate({selection:withinWindow,snapshot}).empty.upcoming,/no games on this date/i);
  assert.match(readBasketballScoreboardSlate({selection:{...withinWindow,date:'2026-11-25'},snapshot}).empty.upcoming,/outside/);
  assert.match(readBasketballScoreboardSlate({selection:{...withinWindow,historical:true},snapshot}).empty.upcoming,/historical/);
});
