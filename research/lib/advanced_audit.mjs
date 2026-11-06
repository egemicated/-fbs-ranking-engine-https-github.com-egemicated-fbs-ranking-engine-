/** Pure, derived-only audit of one all-play CFBD advanced-game response. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const positiveInt = value => Number.isInteger(value) && value > 0;
const id = value => (typeof value === 'string' && /^\d+$/.test(value)) ||
  (Number.isSafeInteger(value) && value >= 0) ? String(value) : null;
const CORE = ['plays', 'drives', 'ppa', 'totalPPA', 'successRate', 'explosiveness',
  'powerSuccess', 'stuffRate', 'lineYards', 'lineYardsTotal', 'secondLevelYards',
  'secondLevelYardsTotal', 'openFieldYards', 'openFieldYardsTotal'];
const SPLITS = ['standardDowns', 'passingDowns', 'rushingPlays', 'passingPlays'];
const PATHS = ['offense', 'defense'].flatMap(side => [
  ...CORE.map(field => `${side}.${field}`),
  ...SPLITS.flatMap(split => ['ppa', 'successRate', 'explosiveness',
    ...(['rushingPlays', 'passingPlays'].includes(split) ? ['totalPPA'] : [])]
    .map(field => `${side}.${split}.${field}`))]);
const get = (value, path) => path.split('.').reduce((v, key) => object(v) ? v[key] : undefined, value);
const add = (map, key) => { map[key] = (map[key] || 0) + 1; };
const groupOf = (a, b) => [a.division, b.division].sort().join('-');
const close = (a, b) => Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
const sortIds = values => values.sort((a, b) => String(a).localeCompare(String(b)));

function graph(snapshot) {
  if (!object(snapshot) || !Number.isInteger(snapshot.season) || !Array.isArray(snapshot.ratings))
    throw new Error('A full saved season snapshot with ratings is required');
  const teams = new Map(), games = new Map();
  for (const team of snapshot.ratings) {
    if (!object(team) || !id(team.id) || typeof team.name !== 'string' || !team.name ||
        typeof team.division !== 'string' || teams.has(String(team.id)) || !Array.isArray(team.contributions))
      throw new Error('Invalid or duplicated snapshot team');
    teams.set(String(team.id), team);
  }
  for (const team of teams.values()) for (const contribution of team.contributions) {
    if (!object(contribution) || !id(contribution.gameId) || !id(contribution.opponentId) ||
        !teams.has(String(contribution.opponentId)) || String(contribution.opponentId) === String(team.id))
      throw new Error('Invalid snapshot game identity');
    const gameId = String(contribution.gameId);
    const entries = games.get(gameId) || [];
    entries.push({teamId: String(team.id), opponentId: String(contribution.opponentId)});
    games.set(gameId, entries);
  }
  for (const [gameId, entries] of games) {
    if (entries.length !== 2 || entries[0].teamId !== entries[1].opponentId ||
        entries[1].teamId !== entries[0].opponentId)
      throw new Error(`Snapshot game ${gameId} is not one reciprocal pair`);
    const participants = entries.map(e => teams.get(e.teamId)).sort((a, b) => a.id.localeCompare(b.id));
    games.set(gameId, {id: gameId, participants, group: groupOf(...participants)});
  }
  return {teams, games};
}

function schemaOf(rows) {
  const schema = {};
  function visit(value, path) {
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    schema[path] ||= {}; add(schema[path], type);
    if (object(value)) for (const key of Object.keys(value).sort()) visit(value[key], path ? `${path}.${key}` : key);
  }
  for (const row of rows) visit(row, 'row');
  return Object.fromEntries(Object.entries(schema).sort(([a], [b]) => a.localeCompare(b)));
}

function fieldCounts(rows) {
  return Object.fromEntries(PATHS.map(path => {
    const counts = {finite: 0, null: 0, missing: 0, invalid: 0};
    for (const row of rows) {
      const value = get(row, path);
      add(counts, value === undefined ? 'missing' : value === null ? 'null' : finite(value) ? 'finite' : 'invalid');
    }
    return [path, counts];
  }));
}

function mirror(a, b) {
  let compared = 0, mismatches = 0, missing = 0;
  const paths = PATHS.filter(p => p.startsWith('offense.')).map(p => p.slice('offense.'.length));
  for (const [offense, defense] of [[a.offense, b.defense], [b.offense, a.defense]]) {
    for (const path of paths) {
      const left = get(offense, path), right = get(defense, path);
      if (finite(left) && finite(right)) { compared++; if (!close(left, right)) mismatches++; }
      else if (left === null && right === null) continue;
      else missing++;
    }
  }
  return {compared, mismatches, missing};
}

function metricReady(pair, field, rule = finite) {
  return pair.every(row => ['offense', 'defense'].every(side => rule(get(row, `${side}.${field}`))));
}

/** Never returns raw observations. Coverage is against the saved completed graph. */
export function auditAdvanced(rows, snapshot) {
  if (!Array.isArray(rows)) throw new Error('Advanced response must be an array');
  const {teams, games} = graph(snapshot), byGame = new Map();
  const defects = {}, unknownGames = new Set(), defectiveGames = new Set();
  let wrongSeasonRows = 0, malformedRows = 0;
  for (const row of rows) {
    if (!object(row) || !id(row.gameId) || typeof row.team !== 'string' || !row.team ||
        typeof row.opponent !== 'string' || !row.opponent) {
      malformedRows++; add(defects, 'malformed-row-identity'); continue;
    }
    const gameId = String(row.gameId);
    if (row.season !== snapshot.season) {
      wrongSeasonRows++; defectiveGames.add(gameId); add(defects, 'wrong-season'); continue;
    }
    if (!games.has(gameId)) { unknownGames.add(gameId); continue; }
    const list = byGame.get(gameId) || [];
    list.push(row); byGame.set(gameId, list);
  }
  const groups = {}, teamCoverage = {}, missingGames = [], mirrorDefects = [], invalidMetricGames = [];
  const matchedRows = [], measuredRows = [];
  let comparisonCount = 0, mismatchCount = 0;
  for (const team of teams.values()) if (team.division === 'fbs') teamCoverage[team.id] = {
    id: team.id, team: team.name, expectedGames: 0, identityMatchedGames: 0,
    positivePlayPairedGames: 0, ppaReadyGames: 0, successRateReadyGames: 0,
    explosivenessReadyGames: 0};
  for (const game of [...games.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!game.participants.every(t => ['fbs', 'fcs'].includes(t.division)) &&
        !game.participants.some(t => t.division === 'fbs')) continue;
    const group = groups[game.group] ||= {expectedGames: 0, identityMatchedGames: 0,
      positivePlayPairedGames: 0, ppaReadyGames: 0, successRateReadyGames: 0,
      explosivenessReadyGames: 0, mirroredConsistentGames: 0, missingGames: 0};
    group.expectedGames++;
    const fbs = game.participants.filter(t => t.division === 'fbs').map(t => teamCoverage[t.id]);
    fbs.forEach(t => t.expectedGames++);
    const pair = byGame.get(game.id) || [];
    const reasons = [];
    if (defectiveGames.has(game.id)) reasons.push('wrong-season-row');
    if (pair.length !== 2) reasons.push(pair.length === 0 ? 'no-rows' : pair.length === 1 ? 'one-team-only' : 'duplicate-or-extra-rows');
    const matched = game.participants.map((team, i) => pair.filter(row =>
      row.team === team.name && row.opponent === game.participants[1-i].name));
    if (pair.length === 2 && matched.some(list => list.length !== 1)) reasons.push('exact-participant-names-disagree-or-ambiguous');
    if (game.participants[0].name === game.participants[1].name) reasons.push('ambiguous-snapshot-names');
    if (reasons.length) {
      group.missingGames++;
      reasons.forEach(reason => add(defects, reason));
      missingGames.push({id: game.id, teams: game.participants.map(t => t.name), group: game.group, reasons});
      continue;
    }
    group.identityMatchedGames++; fbs.forEach(t => t.identityMatchedGames++); matchedRows.push(...pair);
    const ready = metricReady(pair, 'plays', positiveInt);
    if (!ready) { add(defects, 'invalid-or-missing-play-count'); invalidMetricGames.push(game.id); continue; }
    group.positivePlayPairedGames++; fbs.forEach(t => t.positivePlayPairedGames++); measuredRows.push(...pair);
    for (const [field, key, rule] of [['ppa', 'ppaReadyGames', finite],
      ['successRate', 'successRateReadyGames', value => finite(value) && value >= 0 && value <= 1],
      ['explosiveness', 'explosivenessReadyGames', finite]]) if (metricReady(pair, field, rule)) {
      group[key]++; fbs.forEach(t => t[key]++);
    }
    const mirrored = mirror(...pair); comparisonCount += mirrored.compared; mismatchCount += mirrored.mismatches;
    if (mirrored.mismatches === 0) group.mirroredConsistentGames++;
    else { add(defects, 'offense-defense-mirror-disagreement'); mirrorDefects.push({id: game.id, comparedFields: mirrored.compared, mismatchedFields: mirrored.mismatches}); }
  }
  const sumFbs = key => Object.entries(groups).filter(([name]) => name.split('-').includes('fbs')).reduce((sum, [, group]) => sum + (group[key] || 0), 0);
  return {
    auditVersion: 'cfbd-advanced-coverage-v1', season: snapshot.season,
    reference: {asOf: snapshot.asOf || null, snapshotHash: snapshot.snapshotHash || null,
      policy: 'Exact completed-game ID plus reciprocal exact saved team names; no fuzzy or reputation-based matching'},
    requestPolicy: {excludeGarbageTime: false,
      scope: 'Provider PPA-eligible plays only (play.ppa IS NOT NULL), including its retained game states; not all box-score scrimmage plays and not regulation-only'},
    inputRows: rows.length, inputGameIds: new Set(rows.filter(object).map(r => id(r.gameId)).filter(Boolean)).size,
    malformedRows, wrongSeasonRows, outsideReferenceGameIds: sortIds([...unknownGames]),
    groups, fbsCoverage: Object.fromEntries(['expectedGames', 'identityMatchedGames', 'positivePlayPairedGames',
      'ppaReadyGames', 'successRateReadyGames', 'explosivenessReadyGames', 'mirroredConsistentGames', 'missingGames'].map(key => [key, sumFbs(key)])),
    teamCoverage: Object.values(teamCoverage).sort((a, b) => a.id.localeCompare(b.id)),
    fbsTeamsRepresented: Object.values(teamCoverage).filter(t => t.positivePlayPairedGames > 0).length,
    fbsTeamsComplete: Object.values(teamCoverage).filter(t => t.expectedGames > 0 && t.positivePlayPairedGames === t.expectedGames).length,
    defects, missingGames, invalidMetricGameIds: sortIds(invalidMetricGames),
    mirror: {relativeAbsoluteTolerance: 1e-7, comparedFields: comparisonCount, mismatchedFields: mismatchCount, games: mirrorDefects},
    fields: {scope: 'All identity-matched expected team-game rows, including rows with invalid plays', rows: matchedRows.length, counts: fieldCounts(matchedRows)},
    measuredFields: {scope: 'Positive-play paired expected team-game rows', rows: measuredRows.length, counts: fieldCounts(measuredRows)},
    observedSchema: schemaOf(rows),
    priorBoxGapGames: ['401866455', '401866457', '401866456', '401866408', '401858201', '401861966'].map(gameId => ({
      id: gameId, inReference: games.has(gameId), returnedRows: byGame.get(gameId)?.length || 0,
      exactPairedIdentity: games.has(gameId) && !missingGames.some(g => g.id === gameId) &&
        Boolean(byGame.get(gameId)?.length === 2),
      positivePlayPair: games.has(gameId) && !missingGames.some(g => g.id === gameId) &&
        Boolean(byGame.get(gameId)?.length === 2) && metricReady(byGame.get(gameId), 'plays', positiveInt)
    })),
    limitations: [
      'PPA and explosiveness are provider-model outputs; upstream model training/features/version are not certified by a successful response.',
      'Metric-ready counters mean finite values with positive PPA-eligible play counts, not full metric validation or known opportunity denominators. Provider Number(null) mapping can produce zero for an absent aggregate; numeric zero alone does not certify a measured opportunity.',
      'Coverage does not validate a ranking formula or establish complete special-teams, field-position, turnover, overtime or garbage-time measurement.',
      'Outside-reference games may be newer finals or other games; they are excluded from saved-snapshot coverage rather than treated as errors.',
      'Mirrored consistency alone does not certify metric validity. Missing fields stay unavailable; no values are zero-filled.'
    ]
  };
}
