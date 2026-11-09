import { readFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { readCfpEdition, saveCfpEdition } from '../src/cfp-poll.js';

// Official 2026 broadcast windows, with 30 minutes for the web edition to appear.
// https://collegefootballplayoff.com/news/2026/8/6/sc-aug-2627
const releases = [
  { week: 10, gamesThrough: '2026-11-07', released: '2026-11-10', checkUntil: '20:00' },
  { week: 11, gamesThrough: '2026-11-14', released: '2026-11-17', checkUntil: '20:00' },
  { week: 12, gamesThrough: '2026-11-21', released: '2026-11-24', checkUntil: '18:30' },
  { week: 13, gamesThrough: '2026-11-28', released: '2026-12-01', checkUntil: '18:00' },
  { week: 14, gamesThrough: '2026-12-05', released: '2026-12-06', checkUntil: '13:30' },
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
  // All remaining 2026 CFP dates fall during Mountain Standard Time.
  const deadline = Date.parse(`${date}T${release.checkUntil}:00-07:00`);
  let edition;
  do {
    try {
      edition = await readCfpEdition(release, teamNames);
    } catch (error) {
      console.warn(`CFP source check failed: ${error.message}`);
    }
    if (edition || Date.now() >= deadline) break;
    await wait(Math.min(60_000, deadline - Date.now()));
  } while (true);
  if (!edition) throw new Error(`No verified CFP Top 25 for ${date} at the end of the check window`);
  const changed = await saveCfpEdition('frontend/ranking-editions.json', edition);
  console.log(changed ? `Saved CFP Week ${edition.week} (${date})` : `CFP Week ${edition.week} is already current`);
}
