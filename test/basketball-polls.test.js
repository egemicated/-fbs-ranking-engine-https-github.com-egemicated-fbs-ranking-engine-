import assert from 'node:assert/strict';
import test from 'node:test';
import { basketballPollCheckDue, basketballPollWeek, readBasketballPolls, updateBasketballPolls } from '../basketball/poll-publication.mjs';

const season=2027, observedAt='2026-11-23T19:06:00Z';
const teams=new Map(Array.from({length:30},(_,i)=>['ncaam-d1:'+(i+1),{name:'School '+(i+1)}]));
const rows=(pollType,pollDate='2026-11-23T00:00:00Z')=>Array.from({length:25},(_,i)=>({
  season,seasonType:'regular',week:3,pollType,pollDate,teamId:i+1,ranking:i+1,points:1500-i,team:'Private raw name',
}));
const opts={teams,season,observedAt};

test('archives both bounded polls with observation metadata and competition ties',()=>{
  const ap=rows('AP Top 25');
  ap[18].ranking=18;
  const coaches=rows('coaches');
  const merged=updateBasketballPolls(null,[...ap,...coaches,{...ap[0],ranking:null,teamId:26}],opts);
  assert.deepEqual(Object.keys(merged.polls),['ap','coaches']);
  assert.equal(merged.polls.ap.pollDate,'2026-11-23');
  assert.equal(merged.polls.ap.observedAt,observedAt);
  assert.deepEqual(merged.polls.ap.ranks.slice(17,20).map(row=>row.rank),[18,18,20]);
  assert.deepEqual(Object.keys(merged.polls.coaches.ranks[0]),['id','rank']);
  assert.equal(readBasketballPolls(merged,teams,season),merged);
});

test('does not replace a complete prior edition on an incomplete newer poll or mutable same-date response',()=>{
  const prior=updateBasketballPolls(null,[...rows('ap','2026-11-16T00:00:00Z'),...rows('coaches','2026-11-16T00:00:00Z')],opts);
  const incomplete=rows('ap').slice(0,24);
  const sameDate=rows('coaches','2026-11-16T00:00:00Z');
  [sameDate[0].teamId,sameDate[1].teamId]=[sameDate[1].teamId,sameDate[0].teamId];
  assert.equal(updateBasketballPolls(prior,[...incomplete,...sameDate],opts),prior);
  const full=updateBasketballPolls(prior,[...incomplete,...rows('coaches')],opts);
  assert.equal(full.polls.ap,prior.polls.ap);
  assert.equal(full.polls.coaches.pollDate,'2026-11-23');
});

test('blocks unverified identity, missing dates, future dates, skipped ranks, and duplicate teams',()=>{
  const variants=[rows('ap','2026-11-24T00:00:00Z'),rows('ap',null),rows('ap'),rows('ap'),rows('ap')];
  variants[2][1].teamId=111;
  variants[3][1].teamId=1;
  variants[4][1].ranking=3;
  for (const raw of variants) assert.deepEqual(updateBasketballPolls(null,raw,opts).polls,{});
  assert.deepEqual(readBasketballPolls({season:2026,schema:1,polls:{}},teams,season),{season,schema:1,polls:{}});
});

test('uses the Eastern week for primary and conditional recovery across DST',()=>{
  assert.equal(basketballPollWeek(new Date('2026-11-23T04:59:59Z')),'2026-11-16');
  for (const day of ['2026-11-23T19:00:00Z','2026-11-24T19:00:00Z']) {
    assert.equal(basketballPollWeek(new Date(day)),'2026-11-23');
  }
  assert.equal(basketballPollWeek(new Date('2027-03-15T18:00:00Z')),'2027-03-15');
  assert.equal(basketballPollCheckDue(new Date('2026-11-23T18:59:59Z'),'primary'),false);
  assert.equal(basketballPollCheckDue(new Date('2026-11-23T19:00:00Z'),'primary'),true);
  assert.equal(basketballPollCheckDue(new Date('2026-11-24T19:00:00Z'),'primary'),false);
  assert.equal(basketballPollCheckDue(new Date('2026-11-24T13:59:59Z'),'recovery'),false);
  assert.equal(basketballPollCheckDue(new Date('2026-11-24T14:30:00Z'),'recovery'),true);
  assert.equal(basketballPollCheckDue(new Date('2027-03-15T18:00:00Z'),'primary'),true);
  assert.equal(basketballPollCheckDue(new Date('2027-03-16T13:30:00Z'),'recovery'),true);
});
