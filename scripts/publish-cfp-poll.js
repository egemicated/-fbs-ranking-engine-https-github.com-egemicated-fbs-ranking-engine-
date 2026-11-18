import { readFile } from 'node:fs/promises';
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
const mountainDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
});
const today = mountainDate.format(new Date());
const date = process.env.CFP_RELEASE_DATE?.trim() || today;
const release = releases.find(item => item.released === date);

if (!release || date > today) {
  if (process.env.CFP_RELEASE_DATE?.trim()) throw new Error(`No CFP release due on ${date}`);
  console.log(`No CFP release scheduled for ${date}`);
} else {
  const snapshot = JSON.parse(await readFile('published/latest.json', 'utf8'));
  const teamNames = snapshot.rankings.map(team => team.name);
  let html;
  const edition = await readCfpEdition(release, teamNames, async (...args) => {
    const response = await fetch(...args);
    html = await response.text();
    return new Response(html, { status: response.status });
  });
  if (!edition) throw new Error(`No verified CFP Top 25 for ${date}`);
  const changed = await saveCfpEdition('frontend/ranking-editions.json', edition);
  await archiveCfpHistory({ html, snapshot });
  console.log(changed ? `Saved CFP Week ${edition.week} (${date})` : `CFP Week ${edition.week} is already current`);
}
