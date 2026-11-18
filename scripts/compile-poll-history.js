import { createHash } from 'node:crypto';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicJson } from '../src/ingest.js';
import { normalizePollEditions } from '../src/poll-history.js';
import { parseCfpArchive } from '../src/cfp-poll.js';
import { saveApComparisonEdition } from '../src/poll-comparison.js';

const [providerDirectory] = process.argv.slice(2);
if (!providerDirectory) throw Error('Usage: node scripts/compile-poll-history.js PROVIDER_ARTIFACT_DIRECTORY');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const ledger = await read('research/poll-release-ledger.json');
const manifest = await read(join(providerDirectory, 'manifest.json'));
let crosschecks;
try { crosschecks = await read('research/poll-crosschecks.json'); }
catch (error) { if (error.code !== 'ENOENT') throw error; crosschecks = { schemaVersion: 1, verifiedOn: ledger.verifiedOn, seasons: {} }; }
const sha = text => createHash('sha256').update(text).digest('hex');
const clean = value => value.replace(/<sup\b[\s\S]*?<\/sup>/g, '').replace(/<[^>]+>/g, '')
  .replaceAll('&amp;', '&').replaceAll('&nbsp;', ' ').replace(/\s+/g, ' ').trim();
const canonical = value => ({ 'Miami (FL)': 'Miami', 'Southern California': 'USC', 'Southern Cal': 'USC', Mississippi: 'Ole Miss' }[value] ?? value);
const fingerprint = rows => JSON.stringify(rows.map(row => [canonical(row.team ?? row.school), row.rank])
  .sort((a, b) => a[0].localeCompare(b[0])));

function apMirror(html, dates) {
  const table = [...html.matchAll(/<table\b[\s\S]*?<\/table>/g)].map(match => match[0])
    .find(table => table.startsWith('<table class="wikitable"'));
  if (!table) throw Error('Missing AP corroboration matrix');
  const editions = dates.map(([released]) => ({ released, rows: [] }));
  const tied = new Map();
  for (const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const position = Number(clean(match[1].match(/<th\b[^>]*>([\s\S]*?)<\/th>/)?.[1] ?? '').replace('.', ''));
    if (!Number.isInteger(position) || position < 1 || position > 25) continue;
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(cell => clean(cell[1]));
    for (let column = 0; column < dates.length; column++) {
      const text = cells[column];
      if (!text) throw Error('Incomplete AP corroboration column');
      const isTie = /(?:т|\(T\)|\(t\))\s*$/.test(text);
      const previous = tied.get(column);
      const rank = isTie && previous?.tied ? previous.rank : position;
      const team = canonical(text.replace(/\s+\(\d+[–−-]\d+[\s\S]*$/, '').replace(/\s+\(\d+\).*$/, '')
        .replace(/\s*(?:т|\(T\)|\(t\))\s*$/, '').trim());
      editions[column].rows.push({ team, rank });
      tied.set(column, { tied: isTie, rank });
    }
  }
  if (editions.some(edition => edition.rows.length !== 25)) throw Error('AP corroboration must have 25 rows per edition');
  return editions;
}

function cfp2025Mirror(html, dates) {
  const table = [...html.matchAll(/<table\b[\s\S]*?<\/table>/g)].map(match => match[0]).find(table => table.includes('NOVEMBER 4'));
  if (!table) throw Error('Missing official 2025 CFP matrix');
  const editions = dates.map(([released]) => ({ released, rows: [] }));
  for (const match of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const team = canonical(clean(match[1].match(/<th\b[^>]*scope="row"[^>]*>([\s\S]*?)<\/th>/)?.[1] ?? ''));
    if (!team) continue;
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(cell => clean(cell[1]));
    for (let index = 0; index < dates.length; index++) {
      let rank = Number(cells[index]);
      // Explicit primary-source discrepancy, independently resolved by the
      // official Dec. 2 media guide, page 27; retained in the source ledger.
      if (dates[index][0] === '2025-12-02' && team === 'James Madison' && rank === 24) rank = 25;
      if (Number.isInteger(rank) && rank >= 1 && rank <= 25) editions[index].rows.push({ team, rank });
    }
  }
  return editions;
}

const verification = { schemaVersion: 1, providerCalls: manifest.providerCalls, verifiedOn: ledger.verifiedOn, seasons: [] };
await mkdir('research/poll-provider', { recursive: true });
await copyFile(join(providerDirectory, 'manifest.json'), 'research/poll-provider/manifest.json');
for (const season of [2025, 2026]) {
  const sourceFile = `${season}-provider-editions.json`;
  const sourceText = await readFile(join(providerDirectory, sourceFile), 'utf8');
  const sourceManifest = manifest.seasons.find(row => row.year === season);
  if (sha(sourceText) !== sourceManifest.normalizedSha256) throw Error(`Provider artifact checksum mismatch for ${season}`);
  const provider = JSON.parse(sourceText);
  const membership = season === 2025 ? Object.values((await read('published/conference-archives/2025.json')).teams) :
    (await read('published/weekly-picks.json')).teams;
  const ids = new Map(membership.filter(team => team.division === 'fbs').map(team => [team.id, team]));
  const history = { schemaVersion: 1, season, verifiedOn: ledger.verifiedOn, editions: {}, releases: {},
    sourceHashes: [sourceManifest, { path: 'research/poll-release-ledger.json', sha256: sha(await readFile('research/poll-release-ledger.json')) }] };
  if (!crosschecks.seasons[season]) {
    const mirrorText = await readFile(`research/cache/polls/wiki${season}.html`, 'utf8');
    const officialText = await readFile(`research/cache/polls/${season === 2025 ? 'cfp2025-weekly' : 'cfp'}.html`, 'utf8');
    crosschecks.seasons[season] = { ap: apMirror(mirrorText, ledger.seasons[season].ap),
      cfp: season === 2025 ? cfp2025Mirror(officialText, ledger.seasons[season].cfp) :
        parseCfpArchive(officialText, season, [...ids.values()].map(team => team.name)),
      sources: [
        { url: `https://en.wikipedia.org/wiki/${season}_NCAA_Division_I_FBS_football_rankings`, sha256: sha(mirrorText), role: 'Secondary full-row corroboration; publication dates independently verified from AP material' },
        { provider: 'College Football Playoff', url: season === 2025 ? ledger.seasons[season].cfp[0][1] : 'https://collegefootballplayoff.com/rankings', sha256: sha(officialText) },
      ] };
  }
  const mirrors = crosschecks.seasons[season];
  history.sourceHashes.push(...mirrors.sources);
  const seasonVerification = { season, polls: {} };
  for (const [key, pollName] of [['ap', 'AP Top 25'], ['cfp', 'Playoff Committee Rankings']]) {
    history.editions[key] = [];
    history.releases[key] = ledger.seasons[season][key].map(([released, sourceUrl, kind]) => ({ released, kind: kind ?? (key === 'ap' ? 'weekly' : 'committee'), publication: { precision: 'date', sourceUrl } }));
    const providerPolls = provider.editions.flatMap(week => week.polls.filter(poll => poll.poll === pollName)
      .map(poll => ({ ...poll, week: week.week, seasonType: week.seasonType })));
    const used = new Set();
    for (const [released, sourceUrl, kind] of ledger.seasons[season][key]) {
      const mirror = mirrors[key].find(edition => edition.released === released);
      const matches = providerPolls.filter(poll => fingerprint(poll.ranks) === fingerprint(mirror?.rows ?? []));
      if (matches.length !== 1) throw Error(`${season} ${key} ${released}: ${matches.length} full-row provider/source matches`);
      const poll = matches[0];
      const identity = `${poll.seasonType}/${poll.week}`;
      if (used.has(identity)) throw Error('Ambiguous identical provider editions');
      used.add(identity);
      const rows = poll.ranks.map(row => {
        const id = String(row.teamId);
        const member = ids.get(id);
        if (!member || canonical(row.school) !== member.name) throw Error(`Poll stable ID/name mismatch for ${row.school}`);
        return { id, team: member.name, rank: row.rank };
      });
      const edition = { released, kind: kind ?? (key === 'ap' ? 'weekly' : 'committee'),
        publication: { precision: 'date', sourceUrl }, url: sourceUrl, rows,
        provenance: { provider: 'CollegeFootballData', responseSha256: sourceManifest.responseSha256,
          providerWeek: poll.week, providerSeasonType: poll.seasonType, isFinal: poll.isFinal ?? null,
          verification: 'All team/rank pairs match independently dated corroboration; dates are never inferred from provider weeks.' } };
      if (normalizePollEditions([edition], membership).length !== 1) throw Error('Incomplete normalized poll edition');
      history.editions[key].push(edition);
    }
    if (used.size !== providerPolls.length) throw Error(`Unreconciled ${season} ${key} provider editions`);
    seasonVerification.polls[key] = { editions: used.size, fullRankPairsMatched: history.editions[key].reduce((sum, edition) => sum + edition.rows.length, 0) };
  }
  const path = `published/poll-history/${season}.json`;
  let existing; try { existing = await read(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const key of ['ap', 'cfp']) for (const saved of existing?.editions?.[key] ?? []) {
    const next = history.editions[key].find(edition => edition.released === saved.released);
    if (!next || fingerprint(next.rows) !== fingerprint(saved.rows)) throw Error(`Saved ${key} edition ${saved.released} would change`);
    // Keep the existing edition's provenance and availability evidence intact.
    history.editions[key][history.editions[key].indexOf(next)] = saved;
  }
  await copyFile(join(providerDirectory, sourceFile), join('research/poll-provider', sourceFile));
  await atomicJson(path, history);
  if (season === 2026) for (const edition of history.editions.ap) {
    await saveApComparisonEdition({ path: 'frontend/ranking-editions.json', season, edition,
      week: edition.kind === 'preseason' ? -1 : edition.provenance.providerWeek - 1 });
  }
  verification.seasons.push(seasonVerification);
}
await atomicJson('research/poll-verification.json', verification);
await atomicJson('research/poll-crosschecks.json', crosschecks);
console.log(JSON.stringify(verification));
