import assert from 'node:assert/strict';
import test from 'node:test';
import {explainSorComparison,sorComparisonMarkup} from '../frontend/sor-compare.js';

const a={id:'a',name:'Alpha',division:'fbs',conference:'East',wins:8,losses:2,ties:0,displayRank:5,sor:2.2,achievementScheduleStrength:.6};
const b={id:'b',name:'Beta',division:'fbs',conference:'West',wins:9,losses:1,ties:0,displayRank:6,sor:2.1,achievementScheduleStrength:.5};
const c={id:'c',name:'Common',division:'fbs',conference:'North',wins:4,losses:6,ties:0,displayRank:80,sor:.5,achievementScheduleStrength:.4};
const snapshot={season:2026,asOf:'2026-11-18T12:00:00Z',rankings:[a,b,c]};
const game=(id,opponentId,opponentName,result,margin)=>({gameId:id,opponentId,opponentName,result,finalMargin:margin,opponentAchievement:.6,opponentRecord:'4–6'});
const left={sorTailProbability:.006,sorExpectedWins:4,contributions:[game('ab','b','Beta','W',3),game('ac','c','Common','W',7)]};
const right={sorTailProbability:.008,sorExpectedWins:5,contributions:[game('ab','a','Alpha','L',-3),game('bc','c','Common','W',10)]};

test('SOR comparison explains actual score probabilities and preserves all published inputs',()=>{
  const before=JSON.stringify({snapshot,left,right});
  const result=explainSorComparison(snapshot,a,b,left,right,[{id:'ab',home:'b',away:'a',neutral:false}]);
  assert.match(result.narrative,/Alpha ranks above Beta/);
  assert.match(result.narrative,/0.60%/);
  assert.equal(result.headToHead[0].venue,'away');
  assert.equal(result.common[0].name,'Common');
  assert.equal(result.bestA.length,2);
  const markup=sorComparisonMarkup(result);
  assert.match(markup,/Head-to-head is part of the achieved record/);
  assert.match(markup,/SOS rank/);
  assert.match(markup,/Venue not reported/);
  assert.equal(JSON.stringify({snapshot,left,right}),before);
});
test('SOR comparison rejects self and cross-division inputs and handles true shared ranks',()=>{
  assert.throws(()=>explainSorComparison(snapshot,a,a,left,left),/different teams/);
  assert.throws(()=>explainSorComparison(snapshot,a,{...b,division:'fcs'},left,right),/same subdivision/);
  const tied={...b,displayRank:5};
  const result=explainSorComparison({...snapshot,rankings:[a,tied,c]},a,tied,left,right);
  assert.match(result.narrative,/share SOR rank #5/);
  assert.match(sorComparisonMarkup(result),/Common opponents/);
});
