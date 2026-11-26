// Human polls are comparison metadata only; this module never enters the engine.
const dateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const nameKey = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const easternDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

// Source archives often encode midnight without a timezone. That is a date,
// never evidence of an exact release instant. Bound the entire Eastern day.
export function pollPublicationWindow(edition) {
  if (!dateOnly(edition?.released)) return null;
  if (edition.publication?.precision === 'instant') {
    if (!instant(edition.publishedAt) || !edition.publication.sourceUrl) return null;
    const at = Date.parse(edition.publishedAt);
    if (easternDate.format(at) !== edition.released) return null;
    return { earliest: at, latest: at, precision: 'instant' };
  }
  const utc = Date.parse(edition.released);
  // Find actual Eastern midnight, including the DST boundary days.
  let earliest = utc;
  while (easternDate.format(earliest) < edition.released) earliest += 36e5;
  let latest = earliest + 23 * 36e5;
  while (easternDate.format(latest) === edition.released) latest += 36e5;
  if (edition.publication?.precision === 'observed') {
    if (!instant(edition.observedAt) || !edition.publication.sourceUrl || Date.parse(edition.observedAt) < earliest) return null;
    return { earliest, latest: Date.parse(edition.observedAt), precision: 'observed' };
  }
  return { earliest, latest, precision: 'date' };
}

export function normalizePollEditions(editions, membership) {
  if (!Array.isArray(editions)) return [];
  const byId = new Map(membership.filter(team => team.division === 'fbs').map(team => [team.id, team]));
  const byName = new Map([...byId.values()].map(team => [nameKey(team.name), team.id]));
  const seen = new Set();
  return editions.flatMap(edition => {
    const window = pollPublicationWindow(edition);
    if (!window || !Array.isArray(edition.rows) || edition.rows.length < 25 ||
        edition.gamesThrough && (!dateOnly(edition.gamesThrough) || edition.gamesThrough > edition.released)) return [];
    const ranks = new Map();
    for (const [index, row] of edition.rows.entries()) {
      // Explicit IDs are authoritative. Never silently repair an unknown ID by name.
      const id = row.id != null ? String(row.id) : byName.get(nameKey(row.team));
      const rank = row.rank ?? index + 1;
      if (!byId.has(id) || ranks.has(id) || !Number.isInteger(rank) || rank < 1 || rank > 25) return [];
      ranks.set(id, rank);
    }
    // AP can have ties. Require competition ranks: 1,2,2,4 rather than 1,2,2,3.
    const values = [...ranks.values()].sort((a, b) => a - b);
    if (values.some((rank, index) => rank !== index + 1 && rank !== values[index - 1])) return [];
    const key = edition.released;
    if (seen.has(key)) throw Error(`Duplicate poll edition ${key}`);
    seen.add(key);
    return [{ ...edition, ranks, window, publishedDay: edition.released, asOf: edition.publishedAt ?? edition.observedAt ?? edition.released }];
  }).sort((a, b) => a.window.latest - b.window.latest);
}

export function selectPregamePoll(game, editions, releases = []) {
  let kickoff = Date.parse(game.startDate);
  if (!Number.isFinite(kickoff)) return { status: 'missing', edition: null };
  // A placeholder kickoff does not prove that a same-day release preceded play.
  if (game.startTimeTbd === true) kickoff = Date.parse(new Date(kickoff).toISOString().slice(0, 10));
  // A season-ending AP edition describes the closed season; it is never a
  // substitute pregame poll for a stray postponed or mislabelled future game.
  const final = editions.findLast(edition => edition.kind === 'final' && edition.window.earliest < kickoff);
  if (final) return { status: kickoff <= final.window.latest ? 'publication-time-uncertain' : 'missing', edition: null };
  editions = editions.filter(edition => edition.kind !== 'final');
  const windows = releases.filter(release => release.kind !== 'final').map(release => ({ ...release, window: pollPublicationWindow(release) }))
    .filter(release => release.window).sort((a, b) => a.window.earliest - b.window.earliest);
  // An incomplete archive's first stored edition does not prove there were no
  // earlier releases. Only the independently verified release ledger does.
  const first = windows[0];
  if (first && first.window.precision !== 'observed' && kickoff <= first.window.earliest) return { status: 'no-poll-yet', edition: null };
  const expected = windows.findLast(release => release.window.earliest < kickoff);
  const edition = editions.findLast(item => item.window.latest < kickoff);
  if (expected && (!edition || expected.released > edition.released)) {
    return { status: kickoff <= expected.window.latest ? 'publication-time-uncertain' : 'missing', edition: null };
  }
  if (!edition) return { status: first && kickoff <= first.window.latest ? 'publication-time-uncertain' : 'missing', edition: null };
  return { status: 'available', edition };
}

function matchingComparisonCutoff(edition, comparisons, membership) {
  if (!edition || !Array.isArray(comparisons)) return null;
  const matches = comparisons.filter(row => row?.released === edition.released);
  if (matches.length !== 1) return null;
  const [match] = normalizePollEditions(matches, membership);
  if (!match?.gamesThrough || match.ranks.size !== edition.ranks.size) return null;
  for (const [team, rank] of edition.ranks) if (match.ranks.get(team) !== rank) return null;
  return match.gamesThrough;
}

export function attachPollHistory(dataset, history, comparison) {
  if (history?.schemaVersion !== 1 || history.season !== dataset.season) return dataset;
  const membership = Object.values(dataset.teams);
  const editions = Object.fromEntries(['ap', 'cfp'].map(key => [key, normalizePollEditions(history.editions?.[key], membership)]));
  for (const key of ['ap', 'cfp']) if (Array.isArray(history.editions?.[key]) && editions[key].length !== history.editions[key].length) {
    throw Error(`Invalid verified ${key.toUpperCase()} history for ${dataset.season}`);
  }
  const active = key => editions[key].length || history.releases?.[key]?.length;
  const teams = Object.fromEntries(membership.map(team => [team.id, { ...team, ranks: { ...team.ranks } }]));
  const rankings = { ...dataset.rankings };
  const games = dataset.games.map(game => {
    const next = { ...game, pregame: { ...game.pregame }, pregameAsOf: { ...game.pregameAsOf },
      pregameStatus: { ...game.pregameStatus }, pregameEdition: { ...game.pregameEdition } };
    for (const key of ['ap', 'cfp']) {
      if (!active(key)) continue;
      const selected = selectPregamePoll(game, editions[key], history.releases?.[key]);
      delete next.pregame[key]; delete next.pregameAsOf[key]; delete next.pregameEdition[key];
      next.pregameStatus[key] = [game.home, game.away].map(id => teams[id]?.division !== 'fbs' ? 'not-applicable' :
        selected.edition ? selected.edition.ranks.has(id) ? 'ranked' : 'unranked' : selected.status);
      if (selected.edition) {
        next.pregame[key] = [game.home, game.away].map(id => teams[id]?.division === 'fbs' ? selected.edition.ranks.get(id) ?? null : null);
        next.pregameAsOf[key] = selected.edition.asOf;
        next.pregameEdition[key] = { released: selected.edition.released, kind: selected.edition.kind ?? 'weekly',
          publicationPrecision: selected.edition.window.precision, availableBefore: new Date(selected.edition.window.latest).toISOString(),
          sourceUrl: selected.edition.publication?.sourceUrl ?? selected.edition.url ?? null };
      }
    }
    return next;
  });
  for (const key of ['ap', 'cfp']) {
    if (!active(key)) continue;
    const current = editions[key].at(-1);
    // The comparison can corroborate the current edition's game cutoff. Pregame
    // availability still uses only the archived edition and release ledger.
    const gamesThrough = current?.gamesThrough ?? (dataset.archived === false && comparison?.season === dataset.season
      ? matchingComparisonCutoff(current, comparison.polls?.[key], membership) : null);
    for (const team of Object.values(teams)) team.ranks[key] = current?.ranks.get(team.id) ?? null;
    const counts = { ranked: 0, unranked: 0, noPollYet: 0, missing: 0, publicationTimeUncertain: 0 };
    for (const game of games) {
      if ((game.pregameStatus[key] ?? []).some(status => status === 'ranked')) counts.ranked++;
      else if ((game.pregameStatus[key] ?? []).some(status => status === 'unranked')) counts.unranked++;
      else if ((game.pregameStatus[key] ?? []).some(status => status === 'no-poll-yet')) counts.noPollYet++;
      else if ((game.pregameStatus[key] ?? []).some(status => status === 'publication-time-uncertain')) counts.publicationTimeUncertain++;
      else counts.missing++;
    }
    rankings[key] = { available: Boolean(current), asOf: current?.asOf ?? null, fullField: false, basis: 'poll',
      historicalEditions: editions[key].length, gamesThrough,
      url: current?.publication?.sourceUrl ?? current?.url ?? null, kind: current?.kind ?? null, pregameCoverage: counts };
  }
  return { ...dataset, teams, games, rankings, pollHistory: { schemaVersion: history.schemaVersion, season: history.season,
    sourceHashes: history.sourceHashes ?? [] } };
}
