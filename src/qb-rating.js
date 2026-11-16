const DAY = 86_400_000;
const DIVISIONS = ['fbs', 'fcs'];
const weights = Object.freeze({
  touchdownYards: 15,
  interceptionYards: 40,
  playerPriorAttempts: 60,
  opponentPriorAttempts: 180,
  minimumAttempts: 20,
  minimumReferenceAttempts: 200,
  minimumReferenceTeams: 5,
  center: 100,
  pointsPerYard: 10,
});

export const QB_RATING_METHOD = Object.freeze({
  id: 'fbs-intelligence-qb-v1',
  status: 'experimental',
  scale: '100 is the same-season subdivision reference. Ten points represent one adjusted yard-equivalent per attempt after shrinkage.',
  formula: '100 + 10 × (Y + 15 × TD − 40 × INT − D − A × L) / (A + 60)',
  terms: Object.freeze({
    Y: 'Passing yards in complete attributed rows',
    TD: 'Passing touchdowns',
    INT: 'Interceptions thrown',
    D: 'Sum of attempts × opposing defense allowance for each game',
    A: 'Pass attempts in complete attributed rows',
    L: 'Attempt-weighted opponent-adjusted passing rate of covered same-season passers in the same subdivision',
  }),
  opponentFormula: 'Defense allowance = (opponent prior yard-equivalents − prior subdivision rate × opponent prior attempts) / (opponent prior attempts + 180). Use evidence available at least 24 hours after earlier game kickoffs.',
  explanation: 'Yards measure progress. Touchdowns earn 15 yard-equivalents and interceptions cost 40 as fixed experimental weights. Completion count checks the input and is visible alongside the rating. Sixty reference attempts pull a short record toward average. Earlier same-subdivision opponent samples measure passing defense before the game.',
  limitation: 'The model uses passing box-score evidence. Published rushing yards can include sacks, and player fumble data does not consistently distinguish QB plays or assign lost fumbles. Rushing, sacks and fumbles remain separate evidence until their attribution can be verified. FBS and FCS use separate comparison groups.',
  weights,
});

function validId(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes(':');
}

function passingLine(passing) {
  if (!passing) return null;
  const { attempts, completions, yards, touchdowns, interceptions } = passing;
  if (![attempts, completions, yards, touchdowns, interceptions].every(Number.isSafeInteger) ||
      attempts <= 0 || completions < 0 || completions > attempts || touchdowns < 0 ||
      touchdowns > completions || interceptions < 0 || interceptions > attempts - completions ||
      (completions === 0 && yards !== 0)) return null;
  return { attempts, completions, yards, touchdowns, interceptions,
    value: yards + weights.touchdownYards * touchdowns - weights.interceptionYards * interceptions };
}

function addRate(totals, line) {
  totals.attempts += line.attempts;
  totals.value += line.value;
}

function rateTotals() {
  return { attempts: 0, value: 0 };
}

function sampleTotals(division) {
  return { division, attempts: 0, completions: 0, yards: 0, touchdowns: 0, interceptions: 0,
    value: 0, defenseAdjustment: 0, adjustedAttempts: 0, games: 0, incompletePassingGames: 0 };
}

function addSample(totals, line, defense, adjusted) {
  addRate(totals, line);
  totals.completions += line.completions;
  totals.yards += line.yards;
  totals.touchdowns += line.touchdowns;
  totals.interceptions += line.interceptions;
  totals.defenseAdjustment += line.attempts * defense;
  if (adjusted) totals.adjustedAttempts += line.attempts;
  totals.games++;
}

/** Pass only completed observations authenticated by the caller's season/game join. */
export function buildQBRatings(observations, { season, asOf } = {}) {
  if (!Array.isArray(observations) || (season !== undefined && !Number.isInteger(season))) {
    throw new Error('QB ratings require one season of player game observations');
  }
  const cutoff = asOf === undefined ? Infinity : Date.parse(asOf);
  if (Number.isNaN(cutoff)) throw new Error('Invalid QB rating cutoff');

  const keys = new Set();
  const identities = new Map();
  const players = new Map();
  const cohorts = Object.fromEntries(DIVISIONS.map(division => [division, { ...rateTotals(), teams: new Set(), players: new Set() }]));
  const observedSeasons = new Set();
  const rows = [];
  for (const row of observations) {
    if (!row || ![row.gameId, row.teamId, row.playerId, row.opponentId].every(validId) ||
        row.teamId === row.opponentId || !DIVISIONS.includes(row.division) ||
        (row.season !== undefined && (!Number.isInteger(row.season) || (season !== undefined && row.season !== season)))) {
      throw new Error('Invalid QB game identity or season');
    }
    if (row.season !== undefined) observedSeasons.add(row.season);
    const time = Date.parse(row.kickoff ?? row.date);
    if (!Number.isFinite(time)) throw new Error('Invalid QB game kickoff');
    if (time >= cutoff) continue;
    const key = `${row.teamId}:${row.playerId}`;
    const identity = `${row.gameId}:${row.teamId}:${row.playerId}`;
    if (keys.has(identity)) throw new Error(`Duplicate QB game row: ${identity}`);
    keys.add(identity);
    const side = `${row.gameId}:${row.teamId}`;
    const context = `${row.opponentId}:${row.division}:${time}`;
    if (identities.has(side) && identities.get(side) !== context) throw new Error('Conflicting QB game context');
    identities.set(side, context);
    const totals = players.get(key) ?? sampleTotals(row.division);
    if (totals.division !== row.division) throw new Error('Conflicting QB subdivision');
    players.set(key, totals);
    const line = passingLine(row.passing);
    if (line) {
      rows.push({ ...row, key, time, line, totals });
    } else if (row.passing && row.passing.attempts !== 0) {
      totals.incompletePassingGames++;
    }
  }
  if (observedSeasons.size > 1) throw new Error('QB comparison groups cannot mix seasons');

  rows.sort((a, b) => a.time - b.time || a.gameId.localeCompare(b.gameId) || a.key.localeCompare(b.key));
  const earlierDivisions = new Map();
  const earlierDefenses = new Map();
  let nextEarlier = 0;
  for (const row of rows) {
    // Historical archives record kickoff, not when a finished box became public.
    // Use the same conservative day buffer as the team's retrospective replay.
    while (nextEarlier < rows.length && rows[nextEarlier].time + DAY <= row.time) {
      const prior = rows[nextEarlier++];
      const defenseKey = `${prior.division}:${prior.opponentId}`;
      const division = earlierDivisions.get(prior.division) ?? rateTotals();
      const defense = earlierDefenses.get(defenseKey) ?? rateTotals();
      addRate(division, prior.line);
      addRate(defense, prior.line);
      earlierDivisions.set(prior.division, division);
      earlierDefenses.set(defenseKey, defense);
    }
    const division = earlierDivisions.get(row.division);
    const defense = earlierDefenses.get(`${row.division}:${row.opponentId}`);
    const adjustment = defense && division
      ? (defense.value - division.value / division.attempts * defense.attempts) /
        (defense.attempts + weights.opponentPriorAttempts)
      : 0;
    addSample(row.totals, row.line, adjustment, Boolean(defense && division));
    const cohort = cohorts[row.division];
    cohort.attempts += row.line.attempts;
    cohort.value += row.line.value - row.line.attempts * adjustment;
    cohort.teams.add(row.teamId);
    cohort.players.add(row.key);
  }

  const comparisons = Object.fromEntries(DIVISIONS.map(division => {
    const cohort = cohorts[division];
    const comparable = cohort.attempts >= weights.minimumReferenceAttempts && cohort.teams.size >= weights.minimumReferenceTeams;
    return [division, { division, attempts: cohort.attempts, teams: cohort.teams.size, passers: cohort.players.size,
      yardEquivalentsPerAttempt: comparable ? cohort.value / cohort.attempts : null }];
  }));
  const ratings = new Map();
  for (const [key, totals] of players) {
    const { division, attempts, value, defenseAdjustment } = totals;
    const reference = comparisons[division];
    const referenceRate = reference.yardEquivalentsPerAttempt;
    const rating = attempts >= weights.minimumAttempts && referenceRate !== null
      ? weights.center + weights.pointsPerYard * (value - defenseAdjustment - attempts * referenceRate) /
        (attempts + weights.playerPriorAttempts)
      : null;
    const sampleStatus = rating === null ? 'not-rated' : attempts < weights.playerPriorAttempts ? 'small-sample' : 'rated';
    let explanation;
    if (attempts < weights.minimumAttempts) {
      explanation = `${attempts} verified pass attempts. At least ${weights.minimumAttempts} are needed for a rating.`;
    } else if (referenceRate === null) {
      explanation = `The covered ${division.toUpperCase()} comparison group is too small to publish a rating.`;
    } else {
      explanation = `Based on ${attempts} verified pass attempts in ${totals.games} ${totals.games === 1 ? 'game' : 'games'}. 100 is the covered ${division.toUpperCase()} reference. Earlier opponent evidence applies to ${totals.adjustedAttempts} attempts.`;
      if (sampleStatus === 'small-sample') explanation += ' This is a small sample, so the reference has more weight.';
      if (totals.incompletePassingGames) explanation += ` ${totals.incompletePassingGames} incomplete passing lines were excluded.`;
    }
    ratings.set(key, { rating, division, attempts, status: QB_RATING_METHOD.status, sampleStatus, explanation,
      formula: QB_RATING_METHOD.formula, methodId: QB_RATING_METHOD.id, reference,
      components: { ...totals, referenceRate, playerPriorAttempts: weights.playerPriorAttempts } });
  }
  return { methodology: QB_RATING_METHOD, comparisons, ratings };
}
