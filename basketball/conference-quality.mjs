const venues = ['neutral', 'home', 'away', 'unconfirmed'];
const smallSample = 10;
const method = 'For each verified D-I interconference game with a known venue, compare its result to the chance an average D-I team would win against the same opponent at that venue. The opponent’s Colley rating excludes that game. Conference win surplus is observed wins minus those expected wins across the rated games.';

const newRecord = () => ({ games: 0, wins: 0, sample: 0, winsInSample: 0, expected: 0 });

function addResult(record, won, chance) {
  record.games++;
  record.wins += won;
  if (Number.isFinite(chance) && chance >= 0 && chance <= 1) {
    record.sample++;
    record.winsInSample += won;
    record.expected += chance;
  }
}

function summarize(record) {
  const { games, wins, sample, winsInSample, expected } = record;
  const surplus = winsInSample - expected;
  return {
    games,
    wins,
    losses: games - wins,
    winRate: games ? wins / games : null,
    sample,
    winsInSample,
    expectedWins: sample ? expected : null,
    winSurplus: sample ? surplus : null,
    surplusPerGame: sample ? surplus / sample : null,
    limitedSample: sample > 0 && sample < smallSample,
  };
}

function distribution(scores) {
  const sorted = scores.slice().sort((a, b) => a - b);
  const quantile = share => {
    if (!sorted.length) return null;
    const rank = (sorted.length - 1) * share;
    const floor = Math.floor(rank);
    return sorted[floor] + (rank - floor) * (sorted[Math.ceil(rank)] - sorted[floor]);
  };
  return {
    mean: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null,
    median: quantile(0.5),
    q1: quantile(0.25),
    q3: quantile(0.75),
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
  };
}

function conferenceEntry(team) {
  return {
    conference: team.conference,
    teams: 0,
    scores: [],
    record: newRecord(),
    venues: Object.fromEntries(venues.map(venue => [venue, newRecord()])),
    opponents: new Map(),
  };
}

function addConferenceGame(row, opponent, venue, won, chance) {
  addResult(row.record, won, chance);
  addResult(row.venues[venue], won, chance);
  if (!row.opponents.has(opponent)) row.opponents.set(opponent, newRecord());
  addResult(row.opponents.get(opponent), won, chance);
}

export function basketballConferenceQuality({ snapshot, dataset }) {
  if (snapshot?.competition !== 'ncaam-d1' || dataset?.competition !== snapshot.competition ||
      snapshot.season !== dataset.season || !Number.isFinite(Date.parse(snapshot.asOf)) ||
      (snapshot.source?.sha256 && snapshot.source.sha256 !== dataset.source?.sha256)) {
    throw new Error('Conference quality requires a matching basketball season and model snapshot.');
  }

  const conferences = new Map(), teams = new Map();
  for (const team of snapshot.teams) {
    if (!team.conference) continue;
    if (!conferences.has(team.conference)) conferences.set(team.conference, conferenceEntry(team));
    const conference = conferences.get(team.conference);
    conference.teams++;
    if (Number.isFinite(team.predictiveScore)) conference.scores.push(team.predictiveScore);
    teams.set(team.id, { conference, evidence: new Map((team.schedule ?? []).map(game => [game.gameId, game])) });
  }

  let gameCount = 0;
  for (const game of dataset.games) {
    const home = teams.get(game.home), away = teams.get(game.away);
    if (!game.completed || game.divisionOne === false || game.seasonType === 'preseason' ||
        game.conferenceGame === true || !home || !away || home.conference === away.conference) continue;
    const homeGame = home.evidence.get(game.id), awayGame = away.evidence.get(game.id);
    // The matchup must appear in both model schedules to establish that the
    // final and both memberships were known at this cutoff.
    if (homeGame?.opponentId !== game.away || awayGame?.opponentId !== game.home ||
        !['W', 'L'].includes(homeGame.result) || !['W', 'L'].includes(awayGame.result) || homeGame.result === awayGame.result) continue;

    const homeWon = Number(homeGame.result === 'W');
    const [homeSite, awaySite] = game.neutral === true ? ['neutral', 'neutral']
      : game.neutral === false ? ['home', 'away'] : ['unconfirmed', 'unconfirmed'];
    const rate = homeSite !== 'unconfirmed';
    addConferenceGame(home.conference, away.conference.conference, homeSite, homeWon, rate ? homeGame.referenceWinProbability : null);
    addConferenceGame(away.conference, home.conference.conference, awaySite, 1 - homeWon, rate ? awayGame.referenceWinProbability : null);
    gameCount++;
  }

  const rows = [...conferences.values()].sort((a, b) => a.conference.localeCompare(b.conference))
    .map(({ conference, teams: count, scores, record, venues: sites, opponents }) => ({
      conference,
      teams: count,
      rankedTeams: scores.length,
      predictive: distribution(scores),
      nonconference: {
        ...summarize(record),
        ...Object.fromEntries(venues.map(venue => [venue, summarize(sites[venue])])),
      },
      headToHead: [...opponents.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([opponent, stats]) => ({ conference: opponent, ...summarize(stats) })),
    }));
  const matrix = Object.fromEntries(rows.map(row => [
    row.conference, Object.fromEntries(row.headToHead.map(({ conference, ...results }) => [conference, results])),
  ]));
  return {
    season: snapshot.season,
    asOf: snapshot.asOf,
    snapshotHash: snapshot.snapshotHash,
    reference: 'average-di',
    method,
    sampleNote: 'Fewer than 10 rated games is a small sample. Games at unconfirmed venues count toward the record but not win surplus.',
    predictiveUnit: 'neutral-game model logit',
    rows,
    matrix,
    gameCount,
  };
}
