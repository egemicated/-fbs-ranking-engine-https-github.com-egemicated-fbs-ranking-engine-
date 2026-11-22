import { rankingComparisonTable } from '../frontend/platform-presentation.js';
import { BASKETBALL_POLLS } from './poll-publication.mjs';
import { basketballPollRoutes } from './preview-navigation-routes.mjs';
import { basketballRankingsPage, escape, seasonLabel, stamp, teamLink, teamRecord } from './preview-ui.mjs';

const pollDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'long' });

export function renderBasketballRankingComparison(snapshot, polls, type) {
  const source = BASKETBALL_POLLS[type];
  const poll = polls[type];
  const season = snapshot.season;
  const sor = snapshot.teams.filter(team => Number.isInteger(team.sorRank) && team.sorRank > 0 && team.sorRank <= 25)
    .sort((a, b) => a.sorRank - b.sorRank || a.name.localeCompare(b.name))
    .map(team => ({ rank: team.sorRank, team, record: teamRecord(team) }));
  const teamById = new Map(snapshot.teams.map(team => [team.id, team]));
  const pollRows = (poll?.ranks ?? []).map(({ id, rank }) => ({ rank, team: teamById.get(id) }));
  const rankedByPoll = new Set(pollRows.map(row => row.team.id));
  const shared = sor.filter(row => rankedByPoll.has(row.team.id)).length;
  const tabs = `<nav class="matchup-views edition-tabs" aria-label="Poll source">${Object.entries(BASKETBALL_POLLS)
    .map(([key, { name }]) => `<a href="${basketballPollRoutes[key]}"${key === type ? ' aria-current="page"' : ''}>${name}</a>`).join('')}</nav>`;
  const dates = poll ? `<p>${escape(source.name)} dated <time datetime="${escape(poll.pollDate)}">${pollDate.format(new Date(poll.pollDate + 'T00:00:00Z'))}</time>.
    First observed <time datetime="${escape(poll.observedAt)}">${stamp(poll.observedAt)}</time>.</p>
    <p class="compact-note edition-context">The editions may cover different games. The poll’s exact game cutoff is unverified.</p>
    ${sor.length ? `<p class="edition-notice">${shared} ${shared === 1 ? 'team appears' : 'teams appear'} in both Top 25 lists.</p>` : ''}`
    : `<p class="edition-notice" role="status">No verified ${escape(source.name)} edition is available yet.</p>`;
  return basketballRankingsPage('polls',`
    <div class="rankings-view-heading"><h2>Compare Rankings</h2><p>Compare The Games Decide’s Strength of Record with the AP and Coaches polls.</p></div>
    <section class="panel edition-panel" data-basketball-ranking-comparison><div class="panel-body">
    ${tabs}<div class="edition-controls"><a class="text-link" href="${source.url}">Open ${source.name}</a></div>
    <h3>${seasonLabel(season)} · Latest available editions</h3>
    ${sor.length ? `<p>GD SOR snapshot <time datetime="${escape(snapshot.asOf)}">${stamp(snapshot.asOf)}</time>.</p>`
      : '<p>No GD SOR Top 25 is available for this snapshot.</p>'}
    ${dates}
    </div>${rankingComparisonTable({
      caption: `Basketball GD SOR and ${source.name} comparison`,
      columns: [{ label: 'GD SOR', teams: sor }, { label: source.name, teams: pollRows }],
      renderTeam: ({ team, record }) => `<div class="poll-ranked-team">${teamLink(team, season)}${record ? `<small>${escape(record)}</small>` : ''}</div>`,
    })}
    <div class="panel-body"><p class="compact-note">Tied teams share a cell. A dash marks a skipped rank or an unavailable edition. Poll data provided by CollegeBasketballData.com.</p></div>
    </section>`);
}
