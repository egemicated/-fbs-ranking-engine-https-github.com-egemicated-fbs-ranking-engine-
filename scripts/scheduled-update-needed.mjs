import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { RELEASE_REPOSITORY } from './require-release-checks.mjs';

const workflows = {
  results: { file: 'weekly.yml', crons: ['45 2 * * *', '45 4 * * *'] },
  availability: { file: 'player-availability.yml', crons: ['45 2 * 8-12,1 *', '45 4 * 8-12,1 *'] },
};
const fallbackTitle = 'Forge overnight fallback';
const refreshDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Etc/GMT+7', year: 'numeric', month: '2-digit', day: '2-digit',
});

export async function scheduledUpdateNeeded(kind, { runId, token, now = new Date(), fetcher = fetch } = {}) {
  if (!Object.hasOwn(workflows, kind) || !Number.isSafeInteger(runId) || runId <= 0 ||
      typeof token !== 'string' || !token || !Number.isFinite(now.getTime())) {
    throw new Error('The scheduled update could not identify its GitHub run.');
  }
  const { file, crons } = workflows[kind];
  const titles = new Set(crons.map(cron => `Scheduled update (${cron})`));
  const url = new URL(`https://api.github.com/repos/${RELEASE_REPOSITORY}/actions/workflows/${file}/runs`);
  url.search = new URLSearchParams({
    branch: 'main',
    created: `>=${new Date(now.getTime() - 36 * 60 * 60_000).toISOString()}`,
    per_page: '100',
  });
  const response = await fetcher(url, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2026-03-10' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('GitHub could not confirm the scheduled update history.');
  const { workflow_runs: runs, total_count: total } = await response.json();
  if (!Array.isArray(runs) || total !== runs.length) {
    throw new Error('The scheduled update history was incomplete.');
  }

  const today = refreshDay.format(now);
  // Keep recognizing completed GitHub cron runs during the scheduler handoff.
  return !runs.some(run => run.id !== runId && run.head_branch === 'main' &&
    run.path === `.github/workflows/${file}` &&
    ((run.event === 'schedule' && titles.has(run.display_title)) ||
     (run.event === 'workflow_dispatch' && run.display_title === fallbackTitle)) &&
    run.status === 'completed' && run.conclusion === 'success' &&
    Number.isFinite(Date.parse(run.created_at)) && refreshDay.format(new Date(run.created_at)) === today);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const event = process.env.GITHUB_EVENT_NAME;
    const isFallback = event === 'workflow_dispatch' && process.env.SCHEDULED_FALLBACK === 'true';
    if ((event !== 'schedule' && !isFallback) || process.env.GITHUB_REF !== 'refs/heads/main' ||
        process.env.GITHUB_REPOSITORY !== RELEASE_REPOSITORY || !process.env.GITHUB_OUTPUT) {
      throw new Error('A scheduled update on the production branch is required.');
    }
    const needed = await scheduledUpdateNeeded(process.argv[2], {
      runId: Number(process.env.GITHUB_RUN_ID), token: process.env.GH_TOKEN,
    });
    await appendFile(process.env.GITHUB_OUTPUT, `needed=${needed}\n`);
    console.log(needed ? 'No successful overnight update yet today.' : 'An overnight update already succeeded today. Skipping this pull.');
  } catch {
    console.error('Unable to verify scheduled update history. No provider pull started.');
    process.exitCode = 1;
  }
}
