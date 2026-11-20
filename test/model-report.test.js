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

test('report pairs the home-team benchmark and grades coverage on eligible finals only',()=>{
  const artifact={...fixture([
    game('home',28,7,.8,{neutral:false}), game('away',7,28,.25,{neutral:false}),
    game('neutral',28,7,.8,{neutral:true}), game('even',28,7,.5,{neutral:false}),
    game('missing',28,7,.8,{pick:null}), game('pending',null,null,.7,{status:'pending'}),
    game('tie',14,14,.8),
  ]),source:{pickHorizonDays:7}};
  const report=buildModelReport(artifact,'regular:11');
  assert.deepEqual(report.homeBenchmark,{games:2,modelCorrect:2,homeCorrect:1});
  assert.equal(report.eligibleFinals,5);
  assert.equal(report.firstSavedAt,'2026-11-09T12:00:00.000Z');
  assert.equal(report.scores.season.completedPicks,4);
  const markup=modelReportMarkup(report);
  assert.match(markup,/4 of 5 eligible finals/);
  assert.match(markup,/0\.250 Brier on the same 4 finals/);
  assert.match(markup,/upcoming games up to 7 days ahead/);
});

test('2026 FBS championship week has a selector entry and an honest empty report', () => {
  const artifact = { ...fixture([
    game('week-13-final', 28, 7, .8, { week:13, startDate:'2026-11-28T20:00:00Z' }),
    game('week-15-scheduled', null, null, .7, { week:15, pick:null, status:'scheduled', startDate:'2026-12-12T20:00:00Z' }),
  ]), asOf:'2026-12-01T12:00:00Z' };
  const before = JSON.stringify(artifact);
  const report = buildModelReport(artifact, 'regular:14');
  assert.deepEqual(report.weeks, ['regular:13', 'regular:14', 'regular:15']);
  assert.equal(report.week, 'regular:14');
  assert.ok(report.championshipPending);
  assert.equal(report.scores.week, null);
  assert.deepEqual(report.scores.season, buildModelReport(artifact, 'regular:13').scores.season);
  assert.equal(buildModelReport(artifact, 'regular:15').week, 'regular:15');
  assert.equal(buildModelReport(artifact).week, 'regular:13');
  assert.equal(JSON.stringify(artifact), before);
  const markup = modelReportMarkup(report);
  assert.match(markup, /<option value="regular:14" selected>Week 14 — Conference Championship Week<\/option>/);
  assert.match(markup, /Awaiting qualifying predictions/);
  assert.match(markup, /Season saved-pick accuracy/);
  assert.doesNotMatch(markup, /Weekly saved-pick accuracy|Weekly Brier score|Results by saved favorite probability/);
  assert.ok(!buildModelReport({ ...artifact, season:2025 }, 'regular:14').weeks.includes('regular:14'));
  assert.ok(!buildModelReport(artifact, 'regular:14', 'fcs').weeks.includes('regular:14'));
});

test('published 2026 championship games use normal report scoring', () => {
  const matchup = game('141', null, null, .8, { week:14, pick:null, status:'scheduled', startDate:'2026-12-06T01:00:00Z', startTimeTbd:false });
  const pendingTime = { ...matchup, id:'142', startDate:'2026-12-05T00:00:00Z', startTimeTbd:true };
  const scheduled = buildModelReport(fixture([matchup, pendingTime]), 'regular:14');
  assert.deepEqual(scheduled.weeks, ['regular:14']);
  assert.equal(scheduled.championshipPending, false);
  const markup = modelReportMarkup(scheduled);
  assert.match(markup, /Awaiting qualifying predictions/);
  assert.match(markup, /Published Week 14 matchups/);
  assert.match(markup, /href="\/weekly-picks\?week=regular%3A14&amp;game=141"/);
  assert.match(markup, /B at A/);
  assert.match(markup, /<time datetime="2026-12-06T01:00:00Z">[^<]+ MT<\/time>/);
  assert.match(markup, /<time datetime="2026-12-05">Dec 5, 2026<\/time> · Time pending/);
  assert.doesNotMatch(markup, /matchups have not yet been confirmed|Weekly Brier score/);
  const artifact = { ...fixture([{ ...matchup, status:'final', homePoints:28, awayPoints:7,
    pick:{capturedAt:'2026-12-05T12:00:00Z', homeWinProbability:.8, favored:'home'} }]), asOf:'2026-12-06T12:00:00Z' };
  const final = buildModelReport(artifact, 'regular:14');
  assert.deepEqual(final.scores, weeklyPicksScore(artifact, 'regular:14'));
  assert.equal(final.scores.week.completedPicks, 1);
  assert.match(modelReportMarkup(final), /<dt>Weekly saved-pick accuracy<\/dt><dd>100\.0%<\/dd>/);
  assert.doesNotMatch(modelReportMarkup(final), /Awaiting qualifying predictions/);
});
