import { basketballForgePath } from './preview-navigation-routes.mjs';
import { basketballRankingsPage, dayKey, escape, seasonLabel, stamp, teamLink, teamRecord } from './preview-ui.mjs';

export const basketballForgeArchiveFile = 'basketball-forge-ballots.json';
const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'long' });
const dateText = value => dateLabel.format(new Date(`${value}T00:00:00Z`));
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validRecord = value => Number.isSafeInteger(value) && value >= 0;

export function basketballForgeEditionPath(gamesThrough) {
  return `${basketballForgePath}${gamesThrough}/`;
}

export function readBasketballForgeBallots(saved, snapshot) {
  if (saved == null) return { schema: 1, season: snapshot.season, editions: [] };
  if (saved.schema !== 1 || !Number.isSafeInteger(saved.season) || saved.season < 1900 || saved.season > snapshot.season ||
      !Array.isArray(saved.editions)) throw Error('Invalid basketball Forge archive');

  const teams = saved.season === snapshot.season ? new Map(snapshot.teams.map(team => [team.id, team])) : null;
  const cutoffs = new Set();
  for (const edition of saved.editions) {
    const { gamesThrough, released, snapshotAsOf, snapshotHash, rows, notes } = edition ?? {};
    if (!validDay(gamesThrough) || !validDay(released) || cutoffs.has(gamesThrough) || gamesThrough > released ||
        gamesThrough < `${saved.season - 1}-07-01` || gamesThrough >= `${saved.season}-07-01` ||
        typeof snapshotAsOf !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(snapshotAsOf) ||
        !validDay(snapshotAsOf.slice(0, 10)) || !Number.isFinite(Date.parse(snapshotAsOf)) ||
        dayKey(snapshotAsOf) < gamesThrough || dayKey(snapshotAsOf) > released ||
        typeof snapshotHash !== 'string' || !/^[a-f0-9]{64}$/.test(snapshotHash) ||
        !Array.isArray(notes) || notes.some(note => typeof note !== 'string' || !note.trim()) ||
        !Array.isArray(rows) || rows.length !== 25 || new Set(rows.map(row => row?.id)).size !== 25 ||
        rows.some(row => typeof row?.id !== 'string' || !/^ncaam-d1:[1-9]\d*$/.test(row.id) ||
          typeof row.team !== 'string' || !row.team.trim() || !validRecord(row.wins) || !validRecord(row.losses))) {
      throw Error('Invalid basketball Forge ballot edition');
    }
    if (teams && snapshotHash === snapshot.snapshotHash && (snapshotAsOf !== snapshot.asOf || rows.some(row => {
      const team = teams.get(row.id);
      return !team || team.name !== row.team || team.wins !== row.wins || team.losses !== row.losses;
    }))) throw Error('Basketball Forge ballot does not match its published snapshot');
    cutoffs.add(gamesThrough);
  }
  return { ...saved, editions: [...saved.editions].sort((a, b) => b.gamesThrough.localeCompare(a.gamesThrough)) };
}

export function renderBasketballForgeBallot(snapshot, archive, gamesThrough) {
  const { season, editions } = archive;
  const index = gamesThrough ? editions.findIndex(edition => edition.gamesThrough === gamesThrough) : 0;
  const edition = editions[index];
  const heading = `<div class="rankings-view-heading"><h2>Forge’s Basketball Top 25</h2>
    <p>An AI-authored editorial ballot based on results, opponent quality, and game context.</p></div>`;
  const page = content => basketballRankingsPage('forge-rankings', heading + content, snapshot.season);
  if (!edition) return page('<section class="panel edition-panel" data-basketball-forge-ballot><div class="panel-body"><p role="status">No Forge basketball ballot is available yet.</p></div></section>');

  const previous = editions[index + 1];
  const ranks = new Map(previous?.rows.map((row, position) => [row.id, position + 1]));
  const teams = new Map(snapshot.teams.map(team => [team.id, team]));
  const rows = edition.rows.map((row, position) => {
    const rank = position + 1;
    const prior = ranks.get(row.id);
    const difference = prior === undefined ? 0 : prior - rank;
    const label = prior === undefined ? 'Entered the Top 25' : difference > 0 ? `Up ${difference}`
      : difference < 0 ? `Down ${-difference}` : 'Same rank';
    const move = prior === undefined ? 'In' : difference > 0 ? `↑${difference}` : difference < 0 ? `↓${-difference}` : '—';
    const team = teams.get(row.id);
    const mascot = team?.name === row.team ? team.mascot : undefined;
    return `<tr><th scope="row" class="num">${rank}</th><td>${teamLink({ id: row.id, name: row.team, mascot }, season)}</td>
      <td class="num">${teamRecord(row)}</td>${previous ? `<td class="num" aria-label="${label}">${move}</td>` : ''}</tr>`;
  }).join('');
  const archiveLinks = editions.length > 1 ? `<details>
    <summary>Ballot archive</summary><ul>${editions.map(row => {
      const path = basketballForgeEditionPath(row.gamesThrough);
      return `<li><a href="${path}"${row === edition ? ' aria-current="page"' : ''}>Games through ${dateText(row.gamesThrough)}</a></li>`;
    }).join('')}</ul></details>` : '';
  return page(`<section class="panel edition-panel" data-basketball-forge-ballot>
    <div class="panel-body"><h3>${seasonLabel(season)} · Games through <time datetime="${edition.gamesThrough}">${dateText(edition.gamesThrough)}</time></h3>
    <p>Published <time datetime="${edition.released}">${dateText(edition.released)}</time>. Data snapshot <time datetime="${edition.snapshotAsOf}">${stamp(edition.snapshotAsOf)}</time>.</p>
    ${edition.notes.length ? `<ul class="edition-notice">${edition.notes.map(note => `<li>${escape(note)}</li>`).join('')}</ul>` : ''}${archiveLinks}</div>
    <div class="table-scroll"><table class="edition-table poll-rank-table"><caption class="sr-only">Forge’s basketball ballot through ${dateText(edition.gamesThrough)}</caption>
    <thead><tr><th scope="col">Rank</th><th scope="col">Team</th><th scope="col">Record</th>${previous ? '<th scope="col">Move</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>
    </section>`);
}
