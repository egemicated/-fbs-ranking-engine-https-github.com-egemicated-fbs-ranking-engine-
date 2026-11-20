import { publicFootballPageUrl } from './game-calendar.js';
import { teamAccent, teamDisplayName, teamNameParts } from './team-identity.js';

const width = 1200;
const height = 630;
const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Denver',
});
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const clean = (value, length) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, length) : '';
const slug = value => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const validId = value => /^\d{1,24}$/.test(String(value));
let brandArtwork;

export function publicShareCard({ teams, asOf, href, venue, forecastLabel } = {}) {
  if (!Array.isArray(teams) || teams.length < 1 || teams.length > 2) return null;
  const link = publicFootballPageUrl(href);
  if (!link) return null;
  const publicTeams = teams.map(team => ({
    id: validId(team?.id) ? String(team.id) : null,
    name: clean(teamDisplayName(team?.id, clean(team?.name, 85)), 85),
    rank: Number.isSafeInteger(team?.rank) && team.rank > 0 ? team.rank : null,
    rankLabel: clean(team?.rankLabel, 26),
    record: clean(team?.record, 18),
    division: /^(?:FBS|FCS)$/i.test(team?.division ?? '') ? team.division.toUpperCase() : '',
    probability: Number.isFinite(team?.probability) && team.probability >= 0 && team.probability <= 1 ? team.probability : null,
  }));
  if (publicTeams.some(team => !team.name)) return null;
  const asOfTime = typeof asOf === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(asOf) ? Date.parse(asOf) : NaN;
  return {
    teams: publicTeams,
    asOf: Number.isFinite(asOfTime) ? new Date(asOfTime).toISOString() : null,
    href: link,
    venue: clean(venue, 80),
    forecastLabel: clean(forecastLabel, 45),
  };
}

const shareIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V3m-4 4 4-4 4 4m2 3h2v11H4V10h2"/></svg>';

export function shareCardButton(value) {
  const card = publicShareCard(value);
  if (!card) return '';
  const title = card.teams.map(team => team.name).join(' and ');
  return `<button type="button" class="share-calendar-button share-card-trigger" data-share-card="${escapeHtml(JSON.stringify(card))}" aria-label="Share ${escapeHtml(title)} card">${shareIcon}<span>Share</span></button>`;
}

function loadBrandArtwork() {
  if (brandArtwork) return brandArtwork;
  brandArtwork = new Promise(resolve => {
    const image = new Image();
    const finish = value => {
      clearTimeout(timeout);
      image.onload = image.onerror = null;
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 2500);
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = '/assets/the-games-decide-logo.webp';
  }).then(image => {
    if (!image) brandArtwork = null;
    return image;
  });
  return brandArtwork;
}

function fontReady() {
  const fonts = document.fonts;
  if (!fonts?.load) return null;
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 1100);
    void Promise.all([fonts.load('600 64px Barlow'), fonts.load('700 64px Barlow')])
      .then(resolve, resolve).finally(() => clearTimeout(timer));
  });
}

function fillBox(ctx, x, y, w, h, radius, color) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, radius);
  else ctx.rect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fill();
}

function text(ctx, value, x, y, { size, max = width, align = 'left', color = '#fff', weight = 700, font = 'Barlow, sans-serif' }) {
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.font = weight + ' ' + size + 'px ' + font;
  const measured = ctx.measureText(value).width;
  if (measured > max) ctx.font = weight + ' ' + Math.floor(size * max / measured) + 'px ' + font;
  ctx.fillText(value, x, y);
}

function fitImage(ctx, image, x, y, w, h) {
  const scale = Math.min(w / image.naturalWidth, h / image.naturalHeight);
  const iw = image.naturalWidth * scale, ih = image.naturalHeight * scale;
  ctx.drawImage(image, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

function cornerAccent(ctx, x, y, accent, size = 48) {
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x, y - size * 0.58);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
}

function cardBackground(ctx) {
  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, '#102952');
  background.addColorStop(1, '#07152d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#00b7ed';
  ctx.fillRect(0, 0, 8, height);
}

function rankDescription(team) {
  if (!team.rank) return '';
  return ['#' + team.rank, team.division, team.rankLabel || 'rank'].filter(Boolean).join(' ');
}

function cardFooter(ctx, card) {
  ctx.fillStyle = '#385474';
  ctx.fillRect(61, 543, 1078, 2);
  const asOf = card.asOf ? 'AS OF ' + dateFormat.format(new Date(card.asOf)).toUpperCase() : 'SNAPSHOT DATE UNAVAILABLE';
  text(ctx, asOf, 63, 589, { size: 24, color: '#d4e4f7' });
}

function drawTeamCard(ctx, team) {
  const { school, nickname } = teamNameParts(team.id, team.name);
  cornerAccent(ctx, width, height, teamAccent(team.id), 72);
  text(ctx, team.division ? team.division + ' FOOTBALL' : 'COLLEGE FOOTBALL', 64, 164, { size: 25, color: '#85dcff' });
  text(ctx, school, 64, 250, { size: nickname ? 65 : 92, max: 1074, weight: nickname ? 600 : 700 });
  if (nickname) text(ctx, nickname.toUpperCase(), 61, 370, { size: 105, max: 1074 });
  const place = rankDescription(team);
  const detail = [place, team.record && team.record + ' overall'].filter(Boolean).join(' · ');
  if (detail) text(ctx, detail, 64, nickname ? 448 : 342, { size: 43, max: 1074, color: '#9be7ff' });
}

function drawMatchupCard(ctx, card) {
  const label = [card.forecastLabel || 'Model win chance', card.venue].filter(Boolean).join(' · ');
  text(ctx, label.toUpperCase(), 600, 133, { size: 25, max: 1050, align: 'center', color: '#97e5ff' });
  for (const [index, team] of card.teams.entries()) {
    const x = index ? 628 : 62, center = x + 255;
    const { school, nickname } = teamNameParts(team.id, team.name);
    fillBox(ctx, x, 161, 510, 352, 14, '#122e53');
    ctx.save();
    ctx.clip();
    cornerAccent(ctx, x + 510, 513, teamAccent(team.id));
    ctx.restore();
    text(ctx, school, center, nickname ? 247 : 278, { size: nickname ? 44 : 58, max: 455, align: 'center', weight: nickname ? 600 : 700 });
    if (nickname) text(ctx, nickname.toUpperCase(), center, 313, { size: 63, max: 455, align: 'center' });
    const description = [rankDescription(team), team.record].filter(Boolean).join(' · ');
    const chance = team.probability === null ? 'Win chance unavailable' : (100 * team.probability).toFixed(1) + '%';
    text(ctx, chance, center, 423, { size: team.probability === null ? 34 : 78, max: 454, align: 'center', color: '#96e8ff' });
    if (description) text(ctx, description, center, 476, { size: 27, max: 455, align: 'center', color: '#dceaff' });
  }
  text(ctx, 'VS', 600, 338, { size: 26, max: 50, align: 'center', color: '#9fe6ff' });
}

export async function createShareCardImage(value) {
  const card = publicShareCard(value);
  if (!card) throw new TypeError('Invalid share card');
  const [brand] = await Promise.all([loadBrandArtwork(), fontReady()]);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create share image');
  const matchup = card.teams.length === 2;
  cardBackground(ctx);
  if (brand) fitImage(ctx, brand, 61, 16, 285, 89);
  else text(ctx, 'THE GAMES DECIDE', 61, 75, { size: 37, max: 500 });
  text(ctx, matchup ? 'MATCHUP FORECAST' : 'TEAM SNAPSHOT', 1139, 75, {
    size: 25, align: 'right', color: '#8ddfff',
  });
  if (matchup) drawMatchupCard(ctx, card);
  else drawTeamCard(ctx, card.teams[0]);
  cardFooter(ctx, card);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode share image')), 'image/png');
  });
}

function canShare(data) {
  try { return navigator.canShare ? navigator.canShare(data) : !data.files; } catch { return false; }
}

function openShareCard(trigger, card) {
  const title = card.teams.map(team => team.name).join(' vs. ');
  const filename = 'the-games-decide-' + (slug(title) || 'share-card') + '.png';
  const dialog = document.createElement('dialog');
  dialog.className = 'share-card-dialog';
  dialog.setAttribute('aria-labelledby', 'fbs-share-title');
  dialog.innerHTML = `<div class="share-card-dialog-heading"><h2 id="fbs-share-title">Share card</h2>
    <button type="button" class="share-card-close" aria-label="Close share card" autofocus>×</button></div>
    <p class="share-card-caption">${escapeHtml(title)}</p>
    <div class="share-card-preview"><img alt="${escapeHtml(title)} · The Games Decide" hidden></div>
    <p class="share-card-status" role="status">Preparing the image…</p>
    <div class="share-card-actions"><button type="button" class="button small" data-share-native hidden></button>
    <a class="button light small" data-save-card download="${escapeHtml(filename)}" hidden>Save image</a>
    <button type="button" class="button light small" data-copy-card>Copy link</button></div>
    <input type="text" class="share-card-link" aria-label="Page link" value="${escapeHtml(card.href)}" readonly hidden>`;
  document.body.append(dialog);
  let objectUrl;
  let shareData = { title, url: card.href };
  const status = dialog.querySelector('.share-card-status');
  const preview = dialog.querySelector('img');
  const native = dialog.querySelector('[data-share-native]');
  const save = dialog.querySelector('[data-save-card]');
  const link = dialog.querySelector('.share-card-link');
  const dismiss = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    dialog.remove();
    if (trigger.isConnected) trigger.focus();
  };
  const updateNative = () => {
    native.hidden = typeof navigator.share !== 'function' || !canShare(shareData);
    native.textContent = shareData.files ? 'Share image + link' : 'Share link';
  };
  dialog.addEventListener('close', dismiss, { once: true });
  dialog.querySelector('.share-card-close').onclick = () => dialog.close ? dialog.close() : dismiss();
  dialog.querySelector('[data-copy-card]').onclick = async () => {
    try {
      await navigator.clipboard.writeText(card.href);
      status.textContent = 'Link copied.';
    } catch {
      link.hidden = false;
      link.focus();
      link.select();
      status.textContent = 'Copy the selected page link.';
    }
  };
  native.onclick = async () => {
    try { await navigator.share(shareData); }
    catch (error) {
      if (error?.name !== 'AbortError') status.textContent = 'Sharing is unavailable here. Use Save image or Copy link.';
    }
  };
  updateNative();
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute('open', '');
  void createShareCardImage(card).then(blob => {
    if (!dialog.isConnected) return;
    objectUrl = URL.createObjectURL(blob);
    preview.src = objectUrl;
    preview.hidden = false;
    save.href = objectUrl;
    save.hidden = false;
    if (typeof File === 'function') {
      const files = [new File([blob], filename, { type: 'image/png' })];
      const candidate = { ...shareData, files };
      if (canShare({ files }) && canShare({ url: card.href }) && canShare(candidate)) shareData = candidate;
    }
    updateNative();
    if (status.textContent === 'Preparing the image…') status.textContent = '';
  }).catch(() => {
    if (dialog.isConnected) status.textContent = 'The image is unavailable. You can still share the page link.';
  });
}

export function mountShareCards(root) {
  root.addEventListener('click', event => {
    const button = event.target.closest?.('[data-share-card]');
    if (!button || !root.contains(button)) return;
    let card;
    try { card = publicShareCard(JSON.parse(button.dataset.shareCard)); } catch { return; }
    if (card) openShareCard(button, card);
  });
}
