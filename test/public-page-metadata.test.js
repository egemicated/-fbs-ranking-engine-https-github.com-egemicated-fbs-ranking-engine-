import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalPath,pageMetadata} from '../frontend/page-routes.js';

test('major public routes have independent canonical destinations, including weekly game links',()=>{
  for(const [hash,path] of [['#methodology','/methodology/'],['#beat-the-model','/beat-the-model/'],['#scoreboard','/scoreboard/'],['#compare/weekly/regular:12/401','/weekly-picks/fbs/'],['#compare/weekly/fcs/regular:12/402','/weekly-picks/fcs/'],['#polls/cfp/12','/polls/cfp/'],['#ranking-history/11','/ranking-history/']])assert.equal(canonicalPath(hash),path);
  assert.notEqual(pageMetadata('#methodology').canonical,pageMetadata('#beat-the-model').canonical);
});
test('team metadata reuses the generated team-specific publication description and image',()=>{
  const registry={'/team/252/':{title:'BYU · The Games Decide',description:'BYU published team evidence.',image:'/social/team-252.png'}};
  const metadata=pageMetadata('#team/252/players',registry);
  assert.equal(metadata.title,registry['/team/252/'].title);assert.equal(metadata.description,registry['/team/252/'].description);
  assert.equal(metadata.canonical,'https://fbs-intelligence.onrender.com/team/252/');
  assert.equal(metadata.image,'https://fbs-intelligence.onrender.com/social/team-252.png');
});
test('account and unknown routes cannot retain an unrelated public canonical or leak callback credentials',()=>{
  for(const hash of ['#account','#admin','#my-teams']){const metadata=pageMetadata(hash);assert.equal(metadata.canonical,null);assert.equal(metadata.noindex,true);}
  for(const hash of ['#access_token=private&refresh_token=private','#unknown/private']){
    const metadata=pageMetadata(hash);assert.equal(metadata.canonical,null);assert.doesNotMatch(JSON.stringify(metadata),/private/);
  }
  assert.equal(pageMetadata('#team/252',{'/team/252/':{image:'https://private.example/pixel'}}).image,'https://fbs-intelligence.onrender.com/social/platform.png');
});
