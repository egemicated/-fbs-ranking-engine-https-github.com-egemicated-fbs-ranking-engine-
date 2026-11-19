import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { publicFootballPageUrl } from '../frontend/game-calendar.js';
import { filterGames, gameDay } from '../frontend/game-filters.js';
import { publishDivisionSnapshot, readPublicationPolicy } from '../src/publication.js';
import { publishFcsSnapshot } from '../src/fcs-publication.js';

test('published division rankings keep unique identities, records, and ordered SOR scores', async () => {
  const input = JSON.parse(await readFile('published/latest.json', 'utf8'));
  const policy = await readPublicationPolicy();
  const snapshot = publishFcsSnapshot(publishDivisionSnapshot(input, policy), policy);
  for (const [division, rows] of [['fbs', snapshot.rankings], ['fcs', snapshot.fcsRankings]]) {
    assert.equal(new Set(rows.map(team => team.id)).size, rows.length);
    for (let index = 0; index < rows.length; index++) {
      const team = rows[index];
      assert.equal(team.division, division);
      assert.equal(team.games, team.wins + team.losses + team.ties);
      assert.ok(Number.isFinite(team.sor));
      assert.ok(Number.isInteger(team.displayRank ?? team.sorRank));
      if (index) assert.ok(rows[index - 1].sor >= team.sor, 'SOR order');
    }
  }
  assert.equal(snapshot.snapshotHash, input.snapshotHash);
});

test('shared matchup URLs reject identical IDs and team cards use crawlable profiles', () => {
  assert.equal(publicFootballPageUrl('#compare/matchup/254/254/home'), null);
  assert.equal(publicFootballPageUrl('#compare/matchup/254/252/away'), 'https://www.thegamesdecide.com/#compare/matchup/254/252/away');
  assert.equal(publicFootballPageUrl('#team/252'), 'https://www.thegamesdecide.com/team/252/');
});

test('shared game filters preserve zero/missing distinctions and Mountain day boundaries', () => {
  const teams = new Map([['a',{division:'fbs',conference:'SEC',displayRank:2}],['b',{division:'fbs',conference:'Big Ten',displayRank:50}]]);
  const game = {id:'1',home:'a',away:'b',startDate:'2026-11-19T01:00:00Z',status:'scheduled',pick:{homeWinProbability:.5}};
  assert.equal(gameDay(game), '2026-11-18');
  assert.equal(gameDay({...game,startDate:'2026-09-05T06:30:00Z'}), '2026-09-05');
  assert.equal(filterGames([game],{scope:'mine'},{teams,myTeamIds:[]}).length,0);
  assert.equal(filterGames([game],{scope:'mine',ranked:true},{teams,myTeamIds:['a']}).length,1);
  assert.equal(filterGames([game],{conference:'ACC'},{teams}).length,0);
  assert.equal(filterGames([game],{close:true},{teams}).length,1);
  assert.equal(filterGames([{...game,pick:null}],{close:true},{teams}).length,0);
  assert.equal(filterGames([{...game,status:'final',homePoints:0,awayPoints:0}],{close:true},{teams}).length,1);
  assert.equal(filterGames([{...game,status:'final',homePoints:null,awayPoints:null}],{close:true},{teams}).length,0);
});
