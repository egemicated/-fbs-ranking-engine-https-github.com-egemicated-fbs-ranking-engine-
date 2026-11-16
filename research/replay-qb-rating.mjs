import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { rankSeason } from '../src/engine.js';
import { buildQBRatings, QB_RATING_METHOD } from '../src/qb-rating.js';

const DAY = 86_400_000;
const fitSeasons = [2022, 2023];
const testSeasons = [2024, 2025];
const divisionGroups = ['fbs', 'fcs'];
const candidateWeights = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async url => JSON.parse(await readFile(url));

function normalizeBoxes(boxes, season, byId, gameById) {
  if (boxes.season !== season.year || !Array.isArray(boxes.rows)) throw new Error('Wrong-season QB archive');
  return boxes.rows.map(row => {
    const game = gameById.get(row.gameId);
    const team = byId.get(row.teamId);
    if (!game?.completed || !divisionGroups.includes(team?.division) ||
        ![game.home, game.away].includes(row.teamId) ||
        Date.parse(game.startDate) !== Date.parse(row.kickoff)) {
      throw new Error(`QB archive line does not match the official participants and kickoff: ${row.gameId}`);
    }
    const { attempts, completions, yards, touchdowns, interceptions } = row;
    return { gameId: row.gameId, teamId: row.teamId, playerId: row.athleteId, division: team.division,
      opponentId: game.home === row.teamId ? game.away : game.home, season: season.year,
      kickoff: game.startDate, passing: { attempts, completions, yards, touchdowns, interceptions } };
  });
}

function recentPassers(games, observed, ratings) {
  const recent = new Map();
  for (const game of [...games].sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate) || a.id.localeCompare(b.id))) {
    for (const teamId of [game.home, game.away]) {
      const ids = recent.get(teamId) ?? new Set();
      if (ids.size < 2) ids.add(game.id);
      recent.set(teamId, ids);
    }
  }
  const counts = new Map();
  for (const row of observed) {
    if (!recent.get(row.teamId)?.has(row.gameId) || !Number.isSafeInteger(row.passing.attempts) || row.passing.attempts <= 0) continue;
    const team = counts.get(row.teamId) ?? new Map();
    team.set(row.playerId, (team.get(row.playerId) ?? 0) + row.passing.attempts);
    counts.set(row.teamId, team);
  }
  // Pick the most-used known passer first. A missing rating for that passer
  // leaves the team uncovered. It cannot promote a lower-workload backup.
  return new Map([...counts].map(([teamId, players]) => {
    const [id] = [...players].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))[0];
    return [teamId, ratings.get(`${teamId}:${id}`)?.rating ?? null];
  }));
}

function replaySeason(season, previous, config, scales, boxes) {
  const byId = new Map(season.teams.map(team => [team.id, team]));
  const byGameId = new Map(season.games.map(game => [game.id, game]));
  const observations = normalizeBoxes(boxes, season, byId, byGameId);
  const kickoffTime = new Map(season.games.map(game => [game.id, Date.parse(game.startDate)]));
  const weekGroups = new Map();
  for (const game of season.games) {
    const key = `${game.seasonType}:${game.week}`;
    const slate = weekGroups.get(key) ?? [];
    slate.push(game);
    weekGroups.set(key, slate);
  }
  const output = [];
  for (const slate of weekGroups.values()) {
    const time = Math.min(...slate.map(game => kickoffTime.get(game.id)));
    const before = new Date(time).toISOString();
    const eligible = new Set(season.games.filter(game => game.completed && kickoffTime.get(game.id) + DAY <= time)
      .map(game => game.id));
    const observed = observations.filter(row => eligible.has(row.gameId));
    const model = buildQBRatings(observed, { season: season.year, asOf: before });
    const teamQB = recentPassers(season.games.filter(game => eligible.has(game.id)), observed, model.ratings);
    const strength = rankSeason(season, { previous, config, before });
    const byTeam = new Map(strength.ratings.map(team => [team.id, team.strength]));
    for (const game of slate) {
      const division = byId.get(game.home)?.division;
      if (!game.completed || game.homePoints === game.awayPoints || division !== byId.get(game.away)?.division ||
          !divisionGroups.includes(division)) continue;
      const homeRating = teamQB.get(game.home);
      const awayRating = teamQB.get(game.away);
      const qbDifference = Number.isFinite(homeRating) && Number.isFinite(awayRating) ? (homeRating - awayRating) / 10 : null;
      const margin = byTeam.get(game.home) - byTeam.get(game.away) + (game.neutral ? 0 : config.homeAdvantage);
      output.push({ year: season.year, division, actual: Number(game.homePoints > game.awayPoints),
        baselineLogit: margin / scales[division], qbDifference });
    }
  }
  return output;
}

function metrics(rows, weight = 0) {
  if (rows.length === 0) return null;
  let brier = 0, logLoss = 0, picked = 0, correct = 0;
  for (const row of rows) {
    const logit = row.baselineLogit + weight * row.qbDifference;
    const probability = 1 / (1 + Math.exp(-logit));
    brier += (probability - row.actual) ** 2;
    logLoss += Math.max(logit, 0) - logit * row.actual + Math.log1p(Math.exp(-Math.abs(logit)));
    if (logit !== 0) {
      picked++;
      correct += Number(Number(logit > 0) === row.actual);
    }
  }
  return { games: rows.length, brier: brier / rows.length, logLoss: logLoss / rows.length,
    picked, correct, accuracy: picked ? correct / picked : null };
}

function summarize(rows) {
  const covered = rows.filter(row => row.qbDifference !== null);
  const fit = covered.filter(row => fitSeasons.includes(row.year));
  const fitComparison = fit.length ? candidateWeights.map(weight => ({ weight, ...metrics(fit, weight) }))
    .sort((a, b) => a.brier - b.brier || a.weight - b.weight) : [];
  const selectedWeight = fitComparison[0]?.weight ?? null;
  const evaluate = (all, same) => ({ eligibleGames: all.length, pairedGames: same.length,
    baseline: metrics(same), withQBs: selectedWeight === null ? null : metrics(same, selectedWeight) });
  return { fit: fitComparison.length ? evaluate(rows.filter(row => fitSeasons.includes(row.year)), fit) : null, selectedWeight,
    holdout: evaluate(rows.filter(row => testSeasons.includes(row.year)), covered.filter(row => testSeasons.includes(row.year))),
    holdoutBySeason: Object.fromEntries(testSeasons.map(year => [year,
      evaluate(rows.filter(row => row.year === year), covered.filter(row => row.year === year))])) };
}

const args = process.argv.slice(2);
if (args.length !== 2 && args.length !== 3) {
  throw new Error('Usage: node research/replay-qb-rating.mjs <cached-season-folder> <cached-passing-box-folder> [result-json]');
}
const [gamesDir, boxesDir, target] = args;
const config = await json(new URL('../data/model.json', import.meta.url));
const fbsScale = (await json(new URL('../data/matchup-validation.json', import.meta.url))).winProbability.scale;
const fcsScale = (await json(new URL('../data/fcs-matchup-validation.json', import.meta.url))).scale;
const firstSeason = 2018;
const resultRows = [];
const sources = {};
let previous = null;
for (let year = firstSeason; year <= testSeasons.at(-1); year++) {
  const seasonBytes = await readFile(resolve(gamesDir, `${year}.json`));
  const season = JSON.parse(seasonBytes);
  if (season.year !== year) throw new Error('Wrong season archive');
  sources[year] = { gameArchiveSha256: hash(seasonBytes) };
  if (fitSeasons.includes(year) || testSeasons.includes(year)) {
    const boxBytes = await readFile(resolve(boxesDir, `passing-games-${year}.json.gz`));
    const boxes = JSON.parse(gunzipSync(boxBytes));
    resultRows.push(...replaySeason(season, previous, config, { fbs: fbsScale, fcs: fcsScale }, boxes));
    sources[year].passingArchiveSha256 = hash(boxBytes);
    sources[year].passingArchiveSource = boxes.source?.url ?? null;
    sources[year].verifiedPassingRows = boxes.rows.length;
  }
  previous = rankSeason(season, { previous, config });
}

const report = { method: QB_RATING_METHOD.id, firstPriorSeason: firstSeason, fitSeasons, testSeasons,
  cutoff: 'One prediction snapshot for each regular or postseason week. Only games with kickoff at least 24 hours before its first kickoff contribute.',
  selection: 'Highest recorded combined attempts across the prior two team games. A paired test needs a rated passer on both sides. Starter and report-of-availability confirmation are unavailable.',
  baseline: 'Existing team Strength margins and pre-2022 logistic slopes for same-subdivision games, rebuilt from matched outcome archives.',
  challenger: 'Baseline log odds plus a nonnegative coefficient times the difference in experimental QB ratings divided by 10. Choose the coefficient by paired fit Brier score, including zero.',
  candidateWeights, sources,
  resultsByDivision: Object.fromEntries(divisionGroups.map(division => [division, summarize(resultRows.filter(row => row.division === division))])),
  limitation: 'Archived ESPN observations do not guarantee identical coverage to CFBD, or coverage of both teams and games. This evaluates a pregame research signal only.',
};
const output = `${JSON.stringify(report, null, 2)}\n`;
if (target) await writeFile(resolve(target), output);
console.log(output);
