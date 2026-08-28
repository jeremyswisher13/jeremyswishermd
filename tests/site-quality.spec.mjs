import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const representativeRoutes = [
  { name: 'homepage', path: '/', status: 200 },
  { name: 'PRP guide', path: '/prp-knee-osteoarthritis/', status: 200 },
  { name: 'exercise library', path: '/home-exercise-programs/', status: 200 },
  { name: 'exercise program', path: '/knee-osteoarthritis-exercises/', status: 200 },
  { name: 'sports injury athlete hub', path: '/sports-injuries/', status: 200 },
  { name: 'ankle athlete progression', path: '/ankle-sprain-return-to-sport-exercises/', status: 200 },
  { name: 'patellofemoral athlete progression', path: '/patellofemoral-pain-return-to-running-exercises/', status: 200 },
  { name: 'Achilles athlete progression', path: '/achilles-tendinopathy-return-to-sport-exercises/', status: 200 },
  { name: 'custom 404', path: '/quality-check-missing-page/', status: 404 },
];

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('exercise library combines athlete, region, and search filters and resets cleanly', async ({ page }) => {
  await blockThirdPartyRequests(page);
  await page.goto('/home-exercise-programs/', { waitUntil: 'domcontentloaded' });

  const controls = page.locator('[data-program-filter]');
  const athleteFilter = page.locator('[data-program-audience-filter]');
  const search = page.locator('[data-program-filter] input[data-program-search]');
  const status = page.locator('[data-program-filter-status]');
  const visibleCards = page.locator('#program-grid .program-card:not([hidden])');

  await expect(controls).toBeVisible();
  await page.locator('label[for="hep-athlete-only"]').click();
  await expect(athleteFilter).toBeChecked();
  await expect(visibleCards).toHaveCount(7);
  await expect(status).toHaveText('Showing 7 of 25 athlete progressions.');

  await page.locator('label[for="hep-filter-foot-ankle"]').click();
  await expect(page.locator('#hep-filter-foot-ankle')).toBeChecked();
  await expect(visibleCards).toHaveCount(2);
  await expect(status).toHaveText('Showing 2 of 25 athlete progressions for foot and ankle.');

  await search.fill('cutting');
  await expect(visibleCards).toHaveCount(1);
  await expect(visibleCards).toHaveAttribute('href', '../ankle-sprain-return-to-sport-exercises/');

  await search.fill('patellofemoral');
  await expect(visibleCards).toHaveCount(0);
  await expect(page.locator('[data-program-empty]')).toBeVisible();

  await page.locator('[data-program-reset]').click();
  await expect(athleteFilter).not.toBeChecked();
  await expect(page.locator('#hep-filter-all')).toBeChecked();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(visibleCards).toHaveCount(25);
  await expect(status).toHaveText('Showing all 25 programs.');
});

test('exercise library remains complete without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await blockThirdPartyRequests(page);
  await page.goto('/home-exercise-programs/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('[data-program-filter]')).toBeHidden();
  await expect(page.locator('#program-grid .program-card')).toHaveCount(25);
  expect(await page.locator('#program-grid .program-card').evaluateAll((cards) => (
    cards.every((card) => !card.hidden)
  ))).toBe(true);

  await context.close();
});

for (const video of [
  {
    path: '/ankle-sprain-return-to-sport-exercises/',
    id: 'ga_OAPf6IOI',
    title: 'How to Rehab a Sprained Ankle (Start to Finish)',
  },
  {
    path: '/patellofemoral-pain-return-to-running-exercises/',
    id: 'K3HxB6rAeDo',
    title: 'Patellofemoral Pain | Chondromalacia Patellae | Runner’s Knee (Education | Myths | Exercises)',
  },
  {
    path: '/achilles-tendinopathy-return-to-sport-exercises/',
    id: 'DnxahqgsAEw',
    title: 'Achilles Tendinopathy / Tendinitis / Tendinosis | Heel Pain Rehab (Education, Myths, Exercises)',
  },
]) {
  test(`${video.path} exposes the verified E3 companion without loading YouTube`, async ({ page }) => {
    await blockThirdPartyRequests(page);
    await page.goto(video.path, { waitUntil: 'domcontentloaded' });

    const resource = page.locator('[data-video-resource]');
    await expect(resource).toHaveCount(1);
    await expect(resource).toHaveAttribute('data-video-id', video.id);
    await expect(resource).toHaveAttribute('data-video-title', video.title);
    await expect(resource.locator('[data-load-video]')).toBeVisible();
    await expect(resource.locator('iframe')).toHaveCount(0);
    await expect(resource.getByRole('link', { name: /Watch on YouTube/ })).toHaveAttribute(
      'href',
      new RegExp(`watch\\?v=${video.id}`),
    );
  });
}

for (const program of [
  '/ankle-sprain-return-to-sport-exercises/',
  '/patellofemoral-pain-return-to-running-exercises/',
  '/achilles-tendinopathy-return-to-sport-exercises/',
]) {
  test(`${program} keeps the athlete prescription in print`, async ({ page }) => {
    await blockThirdPartyRequests(page);
    await page.goto(program, { waitUntil: 'domcontentloaded' });
    await page.emulateMedia({ media: 'print' });

    await expect(page.locator('.print-program-header')).toBeVisible();
    await expect(page.locator('.print-program-brief')).toBeVisible();
    await expect(page.locator('#program')).toBeVisible();
    await expect(page.locator('#response')).toBeVisible();
    await expect(page.locator('#progress')).toBeVisible();
    await expect(page.locator('.navbar')).toBeHidden();
  });
}

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
