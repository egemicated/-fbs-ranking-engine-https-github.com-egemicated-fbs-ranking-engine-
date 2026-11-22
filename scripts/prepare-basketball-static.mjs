import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { applySecurityMetadata } from '../src/security-policy.js';
import { banner, escape, html, nav, panel, previewFooter, sharedNavigationAssets, shell } from '../basketball/preview-ui.mjs';
import { BASKETBALL_POLLS, readBasketballPolls } from '../basketball/poll-publication.mjs';
import { portal } from '../basketball/preview-views.mjs';
import { basketballPublicView } from '../basketball/site-view.mjs';
import { readBasketballSitePublication } from '../basketball/site-publication.mjs';
import { socialMetadata } from './prerender-pages.js';

const assets = {
  'basketball/preview.css':'basketball/preview.css',
  'basketball/reconstruction.css':'basketball/preview-reconstruction.css',
  'basketball/preview-interiors.css':'basketball/preview-interiors.css',
  'basketball/preview-interiors.js':'basketball/preview-interiors.js',
  'basketball/matchup.js':'basketball/preview-matchup.js',
  'basketball/conference.js':'basketball/preview-conference.js',
  'basketball/navigation.css':'basketball/preview-navigation.css',
  'basketball/navigation.js':'basketball/preview-navigation.js',
  'basketball/navigation-routes.mjs':'basketball/preview-navigation-routes.mjs',
  'basketball/arena.webp':'basketball/assets/arena.webp',
  'basketball/arena-mobile.webp':'basketball/assets/arena-mobile.webp',
  'basketball/masthead-football.webp':'basketball/assets/masthead-football.webp',
  'basketball/masthead-basketball.webp':'basketball/assets/masthead-basketball.webp',
  'basketball-bracket.css':'basketball/basketball-bracket.css',
  'basketball/basketball-bracket.js':'basketball/basketball-bracket.js',
  'basketball/bracket.js':'basketball/bracket.js',
  'basketball/bracket-archive.js':'basketball/bracket-archive.js',
  'basketball/model-forecast.js':'basketball/model-forecast.js',
  'basketball/preview-ui.mjs':'basketball/preview-ui.mjs',
  'basketball/preview-views.mjs':'basketball/preview-views.mjs',
  'basketball/site-view.mjs':'basketball/site-view.mjs',
  'basketball/site-client.mjs':'basketball/site-client.mjs',
  'basketball/site-browser.mjs':'basketball/site-browser.mjs',
  'basketball/portal-entry.js':'basketball/portal-entry.js',
};
const getTitle = new Map(nav.map(([label,view]) => [view,label]));
const scripts = '<script type="module" src="/basketball/site-browser.mjs"></script>';
const cleanAssets = html => html.replaceAll('/basketball-preview/', '/basketball/');
const pageName = path => path === '/' ? '' : path.slice(1);

export async function addBasketballSite({ root, output, publicationDirectory, football, authUrl }) {
  const {manifest,files} = await readBasketballSitePublication(publicationDirectory);
  const publicVersion = manifest.version;
  const write = async (path,contents) => {
    const file = join(output,path);
    await mkdir(dirname(file),{recursive:true});
    await writeFile(file,contents);
  };
  await Promise.all(Object.entries(assets).map(async ([destination, source]) => {
    const bytes = await readFile(join(root,source));
    await write(destination,destination.endsWith('.webp') ? bytes :
      cleanAssets(bytes.toString('utf8')).replaceAll("'../frontend/", "'../")
        .replaceAll("'./preview-navigation-routes.mjs'", "'./navigation-routes.mjs'"));
  }));
  const sharedStyles = await readFile(join(output,'platform-ui.css'),'utf8');
  await write('platform-ui.css',cleanAssets(sharedStyles));

  const parsed = new Map();
  const record = path => {
    if (!parsed.has(path)) parsed.set(path,JSON.parse(files.get(path)));
    return parsed.get(path);
  };
  const index = record('index.json');
  const render = basketballPublicView(record,index);
  for (const [path, bytes] of files) await write('basketball-data/' + publicVersion + '/' + path, bytes);

  const paths = ['/basketball/', ...[...getTitle.keys()].filter(view=>view && view !== 'contest')
    .map(view=>'/basketball/'+view+'/')];
  const teamPaths = new Map();
  for (const year of index.years) {
    for (const id of index.directory[year].teams) {
      const path = '/basketball/teams/' + id.split(':')[1] + '/';
      if (!teamPaths.has(path)) teamPaths.set(path,year);
    }
  }
  const buildPage = async (pathname, year) => {
    const query = year !== index.currentSeason ? '?season=' + year : '';
    const page = await render(pathname + query);
    if (!page?.markup) throw Error('Basketball public route could not render: ' + pathname);
    const title = page.title ?? getTitle.get(page.view) ?? 'Men’s college basketball';
    const stylesheet = page.view === 'march-madness' ? '<link rel="stylesheet" href="/basketball-bracket.css">'
      : page.view === 'matchup-lab' ? '<link rel="stylesheet" href="/team-identity.css"><link rel="stylesheet" href="/team-players.css">' : '';
    const pageHtml = html({
      title, pathname, publicVersion, season:year, current:page.view, publication:page.ctx.snapshot,
      body:page.markup, description:'Division I men’s basketball · ' + title, script:stylesheet + scripts,
    });
    await write(pageName(pathname) + 'index.html',applySecurityMetadata(cleanAssets(pageHtml),{authUrl}));
  };
  for (const path of paths) await buildPage(path,index.currentSeason);
  for (const [path,year] of teamPaths) await buildPage(path,year);

  const basketball = { snapshot: record(index.currentSeason + '/season.json').snapshot };
  const pollPath = '/basketball/polls/';
  const pollTeams = new Map(basketball.snapshot.teams.map(team=>[team.id,team]));
  const savedPolls = await readFile(join(root,'published','basketball-polls.json'),'utf8').then(JSON.parse).catch(error=>{
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  const {polls} = readBasketballPolls(savedPolls,pollTeams,index.currentSeason);
  const pollDay = new Intl.DateTimeFormat('en-US',{timeZone:'UTC',dateStyle:'long'});
  const pollTime = new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',dateStyle:'medium',timeStyle:'short'});
  const pollPanels = Object.entries(BASKETBALL_POLLS).map(([type,source])=>{
    const poll = polls[type];
    const sourceLink = '<p><a href="' + source.url + '">Published poll</a></p>';
    if (!poll) return panel(source.name,'<p>No verified edition is available yet.</p>' + sourceLink);
    const rows = poll.ranks.map(({id,rank})=>'<tr><td>' + rank + '</td><th scope="row"><a href="/basketball/teams/' +
      id.split(':')[1] + '/">' + escape(pollTeams.get(id).name) + '</a></th></tr>').join('');
    return panel(source.name,'<p>Poll dated ' + pollDay.format(new Date(poll.pollDate + 'T00:00:00Z')) +
      ' · First observed ' + pollTime.format(new Date(poll.observedAt)) + ' MT</p>' +
      '<table class="fc-table"><thead><tr><th scope="col">Rank</th><th scope="col">Team</th></tr></thead><tbody>' + rows +
      '</tbody></table>' + sourceLink);
  }).join('');
  const pollBody = banner('AP and Coaches polls','Separate ballots from the AP and USA TODAY. See our rankings for the GD models.','National polls · Men’s basketball') +
    '<div class="wrap fc-content"><p><a href="/basketball/rankings/">Back to GD rankings</a></p><div class="fc-grid">' +
    pollPanels + '</div><p>Poll data provided by CollegeBasketballData.com.</p></div>';
  await write(pageName(pollPath)+'index.html',applySecurityMetadata(cleanAssets(html({ title:'AP and Coaches polls',
    pathname:pollPath,publicVersion,season:index.currentSeason,current:'rankings',body:pollBody })),{authUrl}));
  paths.push(pollPath);
  const portalBody = portal({football,basketball});
  const searchBody = '<div class="wrap fc-content"><h1>Find a team</h1>' +
    '<form class="fc-form" action="/find-team/"><label>School or mascot<input name="q" type="search" required maxlength="80"></label>' +
    '<button>Search</button></form><div class="fc-grid" data-public-team-search>' +
    panel('Team directories','<p><a href="/teams/fbs/">Football</a> · <a href="/basketball/teams/">Basketball</a></p>') + '</div></div>';
  const search = html({active:null,title:'Find a team',pathname:'/find-team/',publicVersion,body:searchBody,script:scripts});
  await write('find-team/index.html',applySecurityMetadata(cleanAssets(search),{authUrl}));

  const shipFootball = async (file, pathname) => {
    const src = await readFile(join(output,file),'utf8');
    return src
      .replace('</head>', cleanAssets('<link rel="stylesheet" href="/basketball-preview/reconstruction.css">' + sharedNavigationAssets) + '</head>')
      .replace('<header id="header"></header>',shell('football','',null,null,{pathname,publicSite:true,footballApp:true}))
      .replace('<footer id="footer"></footer>',previewFooter('football',null,{footballApp:true}));
  };
  await write('football/index.html',await shipFootball('football/index.html','/football/'));
  const title = 'College sports intelligence';
  const description = 'Independent college football and basketball rankings, results, and matchup analysis.';
  const home = applySecurityMetadata(cleanAssets(html({active:null,title,pathname:'/',publicVersion,body:portalBody,
    bootNavigation:false,portalPage:true,description,
    script:socialMetadata({path:'/',title:title + ' · The Games Decide',description,image:'/social/platform.png'}) +
      '<script type="module" src="/basketball/portal-entry.js"></script>'})),{authUrl});
  await Promise.all([write('index.html',home),write('sports/index.html',home)]);
  const findPages = async (dir,path='') => {
    const nodes = await readdir(dir,{withFileTypes:true});
    for (const node of nodes.filter(x=>x.isDirectory() && !['basketball','basketball-data','football','sports','find-team'].includes(x.name))) {
      await findPages(join(dir,node.name),path+node.name+'/');
    }
    if (path && nodes.some(node=>node.isFile() && node.name==='index.html')) {
      const file = path+'index.html';
      await write(file,await shipFootball(file,'/' + path));
    }
  };
  await findPages(output);
  const sitemapFile = await readFile(join(output,'sitemap.xml'),'utf8');
  const links = ['/',...paths,...teamPaths.keys()].map(path=>
    '<url><loc>https://www.thegamesdecide.com' + path + '</loc></url>').join('');
  await write('sitemap.xml',sitemapFile.replace('</urlset>',links+'</urlset>'));
  return {version:publicVersion,pages:paths.length + teamPaths.size + 2};
}
