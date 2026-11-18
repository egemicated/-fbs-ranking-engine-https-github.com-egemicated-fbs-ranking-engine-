// Render starts on commit. Refuse publication until that exact revision's
// Node, isolated SQL and browser workflow has completed successfully.
export const RELEASE_REPOSITORY = 'egemicated/-fbs-ranking-engine-https-github.com-egemicated-fbs-ranking-engine-';
const workflowPath = '.github/workflows/test.yml';
const ciPaths = new Set([workflowPath, '.github/workflows/performance.yml']);

export async function waitForReleaseChecks({ commit, fetcher = fetch, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs = 480_000, intervalMs = 30_000, log = console.log } = {}) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw Error('Release checks require an exact Git commit');
  const started = now();
  const url = `https://api.github.com/repos/${RELEASE_REPOSITORY}/actions/runs?head_sha=${commit}&branch=main&per_page=50`;
  for (;;) {
    let response;
    try { response = await fetcher(url, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20_000) }); }
    catch { throw Error('Cannot verify release checks; previous deployment retained'); }
    if (!response.ok) throw Error(`Release check verification returned HTTP ${response.status}; previous deployment retained`);
    let data;
    try { data = await response.json(); } catch { throw Error('Invalid release check response; previous deployment retained'); }
    if (!Array.isArray(data.workflow_runs)) throw Error('Missing release check evidence; previous deployment retained');
    const runs = data.workflow_runs.filter(run => run.head_sha === commit && run.head_branch === 'main' &&
      ciPaths.has(run.path) && ['push', 'workflow_dispatch'].includes(run.event) &&
      run.head_repository?.full_name === RELEASE_REPOSITORY)
      .sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
    const latestByPath = new Map();
    for (const run of runs) if (!latestByPath.has(run.path)) latestByPath.set(run.path, run);
    const latest = latestByPath.get(workflowPath);
    const relevant = [...latestByPath.values()];
    for (const run of relevant) {
      if (run.status === 'completed' && run.conclusion !== 'success')
        throw Error(`Required release checks ${run.conclusion ?? 'unavailable'} (${run.path}); previous deployment retained`);
    }
    if (latest?.status === 'completed' && relevant.every(run => run.status === 'completed' && run.conclusion === 'success')) {
      log(`Required release checks passed for ${commit.slice(0, 12)} (run ${latest.id}, attempt ${latest.run_attempt ?? 1})`);
      return { commit, runId: latest.id, attempt: latest.run_attempt ?? 1, checkedWorkflows: [...latestByPath.keys()] };
    }
    if (now() - started >= timeoutMs) throw Error('Timed out waiting for required release checks; previous deployment retained');
    const pending = relevant.find(run => run.status !== 'completed');
    log(`Waiting for required release checks (${pending?.path ?? workflowPath}: ${pending?.status ?? latest?.status ?? 'not started'})`);
    await sleep(Math.min(intervalMs, timeoutMs - (now() - started)));
  }
}

export async function requireRenderReleaseChecks(environment = process.env, options = {}) {
  if (environment.RENDER !== 'true') return null;
  if (environment.RENDER_GIT_REPO_SLUG && environment.RENDER_GIT_REPO_SLUG !== RELEASE_REPOSITORY)
    throw Error('Unexpected release repository; publication stopped');
  return waitForReleaseChecks({ ...options, commit: environment.RENDER_GIT_COMMIT });
}
