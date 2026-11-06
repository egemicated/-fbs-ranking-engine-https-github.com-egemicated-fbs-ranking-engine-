import test from 'node:test';
import assert from 'node:assert/strict';
import { solveGraph } from '../../src/engine.js';
import { calculateSor, SOR_DEFAULT_PARAMETERS } from './sor_candidate.mjs';

const teams = ['a','b','c','d','idle'].map(id => ({ id, name: id.toUpperCase(), division: id === 'd' ? 'fcs' : 'fbs' }));
const data = () => ({ teams: structuredClone(teams), games: [
  { id:'1', a:'a', b:'b', outcome:1, venue:1 },
  { id:'2', a:'a', b:'b', outcome:-1, venue:-1 }, // Exactly one rematch occurrence must be removed.
  { id:'3', a:'b', b:'c', outcome:1, venue:0 },
  { id:'4', a:'c', b:'d', outcome:1, venue:-1 },
  { id:'5', a:'d', b:'a', outcome:-1, venue:1 },
  { id:'6', a:'d', b:'b', outcome:1, venue:0 }
] });

function bruteRatings(dataset) {
  const indices = new Map(dataset.teams.map((t, i) => [t.id,i]));
  const edges = [], rhs = new Float64Array(dataset.teams.length);
  for (const g of dataset.games) {
    const a = indices.get(g.a), b = indices.get(g.b);
    edges.push([a,b]); rhs[a] += g.outcome / 2; rhs[b] -= g.outcome / 2;
  }
  const fitted = solveGraph(dataset.teams.length,edges,rhs,2).map(x=>x+.5);
  return new Map(dataset.teams.map((t,i)=>[t.id,fitted[i]]));
}

function enumeratedTail(probabilities, wins) {
  let total = 0;
  // Independent exhaustive outcome enumeration checks the implementation's DP.
  for (let outcome = 0; outcome < 2 ** probabilities.length; outcome++) {
    let count = 0, probability = 1;
    for (let j=0;j<probabilities.length;j++) {
      const won = (outcome & (2 ** j)) !== 0;
      count += Number(won);
      probability *= won ? probabilities[j] : 1-probabilities[j];
    }
    if (count >= wins) total += probability;
  }
  return total;
}

function bruteSor(dataset, parameters = SOR_DEFAULT_PARAMETERS) {
  const probabilities = new Map(dataset.teams.filter(t=>t.division==='fbs').map(t=>[t.id,[]]));
  const wins = new Map([...probabilities.keys()].map(id=>[id,0]));
  for (let i=0;i<dataset.games.length;i++) {
    const game = dataset.games[i];
    const reduced = { ...dataset, games: dataset.games.filter((_,j)=>j!==i) };
    const ratings = bruteRatings(reduced);
    const reference = [...probabilities.keys()].reduce((s,id)=>s+ratings.get(id),0)/probabilities.size;
    for (const [id,opponent,outcome,venue] of [[game.a,game.b,game.outcome,game.venue],[game.b,game.a,-game.outcome,-game.venue]]) {
      if (!probabilities.has(id)) continue;
      const p=1/(1+Math.exp(-(parameters.slope*(reference-ratings.get(opponent))+parameters.homeLogOdds*venue)));
      probabilities.get(id).push(p);
      wins.set(id,wins.get(id)+Number(outcome>0));
    }
  }
  return new Map([...probabilities].map(([id,ps])=>[id,{ expectedWins:ps.reduce((s,p)=>s+p,0), tail:enumeratedTail(ps,wins.get(id)) }]));
}

test('exact LOO SOR matches complete refits and exhaustive outcome probabilities, including rematches',()=>{
  const fixture=data(), actual=calculateSor(fixture), expected=bruteSor(fixture), ratings=bruteRatings(fixture);
  assert.equal(actual.referenceFbsCount,4);
  for (const row of actual.rows) {
    assert.ok(Math.abs(row.colley-ratings.get(row.id))<1e-10);
    assert.ok(Math.abs(row.expectedWins-expected.get(row.id).expectedWins)<1e-10);
    assert.ok(Math.abs(row.tail-expected.get(row.id).tail)<1e-10);
    assert.ok(Math.abs(row.sor+Math.log10(expected.get(row.id).tail))<1e-10);
  }
});

test('opposite edge orientation preserves scores and venue effects',()=>{
  const fixture=data(), flipped=structuredClone(fixture);
  flipped.games=flipped.games.map(g=>({ ...g,a:g.b,b:g.a,outcome:-g.outcome,venue:-g.venue }));
  const before=calculateSor(fixture), after=calculateSor(flipped);
  for (const row of before.rows) {
    const other=after.rows.find(t=>t.id===row.id);
    assert.ok(Math.abs(row.sor-other.sor)<1e-10);
    assert.ok(Math.abs(row.expectedWins-other.expectedWins)<1e-10);
    assert.equal(row.sorRank,other.sorRank);
  }
});

test('input order, conference labels, team names and extraneous poll/margin fields do not affect numeric results',()=>{
  const fixture=data(), before=calculateSor(fixture), changed=structuredClone(fixture);
  changed.teams.reverse().forEach(t=>{t.name='Renamed';t.conference='Prestige';t.pollRank=1;});
  changed.games.reverse().forEach(g=>{g.finalMargin=1000;g.humanRank=1;});
  const after=calculateSor(changed);
  const numeric=rows=>rows.map(({team,...r})=>r);
  assert.deepEqual(numeric(before.rows),numeric(after.rows));
});

test('idle FBS teams are included in the reference population and remain unranked',()=>{
  const result=calculateSor(data()), idle=result.rows.find(t=>t.id==='idle');
  assert.equal(idle.games,0); assert.equal(idle.colley,.5); assert.equal(idle.tail,1);
  assert.equal(idle.expectedWins,0); assert.equal(idle.sorRank,null); assert.equal(idle.colleyRank,null);
  const empty=calculateSor({teams:structuredClone(teams),games:[]});
  assert.equal(empty.rows.length,4);
  assert.ok(empty.rows.every(t=>t.sorRank===null&&t.colleyRank===null&&t.tail===1));
});

test('equal evidence shares rank and lower-division teams are modeled but not published',()=>{
  const fixture={teams:['a','b','c','d'].map(id=>({id,name:id,division:'fbs'})),games:[
    {id:'one',a:'a',b:'b',outcome:1,venue:0},{id:'two',a:'c',b:'d',outcome:1,venue:0}]};
  const rows=calculateSor(fixture).rows;
  assert.equal(rows.find(t=>t.id==='a').sorRank,1);
  assert.equal(rows.find(t=>t.id==='c').sorRank,1);
  assert.equal(rows.find(t=>t.id==='b').sorRank,3);
  assert.equal(calculateSor(data()).rows.some(t=>t.id==='d'),false);
});

test('neutral and custom zero-home effects agree with brute force; function does not mutate inputs',()=>{
  const fixture=data(), saved=structuredClone(fixture), parameters={slope:5,homeLogOdds:0}, expected=bruteSor(fixture,parameters);
  for (const row of calculateSor(fixture,parameters).rows) assert.ok(Math.abs(row.tail-expected.get(row.id).tail)<1e-10);
  assert.deepEqual(fixture,saved);
});

test('non-FBS zero-outcome context edges contribute to the Laplacian without inventing FBS ties',()=>{
  const fixture={teams:[{id:'a',name:'A',division:'fbs'},{id:'b',name:'B',division:'fcs'},{id:'c',name:'C',division:'ii'}],games:[
    {id:'win',a:'a',b:'b',outcome:1,venue:0},
    {id:'context',a:'b',b:'c',outcome:0,venue:1}
  ]};
  const result=calculateSor(fixture).rows[0];
  const without=calculateSor({...fixture,games:fixture.games.slice(0,1)}).rows[0];
  assert.equal(result.games,1); assert.equal(result.wins,1); assert.equal(result.losses,0);
  assert.ok(Math.abs(result.colley-without.colley)>1e-3);
  assert.ok(Math.abs(result.colley-bruteRatings(fixture).get('a'))<1e-10);
  assert.ok(Math.abs(result.tail-bruteSor(fixture).get('a').tail)<1e-10);
  assert.throws(()=>calculateSor({...fixture,games:[{...fixture.games[0],outcome:0}]}),/decisive FBS/);
});

test('rejects bad identities, duplicate occurrences, ties and invalid venues',()=>{
  const mutate=fn=>{const fixture=data();fn(fixture);return fixture;};
  for (const bad of [
    mutate(d=>d.teams.push({...d.teams[0]})),
    mutate(d=>d.games[0].b='missing'),mutate(d=>d.games[0].b=d.games[0].a),
    mutate(d=>d.games.push({...d.games[0]})),mutate(d=>d.games[0].outcome=0),
    mutate(d=>d.games[0].venue=2),mutate(d=>d.games[0].venue=false),
    mutate(d=>d.games[0].id=1),mutate(d=>d.teams.forEach(t=>t.division='fcs'))
  ]) assert.throws(()=>calculateSor(bad));
});

test('rejects nonfinite, negative or unrecognized parameters',()=>{
  for (const p of [{slope:0},{slope:NaN},{slope:Infinity},{homeLogOdds:-1},{homeLogOdds:Infinity},{homeLogOdds:'0'},{pollWeight:1},null,[]]) {
    assert.throws(()=>calculateSor(data(),p));
  }
});
