import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createBasketballPreview } from './serve-basketball-preview.mjs';

const external = process.env.FULL_COURT_PREVIEW_URL;
const origin = external ? new URL(external) : null;
if (origin && (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1')) {
  throw new Error('Use a loopback preview for this check.');
}
const server = origin ? null : (await createBasketballPreview()).server;
if (server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
}
const base = origin?.origin ?? `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.QUALITY_BROWSER ? { executablePath: process.env.QUALITY_BROWSER } : {}) });
const screenshots = resolve(process.env.MATCHUP_SCREENSHOTS || '../tmp/gd-one-platform/matchup');
const odds = '.matchup-win-chance strong';
const scrollY = page => page.evaluate(() => window.scrollY);
const evidence = page => page.locator(odds).allTextContents();
const normalizedName = value => value.trim().replace(/\s+/g, ' ').toLowerCase();

async function assertInPlace(page, marker, top) {
  assert.equal(await page.evaluate(() => window.matchupDocumentToken), marker);
  assert.ok(Math.abs(await scrollY(page) - top) < 3, 'The visitor stays at the comparison.');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}

async function pickAlternative(page, selectorA, selectorB) {
  const a = await page.locator(selectorA).inputValue();
  const b = await page.locator(selectorB).inputValue();
  return page.locator(selectorA).evaluate((select, taken) =>
    Array.from(select.options).find(option => option.value && !option.disabled && !taken.includes(option.value))?.value, [a, b]);
}

async function assertBasketballLayout(page, width) {
  const layout = page.locator('[data-matchup-lab] .compare-layout');
  const teamA = layout.locator('[data-matchup-side="a"]');
  const teamB = layout.locator('[data-matchup-side="b"]');
  const estimate = layout.locator('.gd-matchup-estimate');
  const venue = page.getByRole('group', { name: 'Game location' });
  assert.equal(await venue.getByRole('button', { name: 'Neutral court' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await venue.getByRole('button').count(), 3);
  const colors = await venue.getByRole('button').evaluateAll(buttons =>
    buttons.map(button => getComputedStyle(button).backgroundColor));
  assert.ok(colors[0] !== colors[1] && colors[0] !== colors[2], 'The active venue is visually distinguishable.');
  assert.equal(await page.getByRole('button', { name: 'Compare teams', exact: true }).count(), 0, 'Enhanced controls apply directly.');
  const [left, center, right, controls] = await Promise.all(
    [teamA, estimate, teamB, venue].map(locator => locator.boundingBox()));
  assert.ok(left && center && right && controls, 'The venue controls and all three panels are visible.');
  assert.ok(controls.y + controls.height <= Math.min(left.y, center.y, right.y), 'Venue controls sit above the comparison.');
  if (width > 950) {
    assert.ok(left.x + left.width <= center.x && center.x + center.width <= right.x, 'The estimate is between the team cards.');
    assert.ok(Math.abs(left.y - center.y) < 2 && Math.abs(right.y - center.y) < 2, 'All three panels start on the same row.');
  } else {
    assert.ok(center.y >= Math.max(left.y + left.height, right.y + right.height), 'Narrow screens place the estimate under the pickers.');
  }
  for (const [card, side] of [[teamA, 'A'], [teamB, 'B']]) {
    const search = card.getByRole('searchbox', { name: `Filter Team ${side} list` });
    const select = card.getByRole('combobox', { name: `Team ${side}`, exact: true });
    assert.ok(await search.isVisible() && await select.isVisible());
    const availableOptions = select.locator('option:enabled');
    const originalCount = await availableOptions.count();
    const selected = await select.inputValue();
    const name = await select.locator('option:checked').textContent();
    assert.equal(normalizedName(await card.getByRole('heading', { level: 2 }).innerText()), normalizedName(name));
    await search.fill(name.trim());
    assert.ok(await availableOptions.count() < originalCount, 'Typing filters the team options.');
    assert.equal(await select.inputValue(), selected, 'Typing leaves the chosen team in place.');
    await search.press('Escape');
    assert.equal(await availableOptions.count(), originalCount);
    assert.equal(await select.evaluate(control => control === document.activeElement), true);
  }
}

async function inspectBasketballPlayers(page) {
  const players = page.locator('details[data-matchup-players]');
  const summary = players.locator('summary');
  assert.equal(await summary.textContent(), 'Players to know');
  if (!await players.evaluate(disclosure => disclosure.open)) await summary.press('Enter');
  const matchup = page.locator('.matchup-win-chance > span');
  assert.deepEqual(await players.getByRole('heading', { level: 3 }).allTextContents(), await matchup.allTextContents());
  assert.equal(await players.getByText('No player stats or availability reports published for this season.').count(), 2);
  return players;
}

async function football(page, width) {
  const selectorA = '#compare-a', selectorB = '#compare-b';
  await page.goto(base + '/matchup-lab');
  await page.locator(odds).first().waitFor();
  const original = page.url();
  const initial = await evidence(page);
  const initialA = await page.locator(selectorA).inputValue();
  const alternative = await pickAlternative(page, selectorA, selectorB);
  assert.ok(alternative);
  await page.locator(selectorA).scrollIntoViewIfNeeded();
  await page.evaluate(() => { window.matchupDocumentToken = 'football'; window.scrollBy(0, 100); });
  const top = await scrollY(page);
  assert.ok(top > 0);
  await page.locator(selectorA).selectOption(alternative);
  const selectedUrl = page.url();
  assert.equal(new URL(selectedUrl).searchParams.get('a'), alternative);
  assert.notDeepEqual(await evidence(page), initial);
  await assertInPlace(page, 'football', top);
  const home = page.getByRole('button', { name: 'Team A at home' });
  await home.scrollIntoViewIfNeeded();
  const venueTop = await scrollY(page);
  const neutral = await evidence(page);
  await home.press('Enter');
  const homeUrl = page.url();
  assert.equal(new URL(homeUrl).searchParams.get('venue'), 'home');
  const homeOdds = await evidence(page);
  assert.notDeepEqual(homeOdds, neutral);
  await assertInPlace(page, 'football', venueTop);
  assert.equal(await home.getAttribute('aria-pressed'), 'true');
  assert.equal(await home.evaluate(button => button === document.activeElement), true);
  await page.goBack();
  await page.waitForURL(selectedUrl);
  assert.deepEqual(await evidence(page), neutral);
  await page.goBack();
  await page.waitForURL(original);
  assert.equal(await page.locator(selectorA).inputValue(), initialA);
  assert.deepEqual(await evidence(page), initial);
  await page.goForward();
  await page.goForward();
  await page.waitForURL(homeUrl);
  assert.deepEqual(await evidence(page), homeOdds);
  await page.reload();
  await page.locator(odds).first().waitFor();
  assert.deepEqual(await evidence(page), homeOdds);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(screenshots, `football-matchup-${width}.png`), fullPage: true });
}

async function basketball(page, width) {
  const selectorA = 'select[name="a"]', selectorB = 'select[name="b"]';
  await page.goto(base + '/basketball/matchup-lab/');
  assert.equal(await page.locator(odds).count(), 2);
  await page.getByRole('searchbox', { name: 'Filter Team A list' }).waitFor();
  await assertBasketballLayout(page, width);
  const initial = await evidence(page);
  const initialA = await page.locator(selectorA).inputValue();
  const alternative = await pickAlternative(page, selectorA, selectorB);
  assert.ok(alternative);
  const chooseA = page.locator(selectorA);
  await chooseA.scrollIntoViewIfNeeded();
  await chooseA.focus();
  await page.evaluate(() => { window.matchupDocumentToken = 'basketball'; window.scrollBy(0, 100); });
  const top = await scrollY(page);
  assert.ok(top > 0);
  await chooseA.selectOption(alternative);
  await page.waitForURL(url => url.searchParams.get('a') === alternative);
  const neutralUrl = page.url();
  const neutral = await evidence(page);
  assert.notDeepEqual(neutral, initial);
  await assertInPlace(page, 'basketball', top);
  assert.equal(await chooseA.evaluate(control => control === document.activeElement), true);
  const teamACard = page.locator('[data-matchup-side="a"]');
  assert.equal(normalizedName(await teamACard.getByRole('heading', { level: 2 }).innerText()),
    normalizedName(await chooseA.locator('option:checked').textContent()));
  assert.ok(await page.locator(selectorB).evaluate((select, id) =>
    Array.from(select.options).find(option => option.value === id)?.disabled, alternative));
  const home = page.getByRole('button', { name: 'Team A at home' });
  const neutralCourt = page.getByRole('button', { name: 'Neutral court' });
  await home.scrollIntoViewIfNeeded();
  await home.focus();
  const venueTop = await scrollY(page);
  await home.press('Enter');
  await page.waitForURL(url => url.searchParams.get('venue') === 'home');
  const homeUrl = page.url();
  const homeOdds = await evidence(page);
  assert.notDeepEqual(homeOdds, neutral);
  await assertInPlace(page, 'basketball', venueTop);
  assert.equal(await home.getAttribute('aria-pressed'), 'true');
  assert.equal(await home.evaluate(button => button === document.activeElement), true);
  assert.match(await page.locator('[data-matchup-status]').textContent(), /^Matchup updated/);
  assert.equal(await page.locator('[data-matchup-results]').evaluate(result => getComputedStyle(result).animationName), 'none');
  await page.goBack();
  await page.waitForURL(neutralUrl);
  assert.equal(await neutralCourt.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await evidence(page), neutral);
  await page.goBack();
  await page.waitForURL(base + '/basketball/matchup-lab/');
  assert.equal(await page.locator(selectorA).inputValue(), initialA);
  assert.deepEqual(await evidence(page), initial);
  await page.goForward();
  await page.goForward();
  await page.waitForURL(homeUrl);
  assert.equal(await home.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await evidence(page), homeOdds);
  assert.equal(await page.evaluate(() => window.matchupDocumentToken), 'basketball');
  assert.equal(await page.getByRole('searchbox', { name: 'Filter Team A list' }).count(), 1);
  assert.equal(await page.getByRole('searchbox', { name: 'Filter Team B list' }).count(), 1);

  await page.route('**/basketball/matchup-lab/**', async route => {
    if (route.request().resourceType() === 'fetch') await route.fulfill({ status: 503, body: 'Unavailable' });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Team B at home' }).click();
  await page.getByRole('alert').filter({ hasText: 'Previous results are still shown' }).waitFor();
  assert.equal(page.url(), homeUrl);
  assert.deepEqual(await evidence(page), homeOdds);
  await page.unroute('**/basketball/matchup-lab/**');
  await page.getByRole('button', { name: 'Retry', exact: true }).press('Enter');
  await page.waitForURL(url => url.searchParams.get('venue') === 'away');
  assert.notDeepEqual(await evidence(page), homeOdds);
  await inspectBasketballPlayers(page);
  const alternateB = await pickAlternative(page, selectorB, selectorA);
  assert.ok(alternateB);
  await page.locator(selectorB).selectOption(alternateB);
  await page.waitForURL(url => url.searchParams.get('b') === alternateB);
  assert.equal(await chooseA.inputValue(), alternative);
  assert.equal(await page.locator('details[data-matchup-players]').evaluate(disclosure => disclosure.open), true);
  await inspectBasketballPlayers(page);
  const newOdds = await evidence(page);
  await page.reload();
  await page.locator(odds).first().waitFor();
  assert.deepEqual(await evidence(page), newOdds);
  await inspectBasketballPlayers(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(screenshots, `basketball-matchup-${width}.png`), fullPage: true });
}

async function basketballWithoutJavascript() {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(base + '/basketball/matchup-lab/');
    const selectorA = 'select[name="a"]', selectorB = 'select[name="b"]';
    const initial = await evidence(page);
    const alternative = await pickAlternative(page, selectorA, selectorB);
    assert.ok(alternative);
    await page.locator(selectorA).selectOption(alternative);
    await page.locator('select[name="venue"]').selectOption('home');
    await page.getByRole('button', { name: 'Compare teams', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('a') === alternative && url.searchParams.get('venue') === 'home');
    assert.notDeepEqual(await evidence(page), initial, 'The native form returns updated model odds.');
  } finally {
    await context.close();
  }
}

try {
  await mkdir(screenshots, { recursive: true });
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 650 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage();
    const exceptions = [];
    page.on('pageerror', error => exceptions.push(error.message));
    await football(page, width);
    await basketball(page, width);
    assert.deepEqual(exceptions, []);
    await context.close();
  }
  await basketballWithoutJavascript();
  console.log('Matchup Lab passed responsive panel placement, searchable pickers, Players to know, in-place results, shareable state, back/forward, scroll, focus, venue, reduced motion, retry, and the native GET fallback.');
  console.log('Screenshots: ' + screenshots);
} finally {
  await browser.close();
  if (server) await new Promise(resolveClose => server.close(resolveClose));
}
