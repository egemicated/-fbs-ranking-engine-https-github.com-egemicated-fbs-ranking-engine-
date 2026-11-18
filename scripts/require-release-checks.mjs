// Render starts on commit. Refuse publication until that exact revision's
// Node, isolated SQL and browser workflow has completed successfully.
export const RELEASE_REPOSITORY = 'egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-';
const workflowPath = '.github/workflows/test.yml';

export async function waitForReleaseChecks({ commit, fetcher = fetch, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs = 480_000, intervalMs = 30_000, log = console.log } = {}) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw Error('Release checks require an exact Git commit');
  const started = now();
  const url = `https://api.github.com/repos/${RELEASE_REPOSITORY}/actions/workflows/test.yml/runs?head_sha=${commit}&branch=main&per_page=20`;
  for (;;) {
    let response;
    try { response = await fetcher(url, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) }); }
    catch { throw Error('Cannot verify release checks; previous deployment retained'); }
    if (!response.ok) throw Error(`Release check verification returned HTTP ${response.status}; previous deployment retained`);
    let data;
    try { data = await response.json(); } catch { throw Error('Invalid release check response; previous deployment retained'); }
    if (!Array.isArray(data.workflow_runs)) throw Error('Missing release check evidence; previous deployment retained');
    const runs = data.workflow_runs.filter(run => run.head_sha === commit && run.head_branch === 'main' &&
      run.path === workflowPath && ['push', 'workflow_dispatch'].includes(run.event) &&
      run.head_repository?.full_name === RELEASE_REPOSITORY)
      .sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
    const latest = runs[0];
    if (latest?.status === 'completed') {
      if (latest.conclusion !== 'success') throw Error(`Required release checks ${latest.conclusion ?? 'unavailable'}; previous deployment retained`);
      log(`Required release checks passed for ${commit.slice(0, 12)} (run ${latest.id}, attempt ${latest.run_attempt ?? 1})`);
      return { commit, runId: latest.id, attempt: latest.run_attempt ?? 1 };
    }
    if (now() - started >= timeoutMs) throw Error('Timed out waiting for required release checks; previous deployment retained');
    log(`Waiting for required release checks (${latest?.status ?? 'not started'})`);
    await sleep(Math.min(intervalMs, timeoutMs - (now() - started)));
  }
}

export async function requireRenderReleaseChecks(environment = process.env, options = {}) {
  if (environment.RENDER !== 'true') return null;
  if (environment.RENDER_GIT_REPO_SLUG && environment.RENDER_GIT_REPO_SLUG !== RELEASE_REPOSITORY)
    throw Error('Unexpected release repository; publication stopped');
  return waitForReleaseChecks({ ...options, commit: environment.RENDER_GIT_COMMIT });
}
