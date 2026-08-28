import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const representativeRoutes = [
  { name: 'homepage', path: '/', status: 200 },
  { name: 'PRP guide', path: '/prp-knee-osteoarthritis/', status: 200 },
  { name: 'exercise library', path: '/home-exercise-programs/', status: 200 },
  { name: 'exercise program', path: '/knee-osteoarthritis-exercises/', status: 200 },
  { name: 'custom 404', path: '/quality-check-missing-page/', status: 404 },
];

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

async function blockThirdPartyRequests(page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      await route.continue();
    } else {
      await route.abort();
    }
  });
}

async function waitForStableAccessibilityState(page) {
  await page.waitForLoadState('load');
  await page.evaluate(async () => {
    await document.fonts?.ready;
  });
  await expect(page.locator('.fade-in')).toHaveCount(0);
}

async function backgroundIsIsolated(locator) {
  return locator.evaluate((element) => (
    element.inert === true || element.getAttribute('aria-hidden') === 'true'
  ));
}

async function backgroundIsRestored(locator) {
  return locator.evaluate((element) => (
    element.inert === false && element.getAttribute('aria-hidden') !== 'true'
  ));
}

test.describe('representative rendered pages', () => {
  for (const route of representativeRoutes) {
    test(`${route.name} renders and has no axe violations`, async ({ page }) => {
      await blockThirdPartyRequests(page);
      const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });

      expect(response?.status()).toBe(route.status);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1);
      await waitForStableAccessibilityState(page);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
});

test('mobile navigation isolates the page and keeps keyboard focus inside the menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await blockThirdPartyRequests(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const toggle = page.locator('#navToggle');
  const navigation = page.locator('#navLinks');
  const main = page.locator('main');
  const footer = page.locator('footer');
  const logo = page.locator('.nav-logo');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(navigation).toHaveClass(/\bopen\b/);
  expect(await backgroundIsIsolated(main)).toBe(true);
  expect(await backgroundIsIsolated(footer)).toBe(true);
  expect(await backgroundIsIsolated(logo)).toBe(true);
  expect(await navigation.evaluate((element) => element.inert)).toBe(false);
  await expect(page.locator('#navLinks a').first()).toBeFocused();

  const lastNavigationLink = page.locator('#navLinks a').last();
  await lastNavigationLink.focus();
  await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(lastNavigationLink).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  expect(await backgroundIsRestored(main)).toBe(true);
  expect(await backgroundIsRestored(footer)).toBe(true);
  expect(await backgroundIsRestored(logo)).toBe(true);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(navigation).not.toHaveClass(/\bopen\b/);
  expect(await backgroundIsRestored(main)).toBe(true);
  expect(await backgroundIsRestored(footer)).toBe(true);
  expect(await backgroundIsRestored(logo)).toBe(true);
});

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`homepage serves optimized responsive images on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await blockThirdPartyRequests(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const pictures = page.locator('picture');
    const pictureCount = await pictures.count();
    expect(pictureCount).toBeGreaterThanOrEqual(8);
    for (let index = 0; index < pictureCount; index += 1) {
      const optimizedSources = pictures.nth(index).locator(
        'source[type="image/avif"], source[type="image/webp"]',
      );
      await expect(optimizedSources.first()).toHaveAttribute('srcset', /\.(?:avif|webp)/);
    }

    await page.locator('picture img').evaluateAll((images) => {
      for (const image of images) image.loading = 'eager';
    });
    await expect.poll(async () => page.locator('picture img').evaluateAll((images) => (
      images.every((image) => Boolean(image.currentSrc))
    ))).toBe(true);

    const currentSources = await page.locator('picture img').evaluateAll((images) => (
      images.map((image) => new URL(image.currentSrc, document.baseURI).pathname)
    ));

    for (const source of currentSources) {
      expect(source, `Expected an optimized currentSrc, received ${source}`).toMatch(/\.(?:avif|webp)$/);
    }
  });
}
