import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createPreviewAccounts } from '../basketball/preview-accounts.mjs';
import { loadPreviewStore } from '../basketball/preview-store.mjs';
import { action, banner, escape, html, nav, shell } from '../basketball/preview-ui.mjs';
import { contestBoard, profilePage } from '../basketball/preview-profile-ui.mjs';
import { portal, renderBasketball } from '../basketball/preview-views.mjs';

const project = resolve(import.meta.dirname,'..');
const types = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.woff2':'font/woff2',
  '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.xml':'application/xml',
};
const localFiles = {
  '/basketball-preview/preview.css':'basketball/preview.css',
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
function previewFootballRoute(src) {
  return src.replace("{ route: 'home', path: '/' }", "{ route: 'home', path: '/football/' }");
}
function previewFootballDocument(source,profile) {
  return source
    .replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/ig,'')
    .replace(/<(?:meta|link)\s+(?:name="robots"|rel="canonical")[^>]*>/ig,'')
    .replace('</head>','<meta name="robots" content="noindex,nofollow,noarchive"><link rel="stylesheet" href="/basketball-preview/preview.css"></head>')
    .replace(/<header id="header"><\/header>/,shell('football','',null,profile,false)+'<header id="header"></header>');
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
        send(res,200,types[extname(path)],await readFile(join(root,localFiles[path])));
        return;
      }
      const profile=()=>accounts.profile(req);
      const year=Number(incoming.searchParams.get('season')||activeYear);
      if (path==='/basketball-preview/bracket-data.json') {
        const current=seasons.get(year);
        if (!current) { send(res,404,dataType,'{}'); return; }
        send(res,200,dataType,JSON.stringify({snapshot:sanitizeBracketData(current.snapshot),profile:await profile()}));
        return;
      }
      if (path==='/' || path==='/preview-profile/' || path==='/preview-profile') {
        const owner=await profile();
        const isProfile=path!=='/';
        send(res,200,htmlType,html({active:null,title:isProfile?'Practice profile':'College sports intelligence',profile:owner,
          body:isProfile?profilePage(owner,incoming.searchParams):portal(),script:isProfile?'':scriptTag('/basketball-preview/portal.js')}));
        return;
      }
      if (path==='/basketball' || path.startsWith('/basketball/')) {
        const view=path.slice(11).replace(/^\/+|\/+$/g,'');
        const teamRoute=/^teams\/ncaam-d1:\d+$/.test(view);
        if (!views.has(view) && !teamRoute || incoming.searchParams.has('season')&&!seasons.has(year)) {
          send(res,404,htmlType,notFound(await profile())); return;
        }
        const knownSeasons=[...seasons.keys()].sort((a,b)=>b-a);
        const owner=await profile(), ctx={year,profile:owner,seasons:knownSeasons,
          teamSeasons:id=>knownSeasons.filter(season=>seasons.get(season).teams.has(id)),...seasons.get(year)};
        const picks=view==='contest'&&ctx.snapshot ? await contestBoard(accounts,req,ctx,incoming.searchParams) : '';
        const body=renderBasketball(ctx,view,incoming.searchParams,picks);
        const title=teamRoute?ctx.teams?.get(view.slice(6))?.name:views.get(view);
        if (!body) { send(res,404,htmlType,notFound(owner)); return; }
        const scripts=view==='march-madness'?'<link rel="stylesheet" href="/basketball-bracket.css">'+scriptTag('/basketball-preview/bracket-page.js'):'';
        send(res,200,htmlType,html({title:title??'Basketball',description:`Division I men’s basketball · ${title??'The Games Decide'}`,
          current:view,season:year,profile:owner,body,script:scripts}));
        return;
      }

      const extension=extname(path), fileName=path==='/football/'||path==='/football' ? 'index.html'
        : extension ? '.'+path : '.'+path.replace(/\/$/,'')+'/index.html';
      const target=resolve(publishedFootball,fileName);
      const inside=relative(publishedFootball,target);
      if (!inside || inside==='..'||inside.startsWith('..'+sep)||!types[extname(target)]) {
        send(res,404,textType,'Not found'); return;
      }
      try {
        const bytes=await readFile(target);
        const body=extname(target)==='.html'?previewFootballDocument(bytes.toString('utf8'),await profile())
          :path==='/clean-routes.js' ? previewFootballRoute(bytes.toString('utf8')) : bytes;
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
