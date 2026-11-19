import { loadAccountConfig, loadBracketClient } from './bracket-auth.js?v=header-account';
import { notifySupportIfReady, supportRequestMarkup, updateSupportCategory, supportSubmission, restoreSupportDraft, supportResultNotice } from './account-support.js';
import { secondFactorRequired, openAccountDialog } from './account-auth.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const repo = 'https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-';
const pages = {
  about: ['About FBS Intelligence', `<p>FBS Intelligence compares college football teams using game results, opponent quality, and reproducible calculations. Published Strength of Record measures the difficulty of a team’s achieved record. Predictive Strength estimates future matchups. Experimental views show additional analysis with their coverage and validation status.</p><p>Forge’s ballot is AI-authored analysis. AP, Coaches, and CFP rankings are credited comparison sources. Their rankings and our statistical models have separate methods.</p><p><a href="#methodology">Explore the methodology</a> · <a href="#model-report/fbs">See the model’s saved prediction record</a> · <a href="#support">Report a discrepancy</a></p>`],
  privacy: ['Privacy and account information', `<p>Public rankings, team pages, and model reports can be viewed without signing in. Google and enabled email/password sign-in use Supabase Authentication. Supabase manages authentication credentials; FBS Intelligence application tables and administrators do not receive your password. The account service uses the identity information needed for sign-in, including an account identifier and email. Session information is managed by the sign-in library in your browser.</p><p>Saved teams, contest nicknames, visibility preferences, and picks are associated with your account. A public leaderboard can display your chosen nickname and results when you enable it. Picks shared with other visitors become visible after the corresponding game’s confirmed kickoff. You can view your own saved picks.</p><p>Sports information comes from CollegeFootballData, ESPN, official availability sources, and credited poll publishers. Your browser contacts those services or their image hosts where those features require them. Render delivers the site, and Supabase stores account and contest data.</p><p><a href="#account">Account settings</a> lets you manage your public nickname, visibility, password and authenticator where enabled. Use <a href="#my-teams">My Teams</a> to remove saved teams. Private support requests are available to their submitting account and authorized administrators. Request categories, timestamps and administrative actions are retained to handle and audit the request. Notification messages should contain only a request identifier and category, not the private request details.</p><p>Account deletion is a deliberate review process. Submitting a request does not immediately erase locked contest history, and deleting an FBS Intelligence account does not delete your Google account. The owner must confirm the applicable contest-history retention and deletion policy before permanent deletion is enabled. This notice describes the current account features and data flow.</p>`],
  terms: ['Using FBS Intelligence', `<p>Published rankings reflect the data and calculations shown at their stated cutoff. They can change when completed games or source corrections enter a later publication. Forecasts are estimates, and Experimental labels identify methods still being evaluated.</p><p>Contest picks lock at each game’s confirmed kickoff. A postponed game follows its updated kickoff where supplied. Canceled or tied games follow the contest’s scoring rules. Saved forecasts retain their original timestamp so historical results can be checked.</p><p>CFP scenarios are hypothetical projections. The announced bracket and selection committee rankings appear with their own labels and sources. Team names and logos identify the schools being discussed.</p><p>Please report a suspected error with the page, date, game, and supporting source. <a href="#support">Contact and discrepancy reports</a> explain how to submit it.</p>`],
  support: ['Support and data discrepancies', `<p>For a football data issue, include the team or game, the page address, the snapshot date, and a supporting source. Public data reports can be submitted through <a href="${repo}/issues/new?title=Data%20discrepancy&amp;body=Page%3A%20%0ATeam%20or%20game%3A%20%0ASnapshot%20date%3A%20%0AExpected%20value%20and%20source%3A%20" target="_blank" rel="noopener">the project’s GitHub issues</a>. A GitHub account is needed to submit an issue.</p><p>For a private account question or deletion request, sign in with the header and use the request form below. Keep passwords, authenticator codes and API keys out of reports. If you cannot sign in to FBS Intelligence, you can report an access problem through the public project support link without an FBS Intelligence account; do not include private account details in a public issue.</p>`],
  account: ['Your account', `<p>You can manage your <a href="#my-teams">saved teams</a> and your <a href="#beat-the-model">contest nickname and public visibility</a>. Contest picks can be changed before their individual confirmed kickoff. Locked picks are retained for grading.</p><p>Use the private form below for an account question, data correction, or deletion request. Deletion requests require owner review, including how historical contest records will be handled. Submitting a request does not immediately delete your account.</p>`],
};

export function platformInfoMarkup(page) {
  const [title, body] = pages[page] ?? pages.about;
  const headings={privacy:['Your account and sign-in','Your teams and public activity','Data sources and service providers','Account controls and private support','Account-deletion review'],terms:['Rankings and forecasts','Contest picks and deadlines','Playoff scenarios and sources','Report a problem'],support:['Report a football-data discrepancy','Private account help']};
  const paragraphs=body.match(/<p>[\s\S]*?<\/p>/g)??[];
  const content=headings[page]?.length===paragraphs.length?paragraphs.map((paragraph,index)=>`<section><h2>${headings[page][index]}</h2>${paragraph}</section>`).join(''):body;
  return `<section class="panel platform-info"><div class="panel-head"><h1>${title}</h1></div><div class="panel-body">${content}${page==='support'?'<p>GitHub is optional. You can also report a football-data discrepancy through the public support email below. Signed-in users can use the private form and read responses in their request history.</p>':''}</div></section>`;
}

export function mountPlatformInfo(container, { page = 'about', previewClient, previewConfig } = {}) {
  container.innerHTML = platformInfoMarkup(page);
  if (!['account', 'support'].includes(page)) return () => {};
  const formRoot = document.createElement('section');
  formRoot.className = 'panel platform-info';
  formRoot.innerHTML = '<div class="panel-body"><p role="status">Loading account requests…</p></div>';
  container.append(formRoot);
  let active = true, client, config = {}, busy = false, subscription, generation = 0, noticeTimer;

  async function connect() {
    const request = ++generation;
    const current = () => active && request === generation;
    try {
      config = previewConfig ?? (previewClient ? {} : await loadAccountConfig());
      if (page === 'support' && typeof config.supportEmail === 'string' && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(config.supportEmail) && !container.querySelector('[data-public-support-contact]')) {
        const contact = document.createElement('p');
        contact.dataset.publicSupportContact = '';
        contact.innerHTML = `Cannot sign in? Email <a href="mailto:${encodeURIComponent(config.supportEmail)}">${escapeHtml(config.supportEmail)}</a>. Do not send passwords or authenticator codes.`;
        container.querySelector('.platform-info .panel-body')?.append(contact);
      }
      client = previewClient ?? await loadBracketClient(config);
      if (!subscription && client.auth.onAuthStateChange) subscription = client.auth.onAuthStateChange(event => {
        if (!['SIGNED_IN', 'SIGNED_OUT', 'MFA_CHALLENGE_VERIFIED', 'TOKEN_REFRESHED'].includes(event)) return;
        ++generation;
        if (active) formRoot.innerHTML = '<div class="panel-body"><p role="status">Checking your account…</p></div>';
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(connect, 0);
      }).data.subscription;
      const { data, error } = await client.auth.getUser();
      if (!current()) return;
      if (error || !data.user) {
        formRoot.innerHTML = '<div class="panel-body"><p>Sign in from the header to send a private request.</p></div>';
        return;
      }
      const factor=await secondFactorRequired(client);
      if(!current())return;
      if(factor){formRoot.innerHTML='<div class="panel-body account-section"><p>Verify your authenticator to read private support requests.</p><button type="button" class="button light small" data-support-verify>Verify authenticator</button></div>';return;}
      const history = await client.rpc('my_account_requests');
      if (history.error) throw history.error;
      if (!current()) return;
      formRoot.innerHTML = `<div class="panel-body">${supportRequestMarkup(Array.isArray(history.data)?history.data:[],{idPrefix:'support'})}</div>`;
    } catch {
      if (current()) formRoot.innerHTML = '<div class="panel-body"><p role="status">Account requests could not load.</p><button type="button" class="button light small" data-account-request-retry>Try again</button></div>';
    }
  }
  const onClick = async event => {
    if(event.target.closest('[data-account-request-retry]'))return void connect();
    if(event.target.closest('[data-support-verify]')){
      try{const factor=await secondFactorRequired(client);if(factor&&active)openAccountDialog({client,config,mode:'mfa',mfaFactorId:factor,onSignedIn:()=>void connect()});else await connect();}catch{if(active)formRoot.innerHTML='<div class="panel-body"><p role="status">Verify your authenticator from Account settings, then reload support.</p><a href="#account">Account security</a></div>';}
    }
  };
  const onChange=event=>{if(event.target.matches('[data-account-support] [name="category"]'))updateSupportCategory(event.target.form);};
  const onSubmit = async event => {
    if (!event.target.matches('[data-account-support]')) return;
    event.preventDefault();
    if (busy || !client) return;
    busy = true;
    const requestGeneration=generation,current=()=>active&&generation===requestGeneration;
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[data-account-request-status]');
    button.disabled = true;
    try {
      const values = new FormData(form);
      const { data, error } = await client.rpc('submit_support_request', supportSubmission(values));
      if (error || !data?.id) throw error ?? Error('Request not saved');
      if(!current())return;
      if(data.alreadyOpen!==true)await notifySupportIfReady(client,config);
      if(!current())return;
      let requests;
      try{const history=await client.rpc('my_account_requests');if(history.error)throw history.error;requests=Array.isArray(history.data)?history.data:[data];}catch{requests=[data];}
      if(current()){formRoot.innerHTML=`<div class="panel-body">${supportRequestMarkup(requests,{idPrefix:'support'})}</div>`;const nextForm=formRoot.querySelector('[data-account-support]');if(data.alreadyOpen===true){restoreSupportDraft(nextForm,values);const history=formRoot.querySelector('.support-request-history');if(history)history.open=true;}nextForm.querySelector('[data-form-status]').textContent=supportResultNotice(data);}
    } catch(error) { if(current()&&status.isConnected)status.textContent=error.message==='Confirm the deletion-request acknowledgment before submitting.'?error.message:'Your request could not be saved. Please check its details and try again.'; }
    finally { busy = false; if (active) button.disabled = false; }
  };
  container.addEventListener('submit', onSubmit);
  container.addEventListener('click', onClick);
  container.addEventListener('change',onChange);
  void connect();
  return () => { active = false; ++generation; clearTimeout(noticeTimer); subscription?.unsubscribe(); container.removeEventListener('submit', onSubmit); container.removeEventListener('click', onClick); container.removeEventListener('change',onChange); };
}
