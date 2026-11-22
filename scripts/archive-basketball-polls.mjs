import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBasketballClient } from '../basketball/data-client.js';
import { reconcileSharedBasketballQuota } from '../basketball/managed-refresh.mjs';
import { readBasketballSitePublication } from '../basketball/site-publication.mjs';
import { BASKETBALL_POLLS, basketballPollCheckDue, basketballPollWeek, readBasketballPolls, updateBasketballPolls } from '../basketball/poll-publication.mjs';
import { atomicJson } from '../src/ingest.js';
import { RELEASE_REPOSITORY } from './require-release-checks.mjs';

const env = process.env;
if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_REPOSITORY !== RELEASE_REPOSITORY ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw Error('Use the production basketball poll workflow');

const output = async (changed, message) => {
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT,'changed='+changed+'\n');
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY,message+'\n');
  console.log(message);
};

async function archive() {
  const {manifest,files} = await readBasketballSitePublication(resolve('published/basketball-site'));
  const season = manifest.currentSeason;
  const teams = new Map(JSON.parse(files.get(season+'/season.json')).snapshot.teams.map(team=>[team.id,team]));
  const path = resolve('published/basketball-polls.json');
  const stored = await readFile(path,'utf8').then(JSON.parse).catch(error=>{
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  const previous = readBasketballPolls(stored,teams,season);
  const now = new Date();
  const mode = env.BASKETBALL_POLL_MODE || 'primary';
  if (!['primary','recovery','manual'].includes(mode)) throw Error('Unrecognized basketball poll check mode');
  if (!basketballPollCheckDue(now,mode)) return output(false,'This basketball poll check is outside its reported release window.');
  const monday = basketballPollWeek(now);
  if (monday > season + '-04-10' || monday < (season - 1) + '-10-15') {
    return output(false,'Basketball poll check is outside the committed season’s reporting window.');
  }
  if (Object.keys(BASKETBALL_POLLS).every(type=>previous.polls[type]?.pollDate>=monday)) {
    return output(false,'Both basketball polls already have dated editions for this week.');
  }
  const footballKey = env.CFBD_API_KEY;
  const basketballKey = env.CBBD_API_KEY || footballKey;
  if (!footballKey || (footballKey !== basketballKey && env.BASKETBALL_SHARED_ACCOUNT_VERIFIED !== 'true')) {
    throw Error('Basketball poll acquisition requires the approved shared football and basketball account.');
  }
  const client = createBasketballClient({token:basketballKey,maxCalls:1});
  const footballInfo = fetch('https://api.collegefootballdata.com/info',{
    headers:{Authorization:'Bearer ' + footballKey, Accept:'application/json'},
    signal:AbortSignal.timeout(12000),redirect:'error',
  }).then(response=> {
    if (!response.ok) throw Error('Football allowance could not be verified.');
    return response.json();
  });
  const [football,basketball] = await Promise.all([footballInfo,client.checkQuota()]);
  const quota = reconcileSharedBasketballQuota(football,basketball);
  if (!quota.basketballAllowedForRun || Date.parse(quota.resetAt)<=now.getTime()) {
    return output(false,'Shared balance is reserved for football and contingencies. Basketball polls retained.');
  }
  const raw = await client.request('/rankings',{season});
  const next = updateBasketballPolls(previous,raw,{teams,season,observedAt:new Date().toISOString()});
  if (next === previous) return output(false,'One poll request found no new complete edition. The prior display is retained.');
  await atomicJson(path,next);
  const published = Object.entries(next.polls).filter(([type,poll])=>poll!==previous.polls[type])
    .map(([type,poll])=>BASKETBALL_POLLS[type].name+' '+poll.pollDate);
  await output(true,'One shared call checked both basketball polls. New editions: ' + published.join(', ') + '.');
}

await archive();
