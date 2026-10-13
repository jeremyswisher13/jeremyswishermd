import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const programs = JSON.parse(readFileSync(new URL('../scripts/hep-programs.json', import.meta.url), 'utf8'));
const knee = programs.find(program => program.slug === 'knee-osteoarthritis-exercises');
const storageKey = `swishermd:hep-progress:v1:${knee.slug}`;
const session = page => page.locator('[data-hep-session]');

test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' });

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
});

test('mobile navigation closes with Escape and reaches the exercise library', async ({ page }) => {
  await page.goto('/');
  const toggle = page.locator('#navToggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#navLinks')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.locator('#navLinks').getByRole('link', { name: 'Exercise Library', exact: true }).click();
  await expect(page).toHaveURL(/\/home-exercise-programs\/$/);
  await expect(page.locator('input[data-program-search]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('mobile search and combined filters remain usable without recording the query', async ({ page }) => {
  await page.goto('/home-exercise-programs/');
  const search = page.locator('input[data-program-search]');
  const cards = page.locator('#program-grid .program-card:not([hidden])');
  await search.fill('frozen shoulder');
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute('href', '../adhesive-capsulitis-exercises/');
  await search.fill('sprained ankle');
  await expect(cards).toHaveCount(2);
  expect(await cards.evaluateAll(items => items.map(item => item.getAttribute('href')).sort())).toEqual([
    '../ankle-sprain-return-to-sport-exercises/', '../lateral-ankle-sprain-exercises/',
  ]);
  await search.fill('planter fasciitis');
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute('href', '../plantar-fasciitis-exercises/');
  await search.fill('torn rotator cuff');
  await expect(cards).toHaveCount(0);
  await page.locator('[data-program-search-clear]').click();
  await expect(search).toBeFocused();
  await expect(cards).toHaveCount(programs.length);
  await page.locator('label[for="hep-athlete-only"]').click();
  await page.locator('label[for="hep-filter-foot-ankle"]').click();
  await search.fill('cutting');
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute('href', '../ankle-sprain-return-to-sport-exercises/');
  await search.fill('no matching program');
  await expect(page.locator('[data-program-empty]')).toBeVisible();
  await page.locator('[data-program-reset]').click();
  await expect(search).toHaveValue('');
  await expect(cards).toHaveCount(programs.length);
  expect(await page.evaluate(() => [location.search, localStorage.length, sessionStorage.length])).toEqual(['', 0, 0]);
});

for (const width of [320, 390]) {
  test(`pending shared script leaves the hero unobstructed at ${width}px`, async ({ context, page }) => {
    await page.setViewportSize({ width, height: 844 });
    let releaseScript;
    const heldScript = new Promise(resolve => { releaseScript = resolve; });
    await context.route('**/script.js?*', async route => {
      await heldScript;
      await route.continue();
    });
    await page.goto('/', { waitUntil: 'commit' });
    try {
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('html')).not.toHaveClass(/nav-ready/);
      await expect(page.locator('#navToggle')).toBeHidden();
      // Waiting for document.fonts.ready can wait for the held deferred script
      // in some engines. Observe loaded local faces without waiting for onload.
      await expect.poll(() => page.evaluate(() => ['Inter', 'Newsreader'].every(family => [...document.fonts]
        .some(font => font.family.replace(/['"]/g, '') === family && font.status === 'loaded')))).toBe(true);
      const heading = await page.locator('h1').boundingBox();
      const header = await page.locator('.navbar').boundingBox();
      const navigation = await page.locator('#navLinks').boundingBox();
      expect(navigation.y + navigation.height).toBeLessThanOrEqual(header.y + header.height + 1);
      expect(header.y + header.height).toBeLessThanOrEqual(heading.y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      releaseScript();
      await expect(page.locator('html')).toHaveClass(/nav-ready/);
      await expect(page.locator('#navToggle')).toBeVisible();
      const enhancedHeading = await page.locator('h1').boundingBox();
      expect(Math.abs(enhancedHeading.y - heading.y)).toBeLessThanOrEqual(1);
    } finally {
      releaseScript();
    }
  });
}

test('the mobile exercise library sharing entry reaches a usable chooser', async ({ page }) => {
  await page.goto('/home-exercise-programs/');
  const share = page.getByRole('link', { name: 'Share a program', exact: true });
  await expect(share).toHaveCount(1);
  await expect(share).toBeVisible();
  const bounds = await share.boundingBox();
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  expect(bounds.width).toBeGreaterThanOrEqual(44);
  await share.click();
  await expect(page).toHaveURL(/\/share-program\/$/);
  await expect(page.getByLabel('Home exercise program', { exact: true })).toBeEnabled();
});

test('opted-in exercise progress survives a reload in WebKit', async ({ page }) => {
  await page.goto(`/${knee.slug}/`);
  await expect(session(page)).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  await session(page).locator('[data-hep-storage]').check();
  await session(page).locator('[data-hep-start]').click();
  for (let index = 0; index < knee.exercises.length; index += 1) {
    await session(page).locator('[data-hep-done]').click();
  }
  await session(page).getByLabel('Notes (optional)', { exact: true }).fill('WebKit progress smoke check');
  await session(page).locator('[data-hep-save]').click();
  await expect(session(page).locator('[data-hep-history]')).toContainText('WebKit progress smoke check');
  await page.reload();
  await expect(session(page).locator('[data-hep-storage]')).toBeChecked();
  await session(page).locator('[data-hep-log]').click();
  await expect(session(page).locator('[data-hep-history]')).toContainText('WebKit progress smoke check');
});

test('blocked device storage still permits a guided session', async ({ context, page }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() {
      throw new DOMException('Storage is unavailable', 'SecurityError');
    } });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/${knee.slug}/`);
  await session(page).locator('[data-hep-start]').click();
  await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[0].name);
  await session(page).locator('[data-hep-done]').click();
  await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[1].name);
  expect(errors).toEqual([]);
});

test('mobile sharing renders the canonical QR link and supports clipboard denial', async ({ context, page }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { throw new DOMException('Clipboard is unavailable', 'NotAllowedError'); },
    } });
  });
  const program = programs.find(program => program.slug === 'advanced-meniscus-rehabilitation-exercises');
  const canonical = `https://jeremyswishermd.com/${program.slug}/`;
  await page.goto(`/share-program/#program=${program.slug}`);
  await expect(page.getByLabel('Home exercise program', { exact: true })).toHaveValue(program.slug);
  await expect(page.locator('[data-clinic-title]')).toHaveText(program.title);
  await expect(page.locator('[data-clinic-qr] svg')).toBeVisible();
  await expect(page.locator('[data-clinic-open]')).toHaveAttribute('href', canonical);
  await page.getByRole('button', { name: 'Copy program link', exact: true }).click();
  const link = page.getByLabel('Program link', { exact: true });
  await expect(link).toBeFocused();
  expect(await link.evaluate(element => element.value.slice(element.selectionStart, element.selectionEnd))).toBe(canonical);
  await expect(page.locator('[data-clinic-status]')).toContainText('The program link is selected');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
