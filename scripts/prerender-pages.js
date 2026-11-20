import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { teamAccent, teamDisplayName, teamNameMarkup, teamNameParts } from '../frontend/team-identity.js';
import { platformInfoMarkup } from '../frontend/platform-info.js';
import { buildModelReport } from '../frontend/model-report.js';
import { conferenceRecords } from '../frontend/conference-metrics.js';
import { PUBLIC_SITE_ORIGIN as origin, pageMetadata } from '../frontend/page-routes.js';
import { routeHref } from '../frontend/clean-routes.js';
import { formatSorScore, sorEligibleRecord } from '../frontend/format.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const record = team => [team.wins, team.losses, ...(team.ties ? [team.ties] : [])].join('–');
const number = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : 'Unavailable';

function metadata(html, { path, title, description, image, route, content, links }) {
  const privateOrMissing = !path;
  const fallback = privateOrMissing ? pageMetadata(route) : null;
  const canonical = privateOrMissing ? null : origin + path;
  const pageTitle = fallback?.title ?? (route === 'home' ? title : title + ' · The Games Decide');
  const pageDescription = description ?? fallback?.description;
  const head = `<title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(pageDescription)}">` + (privateOrMissing ? `
  <meta name="robots" content="noindex, nofollow" data-account-robots="true">` : `
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="website"><meta property="og:site_name" content="The Games Decide">
  <meta property="og:title" content="${escapeHtml(pageTitle)}"><meta property="og:description" content="${escapeHtml(pageDescription)}">
  <meta property="og:url" content="${canonical}"><meta property="og:image" content="${origin}${image}">
  <meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${escapeHtml(title)}">
  <meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(pageTitle)}"><meta name="twitter:description" content="${escapeHtml(pageDescription)}"><meta name="twitter:image" content="${origin}${image}">`) + (route ? `
  <meta name="app-route" content="${escapeHtml(route)}">` : '');
  return html.replace(/<title>[\s\S]*?<\/title>/, '').replace(/\s*<meta name="description"[^>]*>/, '')
    .replace(/\s*<link rel="canonical"[^>]*>/g, '')
    .replace('</head>', head + '\n</head>')
    .replace(/<main\b[^>]*>[\s\S]*?<\/main>/, `<main id="main" tabindex="-1"><div class="wrap page-content"><section class="panel"><div class="panel-body">${content}<nav class="public-page-links" aria-label="Explore The Games Decide">${links}</nav></div></section></div></main>`);
}

function pageLink(route, label) {
  const href = routeHref(route);
  if (!href) throw new Error(`Unknown route while generating public pages: ${route}`);
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

async function writePage(output, path, html) {
  const directory = join(output, path);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'index.html'), html);
}

const crawlableAliases = new Map([
  ['/rankings/fbs/', '/rankings'],
  ['/weekly-picks/fbs/', '/weekly-picks'],
  ['/teams/', '/teams/fbs/'],
  ['/model-reports/', '/model-reports/fbs/'],
  ['/polls/', '/polls/ap/'],
]);

function previewSvg({ title, nickname, subtitle, detail, accent = '#00b7ed', logo }) {
  const safeAccent = /^#[\da-f]{6}$/i.test(accent) ? accent : '#00b7ed';
  const titleSize = Math.min(nickname ? 66 : 86, Math.floor(1450 / Math.max(1, title.length)));
  const nicknameSize = Math.min(101, Math.floor(1450 / Math.max(1, nickname?.length ?? 0)));
  const headline = `<text x="64" y="${nickname ? 284 : 315}" fill="#fff" font-size="${titleSize}" font-weight="${nickname ? 600 : 700}">${escapeHtml(title)}</text>`
    + (nickname ? `<text x="60" y="394" fill="#fff" font-size="${nicknameSize}" font-weight="700">${escapeHtml(nickname.toUpperCase())}</text>` : '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#061329"/><stop offset="1" stop-color="#073361"/></linearGradient></defs>
    <rect width="1200" height="630" fill="url(#bg)"/><path d="M0 0h8v630H0z" fill="#00b7ed"/>
    <path d="M1106 0h94v94z" fill="${safeAccent}"/>
    <image href="${logo}" x="64" y="45" width="360" height="120"/>
    <path d="M64 201h1072" stroke="#48658a"/>
    <g font-family="Arial,sans-serif">${headline}
    <text x="64" y="${nickname ? 468 : 399}" fill="#85dcff" font-size="36" font-weight="700">${escapeHtml(subtitle)}</text>
    <text x="64" y="${nickname ? 515 : 459}" fill="#d9e6f4" font-size="27">${escapeHtml(detail)}</text>
    <path d="M64 550h1072" stroke="#48658a"/>
    <text x="64" y="588" fill="#a6c0dd" font-size="22">DATA · OPPONENTS · EVIDENCE</text></g>
  </svg>`;
}

export async function prerenderPublicPages({ root, output, snapshot, teams, html, fbsPicks, fcsPicks, conferenceDatasets = [] }) {
  const logo = await sharp(await readFile(join(root, 'frontend/assets/the-games-decide-logo.webp'))).resize({ width: 720 }).png().toBuffer();
  const logoUrl = 'data:image/png;base64,' + logo.toString('base64');
  const asOf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'medium' }).format(new Date(snapshot.asOf));
  const baseLinks = [['home', 'Home'], ['rankings', 'FBS rankings'], ['rankings/fcs/sor', 'FCS rankings'],
    ['conference-strength/records', 'Conference Strength'], ['model-report/fbs', 'Model report'], ['methodology', 'Methodology']]
    .map(([route, label]) => pageLink(route, label)).join(' · ');
  const teamRows = division => teams.filter(team => team.division === division);
  const table = (division, top25 = false) => {
    const rows = teamRows(division);
    const rankOf = team => team.displayRank ?? team.sorRank;
    const counts = new Map();
    for (const team of rows) if (rankOf(team)) counts.set(rankOf(team), (counts.get(rankOf(team)) ?? 0) + 1);
    const visible = top25 ? rows.filter(team => rankOf(team) > 0 && rankOf(team) <= 25) : rows;
    return `<table><caption>${division.toUpperCase()} ${top25 ? 'Top 25 by ' : ''}Strength of Record · ${snapshot.season}</caption><thead><tr><th>Rank</th><th>Team</th><th>Record</th><th>SOR</th></tr></thead><tbody>${visible.map(team => {
      const rank = rankOf(team);
      const eligible = division === 'fcs' && team.sorExcludedGames > 0 ? sorEligibleRecord(team) : null;
      return `<tr><td>${counts.get(rank) > 1 ? 'T-' + rank : rank ?? '—'}</td><td><a href="/team/${team.id}/">${teamNameMarkup(team.id, team.name)}</a></td><td>${record(team)}${eligible ? ` (${eligible} SOR-eligible)` : ''}</td><td>${formatSorScore(team.sor)}</td></tr>`;
    }).join('')}</tbody></table>`;
  };
  const reportText = (picks, division) => {
    if (!picks) return '<p>A saved prediction publication is unavailable.</p>';
    const report = buildModelReport(picks, undefined, division);
    const season = report.scores.season;
    return `<p>${snapshot.season} season · ${season.correctPicks} correct of ${season.decisivePicks} decided saved picks. Season Brier score ${number(season.brier, 3)}.</p><p>${season.completedPicks} of ${report.eligibleFinals} eligible finals have a scored live pick. Only forecasts saved before kickoff enter the live tally. Replays have their own validation record.</p>`;
  };
  const conferences = conferenceDatasets.find(dataset => dataset.season === snapshot.season);
  const conferenceTable = conferences ? (() => {
    const records = conferenceRecords(conferences);
    return `<table><caption>FBS interconference records · ${snapshot.season}</caption><thead><tr><th>Conference</th><th>Wins</th><th>Losses</th><th>FBS vs. FCS</th></tr></thead><tbody>${conferences.conferences.map(({id,name}) => `<tr><th>${escapeHtml(name)}</th><td>${records.summaries[id].wins}</td><td>${records.summaries[id].losses}</td><td>${record(records.fcs[id])}</td></tr>`).join('')}</tbody></table>`;
  })() : '';
  const primary = [
    ['/', 'home', 'The Games Decide Top 25', 'The FBS Top 25 by Strength of Record, with links to every FBS team, game evidence, and matchup analysis.', `<h1>The Games Decide Top 25</h1><p>Independent FBS Strength of Record rankings. Published ${asOf}.</p><p>${pageLink('rankings/all', `View all ${snapshot.fbsTeams} FBS teams`)}</p>${table('fbs', true)}`],
    ['/rankings', 'rankings', 'FBS Strength of Record', `Explore all ${snapshot.fbsTeams} FBS teams by achieved record and opponent quality. Published ${asOf}.`, '<h1>FBS Strength of Record</h1>' + table('fbs')],
    ['/rankings/fcs/', 'rankings/fcs/sor', 'FCS Strength of Record', `Explore ${snapshot.fcsTeams} FCS teams in the Experimental FCS Strength of Record rankings.`, '<h1>FCS Strength of Record · Experimental</h1>' + table('fcs')],
    ['/teams/fbs/', 'teams/fbs', 'FBS team directory', 'Browse FBS teams, records, rankings, and team profiles.', '<h1>FBS team directory</h1>' + table('fbs')],
    ['/teams/fcs/', 'teams/fcs', 'FCS team directory', 'Browse FCS teams, records, rankings, and team profiles.', '<h1>FCS team directory</h1>' + table('fcs')],
    ['/conference-strength/', 'conference-strength/records', 'Conference Strength', 'Compare interconference records, opponent quality, and individual game evidence.', '<h1>Conference Strength</h1><p>Explore conference records and an interactive head-to-head matrix. FCS results have separate records. Opponent-adjusted conference scores are Experimental.</p>' + conferenceTable + pageLink('conference-strength/quality', 'Quality rankings') + ' · ' + pageLink('conference-strength/compare', 'Compare conferences')],
    ['/matchup-lab', 'compare', 'Matchup Lab', 'Compare valid FBS or FCS matchups using Predictive Strength, location, and available player evidence.', '<h1>Matchup Lab</h1><p>Select two teams to inspect their Predictive Strength, model win probabilities, and reported player information.</p>'],
    ['/weekly-picks', 'compare/weekly', 'FBS weekly picks', 'Inspect saved pregame FBS predictions, scheduled games and published final results. Live scores and historical replays are labeled separately.', '<h1>FBS weekly picks</h1>'+reportText(fbsPicks,'fbs')],
    ['/weekly-picks/fcs/', 'compare/weekly/fcs', 'FCS weekly picks', 'Inspect saved pregame FCS predictions and results with separate coverage and validation limits.', '<h1>FCS weekly picks</h1>'+reportText(fcsPicks,'fcs')],
    ['/scoreboard', 'scoreboard', 'Live Scoreboard', 'Follow college football scores and confirmed kickoff times. Live ESPN responses and the published model snapshot have distinct update times.', '<h1>Live Scoreboard</h1><p>The interactive scoreboard retrieves ESPN scores when online. A live-score response is separate from the published rankings and saved-prediction grading cutoff.</p>' + pageLink('compare/weekly', 'Inspect saved predictions and published results')],
    ['/beat-the-model/', 'beat-the-model', 'Beat the Model', 'Make picks before each confirmed kickoff and compare graded results with Forge’s saved pregame predictions.', '<h1>Beat the Model</h1><p>Sign in to submit your own picks before each game’s confirmed kickoff. Other participants’ shared picks remain protected until that game locks. Public standings and model predictions are available through the contest.</p>'],
    ['/ranking-history/', 'ranking-history', 'Ranking History', 'Explore retained SOR publications and clearly labeled retrospective replays. Historical game archives are distinct from saved weekly editions.', '<h1>Ranking History</h1><p>Compare retained weekly Strength of Record editions and movement. Reconstructed replays have separate labels and are not presented as publications saved before those games.</p><a href="/conference-strength/">Explore available prior-season conference evidence</a>'],
    ['/forge-rankings/', 'forge-top-25', 'Forge’s rankings', 'Read Forge’s separately labeled AI-authored ballots and compare them with earned SOR and external polls.', '<h1>Forge’s rankings</h1><p>Forge’s ballot is AI-authored analysis, separate from the reproducible SOR formula and the AP, Coaches and CFP comparison sources.</p>'],
    ...[['ap','AP Poll'],['coaches','Coaches Poll'],['cfp','CFP rankings']].map(([key,title])=>['/polls/'+key+'/', 'polls/'+key, title+' comparison', 'Compare dated '+title+' editions with The Games Decide where aligned historical evidence exists.', '<h1>'+title+' comparison</h1><p>External poll editions are comparison evidence, not inputs to earned SOR. Current ranks, pregame ranks, confirmed unranked teams and unavailable editions have distinct labels.</p>']),
    ['/playoff-bracket/', 'bracket', 'Playoff bracket', 'Create a complete playoff bracket before the entry deadline and track confirmed results. Official, provisional and demo fields are labeled.', '<h1>Playoff bracket</h1><p>Review the available official or clearly labeled provisional field, fill out the full bracket and track confirmed results. Historical demos are separate from the live contest.</p>'],
    ['/cfp-scenarios/', 'cfp-scenarios', 'CFP Scenario Builder', 'Explore hypothetical outcomes and their model effects without changing published rankings or actual game results.', '<h1>CFP Scenario Builder</h1><p>Choose hypothetical outcomes from the available schedule. Scenario projections stay separate from published rankings and the official announced playoff field.</p>'],
    ['/sor-compare/', 'sor-compare', 'Why one team ranks above another', 'Compare earned Strength of Record rankings, schedules, wins, losses, and common opponents.', '<h1>Why one team ranks above another</h1><p>Compare SOR scores, reference-team probabilities, expected wins, venue context, and actual results.</p>'],
    ['/model-reports/fbs/', 'model-report/fbs', 'FBS weekly model report', 'Examine saved pregame predictions, accuracy, Brier score, notable misses, and sample sizes.', '<h1>FBS weekly model report</h1>'+reportText(fbsPicks,'fbs')],
    ['/model-reports/fcs/', 'model-report/fcs', 'FCS weekly model report', 'Track FCS saved pregame picks and results with separate reporting and coverage.', '<h1>FCS weekly model report</h1>'+reportText(fcsPicks,'fcs')],
    ['/methodology/', 'methodology', 'Ranking methodology', 'Read how SOR, Predictive Strength, Performance, and conference comparisons use game data.', '<h1>Ranking methodology</h1><p>Strength of Record asks how often a team with the mean Colley rating of its subdivision could match the same win total against the same opponents at the same venues. We remove each game before recalculating the opponent and reference ratings. A harder record to match earns a higher score.</p><p>SOR = −log10(P(reference team matches at least the observed wins)). Predictive Strength uses a separate model to forecast matchups. Coverage and calibration limitations accompany each method.</p><a href="https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-/blob/main/METHODOLOGY.md">Full equations and technical documentation</a>'],
    ...['about', 'privacy', 'terms', 'support'].map(page => [routeHref(page), page, {about:'About The Games Decide',privacy:'Privacy and accounts',terms:'Using The Games Decide',support:'Support and data discrepancies'}[page], 'Understand The Games Decide and its public data, accounts, and reporting tools.', platformInfoMarkup(page)]),
  ];
  const pages = primary.map(([path, route, title, description, content]) => ({ path, route, title, description, content, subtitle: `${snapshot.season} season · ${asOf}`, detail: 'Independent college football intelligence', image: '/social/platform.png' }));
  for (const team of teams) {
    const rank = team.displayRank ?? team.sorRank;
    const name = teamDisplayName(team.id, team.name);
    const { school, nickname } = teamNameParts(team.id, team.name);
    const title = `${name} · ${team.division.toUpperCase()} team profile`;
    const description = `${name} holds a ${record(team)} record and is ${Number.isInteger(rank) ? '#' + rank : 'unranked'} in The Games Decide ${team.division.toUpperCase()} SOR. Inspect its schedule, results, player statistics, and next matchup. As of ${asOf}.`;
    pages.push({ path: '/team/' + team.id + '/', route: 'team/' + team.id, title, description,
      image: '/social/team-' + team.id + '.png', socialTitle: school, nickname, accent: teamAccent(team.id),
      subtitle: `${team.division.toUpperCase()} SOR ${Number.isInteger(rank) ? '#' + rank : 'unranked'} · ${record(team)}${team.division === 'fcs' ? ' · Experimental' : ''}`,
      detail: `${team.conference} · ${snapshot.season} · ${asOf}`,
      content: `<h1>${teamNameMarkup(team.id, team.name)}</h1><p>${escapeHtml(description)}</p><p>SOR ${formatSorScore(team.sor)} · Predictive Strength ${number(team.strength)} points.</p>${pageLink(`team/${team.id}/results`, 'Results and upcoming games')} · ${pageLink(`sor-compare/${team.division}/${team.id}`, 'Compare earned rankings')} · ${pageLink('compare', 'Matchup Lab')}`,
    });
  }
  await mkdir(join(output, 'social'), { recursive: true });
  await sharp(Buffer.from(previewSvg({ title: 'The Games Decide', subtitle: 'College football, examined', detail: `${snapshot.season} · ${asOf}`, logo: logoUrl }))).png().toFile(join(output, 'social/platform.png'));
  for (let start = 0; start < pages.length; start += 8) {
    await Promise.all(pages.slice(start, start + 8).map(async page => {
      if (page.path !== routeHref(page.route)) throw new Error(`Public metadata route has no matching clean URL: ${page.route}`);
      const document = metadata(html, { ...page, links: baseLinks });
      await writePage(output, page.path, document);
      for (const [alias, canonical] of crawlableAliases) {
        if (canonical === page.path) await writePage(output, alias, document);
      }
      if (page.socialTitle) await sharp(Buffer.from(previewSvg({ title: page.socialTitle, nickname: page.nickname, subtitle: page.subtitle, detail: page.detail, accent: page.accent, logo: logoUrl }))).png().toFile(join(output, page.image));
    }));
  }
  for (const [route, title] of [['account', 'Account settings'], ['admin', 'Administration'], ['my-teams', 'My Teams']]) {
    const content = `<h1>${title}</h1><p>Sign in to access this page.</p>`;
    await writePage(output, routeHref(route), metadata(html, { route, content, links: baseLinks }));
  }
  const missing = metadata(html.replace(/\s*<script\b[^>]*><\/script>/g, ''), {
    content: '<h1>Page not found</h1><p>This address does not match a page on The Games Decide.</p>', links: baseLinks,
  });
  await writeFile(join(output, '404.html'), missing);
  const urls = pages.map(page => `<url><loc>${origin}${page.path}</loc><lastmod>${snapshot.asOf.slice(0, 10)}</lastmod></url>`).join('');
  await writeFile(join(output,'data','page-metadata.json'), JSON.stringify(Object.fromEntries(pages.map(page=>[page.path,{title:page.route==='home'?page.title:page.title+' · The Games Decide',description:page.description,image:page.image}]))));
  await writeFile(join(output, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls + '</urlset>');
  await writeFile(join(output, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: ' + origin + '/sitemap.xml\n');
  return { pages: pages.length };
}
