import { createHash } from 'node:crypto';

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

export function publicRankings(snapshot, teamDetailsPath) {
  const { ratings, fcsRankings, pendingFcsKickoffs, ...summary } = snapshot;
  return { ...summary, teamDetailsPath, publicationHash: publicationHash(snapshot),
    rankings: snapshot.rankings.map(row => selectFields(row, summaryFields)),
    ...(Array.isArray(fcsRankings) ? { fcsRankings: fcsRankings.map(row => selectFields(row, fcsSummaryFields)) } : {}) };
}

export function publicTeamDetails(snapshot, row) {
  const { id, contributions = [], explanation, evidence, sorTailProbability, sorExpectedWins, preseasonStrength } = row;
  const results = contributions.map(({ opponentId, opponentName, opponentRecord, opponentAchievement, result, finalMargin }) =>
    ({ opponentId, opponentName, opponentRecord, opponentAchievement, result, finalMargin }));
  return { id, publicationHash: publicationHash(snapshot), contributions: results, explanation, evidence,
    sorTailProbability, sorExpectedWins, preseasonStrength,
    ...(row.division === 'fcs' ? { sorGames: row.sorGames, sorWins: row.sorWins, sorExcludedGames: row.sorExcludedGames } : {}) };
}
