// Historical matchups and scores transcribed from the NCAA 2026 results.
// These are game facts only; the NCAA layout, branding and assets are omitted.
import {bracketTeams, buildBracket, REGIONAL_SEEDS} from './bracket.js';

const teamsByRegion = {
  East: ['Duke', 'Siena', 'Ohio State', 'TCU', "St. John's", 'Northern Iowa', 'Kansas', 'California Baptist',
    'Louisville', 'South Florida', 'Michigan State', 'North Dakota State', 'UCLA', 'UCF', 'UConn', 'Furman'],
  West: ['Arizona', 'Long Island', 'Villanova', 'Utah State', 'Wisconsin', 'High Point', 'Arkansas', 'Hawaiʻi',
    'BYU', ['Texas', 'NC State'], 'Gonzaga', 'Kennesaw State', 'Miami (FL)', 'Missouri', 'Purdue', 'Queens (NC)'],
  South: ['Florida', ['Prairie View A&M', 'Lehigh'], 'Clemson', 'Iowa', 'Vanderbilt', 'McNeese', 'Nebraska', 'Troy',
    'North Carolina', 'VCU', 'Illinois', 'Penn', "Saint Mary's", 'Texas A&M', 'Houston', 'Idaho'],
  Midwest: ['Michigan', ['UMBC', 'Howard'], 'Georgia', 'Saint Louis', 'Texas Tech', 'Akron', 'Alabama', 'Hofstra',
    'Tennessee', ['Miami (OH)', 'SMU'], 'Virginia', 'Wright State', 'Kentucky', 'Santa Clara', 'Iowa State', 'Tennessee State'],
};

// Verified against all 67 NCAA tournament games in the private CBBD cache.
const providerTeamIds = {
  East: [72,264,216,287,279,209,131,39,150,271,169,202,313,312,314,93],
  West: [11,146,338,329,355,109,12,108,18,[295,185],102,133,168,177,236,362],
  South: [87,[232,141],52,124,336,162,188,302,200,333,118,227,253,293,113,117],
  Midwest: [170,[317,114],98,252,298,3,5,110,292,[167,248],339,357,135,261,125,290],
};

const openingScores = {
  'west-opening-11': [68, 66], 'south-opening-16': [67, 55],
  'midwest-opening-16': [83, 86], 'midwest-opening-11': [89, 79],
};

const regionalScores = {
  east: [
    [[71,65],[64,66],[79,53],[68,60],[83,79],[92,67],[75,71],[82,71]],
    [[81,58],[67,65],[69,77],[57,73]], [[80,75],[63,67]], [[72,73]],
  ],
  west: [
    [[92,58],[76,86],[82,83],[97,78],[71,79],[73,64],[80,66],[104,71]],
    [[78,66],[88,94],[74,68],[69,79]], [[109,88],[77,79]], [[79,64]],
  ],
  south: [
    [[114,55],[61,67],[78,68],[76,47],[78,82],[105,70],[50,63],[78,47]],
    [[72,73],[72,74],[55,76],[57,88]], [[77,71],[65,55]], [[59,71]],
  ],
  midwest: [
    [[101,80],[77,102],[91,71],[90,70],[78,56],[82,73],[89,84],[108,74]],
    [[95,72],[65,90],[79,72],[63,82]], [[90,77],[76,62]], [[95,62]],
  ],
};

const finalScores = {'semifinal-1': [71,62], 'semifinal-2': [73,91], championship: [63,69]};

export function historicalBasketballField(year) {
  if (year !== 2026) return null;
  const regions = Object.entries(teamsByRegion).map(([name, entries]) => ({
    id: name.toLowerCase(), name,
    slots: entries.map((entry, i) => ({
      seed: REGIONAL_SEEDS[i],
      teams: [entry].flat().map((teamName, j) => ({
        id: 'ncaam-d1:' + [providerTeamIds[name][i]].flat()[j], name: teamName,
      })),
    })),
  }));
  const field = {
    year, id: 'ncaa-2026-archive', mode: 'official', regions,
    sourceUrl: 'https://www.ncaa.com/brackets/basketball-men/d1/2026',
    semifinalPairs: [['east', 'south'], ['west', 'midwest']],
  };
  const {games} = buildBracket(field);
  const scores = {...openingScores, ...finalScores};
  for (const [region, rounds] of Object.entries(regionalScores)) {
    rounds.forEach((matches, r) => matches.forEach((score, i) => {
      scores[region + '-r' + (r + 1) + '-' + (i + 1)] = score;
    }));
  }
  const results = Object.create(null);
  const winners = Object.create(null);
  for (const game of games) {
    const teams = bracketTeams(game, winners);
    const line = scores[game.id];
    results[game.id] = {teams, scores: line};
    winners[game.id] = teams[line[0] > line[1] ? 0 : 1];
  }
  return {...field, results};
}
