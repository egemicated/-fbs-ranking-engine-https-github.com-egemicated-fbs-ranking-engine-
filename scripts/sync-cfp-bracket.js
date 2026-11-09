import { readFile } from 'node:fs/promises';
import { cfpSyncCredentials, fetchCfbdCfpGames, publishCfpSync, readWeeklyCfpGames, selectCfpResults, validateCfpBracket } from '../src/cfp-bracket-feed.js';

const season = 2026;
const args = process.argv.slice(2);
const mode = args[0] ?? '--weekly';
if (args.length > 1 || !['--selection', '--weekly', '--game-night'].includes(mode)) {
  throw new Error('Usage: node scripts/sync-cfp-bracket.js [--selection|--weekly|--game-night]');
}
const readJson = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const field = await readJson(`data/cfp-bracket-${season}.json`).catch(error => {
  if (error.code === 'ENOENT') return undefined;
  throw error;
});

if (field === undefined) {
  console.log(`CFP bracket sync skipped. Reviewed ${season} field is not yet published.`);
} else {
  const snapshot = await readJson('published/latest.json');
  if (snapshot.season !== season) throw new Error(`Missing the ${season} FBS team roster`);
  const teamById = new Map(snapshot.rankings.map(team => [String(team.id), team.name]));
  const bracket = validateCfpBracket(field, season, new Set(teamById.values()));
  if (mode !== '--selection' && Date.now() < Date.parse(bracket.lockAt)) {
    console.log('CFP result sync skipped. The first playoff game has not started.');
  } else {
    const url = process.env.CFP_SUPABASE_URL || (await readJson('frontend/bracket-config.json')).url;
    const credentials = cfpSyncCredentials(url, process.env.CFP_SUPABASE_SECRET_KEY);
    let results = {};
    let observedAt = null;
    if (mode !== '--selection') {
      const data = mode === '--game-night'
        ? await fetchCfbdCfpGames(season, teamById, process.env.CFBD_API_KEY)
        : readWeeklyCfpGames(await readJson('published/weekly-picks.json'), season);
      observedAt = data.observedAt;
      results = selectCfpResults(bracket, data.games, data.observedAt);
    }
    await publishCfpSync(credentials, season, bracket, results, { observedAt });
    console.log(`CFP ${season} sync published the official field and ${Object.keys(results).length} confirmed finals.`);
  }
}
