import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createBasketballPreview } from './serve-basketball-preview.mjs';

const { server } = await createBasketballPreview();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.QUALITY_BROWSER ? { executablePath: process.env.QUALITY_BROWSER } : {}) });
const screenshots = resolve(process.env.MATCHUP_SCREENSHOTS || '../tmp/gd-one-platform/matchup');
const odds = '.matchup-win-chance strong';
const scrollY = page => page.evaluate(() => window.scrollY);
const evidence = page => page.locator(odds).allTextContents();

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
  const initial = await evidence(page);
  const initialA = await page.locator(selectorA).inputValue();
  const alternative = await pickAlternative(page, selectorA, selectorB);
  assert.ok(alternative);
  await page.evaluate(() => { window.matchupDocumentToken = 'basketball'; });
  await page.locator(selectorA).selectOption(alternative);
  assert.deepEqual(await evidence(page), initial);
  const compare = page.getByRole('button', { name: 'Compare teams' });
  await compare.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 140));
  await compare.focus();
  const top = await scrollY(page);
  assert.ok(top > 0);
  await compare.press('Enter');
  await page.waitForURL(url => url.searchParams.get('a') === alternative);
  const neutralUrl = page.url();
  const neutral = await evidence(page);
  assert.notDeepEqual(neutral, initial);
  await assertInPlace(page, 'basketball', top);
  assert.equal(await compare.evaluate(button => button === document.activeElement), true);
  const venue = page.getByLabel('Venue', { exact: true });
  await venue.selectOption('home');
  assert.deepEqual(await evidence(page), neutral);
  await compare.press('Enter');
  await page.waitForURL(url => url.searchParams.get('venue') === 'home');
  const homeUrl = page.url();
  const homeOdds = await evidence(page);
  assert.notDeepEqual(homeOdds, neutral);
  await assertInPlace(page, 'basketball', top);
  assert.match(await page.locator('[data-matchup-status]').textContent(), /^Matchup updated/);
  assert.equal(await page.locator('[data-matchup-results]').evaluate(result => getComputedStyle(result).animationName), 'none');
  await page.goBack();
  await page.waitForURL(neutralUrl);
  assert.equal(await venue.inputValue(), 'neutral');
  assert.deepEqual(await evidence(page), neutral);
  await page.goBack();
  await page.waitForURL(base + '/basketball/matchup-lab/');
  assert.equal(await page.locator(selectorA).inputValue(), initialA);
  assert.deepEqual(await evidence(page), initial);
  await page.goForward();
  await page.goForward();
  await page.waitForURL(homeUrl);
  assert.equal(await venue.inputValue(), 'home');
  assert.deepEqual(await evidence(page), homeOdds);
  assert.equal(await page.evaluate(() => window.matchupDocumentToken), 'basketball');

  await page.route('**/basketball/matchup-lab/**', async route => {
    if (route.request().resourceType() === 'fetch') await route.fulfill({ status: 503, body: 'Unavailable' });
    else await route.continue();
  });
  await venue.selectOption('away');
  await compare.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'Previous results are still shown' }).waitFor();
  assert.equal(page.url(), homeUrl);
  assert.deepEqual(await evidence(page), homeOdds);
  assert.equal(await venue.inputValue(), 'away');
  await page.unroute('**/basketball/matchup-lab/**');
  await compare.press('Enter');
  await page.waitForURL(url => url.searchParams.get('venue') === 'away');
  assert.notDeepEqual(await evidence(page), homeOdds);
  const newOdds = await evidence(page);
  await page.reload();
  await page.locator(odds).first().waitFor();
  assert.deepEqual(await evidence(page), newOdds);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(screenshots, `basketball-matchup-${width}.png`), fullPage: true });
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
  console.log('Matchup Lab passed football and basketball in-place results, shareable state, back/forward, scroll, focus, venue, reduced motion, and basketball retry at four widths.');
  console.log('Screenshots: ' + screenshots);
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
