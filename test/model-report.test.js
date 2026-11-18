import assert from 'node:assert/strict';
import test from 'node:test';
import { buildModelReport, modelReportMarkup } from '../frontend/model-report.js';
import { weeklyPicksScore } from '../frontend/weekly-picks-score.js';

const team=(id,division='fbs')=>({id,name:id.toUpperCase(),division});
const capture='2026-11-09T12:00:00Z';
function game(id,homePoints,awayPoints,probability=.8,extra={}) {
  return { id,home:'a',away:'b',homePoints,awayPoints,status:'final',week:11,seasonType:'regular',
    startDate:'2026-11-14T20:00:00Z',pick:{capturedAt:capture,homeWinProbability:probability,
      favored:probability===.5?'even':probability>.5?'home':'away'},...extra };
}
function fixture(games) {
  return {season:2026,asOf:'2026-11-18T12:00:00Z',teams:[team('a'),team('b'),team('c','fcs')],games};
}
test('live report reproduces frozen weekly tally and excludes replay, estimates, late picks and ties',()=>{
  const replay={capturedAt:capture,homeWinProbability:.9,favored:'home'};
  const reportData=fixture([
    game('correct',28,7,.8),
    game('miss',14,21,.9),
    game('even',28,7,.5),
    game('tie',14,14,.6),
    game('late',28,7,.7,{pick:{...replay,capturedAt:'2026-11-15T00:00:00Z'}}),
    game('replay',28,7,.7,{pick:null,replay:{...replay,asOf:capture}}),
    game('estimate',28,7,.7,{pick:null,estimate:replay}),
    game('future',28,7,.7,{startDate:'2026-11-20T20:00:00Z'}),
    game('pending',null,null,.6,{status:'scheduled'}),
  ]);
  const before=JSON.stringify(reportData);
  const report=buildModelReport(reportData,'regular:11');
  assert.deepEqual(report.scores,weeklyPicksScore(reportData,'regular:11'));
  assert.deepEqual(report.selected.map(row=>row.id),['correct','even','miss']);
  assert.equal(report.scores.week.correctPicks,1);
  assert.equal(report.scores.week.decisivePicks,2);
  assert.equal(report.scores.week.completedPicks,3);
  assert.equal(report.bins.reduce((sum,bin)=>sum+bin.games,0),3);
  assert.equal(report.misses[0].id,'miss');
  assert.equal(report.correctCalls[0].id,'correct');
  assert.equal(report.ungraded.find(row=>row.id==='tie').reason,'Tied game, ungraded');
  assert.equal(JSON.stringify(reportData),before);
  assert.match(modelReportMarkup(report),/Historical replay validation/);
  assert.match(modelReportMarkup(report),/Small weekly sample/);
  assert.doesNotMatch(modelReportMarkup(report),/NaN|undefined/);
  assert.equal(buildModelReport({ ...reportData,games:[...reportData.games,
    game('later-estimate',null,null,.7,{week:15,pick:null,status:'scheduled',startDate:'2026-12-12T20:00:00Z'})] }).week,'regular:11');
});
test('report uses saved pregame SOR for upset labels and separates FCS population',()=>{
  const games=[game('call',28,7,.6),game('cross',28,7,.8,{away:'c'})];
  const history={editions:[
    {kind:'saved',released:'2026-11-08',asOf:'2026-11-08T12:00:00Z',rows:[{id:'a',rank:20},{id:'b',rank:5}]},
    {kind:'replay',released:'2026-11-13',asOf:'2026-11-13T12:00:00Z',rows:[{id:'a',rank:1},{id:'b',rank:30}]},
    {kind:'saved',released:'2026-11-15',asOf:'2026-11-15T12:00:00Z',rows:[{id:'a',rank:1},{id:'b',rank:30}]},
  ]};
  const report=buildModelReport(fixture(games),'regular:11','fbs',history);
  assert.equal(report.upsets[0].calledUpset,15);
  assert.equal(report.upsetCoverage,1);
  const fcs=fixture(games);
  fcs.teams=[team('a','fcs'),team('b','fcs'),team('c')];
  assert.deepEqual(buildModelReport(fcs,'regular:11','fcs').selected.map(row=>row.id),['call']);
  assert.throws(()=>buildModelReport(fixture([games[0],games[0]]),'regular:11'),/Duplicate/);
});
