import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readCfpEdition, saveCfpEdition } from '../src/cfp-poll.js';
import { archiveCfpHistory } from './archive-cfp-history.js';

// Official 2026 release dates. Preserve independently verified past cutoffs;
// upcoming editions have no assumed game-date cutoff (postponements can change it).
// https://collegefootballplayoff.com/news/2026/8/6/sc-aug-2627
const releases = [
  { week: 9, gamesThrough: '2026-10-31', released: '2026-11-03' },
  { week: 10, gamesThrough: '2026-11-07', released: '2026-11-10' },
  // The Nov. 17 release included the postponed Sunday game.
  { week: 11, gamesThrough: '2026-11-15', released: '2026-11-17' },
  { week: 12, gamesThrough: null, released: '2026-11-24' },
  { week: 13, gamesThrough: null, released: '2026-12-01' },
  { week: 14, gamesThrough: null, released: '2026-12-06' },
];
const easternDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
const readJson = path => readFile(path, 'utf8').then(JSON.parse);

export async function publishCfpPoll({ snapshot, comparisonPath = 'frontend/ranking-editions.json',
  historyPath = `published/poll-history/${snapshot.season}.json`, releaseDate = '', now = new Date(), fetcher = fetch }) {
  const [comparison, history] = await Promise.all([readJson(comparisonPath), readJson(historyPath).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  })]);
  if (comparison.season !== snapshot.season || !Array.isArray(comparison.polls?.cfp) ||
      history && (history.season !== snapshot.season || !Array.isArray(history.editions?.cfp))) {
    throw Error('CFP publication season mismatch');
  }

  const today = easternDate.format(now);
  const checkedAt = now.toISOString();
  const due = releases.filter(release => release.released.startsWith(`${snapshot.season}-`) && release.released <= today);
  const complete = release => comparison.polls.cfp.some(row => row.released === release.released) &&
    history?.editions.cfp.some(row => row.released === release.released);
  const explicit = releaseDate ? due.find(release => release.released === releaseDate) : undefined;
  if (releaseDate && !explicit) throw Error(`No CFP release due on ${releaseDate}`);
  const release = explicit ?? due.findLast(row => !complete(row));
  if (!release || complete(release)) {
    return { poll: 'cfp', status: due.length ? 'current' : 'no-due', checkedAt, released: (release ?? due.at(-1))?.released ?? null };
  }

  let html;
  const edition = await readCfpEdition(release, snapshot.rankings.map(team => team.name), async (...args) => {
    const response = await fetcher(...args);
    html = await response.text();
    return new Response(html, { status: response.status });
  });
  if (!edition) return { poll: 'cfp', status: 'not-yet-released', checkedAt, released: release.released };

  const changed = await saveCfpEdition(comparisonPath, edition);
  const archived = await archiveCfpHistory({ html, snapshot, path: historyPath, now: checkedAt });
  return { poll: 'cfp', status: changed || archived ? 'saved' : 'current', checkedAt, released: edition.released };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const snapshot = await readJson('published/latest.json');
  console.log(JSON.stringify(await publishCfpPoll({ snapshot, releaseDate: process.env.CFP_RELEASE_DATE?.trim() })));
}
