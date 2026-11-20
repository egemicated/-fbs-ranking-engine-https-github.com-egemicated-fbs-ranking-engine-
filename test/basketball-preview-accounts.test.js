import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import test from 'node:test';
import {basketballPickOpen, createPreviewAccounts, gradeBasketballPick} from '../basketball/preview-accounts.mjs';

const tip = Date.parse('2026-11-21T02:00:00.000Z');
const match = {
  id:'ncaam-d1:1', home:'ncaam-d1:20', away:'ncaam-d1:21', divisionOne:true, status:'scheduled',
  startDate:new Date(tip).toISOString(), completed:false, startTimeTbd:false,
};
const submit = {season:2027, gameId:match.id, winnerId:match.home};
const alice = {action:'register',handle:'fixture-alice',name:'Fixture Alice',passphrase:'a-only-for-fixtures-passphrase'};
const bob = {action:'register',handle:'fixture-bob',name:'Fixture Bob',passphrase:'b-only-for-fixtures-passphrase'};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(),'gd-basketball-accounts-'));
  let now = tip - 2000;
  const accounts = createPreviewAccounts({directory,clock:() => now});
  const dataset = {competition:'ncaam-d1',season:2027,games:[{...match}]};
  const seasons = new Map([[2027,{dataset}]]);
  const server = createServer(async (req,res) => {
    if (await accounts.handle(req,res,{seasons})) return;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({profile:await accounts.profile(req),contest:await accounts.contest(req,dataset)}));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    await rm(directory,{force:true,recursive:true});
  });
  const profile = async cookie => (await fetch(origin + '/', {headers:cookie ? {Cookie:cookie} : {}})).json();
  const post = (path, body, cookie, initiatedBy = origin) =>
    fetch(origin + path, {method:'POST',redirect:'manual',
      headers:{Origin:initiatedBy,...(cookie ? {Cookie:cookie} : {})}, body:new URLSearchParams(body)});
  const register = async fields => {
    const response = await post('/preview-profile/',fields);
    assert.equal(response.status,303);
    assert.match(response.headers.get('location'),/notice=profile-created/);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie,/HttpOnly/);
    assert.match(cookie,/SameSite=Strict/);
    return cookie.split(';')[0];
  };
  return {dataset, post, profile, register, directory, setTime:value => { now = value; }};
}

test('private sessions omit secrets, resist login without a passphrase, and invalidate after logout', async t => {
  const f = await fixture(t);
  const token = await f.register(alice);
  assert.deepEqual(Object.keys((await f.profile(token)).profile).sort(),['handle','id','name']);
  assert.equal((await f.profile()).profile,null);
  const invalid = await f.post('/preview-profile/',{...alice,action:'login',passphrase:'not-the-right-passphrase'});
  assert.match(invalid.headers.get('location'),/notice=profile-invalid/);
  assert.equal(invalid.headers.get('set-cookie'),null);
  const signIn = await f.post('/preview-profile/',{...alice,action:'login',returnTo:'//example.com/'});
  assert.match(signIn.headers.get('location'),/^\/basketball\/contest\/\?notice=signed-in$/);
  const other = signIn.headers.get('set-cookie').split(';')[0];
  assert.notEqual(other,token);
  const signOut = await f.post('/preview-profile/',{action:'logout'},other);
  assert.match(signOut.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await f.profile(other)).profile,null);
  const onDisk = await readFile(join(f.directory,'basketball-preview-accounts.json'),'utf8');
  assert.doesNotMatch(onDisk,/a-only-for-fixtures-passphrase|gd-basketball-local/);
  assert.match(onDisk,/"password":"[a-f0-9]{64}"/);
});

test('cross-origin posts cannot create local profiles or edit picks', async t => {
  const f = await fixture(t);
  const token = await f.register(alice);
  const fake = await f.post('/basketball/contest/',submit,token,'https://cross-origin.example');
  assert.equal(fake.status,403);
  assert.deepEqual((await f.profile(token)).contest.picks,{});
  const guest = await f.post('/basketball/contest/',submit);
  assert.match(guest.headers.get('location'),/profile-required/);
});

test('server isolates season and user picks, enforces confirmed tipoff, and grades against completed game evidence', async t => {
  const f = await fixture(t);
  const [first, second] = await Promise.all([f.register(alice),f.register(bob)]);
  const rejected = await f.post('/basketball/contest/',{...submit,season:2026},first);
  assert.match(rejected.headers.get('location'),/pick-invalid/);
  const invalid = await f.post('/basketball/contest/',{...submit,winnerId:'ncaam-d1:99'},first);
  assert.match(invalid.headers.get('location'),/pick-invalid/);
  f.dataset.games[0].startTimeTbd = true;
  const tbd = await f.post('/basketball/contest/',submit,first);
  assert.match(tbd.headers.get('location'),/pick-locked/);
  f.dataset.games[0].startTimeTbd = false;
  const captured = await f.post('/basketball/contest/',submit,first);
  assert.match(captured.headers.get('location'),/pick-saved/);
  const another = await f.post('/basketball/contest/',{...submit,winnerId:match.away},second);
  assert.match(another.headers.get('location'),/pick-saved/);
  assert.equal((await f.profile(first)).contest.picks[match.id].winnerId,match.home);
  assert.equal((await f.profile(second)).contest.picks[match.id].winnerId,match.away);
  assert.deepEqual((await f.profile()).contest.picks,{});
  f.setTime(tip);
  const changed = await f.post('/basketball/contest/',{...submit,winnerId:match.away},first);
  assert.match(changed.headers.get('location'),/pick-locked/);
  Object.assign(f.dataset.games[0],{status:'final',completed:true,homePoints:73,awayPoints:59});
  assert.deepEqual((await f.profile(first)).contest,{
    picks:{[match.id]:{winnerId:match.home,savedAt:new Date(tip-2000).toISOString(),result:'correct'}},
    graded:1,correct:1,
  });
  assert.equal((await f.profile(second)).contest.picks[match.id].result,'incorrect');
});

test('manual previews distinguish unavailable or canceled games from graded wins and losses', () => {
  assert.equal(basketballPickOpen(match,tip-1),true);
  assert.equal(basketballPickOpen(match,tip),false);
  assert.equal(basketballPickOpen({...match,startTimeTbd:true},tip-1),false);
  assert.equal(basketballPickOpen({...match,divisionOne:false},tip-1),false);
  assert.equal(gradeBasketballPick({...match,status:'canceled'},match.home),'void');
  assert.equal(gradeBasketballPick({...match,status:'final',completed:true,homePoints:null,awayPoints:null},match.home),'void');
  assert.equal(gradeBasketballPick(match,match.home),'pending');
});
