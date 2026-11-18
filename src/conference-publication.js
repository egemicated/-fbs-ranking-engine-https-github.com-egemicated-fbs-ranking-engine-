import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { rankSeason } from './engine.js';
import { assertNoLogicalDuplicates } from './data-quality.js';
import { performanceForSnapshot } from './performance-publication.js';

const powerFour = new Set(['ACC', 'Big Ten', 'Big 12', 'SEC']);
const groupOfFive = new Set(['American Athletic', 'Conference USA', 'Mid-American', 'Mountain West', 'Sun Belt']);
const independent = 'FBS Independents';
const mountainDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
});
const day = value => Number.isFinite(Date.parse(value)) ? mountainDay.format(new Date(value)) : null;
const dateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
const rank = value => Number.isInteger(value) && value > 0 ? value : null;
const count = value => Number.isInteger(value) && value >= 0 ? value : null;
const measure = value => Number.isFinite(value) ? value : null;
const names = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const fbs = team => team?.division === 'fbs';
const method = (map, asOf, fullField, basis, extra = {}) => ({
  available: map.size > 0, asOf: map.size ? asOf : null, fullField: map.size > 0 && fullField, basis, ...extra,
});

function conferenceGroup(conference, season) {
  if (conference === independent) return 'independent';
  if (powerFour.has(conference)) return 'power-four';
  if (groupOfFive.has(conference)) return season >= 2026 ? 'group-of-six' : 'group-of-five';
  if (conference === 'Pac-12' && season >= 2026) return 'group-of-six';
  return 'other';
}

function standingsMap(rows, field, fallback) {
  return new Map(rows.filter(row => Number.isFinite(row[field]))
    .sort((a, b) => b[field] - a[field] || (fallback ? fallback(a, b) : a.id.localeCompare(b.id)))
    .map((row, index) => [row.id, index + 1]));
}

function pollEditions(editions, teamIdByName) {
  if (!Array.isArray(editions)) return [];
  return editions.flatMap(edition => {
    if (!dateOnly(edition?.released) || !dateOnly(edition.gamesThrough) || edition.gamesThrough > edition.released ||
        !Array.isArray(edition.rows) || edition.rows.length < 25) return [];
    const rows = new Map();
    for (const [index, row] of edition.rows.entries()) {
      const id = teamIdByName.get(names(row.team));
      const position = rank(row.rank ?? index + 1);
      if (!id || rows.has(id) || !position || position > 25) return [];
      rows.set(id, position);
    }
    return [{ ranks: rows, publishedDay: edition.released, asOf: edition.released, gamesThrough: edition.gamesThrough,
      ...(typeof edition.url === 'string' ? { url: edition.url } : {}) }];
  }).sort((a, b) => a.publishedDay.localeCompare(b.publishedDay));
}

function savedSorEditions(history, season, teamIds) {
  if (history?.season !== season || !Array.isArray(history.editions)) return [];
  return history.editions.flatMap(edition => {
    if (edition.kind !== 'saved' || !dateOnly(edition.released) || !day(edition.asOf) ||
        !Array.isArray(edition.rows) || edition.rows.length !== teamIds.size ||
        edition.rows.some(row => !teamIds.has(row.id)) ||
        new Set(edition.rows.map(row => row.id)).size !== teamIds.size) return [];
    return [{ ranks: new Map(edition.rows.map(row => [row.id, rank(row.rank)])),
      publishedDay: [edition.released, day(edition.asOf)].sort().at(-1), asOf: edition.asOf }];
  }).sort((a, b) => a.publishedDay.localeCompare(b.publishedDay) || Date.parse(a.asOf) - Date.parse(b.asOf));
}

function pregameRanks(game, histories, teams) {
  // Kickoff time and release time can be uncertain. Only use editions known to
  // have been published before the game's calendar day or uncertain date boundary.
  const utcDay = new Date(game.startDate).toISOString().slice(0, 10);
  const kickoffDay = game.startTimeTbd === true ? [day(game.startDate), utcDay].sort()[0] : day(game.startDate);
  const pregame = {}, pregameAsOf = {};
  for (const [key, editions] of Object.entries(histories)) {
    const edition = editions.findLast(item => item.publishedDay < kickoffDay);
    if (!edition) continue;
    pregame[key] = [game.home, game.away].map(id => fbs(teams.get(id)) ? edition.ranks.get(id) ?? null : null);
    pregameAsOf[key] = edition.asOf;
  }
  return { pregame, pregameAsOf };
}

function completedFbsGames(games, teams, asOf) {
  const finalById = new Map();
  const cutoff = Date.parse(asOf);
  for (const game of games) {
    if (game.status !== 'final' || !(Date.parse(game.startDate) <= cutoff)) continue;
    const home = teams.get(game.home), away = teams.get(game.away);
    if (!fbs(home) && !fbs(away)) continue;
    if (!home || !away || game.home === game.away || typeof game.id !== 'string' || !game.id ||
        count(game.homePoints) === null || count(game.awayPoints) === null || typeof game.neutral !== 'boolean' ||
        !Number.isInteger(game.week) || !['regular', 'postseason'].includes(game.seasonType)) {
      throw Error(`Invalid conference result ${game.id}`);
    }
    const result = { id: game.id, home: game.home, away: game.away, homePoints: game.homePoints,
      awayPoints: game.awayPoints, startDate: new Date(game.startDate).toISOString(),
      neutral: game.neutral, startTimeTbd: game.startTimeTbd === true, week: game.week, seasonType: game.seasonType };
    const previous = finalById.get(game.id);
    if (previous && JSON.stringify(result) !== JSON.stringify(previous)) throw Error(`Conflicting conference result ${game.id}`);
    finalById.set(game.id, result);
  }
  const finals = [...finalById.values()].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
  assertNoLogicalDuplicates(finals.map(game => ({ ...game, completed: true })));
  return finals;
}

function buildDataset({ season, asOf, archived, source, membership, ratings, games, probabilityScale, homeAdvantage,
  sorRows = [], performanceRows = [], performanceAsOf = null, polls = {}, history = null }) {
  const teams = new Map(membership.map(team => [team.id, team]));
  if (teams.size !== membership.length) throw Error('Duplicate season team membership');
  const fbsTeams = membership.filter(fbs);
  const fbsIds = new Set(fbsTeams.map(team => team.id));
  const teamIdByName = new Map(fbsTeams.map(team => [names(team.name), team.id]));
  if (!fbsIds.size || fbsIds.size !== teamIdByName.size) throw Error('Missing or ambiguous FBS team names');

  const byId = new Map(ratings.map(team => [team.id, team]));
  const fbsRatings = fbsTeams.flatMap(team => byId.has(team.id) ? [byId.get(team.id)] : []);
  const sor = new Map(sorRows.filter(row => rank(row.displayRank)).map(row => [row.id, row.displayRank]));
  const predictive = standingsMap(fbsRatings, 'strength');
  const primaryOrder = new Map(sorRows.map((row, index) => [row.id, index]));
  const sos = standingsMap(fbsRatings, 'achievementScheduleStrength', (a, b) => {
    // Match the existing FBS team page's stable sort of primary ranking rows on an SOS tie.
    const order = (primaryOrder.get(a.id) ?? Infinity) - (primaryOrder.get(b.id) ?? Infinity);
    return order || a.id.localeCompare(b.id);
  });
  const performance = new Map(performanceRows.filter(row => rank(row.rank)).map(row => [row.id, row.rank]));
  // Poll releases are published independently of the game results refresh.
  const ap = pollEditions(polls.ap, teamIdByName);
  const cfp = pollEditions(polls.cfp, teamIdByName);
  const currentAp = ap.at(-1), currentCfp = cfp.at(-1);
  const histories = { sor: savedSorEditions(history, season, fbsIds), ap, cfp };
  const finals = completedFbsGames(games, teams, asOf);
  const conferenceRecords = new Map(fbsTeams.filter(team => team.conference && team.conference !== independent)
    .map(team => [team.id, { wins: 0, losses: 0, ties: 0 }]));
  const relevant = [];
  const coverage = { fbsInterconferenceGames: 0, fbsFcsGames: 0, excludedFbsGames: 0 };
  for (const game of finals) {
    const home = teams.get(game.home), away = teams.get(game.away);
    if (fbs(home) && fbs(away) && home.conference && away.conference) {
      if (home.conference === away.conference) {
        const outcomes = game.homePoints > game.awayPoints ? ['wins', 'losses'] :
          game.homePoints < game.awayPoints ? ['losses', 'wins'] : ['ties', 'ties'];
        if (home.conference !== independent) {
          conferenceRecords.get(home.id)[outcomes[0]]++;
          conferenceRecords.get(away.id)[outcomes[1]]++;
        }
        continue;
      }
      coverage.fbsInterconferenceGames++;
    } else if (fbs(home) && home.conference && away.division === 'fcs' ||
        fbs(away) && away.conference && home.division === 'fcs') {
      coverage.fbsFcsGames++;
    } else {
      coverage.excludedFbsGames++;
      continue;
    }
    relevant.push({ ...game, ...pregameRanks(game, histories, teams) });
  }
  const relevantIds = new Set([...fbsIds, ...relevant.flatMap(game => [game.home, game.away])]);
  const conferences = [...new Set(fbsTeams.flatMap(team => team.conference ? [team.conference] : []))]
    .sort((a, b) => a.localeCompare(b))
    .map(id => ({ id, name: id, group: conferenceGroup(id, season) }));
  const publicTeams = membership.filter(team => relevantIds.has(team.id)).map(team => {
    const row = byId.get(team.id);
    return [team.id, {
      id: team.id, name: team.name, conference: team.conference ?? null, division: team.division,
      wins: count(row?.wins), losses: count(row?.losses), ties: count(row?.ties),
      conferenceRecord: conferenceRecords.get(team.id) ?? null,
      strength: measure(row?.strength), sos: measure(row?.achievementScheduleStrength), sosRank: sos.get(team.id) ?? null,
      ranks: {
        sor: sor.get(team.id) ?? null, predictive: predictive.get(team.id) ?? null,
        performance: performance.get(team.id) ?? null,
        ap: currentAp?.ranks.get(team.id) ?? null, cfp: currentCfp?.ranks.get(team.id) ?? null,
      },
    }];
  });
  const methods = {
    sor: method(sor, source.rankingsAsOf ?? asOf, true, 'published', { historicalEditions: histories.sor.length }),
    predictive: method(predictive, source.rankingsAsOf ?? asOf, true, archived ? 'season-end' : 'published', { historicalEditions: 0 }),
    performance: method(performance, performanceAsOf, performance.size === fbsIds.size, 'experimental', { historicalEditions: 0 }),
    ap: method(currentAp?.ranks ?? new Map(), currentAp?.asOf, false, 'poll',
      { historicalEditions: ap.length, gamesThrough: currentAp?.gamesThrough ?? null, url: currentAp?.url ?? null }),
    cfp: method(currentCfp?.ranks ?? new Map(), currentCfp?.asOf, false, 'poll',
      { historicalEditions: cfp.length, gamesThrough: currentCfp?.gamesThrough ?? null, url: currentCfp?.url ?? null }),
  };
  return { schemaVersion: 1, season, asOf, archived, resultsThrough: day(finals.at(-1)?.startDate),
    source, conferences, teams: Object.fromEntries(publicTeams), games: relevant, rankings: methods,
    probabilityScale: measure(probabilityScale), homeAdvantage: measure(homeAdvantage), coverage };
}

export function buildConferenceDataset({ snapshot, fbsPicks, performance, rankingHistory, rankingEditions }) {
  const { source } = fbsPicks ?? {};
  const asOf = snapshot?.source?.fetchedAt;
  if (snapshot?.source?.provider !== 'cfbd' || source?.provider !== 'cfbd' || fbsPicks?.schemaVersion !== 1 ||
      source.matchupScope === 'fcs-fcs' || fbsPicks.season !== snapshot.season ||
      !day(asOf) || source.scheduleAsOf !== asOf || source.rankingAsOf !== snapshot.asOf ||
      !snapshot.snapshotHash || source.snapshotHash !== snapshot.snapshotHash ||
      !Array.isArray(fbsPicks.teams) || !Array.isArray(fbsPicks.games) || !Array.isArray(snapshot.rankings)) return null;
  const member = new Map(fbsPicks.teams.map(team => [team.id, team]));
  if (fbsPicks.teams.filter(fbs).length !== snapshot.rankings.length || snapshot.rankings.some(team => {
    const listed = member.get(team.id);
    return !fbs(listed) || listed.name !== team.name || listed.conference !== team.conference;
  })) throw Error('Conference result membership differs from the ranking snapshot');
  const rankings = new Map((snapshot.ratings ?? []).map(row => [row.id, row]));
  for (const row of snapshot.rankings) rankings.set(row.id, row);
  const measured = performanceForSnapshot(performance, snapshot);
  return buildDataset({
    season: snapshot.season, asOf, archived: false,
    source: { provider: 'CollegeFootballData', snapshotHash: snapshot.snapshotHash, rankingsAsOf: snapshot.asOf },
    membership: fbsPicks.teams, ratings: [...rankings.values()], games: fbsPicks.games,
    probabilityScale: source.probabilityScale, homeAdvantage: source.homeAdvantage,
    sorRows: snapshot.rankings, performanceRows: measured?.rankings, performanceAsOf: measured?.asOf,
    polls: rankingEditions?.season === snapshot.season ? rankingEditions.polls : {},
    history: rankingHistory,
  });
}

export function buildArchivedConferenceDataset({ season, prior }) {
  const asOf = season?.source?.fetchedAt;
  if (prior?.season !== season?.year || season?.source?.provider !== 'sportsdataverse' ||
      prior.source?.sha256 !== season.source.sha256 || !day(asOf) || !Array.isArray(prior.ratings) ||
      !prior.config || !Array.isArray(season.games) || !Array.isArray(season.teams)) throw Error('Unverified conference archive');
  const fbsIds = new Set(season.teams.filter(fbs).map(team => team.id));
  const fbsGames = season.games.filter(game => fbsIds.has(game.home) || fbsIds.has(game.away));
  if (fbsGames.some(game => !game.completed || !(Date.parse(game.startDate) <= Date.parse(asOf)))) {
    throw Error('Archived FBS schedule is incomplete');
  }
  const computed = rankSeason(season, { config: prior.config });
  const strengths = new Map(prior.ratings.map(row => [row.id, row.strength]));
  if (strengths.size !== prior.ratings.length || computed.rankings.some(row => !Number.isFinite(strengths.get(row.id)) || row.games < 12)) {
    throw Error('Archived FBS records or prior Strength ratings are incomplete');
  }
  return buildDataset({
    season: season.year, asOf, archived: true, source: {
      provider: 'SportsDataverse (cfbfastR)', url: season.source.url,
      archiveSourceHash: season.source.sha256, predictiveSnapshotHash: prior.snapshotHash,
    },
    membership: season.teams,
    ratings: computed.ratings.map(row => ({ ...row, strength: strengths.get(row.id) ?? null })),
    games: fbsGames.map(game => ({ ...game, status: 'final' })),
    probabilityScale: prior.config.probabilityScale, homeAdvantage: prior.config.homeAdvantage,
  });
}

async function readOptionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') console.warn('Conference data file unavailable:', error.message);
    return null;
  }
}

export async function loadConferencePublications({ root, snapshot, fbsPicks, performance,
  frontendDirectory = join(root, 'frontend'), publicationDirectory = join(root, 'published') }) {
  const archives = join(publicationDirectory, 'conference-archives');
  const [rankingHistory, rankingEditions, files] = await Promise.all([
    readOptionalJson(join(frontendDirectory, 'ranking-history.json')),
    readOptionalJson(join(frontendDirectory, 'ranking-editions.json')),
    readdir(archives).catch(error => {
      if (error.code !== 'ENOENT') console.warn('Conference archives unavailable:', error.message);
      return [];
    }),
  ]);
  const datasets = (await Promise.all(files.filter(file => /^\d{4}\.json$/.test(file)).map(async file => {
    const archive = await readOptionalJson(join(archives, file));
    return archive?.schemaVersion === 1 && archive.archived === true && archive.season === Number(file.slice(0, 4)) &&
      archive.season !== snapshot?.season && Array.isArray(archive.games) && archive.teams ? archive : null;
  }))).filter(Boolean);
  try {
    const current = buildConferenceDataset({ snapshot, fbsPicks, performance, rankingHistory, rankingEditions });
    if (current) datasets.push(current);
  } catch (error) {
    console.warn('Current conference results unavailable:', error.message);
  }
  datasets.sort((a, b) => b.season - a.season);
  return { manifest: { schemaVersion: 1, seasons: datasets.map(row => row.season) }, datasets };
}
