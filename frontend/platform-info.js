import { loadAccountConfig, loadBracketClient } from './bracket-auth.js?v=header-account';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const repo = 'https://github.com/egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-';
const pages = {
  about: ['About FBS Intelligence', `<p>FBS Intelligence compares college football teams using game results, opponent quality, and reproducible calculations. Published Strength of Record measures the difficulty of a team’s achieved record. Predictive Strength estimates future matchups. Experimental views show additional analysis with their coverage and validation status.</p><p>Forge’s ballot is AI-authored analysis. AP, Coaches, and CFP rankings are credited comparison sources. Their rankings and our statistical models have separate methods.</p><p><a href="#methodology">Explore the methodology</a> · <a href="#model-report/fbs">See the model’s saved prediction record</a> · <a href="#support">Report a discrepancy</a></p>`],
  privacy: ['Privacy and account information', `<p>Public rankings, team pages, and model reports can be viewed without signing in. Google sign-in uses Supabase Authentication. The account service receives the identity information needed for sign-in, including an account identifier and email. Session information is stored by the sign-in library in your browser.</p><p>Saved teams, contest nicknames, visibility preferences, and picks are associated with your account. A public leaderboard can display your chosen nickname and results when you enable it. Picks shared with other visitors become visible after the corresponding game’s confirmed kickoff. You can view your own saved picks.</p><p>Sports information comes from CollegeFootballData, ESPN, official availability sources, and credited poll publishers. Your browser contacts those services or their image hosts where those features require them. Render delivers the site, and Supabase stores account and contest data.</p><p>Use <a href="#beat-the-model">Beat the Model</a> to change your public nickname and contest visibility. Use <a href="#my-teams">My Teams</a> to remove saved teams. <a href="#account">Account requests</a> provides a private way to request deletion. Locked contest picks remain part of scoring until an account request is reviewed. This notice describes the current account features and data flow.</p>`],
  terms: ['Using FBS Intelligence', `<p>Published rankings reflect the data and calculations shown at their stated cutoff. They can change when completed games or source corrections enter a later publication. Forecasts are estimates, and Experimental labels identify methods still being evaluated.</p><p>Contest picks lock at each game’s confirmed kickoff. A postponed game follows its updated kickoff where supplied. Canceled or tied games follow the contest’s scoring rules. Saved forecasts retain their original timestamp so historical results can be checked.</p><p>CFP scenarios are hypothetical projections. The announced bracket and selection committee rankings appear with their own labels and sources. Team names and logos identify the schools being discussed.</p><p>Please report a suspected error with the page, date, game, and supporting source. <a href="#support">Contact and discrepancy reports</a> explain how to submit it.</p>`],
  support: ['Support and data discrepancies', `<p>For a football data issue, include the team or game, the page address, the snapshot date, and a supporting source. Public data reports can be submitted through <a href="${repo}/issues/new?title=Data%20discrepancy&amp;body=Page%3A%20%0ATeam%20or%20game%3A%20%0ASnapshot%20date%3A%20%0AExpected%20value%20and%20source%3A%20" target="_blank" rel="noopener">the project’s GitHub issues</a>. A GitHub account is needed to submit an issue.</p><p>For an account question or deletion request, sign in with the header and use the private request form below. Keep passwords and API keys out of reports.</p>`],
  account: ['Your account', `<p>You can manage your <a href="#my-teams">saved teams</a> and your <a href="#beat-the-model">contest nickname and public visibility</a>. Contest picks can be changed before their individual confirmed kickoff. Locked picks are retained for grading.</p><p>Use the private form below for an account question, data correction, or deletion request. Deletion requests require owner review, including how historical contest records will be handled. Submitting a request does not immediately delete your account.</p>`],
};

export function platformInfoMarkup(page) {
  const [title, body] = pages[page] ?? pages.about;
  return `<section class="panel platform-info"><div class="panel-head"><h1>${title}</h1></div><div class="panel-body">${body}</div></section>`;
}

export function mountPlatformInfo(container, { page = 'about', previewClient } = {}) {
  container.innerHTML = platformInfoMarkup(page);
  if (!['account', 'support'].includes(page)) return () => {};
  const formRoot = document.createElement('section');
  formRoot.className = 'panel platform-info';
  formRoot.innerHTML = '<div class="panel-body"><p role="status">Loading account requests…</p></div>';
  container.append(formRoot);
  let active = true, client, busy = false, subscription, generation = 0, noticeTimer;

  async function connect() {
    const request = ++generation;
    const current = () => active && request === generation;
    try {
      client = previewClient ?? await loadBracketClient(await loadAccountConfig());
      if (!subscription && client.auth.onAuthStateChange) subscription = client.auth.onAuthStateChange(event => {
        if (!['SIGNED_IN', 'SIGNED_OUT'].includes(event)) return;
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
      const history = await client.rpc('my_account_requests');
      if (history.error) throw history.error;
      if (!current()) return;
      formRoot.innerHTML = `<div class="panel-head"><h2>Private account request</h2></div><div class="panel-body"><form data-account-request>
        <label for="account-request-kind">Request type</label><select id="account-request-kind" name="kind"><option value="support">Account support</option><option value="data">Data correction</option><option value="deletion">Account deletion</option></select>
        <label for="account-request-message">Details</label><textarea id="account-request-message" name="message" rows="4" minlength="5" maxlength="2000" required></textarea>
        <button class="button" type="submit">Send private request</button><p role="status" data-account-request-status></p></form>
        <details><summary>Your previous requests</summary>${Array.isArray(history.data) && history.data.length ? `<ul>${history.data.map(row => `<li>${escapeHtml(row.kind)} · ${escapeHtml(row.status)} · ${escapeHtml(new Date(row.createdAt).toLocaleDateString('en-US', {timeZone:'America/Denver'}))}</li>`).join('')}</ul>` : '<p>No previous requests.</p>'}</details></div>`;
    } catch {
      if (current()) formRoot.innerHTML = '<div class="panel-body"><p role="status">Account requests could not load.</p><button type="button" class="button light small" data-account-request-retry>Try again</button></div>';
    }
  }
  const onClick = event => { if (event.target.closest('[data-account-request-retry]')) void connect(); };
  const onSubmit = async event => {
    if (!event.target.matches('[data-account-request]')) return;
    event.preventDefault();
    if (busy || !client) return;
    busy = true;
    const form = event.target;
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[data-account-request-status]');
    button.disabled = true;
    try {
      const values = new FormData(form);
      const { data, error } = await client.rpc('submit_account_request', { p_kind: values.get('kind'), p_message: values.get('message') });
      if (error || !data?.id) throw error ?? Error('Request not saved');
      if (active) { status.textContent = 'Your request is saved for owner review. You can find its status in Your previous requests after reloading.'; form.querySelector('textarea').value = ''; }
    } catch { if (active) status.textContent = 'Your request could not be saved. Please try again.'; }
    finally { busy = false; if (active) button.disabled = false; }
  };
  container.addEventListener('submit', onSubmit);
  container.addEventListener('click', onClick);
  void connect();
  return () => { active = false; ++generation; clearTimeout(noticeTimer); subscription?.unsubscribe(); container.removeEventListener('submit', onSubmit); container.removeEventListener('click', onClick); };
}
