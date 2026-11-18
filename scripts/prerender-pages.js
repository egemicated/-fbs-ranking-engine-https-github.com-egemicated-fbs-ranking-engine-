import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { myTeamColors } from '../frontend/my-team-colors.js';
import { platformInfoMarkup } from '../frontend/platform-info.js';
import { buildModelReport } from '../frontend/model-report.js';
import { conferenceRecords } from '../frontend/conference-metrics.js';

const origin = 'https://fbs-intelligence.onrender.com';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const record = team => [team.wins, team.losses, ...(team.ties ? [team.ties] : [])].join('–');
const number = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : 'Unavailable';

function metadata(html, { path, title, description, image, route, content, links }) {
  const canonical = origin + path;
  const head = `<title>${escapeHtml(title)} · FBS Intelligence</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="website"><meta property="og:site_name" content="FBS Intelligence">
  <meta property="og:title" content="${escapeHtml(title)} · FBS Intelligence"><meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonical}"><meta property="og:image" content="${origin}${image}">
  <meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${escapeHtml(title)}">
  <meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)} · FBS Intelligence"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${origin}${image}">
  <meta name="app-route" content="${escapeHtml(route)}">`;
  return html.replace(/<title>[\s\S]*?<\/title>/, '').replace(/\s*<meta name="description"[^>]*>/, '')
    .replace(/\s*<link rel="canonical"[^>]*>/g, '')
    .replace('</head>', head + '\n</head>')
    .replace(/<main\b[^>]*>[\s\S]*?<\/main>/, `<main id="main" tabindex="-1"><div class="wrap page-content"><section class="panel"><div class="panel-body">${content}<nav class="public-page-links" aria-label="Explore FBS Intelligence">${links}</nav></div></section></div></main>`);
}

function previewSvg({ title, subtitle, detail, accent = '#00b7ed', logo }) {
  const safeAccent = /^#[\da-f]{6}$/i.test(accent) ? accent : '#00b7ed';
  const size = title.length > 28 ? 52 : title.length > 18 ? 68 : 86;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#061329"/><stop offset="1" stop-color="#073361"/></linearGradient></defs>
    <rect width="1200" height="630" fill="url(#bg)"/><path d="M0 0h18v630H0z" fill="${safeAccent}"/>
    <image href="${logo}" x="64" y="45" width="360" height="120"/>
    <path d="M64 201h1072" stroke="#48658a"/><text x="64" y="299" fill="#fff" font-family="Arial,sans-serif" font-size="${size}" font-weight="bold">${escapeHtml(title)}</text>
    <text x="64" y="377" fill="#00c6ef" font-family="Arial,sans-serif" font-size="38" font-weight="bold">${escapeHtml(subtitle)}</text>
    <text x="64" y="447" fill="#d9e6f4" font-family="Arial,sans-serif" font-size="27">${escapeHtml(detail)}</text>
    <text x="64" y="563" fill="#a6c0dd" font-family="Arial,sans-serif" font-size="22">DATA · OPPONENTS · EVIDENCE</text>
    <text x="1138" y="563" fill="#a6c0dd" text-anchor="end" font-family="Arial,sans-serif" font-size="22">fbs-intelligence.onrender.com</text>
  </svg>`;
}

export async function prerenderPublicPages({ root, output, snapshot, teams, html, fbsPicks, fcsPicks, conferenceDatasets = [] }) {
  const logo = await sharp(await readFile(join(root, 'frontend/assets/fbs-intelligence-logo.svg'))).resize({ width: 720 }).png().toBuffer();
  const logoUrl = 'data:image/png;base64,' + logo.toString('base64');
  const asOf = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', dateStyle: 'medium' }).format(new Date(snapshot.asOf));
  const baseLinks = '<a href="/">Home</a> · <a href="/rankings/fbs/">FBS rankings</a> · <a href="/rankings/fcs/">FCS rankings</a> · <a href="/conference-strength/">Conference Strength</a> · <a href="/model-reports/fbs/">Model report</a> · <a href="/methodology/">Methodology</a>';
  const teamRows = division => teams.filter(team => team.division === division);
  const table = division => `<table><caption>${division.toUpperCase()} Strength of Record · ${snapshot.season}</caption><thead><tr><th>Rank</th><th>Team</th><th>Record</th><th>SOR</th></tr></thead><tbody>${teamRows(division).map(team => `<tr><td>${team.displayRank ?? team.sorRank ?? '—'}</td><td><a href="/team/${team.id}/">${escapeHtml(team.name)}</a></td><td>${record(team)}</td><td>${number(team.sor, 4)}</td></tr>`).join('')}</tbody></table>`;
  const reportText = (picks, division) => {
    if (!picks) return '<p>A saved prediction publication is unavailable.</p>';
    const report = buildModelReport(picks, undefined, division);
    const season = report.scores.season;
    return `<p>${snapshot.season} season · ${season.correctPicks} correct of ${season.decisivePicks} decided saved picks. Season Brier score ${number(season.brier, 3)}.</p><p>Only forecasts saved before kickoff enter the live tally. Replays have their own validation record.</p>`;
  };
  const conferences = conferenceDatasets.find(dataset => dataset.season === snapshot.season);
  const conferenceTable = conferences ? (() => {
    const records = conferenceRecords(conferences);
    return `<table><caption>FBS interconference records · ${snapshot.season}</caption><thead><tr><th>Conference</th><th>Wins</th><th>Losses</th><th>FBS vs. FCS</th></tr></thead><tbody>${conferences.conferences.map(({id,name}) => `<tr><th>${escapeHtml(name)}</th><td>${records.summaries[id].wins}</td><td>${records.summaries[id].losses}</td><td>${record(records.fcs[id])}</td></tr>`).join('')}</tbody></table>`;
  })() : '';
  const primary = [
    ['/', 'home', 'College football, examined', 'Independent FBS and FCS rankings, team evidence, saved predictions, and conference comparisons.', `<h1>FBS Intelligence</h1><p>Independent college football rankings and matchup analysis. Published ${asOf}.</p>${table('fbs')}`],
    ['/rankings/fbs/', 'rankings', 'FBS Strength of Record', `Explore all ${snapshot.fbsTeams} FBS teams by achieved record and opponent quality. Published ${asOf}.`, '<h1>FBS Strength of Record</h1>' + table('fbs')],
    ['/rankings/fcs/', 'rankings/fcs/sor', 'FCS Strength of Record', `Explore ${snapshot.fcsTeams} FCS teams in the Experimental FCS Strength of Record rankings.`, '<h1>FCS Strength of Record · Experimental</h1>' + table('fcs')],
    ['/teams/fbs/', 'teams/fbs', 'FBS team directory', 'Browse FBS teams, records, rankings, and team profiles.', '<h1>FBS team directory</h1>' + table('fbs')],
    ['/teams/fcs/', 'teams/fcs', 'FCS team directory', 'Browse FCS teams, records, rankings, and team profiles.', '<h1>FCS team directory</h1>' + table('fcs')],
    ['/conference-strength/', 'conference-strength/records', 'Conference Strength', 'Compare interconference records, opponent quality, and individual game evidence.', '<h1>Conference Strength</h1><p>Explore conference records and an interactive head-to-head matrix. FCS results have separate records. Opponent-adjusted conference scores are Experimental.</p>'+conferenceTable+'<a href="/#conference-strength/quality">Quality rankings</a> · <a href="/#conference-strength/compare">Compare conferences</a>'],
    ['/matchup-lab/', 'compare', 'Matchup Lab', 'Compare valid FBS or FCS matchups using Predictive Strength, location, and available player evidence.', '<h1>Matchup Lab</h1><p>Select two teams to inspect their Predictive Strength, model win probabilities, and reported player information.</p>'],
    ['/sor-compare/', 'sor-compare', 'Why one team ranks above another', 'Compare earned Strength of Record rankings, schedules, wins, losses, and common opponents.', '<h1>Why one team ranks above another</h1><p>Compare SOR scores, reference-team probabilities, expected wins, venue context, and actual results.</p>'],
    ['/model-reports/fbs/', 'model-report/fbs', 'FBS weekly model report', 'Examine saved pregame predictions, accuracy, Brier score, notable misses, and sample sizes.', '<h1>FBS weekly model report</h1>'+reportText(fbsPicks,'fbs')],
    ['/model-reports/fcs/', 'model-report/fcs', 'FCS weekly model report', 'Track FCS saved pregame picks and results with separate reporting and coverage.', '<h1>FCS weekly model report</h1>'+reportText(fcsPicks,'fcs')],
    ['/methodology/', 'methodology', 'Ranking methodology', 'Read how SOR, Predictive Strength, Performance, and conference comparisons use game data.', '<h1>Ranking methodology</h1><p>SOR = −log10(P(reference team matches at least the observed wins)). Predictive Strength fits bounded scoring margins with opponent and venue adjustments. Coverage and calibration limitations accompany each method.</p><a href="https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-/blob/main/METHODOLOGY.md">Full mathematical documentation</a>'],
    ...['about', 'privacy', 'terms', 'support'].map(page => ['/' + page + '/', page, {about:'About FBS Intelligence',privacy:'Privacy and accounts',terms:'Using FBS Intelligence',support:'Support and data discrepancies'}[page], 'Understand FBS Intelligence and its public data, accounts, and reporting tools.', platformInfoMarkup(page)]),
  ];
  const pages = primary.map(([path, route, title, description, content]) => ({ path, route, title, description, content, subtitle: `${snapshot.season} season · ${asOf}`, detail: 'Independent college football intelligence', image: '/social/platform.png' }));
  for (const team of teams) {
    const rank = team.displayRank ?? team.sorRank;
    const title = `${team.name} · ${team.division.toUpperCase()} team profile`;
    const description = `${team.name} is ${record(team)} and ${Number.isInteger(rank) ? '#' + rank : 'unranked'} in FBS Intelligence ${team.division.toUpperCase()} SOR. Inspect its schedule, results, player statistics, and next matchup. As of ${asOf}.`;
    pages.push({ path: '/team/' + team.id + '/', route: 'team/' + team.id, title, description,
      image: '/social/team-' + team.id + '.png', socialTitle: team.name, accent: myTeamColors[team.id],
      subtitle: `${team.division.toUpperCase()} SOR ${Number.isInteger(rank) ? '#' + rank : 'unranked'} · ${record(team)}${team.division === 'fcs' ? ' · Experimental' : ''}`,
      detail: `${team.conference} · ${snapshot.season} · ${asOf}`,
      content: `<h1>${escapeHtml(team.name)}</h1><p>${escapeHtml(description)}</p><p>SOR ${number(team.sor, 4)} · Predictive Strength ${number(team.strength)} points.</p><a href="/#team/${team.id}/results">Results and upcoming games</a> · <a href="/#sor-compare/${team.division}/${team.id}">Compare earned rankings</a> · <a href="/#compare">Matchup Lab</a>`,
    });
  }
  await mkdir(join(output, 'social'), { recursive: true });
  await sharp(Buffer.from(previewSvg({ title: 'FBS Intelligence', subtitle: 'College football, examined', detail: `${snapshot.season} · ${asOf}`, logo: logoUrl }))).png().toFile(join(output, 'social/platform.png'));
  for (let start = 0; start < pages.length; start += 8) {
    await Promise.all(pages.slice(start, start + 8).map(async page => {
      const directory = join(output, page.path);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'index.html'), metadata(html, { ...page, links: baseLinks }));
      if (page.socialTitle) await sharp(Buffer.from(previewSvg({ title: page.socialTitle, subtitle: page.subtitle, detail: page.detail, accent: page.accent, logo: logoUrl }))).png().toFile(join(output, page.image));
    }));
  }
  const urls = pages.map(page => `<url><loc>${origin}${page.path}</loc><lastmod>${snapshot.asOf.slice(0, 10)}</lastmod></url>`).join('');
  await writeFile(join(output, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls + '</urlset>');
  await writeFile(join(output, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: ' + origin + '/sitemap.xml\n');
  return { pages: pages.length };
}
