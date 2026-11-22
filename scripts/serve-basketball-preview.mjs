import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createPreviewAccounts } from '../basketball/preview-accounts.mjs';
import { loadPreviewStore } from '../basketball/preview-store.mjs';
import { basketballForgePath, basketballPollRoutes } from '../basketball/preview-navigation-routes.mjs';
import { basketballScoreboardSelection } from '../basketball/scoreboard.mjs';
import { BASKETBALL_POLLS, readBasketballPolls } from '../basketball/poll-publication.mjs';
import { renderBasketballRankingComparison } from '../basketball/poll-comparison.mjs';
import { basketballForgeArchiveFile, readBasketballForgeBallots, renderBasketballForgeBallot } from '../basketball/forge-ballot.mjs';
import { action, banner, dayKey, empty, escape, html, nav, panel, previewFooter, sharedNavigationAssets, shell, teamHref } from '../basketball/preview-ui.mjs';
import { contestBoard, profilePage } from '../basketball/preview-profile-ui.mjs';
import { portal, renderBasketball } from '../basketball/preview-views.mjs';
import { teamDisplayName } from '../frontend/team-identity.js';

const project = resolve(import.meta.dirname,'..');
const types = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.woff2':'font/woff2',
  '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.xml':'application/xml',
};
const localFiles = {
  '/basketball-preview/preview.css':'basketball/preview.css',
  '/basketball-preview/reconstruction.css':'basketball/preview-reconstruction.css',
  '/basketball-preview/preview-interiors.css':'basketball/preview-interiors.css',
  '/basketball-preview/preview-interiors.js':'basketball/preview-interiors.js',
  '/basketball-preview/matchup.js':'basketball/preview-matchup.js',
  '/basketball-preview/conference.js':'basketball/preview-conference.js',
  '/basketball-preview/navigation.css':'basketball/preview-navigation.css',
  '/basketball-preview/navigation.js':'basketball/preview-navigation.js',
  '/basketball-preview/navigation-routes.mjs':'basketball/preview-navigation-routes.mjs',
  '/basketball-preview/preview-ui.mjs':'basketball/preview-ui.mjs',
  '/basketball-preview/scoreboard.mjs':'basketball/scoreboard.mjs',
  '/basketball-preview/arena.webp':'basketball/assets/arena.webp',
  '/basketball-preview/arena-mobile.webp':'basketball/assets/arena-mobile.webp',
  '/basketball-preview/masthead-football.webp':'basketball/assets/masthead-football.webp',
  '/basketball-preview/masthead-basketball.webp':'basketball/assets/masthead-basketball.webp',
  '/basketball-preview/portal.js':'basketball/preview-portal.js',
  '/basketball-preview/bracket-page.js':'basketball/preview-bracket-page.js',
  '/basketball-bracket.css':'basketball/basketball-bracket.css',
  '/basketball/basketball-bracket.js':'basketball/basketball-bracket.js',
  '/basketball/bracket.js':'basketball/bracket.js',
  '/basketball/bracket-archive.js':'basketball/bracket-archive.js',
  '/basketball/model-forecast.js':'basketball/model-forecast.js',
};
const views = new Map(nav.map(([label,path])=>[path,label]));
const forecastFields = ['id','name','mascot','conference','color','sorRank','sorScore','games','colley','elo','marginRating','adjustedOffense','adjustedDefense',
  'tempo','boxGames','recentForm','lastGameAt','performanceScore','predictiveScore'];
const sanitizeBracketData = snapshot => ({
  season:snapshot.season,asOf:snapshot.asOf,modelVersion:snapshot.modelVersion,snapshotHash:snapshot.snapshotHash,
  modelConfig:snapshot.modelConfig,leagueEfficiency:snapshot.leagueEfficiency,meanTempo:snapshot.meanTempo,
  teams:snapshot.teams.map(team=>Object.fromEntries(forecastFields.filter(key=>key in team).map(key=>[key,team[key]]))),
});
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
function send(response,status,type,body) {
  response.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Content-Security-Policy':csp,
    'X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin'});
  response.end(body);
}
const dataType = types['.json'], htmlType=types['.html'], textType='text/plain; charset=utf-8';
const scriptTag = src => `<script type="module" src="${src}"></script>`;
function notFound(profile) {
  return html({active:null,title:'Page not found',profile,body:banner('Page not found','Choose a sport to keep exploring.', 'The Games Decide')
    +`<div class="wrap fc-content">${action('/','Back to home')}</div>`});
}
function previewFootballDocument(source,profile,pathname,publication) {
  return source
    .replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/ig,'')
    .replace(/<(?:meta|link)\s+(?:name="robots"|rel="canonical")[^>]*>/ig,'')
    .replace(sharedNavigationAssets.replaceAll('/basketball-preview/','/basketball/'),'')
    .replace('<link rel="stylesheet" href="/basketball/reconstruction.css">','')
    .replace('</head>',`<meta name="robots" content="noindex,nofollow,noarchive"><link rel="stylesheet" href="/basketball-preview/reconstruction.css">${sharedNavigationAssets}</head>`)
    .replace(/<header id="header"[^>]*>[\s\S]*?<\/header>/,shell('football','',null,profile,{pathname,publication}))
    .replace(/<footer id="footer"[^>]*>[\s\S]*?<\/footer>/,previewFooter('football'));
}
function replaceFootballFunction(source, name, body='') {
  const signature=`function ${name}() {`;
  const start=source.indexOf(signature);
  const end=source.indexOf('\n}',start);
  if (start < 0 || end < 0) throw Error(`Football preview integration for ${name} must be updated.`);
  return source.slice(0,start)+signature+body+'}'+source.slice(end+2);
}
function previewFootballApp(source) {
  const favoritePrompt='<section class="my-team"><header class="my-team-heading"><h2>My Team</h2></header><div class="my-team-prompt"><p>Saved football teams are available on the live site.</p><a class="text-link" href="/teams/fbs/">Browse football teams</a></div></section>';
  const myTeamsPrompt='<section class="wrap page-content"><h1>My Teams</h1><p>Saved football teams are available on the live site. This preview uses a local profile for basketball practice picks and brackets.</p><a class="text-link" href="/teams/fbs/">Browse football teams</a></section>';
  const withoutHeader=replaceFootballFunction(source,'renderHeader');
  return replaceFootballFunction(withoutHeader,'mountHomeFavorite',`
    const target = main.querySelector('[data-my-team]');
    if (target) target.innerHTML = ${JSON.stringify(favoritePrompt)};
  `)
    .replace('function renderConnectedFeature(page, id, scope) {', `function renderConnectedFeature(page, id, scope) {
  if (page === 'my-teams') {
    main.innerHTML = ${JSON.stringify(myTeamsPrompt)};
    return;
  }`);
}

function searchPage(query, football, basketball, year) {
  const normalize=value=>value.normalize('NFKC').toLowerCase().replace(/[’']/g,'').trim();
  const words=normalize(query).split(/\s+/).filter(Boolean);
  const results=(heading, rows, directory) => {
    const matches=words.length ? rows.filter(({name})=>words.every(word=>normalize(name).includes(word))).slice(0,12) : [];
    return panel(heading,`${matches.length ? `<ul>${matches.map(({name,href,conference})=>
      `<li><a class="text-link" href="${escape(href)}">${escape(name)}</a><p>${escape(conference)}</p></li>`).join('')}</ul>`
      : empty(words.length ? 'No matching schools in this sport.' : 'Enter a school or mascot to search.')}
      ${action(directory, 'Open team directory', true)}`);
  };
  const footballTeams=[...(football?.rankings??[]),...(football?.fcsRankings??[])].map(team=>({
    name:teamDisplayName(team.id,team.name),href:`/team/${encodeURIComponent(team.id)}/`,
    conference:[team.division?.toUpperCase(),team.conference].filter(Boolean).join(' · '),
  }));
  const basketballTeams=(basketball?.snapshot?.teams??[]).map(team=>({
    name:[team.name,team.mascot].filter(Boolean).join(' '),href:teamHref(team.id,year),conference:team.conference,
  }));
  return banner('Find a team','Search football and men’s basketball by school or mascot.','The Games Decide')
    +`<div class="wrap fc-content"><form class="fc-form gd-results-search" action="/find-team/">
      <label for="gd-results-query">School or mascot<input id="gd-results-query" type="search" name="q" maxlength="80" value="${escape(query)}" required></label>
      <input type="hidden" name="season" value="${year}"><button type="submit">Search</button></form>
      <div class="gd-preview-results">${results('Football',footballTeams,'/teams/fbs/')}
      ${results('Basketball',basketballTeams,`/basketball/teams/?season=${year}`)}</div></div>`;
}

async function seasonVersion(root) {
  const directory=join(root,'data','seasons','basketball');
  const files=await readdir(directory).catch(error=>{if(error.code!=='ENOENT') throw error;return [];});
  return (await Promise.all(files.filter(name=>/^\d{4}\.json$/.test(name)).sort().map(async name=>{
    const file=await stat(join(directory,name));
    return `${name}:${file.mtimeMs}:${file.size}`;
  }))).join('|');
}
export async function createBasketballPreview({root=project,clock=Date.now(),accountDirectory}={}) {
  const {seasons,activeYear,stateDir} = await loadPreviewStore(root,clock);
  const accounts=createPreviewAccounts({directory:accountDirectory??join(stateDir,'accounts')});
  const publishedFootball=join(root,'static-dist');
  let footballPublication;
  const getFootballPublication=()=>footballPublication??=readFile(join(publishedFootball,'data','rankings.json'),'utf8')
    .then(JSON.parse).catch(error=>{footballPublication=undefined;if(error.code!=='ENOENT') throw error;return null;});
  let version=await seasonVersion(root), nextCheck=Date.now()+5_000, pendingReload=null;
  async function reloadPublication() {
    if(pendingReload) return pendingReload;
    if(Date.now()<nextCheck) return;
    nextCheck=Date.now()+5_000;
    pendingReload=(async()=>{
      try {
        const nextVersion=await seasonVersion(root);
        if(nextVersion===version) return;
        const next=await loadPreviewStore(root);
        seasons.clear();
        for(const [year,data] of next.seasons) seasons.set(year,data);
        version=nextVersion;
      } catch(error) {
        nextCheck=Date.now()+30_000;
        console.warn('New basketball cache could not publish. Serving the prior valid preview.',error.name);
      } finally { pendingReload=null; }
    })();
    return pendingReload;
  }
  const server=createServer(async (req,res)=>{
    try {
      const host=req.headers.host;
      if (host!==`127.0.0.1:${server.address()?.port}`) {
        send(res,403,textType,'This preview accepts local requests only.');
        return;
      }
      const incoming=new URL(req.url,`http://${host}`);
      const path=decodeURIComponent(incoming.pathname);
      if(path.startsWith('/basketball')) await reloadPublication();
      if (req.method==='POST' && await accounts.handle(req,res,{seasons})) return;
      if (!['GET','HEAD'].includes(req.method)) { send(res,405,textType,'Method not allowed'); return; }
      if (path==='/robots.txt') { send(res,200,textType,'User-agent: *\nDisallow: /\n'); return; }
      if (path==='/sitemap.xml'||path.startsWith('/.well-known/')) { send(res,404,textType,'Not available in this local preview'); return; }
      if (path==='/bracket-config.json') { send(res,200,dataType,'{"enabled":false}'); return; }
      if (Object.hasOwn(localFiles,path)) {
        const bytes=await readFile(join(root,localFiles[path]));
        const content=['/basketball-preview/scoreboard.mjs','/basketball-preview/preview-ui.mjs'].includes(path)
          ? bytes.toString('utf8').replaceAll("'../frontend/","'../").replaceAll("'./preview-navigation-routes.mjs'","'./navigation-routes.mjs'") : bytes;
        send(res,200,types[extname(path)],content);
        return;
      }
      const profile=()=>accounts.profile(req);
      const year=Number(incoming.searchParams.get('season')||activeYear);
      if (path==='/find-team/' || path==='/find-team') {
        await reloadPublication();
        const searchYear=seasons.has(year)?year:activeYear;
        const query=(incoming.searchParams.get('q')??'').trim().slice(0,80);
        send(res,200,htmlType,html({active:null,title:'Find a team',profile:await profile(),
          body:searchPage(query,await getFootballPublication(),seasons.get(searchYear),searchYear),query}));
        return;
      }
      if (path==='/account' || path==='/account/') {
        res.writeHead(302,{'Location':'/preview-profile/','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive'});
        res.end();
        return;
      }
      if (path==='/admin' || path==='/admin/') {
        send(res,200,htmlType,html({active:'football',title:'Administration',profile:await profile(),pathname:path,
          body:banner('Administration','Production administrator accounts are disconnected from this preview.','The Games Decide')}));
        return;
      }
      if (path==='/basketball-preview/bracket-data.json') {
        const current=seasons.get(year);
        if (!current) { send(res,404,dataType,'{}'); return; }
        send(res,200,dataType,JSON.stringify({snapshot:sanitizeBracketData(current.snapshot),profile:await profile()}));
        return;
      }
      if (path==='/basketball-preview/scoreboard-data.json') {
        const years=[...seasons.keys()].sort((a,b)=>b-a);
        const latest=seasons.get(activeYear);
        if (!latest?.snapshot) { send(res,404,dataType,'{}'); return; }
        const slate=latest?.dataset?.games.filter(game=>Number.isFinite(Date.parse(game.startDate))) ?? [];
        const dates=[...new Set(slate.map(game=>dayKey(game.startDate)))].sort();
        const directory=Object.fromEntries(years.map(year=>[year,{dates:year===activeYear ? dates : [],historical:seasons.get(year).historical}]));
        const selection=basketballScoreboardSelection({years,currentSeason:activeYear,directory},incoming.searchParams);
        const context=seasons.get(selection.year);
        if (!context?.snapshot) { send(res,404,dataType,'{}'); return; }
        const {season,asOf}=context.snapshot;
        const teams=context.snapshot.teams.map(({id,name,mascot,conference,color,sorRank,wins,losses})=>({id,name,mascot,conference,color,sorRank,wins,losses}));
        const games=selection.historical ? [] : slate.filter(game=>dayKey(game.startDate)===selection.date);
        const records=source=>games.filter(game=>source.has(game.id)).map(game=>[game.id,source.get(game.id)]);
        send(res,200,dataType,JSON.stringify({selection,snapshot:{season,asOf,teams},group:{games,
          forecasts:records(context.forecasts),grades:records(context.forecastReportById)}}));
        return;
      }
      if (path==='/' || path==='/preview-profile/' || path==='/preview-profile') {
        const owner=await profile();
        const isProfile=path!=='/';
        send(res,200,htmlType,html({active:null,title:isProfile?'Practice profile':'College sports intelligence',profile:owner,
          body:isProfile?profilePage(owner,incoming.searchParams):portal({football:await getFootballPublication(),basketball:seasons.get(activeYear)}),
          script:isProfile?'':scriptTag('/basketball-preview/portal.js')}));
        return;
      }
      const poll = Object.keys(basketballPollRoutes).find(key => basketballPollRoutes[key] === path.replace(/\/?$/, '/'));
      if (poll) {
        const current = seasons.get(activeYear);
        if (!current?.snapshot) { send(res,404,htmlType,notFound(await profile())); return; }
        const saved = await readFile(join(root,'published','basketball-polls.json'),'utf8').then(JSON.parse).catch(error => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        });
        const {polls} = readBasketballPolls(saved,current.teams,activeYear);
        send(res,200,htmlType,html({title:`Compare Basketball Rankings · ${BASKETBALL_POLLS[poll].name}`,
          current:'polls',pathname:path,season:activeYear,profile:await profile(),publication:current.snapshot,
          body:renderBasketballRankingComparison(current.snapshot,polls,poll)}));
        return;
      }
      const canonicalPath = path.replace(/\/?$/, '/');
      const forgeCutoff = canonicalPath.slice(basketballForgePath.length).match(/^(\d{4}-\d{2}-\d{2})\/$/)?.[1];
      if (canonicalPath === basketballForgePath || canonicalPath.startsWith(basketballForgePath) && forgeCutoff) {
        const current = seasons.get(activeYear);
        if (!current?.snapshot) { send(res,404,htmlType,notFound(await profile())); return; }
        const saved = await readFile(join(root, 'published', basketballForgeArchiveFile), 'utf8').then(JSON.parse).catch(error => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        });
        const forge = readBasketballForgeBallots(saved, current.snapshot);
        if (forgeCutoff && !forge.editions.some(edition => edition.gamesThrough === forgeCutoff)) {
          send(res,404,htmlType,notFound(await profile())); return;
        }
        send(res,200,htmlType,html({ title:'Forge’s Basketball Top 25', current:'forge-rankings', pathname:canonicalPath,
          season:activeYear, profile:await profile(), publication:current.snapshot, body:renderBasketballForgeBallot(current.snapshot, forge, forgeCutoff) }));
        return;
      }
      if (path==='/basketball' || path.startsWith('/basketball/')) {
        const view=path.slice(11).replace(/^\/+|\/+$/g,'');
        const teamRoute=/^teams\/ncaam-d1:\d+$/.test(view);
        if (!views.has(view) && !teamRoute || incoming.searchParams.has('season')&&!seasons.has(year)) {
          send(res,404,htmlType,notFound(await profile())); return;
        }
        const knownSeasons=[...seasons.keys()].sort((a,b)=>b-a);
        const owner=await profile(), ctx={year,profile:owner,seasons:knownSeasons,scoreboardPreview:'/basketball-preview/scoreboard-data.json',
          conferenceHistory:knownSeasons.map(season=>({season,historical:seasons.get(season).historical,quality:seasons.get(season).conferenceQuality})),
          teamSeasons:id=>knownSeasons.filter(season=>seasons.get(season).teams.has(id)),...seasons.get(year)};
        const picks=view==='contest'&&ctx.snapshot ? await contestBoard(accounts,req,ctx,incoming.searchParams) : '';
        const body=renderBasketball(ctx,view,incoming.searchParams,picks);
        const title=teamRoute?ctx.teams?.get(view.slice(6))?.name:views.get(view);
        if (!body) { send(res,404,htmlType,notFound(owner)); return; }
        const scripts = view === 'march-madness' ? '<link rel="stylesheet" href="/basketball-bracket.css">'+scriptTag('/basketball-preview/bracket-page.js')
          : view === 'matchup-lab' ? '<link rel="stylesheet" href="/team-identity.css"><link rel="stylesheet" href="/team-players.css">'+scriptTag('/basketball-preview/matchup.js')
            : view === 'conferences' ? scriptTag('/basketball-preview/conference.js')
            : view === 'scoreboard' ? '<link rel="stylesheet" href="/scoreboard.css"><link rel="stylesheet" href="/game-discovery.css"><link rel="stylesheet" href="/team-identity.css">'+scriptTag('/basketball-preview/scoreboard.mjs') : '';
        send(res,200,htmlType,html({title:title??'Basketball',description:`Division I men’s basketball · ${title??'The Games Decide'}`,
          current:view,pathname:path,season:year,profile:owner,publication:ctx.snapshot,body,script:scripts}));
        return;
      }

      const extension=extname(path), fileName=path==='/football/'||path==='/football' ? 'football/index.html'
        : extension ? '.'+path : '.'+path.replace(/\/$/,'')+'/index.html';
      const target=resolve(publishedFootball,fileName);
      const inside=relative(publishedFootball,target);
      if (!inside || inside==='..'||inside.startsWith('..'+sep)||!types[extname(target)]) {
        send(res,404,textType,'Not found'); return;
      }
      try {
        const bytes=await readFile(target);
        let body=bytes;
        if (extname(target)==='.html') body=previewFootballDocument(bytes.toString('utf8'),await profile(),path,await getFootballPublication());
        else if (path==='/clean-navigation.js') body=bytes.toString('utf8')
          .replace(/if \(!route\) return null;\r?\n  \/\/ Leave links/, "if (!route || route === 'account' || route === 'admin') return null;\n  // Leave links");
        else if (path==='/app.js') body=previewFootballApp(bytes.toString('utf8'));
        send(res,200,types[extname(target)],body);
      } catch(error) {
        if(error.code!=='ENOENT') throw error;
        const body=path==='/football/' && !(await readFile(join(publishedFootball,'index.html')).catch(()=>null))
          ? html({active:'football',title:'Football build unavailable',body:banner('Build the football preview','Run node scripts/prepare-static.js --build-only.')})
          : notFound(await profile());
        send(res,404,htmlType,body);
      }
    } catch(error) {
      console.error('Basketball preview request failed:',error.name,escape(error.message).slice(0,170));
      if(!res.headersSent) send(res,500,textType,'The local preview could not complete this request.');
      else res.end();
    }
  });
  return {server,seasons};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const {values:{port='4317'}}=parseArgs({options:{port:{type:'string'}}});
  const portNumber=Number(port);
  if(!Number.isInteger(portNumber)||portNumber<1024||portNumber>65535) throw Error('Use a valid local preview port.');
  const {server,seasons}=await createBasketballPreview();
  server.listen(portNumber,'127.0.0.1',()=>{
    console.log(`Private preview: http://127.0.0.1:${portNumber}/ · ${seasons.size} basketball seasons`);
  });
}
