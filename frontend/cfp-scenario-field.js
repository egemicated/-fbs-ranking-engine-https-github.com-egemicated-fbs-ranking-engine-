export const SCENARIO_CFP_SEASON = 2026;
export const SCENARIO_CFP_SELECTION_AT = '2026-12-06T17:00:00Z';
export const CFP_RULES_URL = 'https://collegefootballplayoff.com/sports/2026/8/9/bracket-place-holder';
export const SCENARIO_CHAMPION_CONFERENCES = Object.freeze(['ACC', 'Big Ten', 'Big 12', 'SEC']);

const eligibleConferences = new Set(['American Athletic', 'Conference USA', 'Mid-American', 'Mountain West', 'Pac-12', 'Sun Belt']);
const allConferences = new Set([...SCENARIO_CHAMPION_CONFERENCES, ...eligibleConferences, 'FBS Independents']);
const seedPaths = [[5, 12, 4], [6, 11, 3], [7, 10, 2], [8, 9, 1]];

function rankedTeams(rows) {
  if (!Array.isArray(rows)) throw new Error('2026 CFP scenarios need ranked FBS teams.');
  const ids = new Set();
  const ranked = [];
  let previousRank = 0;
  for (const row of rows) {
    if (typeof row?.id !== 'string' || !row.id.trim() || ids.has(row.id) ||
        typeof row.name !== 'string' || !row.name.trim() || !allConferences.has(row.conference) ||
        ![row.wins, row.losses].every(value => Number.isInteger(value) && value >= 0)) {
      throw new Error('2026 CFP scenarios need unique teams with valid conferences and records.');
    }
    ids.add(row.id);
    if (row.sorRank === null || row.wins + row.losses === 0) continue;
    if (!Number.isInteger(row.sorRank) || row.sorRank < 1 || !Number.isFinite(row.sor) || row.sorRank < previousRank) {
      throw new Error('2026 CFP scenario teams must be in SOR order.');
    }
    previousRank = row.sorRank;
    ranked.push(row);
  }
  if (ranked.length < 12) throw new Error('2026 CFP scenarios need at least 12 ranked FBS teams.');
  return ranked;
}

export function selectScenarioField(rows, champions = {}) {
  if (!champions || ![Object.prototype, null].includes(Object.getPrototypeOf(champions)) ||
      Object.keys(champions).some(conference => !SCENARIO_CHAMPION_CONFERENCES.includes(conference))) {
    throw new Error('Choose conference champions for the ACC, Big Ten, Big 12, or SEC.');
  }
  const ranked = rankedTeams(rows);
  const bids = new Map();
  const selectedChampions = SCENARIO_CHAMPION_CONFERENCES.map(conference => {
    const choice = champions[conference];
    const assumed = choice === undefined || choice === '';
    const team = ranked.find(row => row.conference === conference && (assumed || row.id === choice));
    if (!team) throw new Error(assumed ? `No ranked ${conference} team is available.` : `Choose a ranked ${conference} team as champion.`);
    bids.set(team.id, 'conference champion');
    return { conference, teamId: team.id, assumed };
  });

  const otherQualifier = ranked.find(row => eligibleConferences.has(row.conference));
  if (!otherQualifier) throw new Error('No ranked team from an eligible conference is available for the fifth automatic bid.');
  bids.set(otherQualifier.id, 'highest-ranked eligible conference');

  // The input order breaks shared SOR ranks without changing the displayed ranks.
  const notreDame = ranked.slice(0, 12).find(row => row.name === 'Notre Dame' && row.conference === 'FBS Independents');
  if (notreDame) bids.set(notreDame.id, 'Notre Dame');
  for (const team of ranked) {
    if (bids.size === 12) break;
    if (!bids.has(team.id)) bids.set(team.id, 'at-large');
  }

  const field = ranked.filter(team => bids.has(team.id))
    .map((team, index) => ({ ...team, seed: index + 1, bid: bids.get(team.id) }));
  const matchups = seedPaths.map(([home, away, byeOpponent]) => ({
    home: field[home - 1], away: field[away - 1], byeOpponent: field[byeOpponent - 1],
  }));
  return { field, champions: selectedChampions, matchups };
}
