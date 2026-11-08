import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { rankSeason } from '../src/engine.js';
import { readPublicationPolicy } from '../src/publication.js';
import { calculateDivisionSor } from './lib/division_candidate.mjs';

const root = new URL('../', import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, root)));
const [baseline, quarterback, units, passerChallenger, datedQuarterback, coaching, policy] = await Promise.all([
  read('research/cache/preseason-team-baseline/result.json'),
  read('research/cache/preseason-player/quarterback-replay.json'),
  read('research/results/preseason-units/results.json'),
  read('research/cache/preseason-player/team-passing-challenger.json'),
  read('research/cache/preseason-player/roster-qb-challenger.json'),
  read('research/results/preseason-coaching/results.json'),
  readPublicationPolicy(),
]);
const sample = baseline.previews[2025];
// The 2025 archive notes identify these conference title games. The teams
// were undetermined at the preseason cutoff, despite the regular-season tag.
const conferenceTitleGames = new Set([
  '401777324', '401777325', '401777326', '401777327', '401777328',
  '401777329', '401777351', '401777352', '401777353',
]);
const preseasonCohort = sample.games.filter(game => !conferenceTitleGames.has(game.gameId));
const winsByTeam = new Map(sample.teams.map(team => [team.id, { expectedWins: 0, actualWins: 0 }]));
for (const game of preseasonCohort) {
  const home = winsByTeam.get(game.home);
  const away = winsByTeam.get(game.away);
  home.expectedWins += game.homeProbability;
  away.expectedWins += 1 - game.homeProbability;
  home.actualWins += Number(game.homePoints > game.awayPoints);
  away.actualWins += Number(game.awayPoints > game.homePoints);
}

async function historicalRows(year) {
  const season = await read(`data/seasons/${year}.json`);
  const games = season.games.filter(game => game.completed).map(game => ({
    id: game.id, a: game.home, b: game.away, outcome: Math.sign(game.homePoints - game.awayPoints),
    venue: game.neutral ? 0 : 1,
  }));
  const outcome = calculateDivisionSor({ year, teams: season.teams, games }, policy.parameters);
  const scores = new Map(outcome.rows.map(row => [row.id, row.sor]));
  const snapshot = rankSeason(season, { config: baseline.config });
  const bySchedule = [...snapshot.rankings].sort((a, b) =>
    (b.achievementScheduleStrength ?? -1) - (a.achievementScheduleStrength ?? -1));
  return new Map(bySchedule.map((team, index) => [team.id, {
    year, wins: team.wins, losses: team.losses, sor: scores.get(team.id),
    sos: team.games ? index + 1 : null,
  }]));
}

const history = await Promise.all(sample.windowYears.map(historicalRows));
const examples = [
  {
    teamId: '228', athleteId: '4685413', player: 'Cade Klubnik', cohort: 'Returning quarterback', knownOn: 'Feb 13, 2025',
    fact: 'Clemson’s spring guide identified Klubnik as the returning starter. His prior college passing record was at Clemson.',
    source: 'https://clemsontigers.com/news/2025/02/13/2025-spring-guide-meet-the-2025-tigers',
  },
  {
    teamId: '2390', athleteId: '4430841', player: 'Carson Beck', cohort: 'Experienced transfer', knownOn: 'Jan 14, 2025',
    fact: 'Miami confirmed Beck joined the team from Georgia. His prior college production follows his player ID to the new school.',
    source: 'https://miamihurricanes.com/news/2025/01/14/fb-feature-corey-hetherman-carson-beck-help-canes-shift-focus-to-2025-season',
  },
  {
    teamId: '130', athleteId: '5141741', player: 'Bryce Underwood', cohort: 'First-year quarterback', knownOn: 'Dec 6, 2024',
    fact: 'Michigan announced Underwood as an incoming quarterback. The signing established his affiliation before the cutoff.',
    source: 'https://mgoblue.com/news/2024/12/6/michigan-signs-22-student-athletes-to-2025-football-recruiting-class',
  },
];
const names = { fourYears: 'Four seasons', allEarlier: 'All earlier seasons', oneYear: 'One season' };
const holdout = baseline.evaluation.originalStrengthHoldout;
const modelRows = Object.entries(holdout).map(([id, result]) => ({
  id, label: names[id], accuracy: result.accuracy, brier: result.brier, logLoss: result.logLoss,
  winError: result.expectedWinsMAE,
}));
const mediaDay = datedQuarterback.results.mediaDay;
const coachTest = coaching.test.pooled;
const datedTests = {
  quarterback: {
    fitGames: mediaDay.trainingGames,
    coveredGames: mediaDay.evaluation.supportedGames,
    totalGames: mediaDay.evaluation.games,
    baseline: mediaDay.evaluation.conditional.baseline,
    challenger: mediaDay.evaluation.conditional.challenger,
    baselineWithFallback: mediaDay.evaluation.fullScheduleWithFallback.baseline,
    challengerWithFallback: mediaDay.evaluation.fullScheduleWithFallback.challenger,
    coverage: mediaDay.coverage,
    starterGames: datedQuarterback.results.starter.evaluation.supportedGames,
    roomGames: datedQuarterback.results.room.evaluation.supportedGames,
  },
  coaching: {
    fitGames: coaching.fit.trainingGames,
    games: coachTest.games,
    contrastGames: coaching.test.withContrast.games,
    baseline: coachTest.strength,
    challenger: coachTest.continuity,
    schools: coaching.test.contrastByChangedSchool,
    limitation: coaching.limitation,
  },
};
const result = {
  season: sample.season,
  window: `${sample.windowYears[0]}–${sample.windowYears.at(-1)}`,
  modelId: 'fourYears',
  scheduleLabel: `${preseasonCohort.length} archived FBS–FBS regular-season games, excluding conference title games`,
  teams: sample.teams.map(({ id, team, conference, rank, strength }) => ({
    id, name: team, conference, rank, strength, ...winsByTeam.get(id),
    history: history.flatMap(rows => rows.has(id) ? [rows.get(id)] : []),
  })),
  games: preseasonCohort.map(({ gameId, home, away, week, neutral, homeProbability, edge, homePoints, awayPoints }) => ({
    gameId, home, away, week, neutral, homeProbability, edge, homePoints, awayPoints,
  })),
  validation: {
    models: modelRows,
    datedTests,
    scope: 'Each model scored the same 2,264 archived FBS–FBS games from 2023–2025, including some conference title games. Team strength was frozen before any games in the target season.',
    calibration: 'The preseason odds mapping was fitted on 2014–2019 games. The team model uses our own scores, opponent network, and venue adjustment.',
    units: {
      games: units.pooled.strength.games,
      covered: units.pooled.coveredGames,
      baselineBrier: units.pooled.strength.brier,
      challengerBrier: units.pooled.unitsWithFallback.brier,
    },
    passer: {
      games: passerChallenger.evaluation.strength.games,
      baselineBrier: passerChallenger.evaluation.strength.brier,
      challengerBrier: passerChallenger.evaluation.strengthWithPriorPassing.brier,
    },
  },
  quarterbacks: {
    description: 'These are separate player estimates from prior recorded passing yards and attempts. Three dated school records illustrate returning, transfer, and first-year evidence. National preseason roster coverage is still unverified.',
    validation: {
      ...quarterback.evaluation,
      scope: 'The 2024–2025 replay scored player-seasons with at least 100 observed FBS attempts. It tests passing efficiency conditional on playing.',
    },
    examples: examples.map(({ athleteId, ...row }) => {
      const prior = quarterback.examplePool2025.find(player => player.id === athleteId);
      assert.ok(!prior || prior.name === row.player, `Unexpected player identity for ${row.player}`);
      return { ...row, rating: prior?.rating ?? null, attempts: prior?.attempts ?? 0 };
    }),
  },
  limits: 'This is a retrospective replay on recorded fixtures. Final archive schedules can include later changes, and the archive misses some results. Win totals cover the scored FBS–FBS cohort. A dated prospective forecast starts with the next preseason.',
  featureStatus: 'The preview uses the four-season team baseline. The dated quarterback and coach tests below cover selected cohorts. Verified complete QB rooms are still needed for a full roster test.',
};
assert.equal(result.games.length, 753);
assert.equal(result.teams.length, 136);
const output = new URL('preseason-preview/data/', root);
await mkdir(output, { recursive: true });
await writeFile(new URL('replay.json', output), JSON.stringify(result) + '\n');
console.log(`Preview ready: ${result.teams.length} teams, ${result.games.length} scored games, ${result.quarterbacks.examples.length} dated QB cases.`);
