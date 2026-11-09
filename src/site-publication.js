import { createHash } from 'node:crypto';

const summaryFields = [
  'id', 'name', 'division', 'conference', 'wins', 'losses', 'ties', 'games',
  'achievement', 'strength', 'achievementScheduleStrength', 'rank', 'conferenceRank',
  'colleyRank', 'displayRank', 'displayConferenceRank', 'sor',
];

function publicationHash(snapshot) {
  return snapshot.publicationHash ?? snapshot.snapshotHash ?? createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export function publicRankings(snapshot, teamDetailsPath) {
  const { ratings, ...summary } = snapshot;
  return { ...summary, teamDetailsPath, publicationHash: publicationHash(snapshot),
    rankings: snapshot.rankings.map(row => Object.fromEntries(summaryFields.map(field => [field, row[field]]))) };
}

export function publicTeamDetails(snapshot, row) {
  const { id, contributions = [], explanation, evidence, sorTailProbability, sorExpectedWins, preseasonStrength } = row;
  const results = contributions.map(({ opponentId, opponentName, opponentRecord, opponentAchievement, result, finalMargin }) =>
    ({ opponentId, opponentName, opponentRecord, opponentAchievement, result, finalMargin }));
  return { id, publicationHash: publicationHash(snapshot), contributions: results, explanation, evidence,
    sorTailProbability, sorExpectedWins, preseasonStrength };
}
