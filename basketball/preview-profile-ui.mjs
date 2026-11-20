import { basketballPickOpen } from './preview-accounts.mjs';
import { action, basketballHref, banner, dayKey, empty, escape as e, input, metric, panel, pct, stamp } from './preview-ui.mjs';

const notices = {
  'profile-created':'Practice profile created.', 'profile-exists':'That handle is already registered in this preview.',
  'profile-invalid':'Check the handle and passphrase.', 'profile-unsupported':'That request was unavailable.',
  'profile-required':'Sign in with a local profile to make picks.', 'signed-in':'Signed in to the local preview.',
  'signed-out':'Signed out of the local preview.', 'pick-saved':'Practice pick saved.',
  'pick-invalid':'That team and game could not be verified.', 'pick-locked':'This game is locked or its tipoff is unconfirmed.',
};
const notice = code => Object.hasOwn(notices,code) ? `<p class="fc-notice" role="status">${notices[code]}</p>` : '';
const password = '<label>Passphrase<input type="password" name="passphrase" minlength="10" maxlength="128" required></label>';
const end = '<input type="hidden" name="returnTo" value="/preview-profile/">';
export function profilePage(profile, query) {
  const signout = `<form class="fc-form" method="post">${end}<input type="hidden" name="action" value="logout"><button>Sign out</button></form>`;
  const settings = profile ? panel(`Practice profile · ${profile.name}`, `<p>Handle @${e(profile.handle)}</p>
    <div class="fc-actions">${action(basketballHref('contest'),'Open practice picks')}${action(basketballHref('march-madness'),'Open brackets',true)}</div>${signout}`)
    : `<div class="fc-grid">${panel('Sign in', `<form class="fc-form" method="post">${end}<input type="hidden" name="action" value="login">
      ${input('handle','Handle','')}${password}<button>Sign in</button></form>`)}
      ${panel('Create a practice profile', `<form class="fc-form" method="post">${end}<input type="hidden" name="action" value="register">
      ${input('handle','Handle','')}${input('name','Display name (optional)','')}${password}<button>Create profile</button></form><p class="fc-note">Use a throwaway passphrase for the preview.</p>`)}</div>`;
  return banner('Local practice profile','Basketball practice picks and brackets share a local profile on this computer.')+
    `<div class="wrap fc-content">${notice(query.get('notice'))}<p class="fc-note">This preview stores test profiles separately. Production Google, email, and administrator accounts are disconnected.</p>${settings}</div>`;
}
export async function contestBoard(accounts,request,ctx,query) {
  const now=Date.now(), today=dayKey(now);
  const date=query.get('date');
  const selected=/^\d{4}-\d{2}-\d{2}$/.test(date??'') ? date : today;
  const result = await accounts.contest(request,ctx.dataset);
  const picks=result?.picks??{};
  const games=ctx.dataset.games.filter(game=>game.divisionOne===true&&game.startDate&&dayKey(game.startDate)===selected);
  const rows=games.map(game=>{
    const picked=picks[game.id], h=ctx.teams.get(game.home), a=ctx.teams.get(game.away);
    const prediction=ctx.forecasts.get(game.id);
    const saved = prediction ? `GD saved · ${e(prediction.homeWinProbability>.5?h?.name:a?.name)} ${pct(Math.max(prediction.homeWinProbability,1-prediction.homeWinProbability))}` : 'No saved forecast';
    const allowed = ctx.profile && basketballPickOpen(game,now);
    const choice = (id,name) => `<button name="winnerId" value="${e(id)}"${picked?.winnerId===id?' class="fc-selected" aria-pressed="true"':' aria-pressed="false"'}>${e(name)}</button>`;
    return `<article class="fc-pick-row"><div><strong>${e(a?.name??game.awayName)} at ${e(h?.name??game.homeName)}</strong>
      <small>${game.startTimeTbd?'Tipoff TBD':stamp(game.startDate)} · ${saved}</small></div>
      ${allowed ? `<form method="post" action="/basketball/contest/" class="fc-form">
       <input type="hidden" name="season" value="${ctx.year}"><input type="hidden" name="gameId" value="${e(game.id)}">${choice(game.away,a?.name??game.awayName)}${choice(game.home,h?.name??game.homeName)}</form>` :
       `<small>${picked?'Local pick: '+e((ctx.teams.get(picked.winnerId)?.name??'Unknown')+' · '+picked.result):ctx.profile?'Locked or unconfirmed':'Sign in to make a pick'}</small>`}</article>`;
  });
  return `${notice(query.get('notice'))}${ctx.profile ? `<div class="fc-metrics">${metric('Practice profile',ctx.profile.name)}
    ${metric('Graded',result?.graded??0)}${metric('Correct',result?.correct??0)}</div>` : `<p class="fc-note">${action('/preview-profile/','Sign in to practice')}</p>`}
    <form class="fc-form" method="get"><input type="hidden" name="season" value="${ctx.year}">
      ${input('date','Game date',selected,'date')}<button>See games</button></form>
    ${panel('Practice picks',rows.length?rows.join(''):empty('No Division I games on this date.'),
      'Only confirmed future tipoffs accept picks. This preview stores picks by local profile.') }`;
}
