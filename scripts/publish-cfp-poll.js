import { readFile } from 'node:fs/promises';
import { readCfpEdition, saveCfpEdition } from '../src/cfp-poll.js';

// Official 2026 release dates and the last game date covered by each edition.
// https://collegefootballplayoff.com/news/2026/8/6/sc-aug-2627
const releases = [
  { week: 10, gamesThrough: '2026-11-07', released: '2026-11-10' },
  { week: 11, gamesThrough: '2026-11-14', released: '2026-11-17' },
  { week: 12, gamesThrough: '2026-11-21', released: '2026-11-24' },
  { week: 13, gamesThrough: '2026-11-28', released: '2026-12-01' },
  { week: 14, gamesThrough: '2026-12-05', released: '2026-12-06' },
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
  const edition = await readCfpEdition(release, teamNames);
  if (!edition) throw new Error(`No verified CFP Top 25 for ${date}`);
  const changed = await saveCfpEdition('frontend/ranking-editions.json', edition);
  console.log(changed ? `Saved CFP Week ${edition.week} (${date})` : `CFP Week ${edition.week} is already current`);
}
