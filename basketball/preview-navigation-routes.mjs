export const basketballPollRoutes = Object.freeze({ ap: '/basketball/polls/', coaches: '/basketball/polls/coaches/' });

export const destination = {
  football: {
    home: '/football/', rankings: '/rankings', polls: '/polls/ap/', scoreboard: '/scoreboard', teams: '/teams/fbs/',
    matchup: '/matchup-lab', conferences: '/conference-strength/', picks: '/weekly-picks',
    contest: '/beat-the-model/', reports: '/model-reports/fbs/', history: '/ranking-history/',
    methodology: '/methodology/', postseason: '/playoff-bracket/',
  },
  basketball: {
    home: '/basketball/', rankings: '/basketball/rankings/', polls: basketballPollRoutes.ap, scoreboard: '/basketball/scoreboard/', teams: '/basketball/teams/',
    matchup: '/basketball/matchup-lab/', conferences: '/basketball/conferences/', picks: '/basketball/picks/',
    contest: '/basketball/contest/', reports: '/basketball/model-reports/', history: '/basketball/ranking-history/',
    methodology: '/basketball/methodology/', postseason: '/basketball/march-madness/',
  },
};

export const groups = {
  football: {
    rankings: [
      ['Earned results', [['FBS Strength of Record', '/rankings'], ['FCS Strength of Record', '/rankings/fcs/'],
        ['Compare Strength of Record', '/sor-compare/']]],
      ['Other views', [['Predictive Strength', '/rankings?model=strength'], ['Experimental Performance', '/rankings?model=performance'],
        ['Compare Rankings', '/polls/ap/'], ['Forge’s Rankings', '/forge-rankings/']]],
    ],
    conferences: [
      ['Conference evidence', [['Conference Strength', '/conference-strength/'], ['Quality Rankings', '/conference-strength/?view=quality'],
        ['Compare Conferences', '/conference-strength/?view=compare']]],
      ['Team research', [['FBS Teams', '/teams/fbs/'], ['FCS Teams', '/teams/fcs/'], ['My Teams', '/my-teams']]],
    ],
    predictions: [
      ['Saved forecasts', [['FBS Weekly Picks', '/weekly-picks'], ['FCS Weekly Picks', '/weekly-picks/fcs/'],
        ['Beat the Model', '/beat-the-model/']]],
      ['Explore a game', [['Scoreboard', '/scoreboard'], ['Matchup Lab', '/matchup-lab']]],
    ],
    research: [
      ['Results and evidence', [['FBS Model Report Card', '/model-reports/fbs/'], ['FCS Model Report Card', '/model-reports/fcs/'],
        ['Weekly Movement', '/ranking-history/']]],
      ['Models', [['Compare Strength of Record', '/sor-compare/'], ['Methodology', '/methodology/']]],
    ],
    postseason: [
      ['College Football Playoff', [['CFP Scenario Builder', '/cfp-scenarios/'], ['Playoff Bracket', '/playoff-bracket/']]],
    ],
  },
  basketball: {
    rankings: [
      ['Ranking models', [['Strength of Record', '/basketball/rankings/'], ['Predictive Strength', '/basketball/rankings/?model=predictive'],
        ['Experimental Performance', '/basketball/rankings/?model=performance']]],
      ['Other views', [['Compare Rankings', basketballPollRoutes.ap], ['Ranking History', '/basketball/ranking-history/']]],
    ],
    conferences: [
      ['Conference evidence', [['Conference Strength', '/basketball/conferences/']]],
      ['Team research', [['Team Directory', '/basketball/teams/']]],
    ],
    predictions: [
      ['Saved forecasts', [['Daily Picks', '/basketball/picks/'], ['Beat the Model', '/basketball/contest/']]],
      ['Explore a game', [['Scoreboard', '/basketball/scoreboard/'], ['Matchup Lab', '/basketball/matchup-lab/']]],
    ],
    research: [
      ['Results and evidence', [['Model Report Card', '/basketball/model-reports/'], ['Ranking History', '/basketball/ranking-history/']]],
      ['Models', [['Methodology', '/basketball/methodology/']]],
    ],
    postseason: [
      ['March Madness', [['March Madness Bracket', '/basketball/march-madness/']]],
    ],
  },
};

const footballAliases = {
  team: 'teams', 'my-teams': 'teams', 'forge-rankings': 'rankings',
  'sor-compare': 'research', 'weekly-picks': 'picks', 'beat-the-model': 'contest', 'conference-strength': 'conferences',
  'cfp-scenarios': 'postseason', 'playoff-bracket': 'postseason', 'model-reports': 'reports', 'ranking-history': 'history',
  'matchup-lab': 'matchup',
};
const basketballAliases = {
  'model-reports': 'reports', 'ranking-history': 'history', 'march-madness': 'postseason', 'matchup-lab': 'matchup',
};
export function sectionAt(sport, pathname) {
  const [first, second] = pathname.split('/').filter(Boolean);
  if (sport === 'basketball') return basketballAliases[second] ?? (first === 'basketball' ? second ?? 'home' : '');
  return footballAliases[first] ?? (first === 'football' || !first ? 'home' : first);
}

const sectionGroup = {polls: 'rankings', picks: 'predictions', contest: 'predictions', reports: 'research', history: 'research', methodology: 'research'};
export function primarySection(sport, pathname) {
  const current = sectionAt(sport, pathname);
  return sectionGroup[current] ?? current;
}

export function sportHref(targetSport, currentSport, pathname, publicSite = false) {
  const section = sectionAt(currentSport, pathname);
  return destination[targetSport][publicSite && targetSport === 'basketball' && section === 'contest' ? 'picks' : section]
    ?? destination[targetSport].home;
}
