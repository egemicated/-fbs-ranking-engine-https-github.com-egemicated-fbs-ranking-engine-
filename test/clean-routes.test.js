import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyRouteFromHash, routeFromUrl, routeHref } from '../frontend/clean-routes.js';

test('all page routes have a clean landing path and continue to accept their hash bookmarks', () => {
  const pages = [
    ['home', '/'], ['rankings', '/rankings'], ['rankings/fcs/sor', '/rankings/fcs/'],
    ['teams/fbs', '/teams/fbs/'], ['teams/fcs', '/teams/fcs/'], ['team/252', '/team/252/'],
    ['conference-strength', '/conference-strength/'], ['compare', '/matchup-lab'],
    ['compare/weekly', '/weekly-picks'], ['compare/weekly/fcs', '/weekly-picks/fcs/'],
    ['scoreboard', '/scoreboard'], ['beat-the-model', '/beat-the-model/'],
    ['ranking-history', '/ranking-history/'], ['forge-top-25', '/forge-rankings/'],
    ['polls/ap', '/polls/ap/'], ['polls/coaches', '/polls/coaches/'], ['polls/cfp', '/polls/cfp/'],
    ['bracket', '/playoff-bracket/'], ['cfp-scenarios', '/cfp-scenarios/'], ['sor-compare', '/sor-compare/'],
    ['model-report/fbs', '/model-reports/fbs/'], ['model-report/fcs', '/model-reports/fcs/'],
    ['methodology', '/methodology/'], ['about', '/about/'], ['privacy', '/privacy/'],
    ['terms', '/terms/'], ['support', '/support'], ['account', '/account'], ['admin', '/admin'], ['my-teams', '/my-teams'],
  ];
  for (const [token, path] of pages) {
    assert.equal(routeHref(token), path, token);
    assert.equal(routeHref(`#${token}`), path, token);
    assert.equal(legacyRouteFromHash(`#${token}`), token, token);
    assert.equal(routeFromUrl(path), token, path);
    assert.equal(routeFromUrl(new URL(path, 'https://www.thegamesdecide.com')), token, path);
    if (path !== '/') assert.equal(routeFromUrl(path.endsWith('/') ? path.slice(0, -1) : path + '/'), token, path);
  }
});

test('links preserve comparison, division, edition, season, player, and event selections', () => {
  const selections = [
    ['rankings/all', '/rankings?all=1'], ['rankings/strength/all', '/rankings?model=strength&all=1'],
    ['rankings/fcs/performance/all', '/rankings/fcs/?model=performance&all=1'],
    ['rankings/fcs/predictive', '/rankings/fcs/?model=strength'],
    ['team/252/results/401810903', '/team/252/?view=results&game=401810903'],
    ['team/252/players/123456', '/team/252/?view=players&player=123456'], ['team/252/model', '/team/252/?view=model'],
    ['team/252/availability', '/team/252/?view=availability'],
    ['compare/matchup/252/2305/home', '/matchup-lab?a=252&b=2305&venue=home'],
    ['compare/matchup/252//neutral', '/matchup-lab?a=252'], ['compare/matchup//2305/away', '/matchup-lab?b=2305&venue=away'],
    ['compare/matchup///neutral', '/matchup-lab?venue=neutral'],
    ['compare/matchup/252/252/home', '/matchup-lab?a=252&b=252&venue=home'],
    ['compare/weekly/regular:0/401810903', '/weekly-picks?week=regular%3A0&game=401810903'],
    ['compare/weekly/fcs/postseason:1/402', '/weekly-picks/fcs/?week=postseason%3A1&game=402'],
    ['beat-the-model/regular%3A12/401810903', '/beat-the-model/?week=regular%3A12&game=401810903'],
    ['model-report/fcs/postseason%3A1', '/model-reports/fcs/?week=postseason%3A1'],
    ['model-report/fbs/regular%3A0', '/model-reports/fbs/?week=regular%3A0'],
    ['ranking-history/regular:12', '/ranking-history/?week=regular%3A12'],
    ['polls/ap/-1', '/polls/ap/?week=-1'], ['polls/coaches/12', '/polls/coaches/?week=12'],
    ['forge-top-25/-1', '/forge-rankings/?week=-1'],
    ['forge-top-25/11/2026-11-14', '/forge-rankings/?week=11&through=2026-11-14'],
    ['bracket/demo', '/playoff-bracket/?view=demo'], ['bracket/leaderboard', '/playoff-bracket/?view=leaderboard'],
    ['sor-compare/fcs/2509/2199', '/sor-compare/?division=fcs&a=2509&b=2199'],
    ['sor-compare/fbs//252', '/sor-compare/?division=fbs&b=252'],
    ['my-teams/252', '/my-teams?team=252'],
    ['conference-strength/quality/2025', '/conference-strength/?view=quality&season=2025'],
    ['conference-strength/compare/2025/Big%20Ten/FBS%20Independents', '/conference-strength/?view=compare&season=2025&a=Big+Ten&b=FBS+Independents'],
  ];
  for (const [token, url] of selections) {
    assert.equal(routeHref(`#${token}`), url, token);
    assert.equal(legacyRouteFromHash(`#${token}`), token, token);
    assert.equal(routeFromUrl(url), token, url);
  }
});

test('legacy names and established crawlable path aliases normalize to the same clean addresses', () => {
  const aliases = [
    ['#matchup-lab', '/matchup-lab/', '/matchup-lab'],
    ['#weekly-picks', '/weekly-picks/fbs/', '/weekly-picks'],
    ['#compare/weekly/12', '/weekly-picks?week=regular%3A12', '/weekly-picks?week=regular%3A12'],
    ['#weekly-picks/fcs/regular%3A12/401', '/weekly-picks/fcs/?week=regular%3A12&game=401', '/weekly-picks/fcs/?week=regular%3A12&game=401'],
    ['#rankings/fbs/achievement', '/rankings/fbs/', '/rankings'],
    ['#teams', '/teams', '/teams/fbs/'],
    ['#model-report', '/model-reports/', '/model-reports/fbs/'],
    ['#polls', '/polls/', '/polls/ap/'],
    ['#playoff-bracket/demo', '/playoff-bracket?view=demo', '/playoff-bracket/?view=demo'],
    ['#forge-rankings/0', '/forge-rankings?week=0', '/forge-rankings/?week=0'],
  ];
  for (const [hash, oldPath, cleanPath] of aliases) {
    assert.equal(routeHref(hash), cleanPath, hash);
    assert.equal(routeFromUrl(oldPath), legacyRouteFromHash(hash), oldPath);
  }
});

test('unrecognized routes, non-app anchors, malformed state and authentication fragments stay out of app links', () => {
  const ignored = ['#main', '#unknown/private', '#access_token=secret&refresh_token=secret', '#error',
    '#error=access_denied&error_description=private', '#code%3Dprivate', '#account?code=private', '#team/252/%2f',
    '#team/252/availability/123', '#compare/matchup/252/2305/invalid', '#weekly-picks/%GG'];
  for (const hash of ignored) {
    assert.equal(legacyRouteFromHash(hash), null, hash.split('=')[0]);
    assert.equal(routeHref(hash), null, hash.split('=')[0]);
  }
  assert.equal(routeFromUrl('https://www.thegamesdecide.com/account?code=secret&account=recovery#access_token=secret'), 'account');
  assert.equal(routeFromUrl('https://fbs-intelligence.onrender.com/#admin'), 'home');
  for (const path of ['/unknown', 'https://www.thegamesdecide.com//', '/team/unregistered-id/', '/team/252/?game=401', '/team/252/?view=players&game=401',
    '/rankings?model=unknown', '/matchup-lab?a=252&a=2305', '/weekly-picks?game=401', '/weekly-picks?week=private',
    '/conference-strength/?view=compare&a=Big+Ten&b=SEC', '/forge-rankings/?through=2026-11-14',
    '/forge-rankings/?week=11&through=2026-02-30', 'javascript:invalid']) {
    assert.equal(routeFromUrl(path), null, path);
  }
});
