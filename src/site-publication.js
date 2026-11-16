import { createHash } from 'node:crypto';
import { validWeeklyPick } from '../frontend/weekly-picks-score.js';
import { fcsMatchupValidation, matchupValidation, strengthWinProbability } from './site-validation.js';

const summaryFields = [
  'id', 'name', 'division', 'conference', 'wins', 'losses', 'ties', 'games',
  'achievement', 'strength', 'achievementScheduleStrength', 'rank', 'conferenceRank',
  'colleyRank', 'displayRank', 'displayConferenceRank', 'sor',
];
const fcsSummaryFields = [...summaryFields, 'sorRank', 'sorGames', 'sorWins', 'sorExcludedGames', 'strengthRank', 'sosRank'];
const selectFields = (row, fields) => Object.fromEntries(fields.map(field => [field, row[field]]));

function publicationHash(snapshot) {
  return snapshot.publicationHash ?? snapshot.snapshotHash ?? createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function teamScheduleVersion(snapshot) {
  const fetchedAt = snapshot.source?.fetchedAt;
  if (snapshot.source?.provider !== 'cfbd' || !Number.isFinite(Date.parse(fetchedAt))) return {};
  return { teamDetailsVersion: `${publicationHash(snapshot)}:${snapshot.kickoffVerificationAsOf ?? fetchedAt}` };
}

function alignedWeeklyPicks(snapshot, picks, fcs) {
  return picks?.schemaVersion === 1 && picks.season === snapshot.season && picks.source?.provider === 'cfbd' &&
    (picks.source.matchupScope === 'fcs-fcs') === fcs && picks.source.scheduleAsOf === snapshot.source.fetchedAt &&
    picks.source.rankingAsOf === snapshot.asOf && picks.source.snapshotHash === snapshot.snapshotHash &&
    Date.parse(picks.asOf) >= Date.parse(snapshot.asOf) && Array.isArray(picks.teams) && Array.isArray(picks.games) ? picks : null;
}

function fixtureOdds(game, teams, saved, config, fbsScale, fcsScale) {
  const home = teams.get(game.home), away = teams.get(game.away);
  if (![home.division, away.division].every(division => ['fbs', 'fcs'].includes(division))) return null;
  const fbs = home.division === 'fbs' && away.division === 'fbs';
  const fcs = home.division === 'fcs' && away.division === 'fcs';
  if (saved && saved.game.home === game.home && saved.game.away === game.away && saved.game.neutral === game.neutral &&
      Date.parse(saved.game.startDate) === Date.parse(game.startDate) &&
      validWeeklyPick(game, saved.game.pick, saved.game.pick.capturedAt, saved.publication.asOf, teams, fcs ? 'fcs' : 'fbs')) {
    return { homeWinProbability: saved.game.pick.homeWinProbability, probabilitySource: 'saved',
      calibrated: (fbs || fcs) && saved.publication.source.calibrated === true };
  }
  const scale = fcs ? fcsScale : (fbs ? fbsScale : null) ?? config?.probabilityScale;
  const advantage = game.neutral ? 0 : config?.homeAdvantage;
  if (![home.strength, away.strength, advantage, scale].every(Number.isFinite) || scale <= 0 || advantage < 0) return null;
  return { homeWinProbability: strengthWinProbability(home.strength, away.strength, advantage, scale),
    probabilitySource: 'estimate', calibrated: fcs || (fbs && Number.isFinite(fbsScale)) };
}

export function buildUpcomingTeamSchedule(snapshot, weeklyFbs = null, weeklyFcs = null) {
  const schedule = new Map();
  const cutoff = Date.parse(snapshot.asOf);
  if (snapshot.source?.provider !== 'cfbd' || !Number.isFinite(Date.parse(snapshot.source.fetchedAt)) ||
      !Number.isFinite(cutoff) || !snapshot.snapshotHash) return schedule;
  const fbsPicks = alignedWeeklyPicks(snapshot, weeklyFbs, false);
  const fcsPicks = alignedWeeklyPicks(snapshot, weeklyFcs, true);
  const captured = Array.isArray(snapshot.futureFixtures);
  const ranked = [...snapshot.rankings, ...(snapshot.fcsRankings ?? [])];
  const teams = new Map([...(fbsPicks?.teams ?? []), ...(fcsPicks?.teams ?? []), ...ranked, ...(snapshot.ratings ?? [])]
    .map(team => [team.id, team]));
  for (const { id, division } of ranked) {
    if (division === 'fbs' && (captured || fbsPicks) || division === 'fcs' && (captured || (fbsPicks && fcsPicks))) schedule.set(id, []);
  }
  const upcoming = [fbsPicks, fcsPicks].flatMap(publication => (publication?.games ?? [])
    .filter(game => game.status === 'scheduled').map(game => ({ game, publication })));
  const saved = new Map(upcoming.filter(({ game }) => game.pick).map(entry => [entry.game.id, entry]));
  const fixtures = captured ? snapshot.futureFixtures : upcoming.map(({ game }) => game);
  const fbsScale = matchupValidation(snapshot)?.winProbability.scale;
  const fcsScale = fcsMatchupValidation(snapshot)?.scale;
  const seen = new Set();
  for (const game of fixtures) {
    const kickoff = Date.parse(game.startDate);
    if (!(kickoff > cutoff) || typeof game.neutral !== 'boolean' || seen.has(game.id) ||
        game.home === game.away || !teams.has(game.home) || !teams.has(game.away)) continue;
    seen.add(game.id);
    const odds = fixtureOdds(game, teams, saved.get(game.id), snapshot.config, fbsScale, fcsScale);
    for (const home of [true, false]) {
      const list = schedule.get(home ? game.home : game.away);
      if (!list) continue;
      const opponent = teams.get(home ? game.away : game.home);
      list.push({ opponentId: opponent.id, opponentName: opponent.name, startDate: new Date(kickoff).toISOString(),
        venue: game.neutral ? 'neutral' : home ? 'home' : 'away',
        ...(typeof game.startTimeTbd === 'boolean' ? { startTimeTbd: game.startTimeTbd } : {}),
        winProbability: odds ? home ? odds.homeWinProbability : 1 - odds.homeWinProbability : null,
        probabilitySource: odds?.probabilitySource ?? null, calibrated: odds?.calibrated ?? false });
    }
  }
  for (const list of schedule.values()) list.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.opponentName.localeCompare(b.opponentName));
  return schedule;
}

export function publicRankings(snapshot, teamDetailsPath, includeTeamSchedule = false) {
  const { ratings, fcsRankings, futureFixtures, pendingFcsKickoffs, ...summary } = snapshot;
  return { ...summary, teamDetailsPath, publicationHash: publicationHash(snapshot),
    ...(includeTeamSchedule ? teamScheduleVersion(snapshot) : {}),
    rankings: snapshot.rankings.map(row => selectFields(row, summaryFields)),
    ...(Array.isArray(fcsRankings) ? { fcsRankings: fcsRankings.map(row => selectFields(row, fcsSummaryFields)) } : {}) };
}

export function publicTeamDetails(snapshot, row, { upcomingGames = null, includeTeamSchedule = false } = {}) {
  const { id, contributions = [], explanation, evidence, sorTailProbability, sorExpectedWins, preseasonStrength } = row;
  const results = contributions.map(({ opponentId, opponentName, opponentRecord, opponentAchievement, result, finalMargin }) =>
    ({ opponentId, opponentName, opponentRecord, opponentAchievement, result, finalMargin }));
  return { id, publicationHash: publicationHash(snapshot), upcomingGames,
    ...(includeTeamSchedule ? teamScheduleVersion(snapshot) : {}),
    contributions: results, explanation, evidence,
    sorTailProbability, sorExpectedWins, preseasonStrength,
    ...(row.division === 'fcs' ? { sorGames: row.sorGames, sorWins: row.sorWins, sorExcludedGames: row.sorExcludedGames } : {}) };
}
