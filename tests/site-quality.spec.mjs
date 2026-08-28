import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const exercisePrograms = JSON.parse(
  readFileSync(new URL('../scripts/hep-programs.json', import.meta.url), 'utf8'),
);
const exerciseProgramsWithVideo = exercisePrograms.filter((program) => program.video);
const exerciseProgramsWithoutVideo = exercisePrograms.filter((program) => !program.video);

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

for (const program of exerciseProgramsWithVideo) {
  const path = `/${program.slug}/`;

  test(`${path} exposes and configures its verified E3 video companion`, async ({ page }) => {
    await blockThirdPartyRequests(page);
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    const resource = page.locator('[data-video-resource]');
    await expect(resource).toHaveCount(1);
    await expect(resource).toHaveAttribute('data-video-id', program.video.id);
    await expect(resource).toHaveAttribute('data-video-title', program.video.title);

    if (Number.isInteger(program.video.startSeconds)) {
      await expect(resource).toHaveAttribute('data-video-start', String(program.video.startSeconds));
      await expect(resource).toHaveAttribute('data-video-end', String(program.video.endSeconds));
    } else {
      expect(await resource.getAttribute('data-video-start')).toBeNull();
      expect(await resource.getAttribute('data-video-end')).toBeNull();
    }

    const loadButton = resource.locator('[data-load-video]');
    const fallback = resource.getByRole('link', { name: /Watch on YouTube/ });
    await expect(loadButton).toBeVisible();
    await expect(loadButton).toBeEnabled();
    await expect(resource.locator('iframe')).toHaveCount(0);
    await expect(page.locator('#youtube-iframe-api')).toHaveCount(0);
    await expect(fallback).toHaveAttribute('target', '_blank');
    await expect(fallback).toHaveAttribute('rel', /\bnoopener\b/);

    const fallbackUrl = new URL(await fallback.getAttribute('href'));
    expect(fallbackUrl.hostname).toBe('www.youtube.com');
    expect(fallbackUrl.pathname).toBe('/watch');
    expect(fallbackUrl.searchParams.get('v')).toBe(program.video.id);
    if (Number.isInteger(program.video.startSeconds)) {
      expect(fallbackUrl.searchParams.get('t')).toBe(`${program.video.startSeconds}s`);
    } else {
      expect(fallbackUrl.searchParams.has('t')).toBe(false);
    }

    const embeddedPlayer = await resource.evaluate((element) => {
      const loadButton = element.querySelector('[data-load-video]');
      loadButton.click();
      const iframe = element.querySelector('iframe');
      const status = element.closest('.video-section')?.querySelector('[data-video-status]');
      return {
        allow: iframe?.getAttribute('allow') || '',
        allowFullscreen: Boolean(iframe?.allowFullscreen),
        buttonDisabled: loadButton.disabled,
        src: iframe?.src || '',
        stageBusy: element.querySelector('[data-video-stage]')?.getAttribute('aria-busy'),
        status: status?.textContent || '',
        title: iframe?.title || '',
      };
    });

    const iframeUrl = new URL(embeddedPlayer.src);
    expect(iframeUrl.protocol).toBe('https:');
    expect(iframeUrl.hostname).toBe('www.youtube-nocookie.com');
    expect(iframeUrl.pathname).toBe(`/embed/${program.video.id}`);
    expect(iframeUrl.searchParams.get('cc_load_policy')).toBe('1');
    expect(iframeUrl.searchParams.get('cc_lang_pref')).toBe('en');
    expect(iframeUrl.searchParams.get('enablejsapi')).toBe('1');
    expect(iframeUrl.searchParams.get('hl')).toBe('en');
    expect(iframeUrl.searchParams.get('playsinline')).toBe('1');
    expect(iframeUrl.searchParams.get('rel')).toBe('0');
    expect(iframeUrl.searchParams.get('origin')).toBe('http://127.0.0.1:4173');
    expect(iframeUrl.searchParams.has('autoplay')).toBe(false);

    if (Number.isInteger(program.video.startSeconds)) {
      expect(iframeUrl.searchParams.get('start')).toBe(String(program.video.startSeconds));
      expect(iframeUrl.searchParams.get('end')).toBe(String(program.video.endSeconds));
    } else {
      expect(iframeUrl.searchParams.has('start')).toBe(false);
      expect(iframeUrl.searchParams.has('end')).toBe(false);
    }

    expect(embeddedPlayer.allow).not.toMatch(/\bautoplay\b/);
    expect(embeddedPlayer.allowFullscreen).toBe(true);
    expect(embeddedPlayer.buttonDisabled).toBe(true);
    expect(embeddedPlayer.stageBusy).toBe('true');
    expect(embeddedPlayer.status).toBe('Loading the YouTube video player.');
    expect(embeddedPlayer.title).toBe(`${program.video.title} | E3 Rehab`);
  });
}

for (const program of exerciseProgramsWithoutVideo) {
  const path = `/${program.slug}/`;

  test(`${path} does not present a video when no verified companion is configured`, async ({ page }) => {
    await blockThirdPartyRequests(page);
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('[data-video-resource]')).toHaveCount(0);
    await expect(page.locator('[data-video-status]')).toHaveCount(0);
    await expect(page.locator('.video-section')).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('a[href*="youtube.com/watch"]')).toHaveCount(0);
  });
}

test('an E3 companion announces success and moves focus into the loaded player', async ({ page }) => {
  await page.addInitScript(() => {
    window.YT = {
      Player: class {
        constructor(iframe, options) {
          this.iframe = iframe;
          queueMicrotask(() => options.events.onReady());
        }

        destroy() {}

        getIframe() {
          return this.iframe;
        }
      },
    };
  });
  await blockThirdPartyRequests(page);
  await page.goto(`/${exerciseProgramsWithVideo[0].slug}/`, { waitUntil: 'domcontentloaded' });

  const resource = page.locator('[data-video-resource]');
  const status = page.locator('[data-video-status]');
  await resource.locator('[data-load-video]').click();

  await expect(resource).toHaveClass(/\bis-loaded\b/);
  await expect(resource).not.toHaveClass(/\bis-loading\b/);
  await expect(resource.locator('[data-video-stage]')).not.toHaveAttribute('aria-busy');
  await expect(status).toHaveText('YouTube video player loaded.');
  await expect(resource.locator('iframe')).toBeFocused();
});

test('a failed E3 companion restores a focused retry button and can then load', async ({ page }) => {
  await page.addInitScript(() => {
    window.__e3PlayerShouldFail = true;
    window.YT = {
      Player: class {
        constructor(iframe, options) {
          this.iframe = iframe;
          this.options = options;
          queueMicrotask(() => {
            if (window.__e3PlayerShouldFail) options.events.onError();
            else options.events.onReady();
          });
        }

        destroy() {}

        getIframe() {
          return this.iframe;
        }
      },
    };
  });
  await blockThirdPartyRequests(page);
  await page.goto(`/${exerciseProgramsWithVideo[0].slug}/`, { waitUntil: 'domcontentloaded' });

  const resource = page.locator('[data-video-resource]');
  const status = page.locator('[data-video-status]');
  await resource.locator('[data-load-video]').click();

  const retryButton = resource.locator('[data-load-video]');
  await expect(retryButton).toBeVisible();
  await expect(retryButton).toBeEnabled();
  await expect(retryButton).toContainText('Retry video player');
  await expect(retryButton).toBeFocused();
  await expect(resource.locator('iframe')).toHaveCount(0);
  await expect(status).toHaveText(
    'The embedded player could not load. Retry or use the Watch on YouTube link below.',
  );

  await page.evaluate(() => {
    window.__e3PlayerShouldFail = false;
  });
  await retryButton.click();

  await expect(resource).toHaveClass(/\bis-loaded\b/);
  await expect(status).toHaveText('YouTube video player loaded.');
  await expect(resource.locator('iframe')).toBeFocused();
});

for (const program of exercisePrograms) {
  const path = `/${program.slug}/`;

  test(`${path} keeps the complete prescription and canonical guide link in print`, async ({ page }) => {
    await blockThirdPartyRequests(page);
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.emulateMedia({ media: 'print' });

    await expect(page.locator('.print-program-header')).toBeVisible();
    await expect(page.locator('.print-program-brief')).toBeVisible();
    await expect(page.locator('#program')).toBeVisible();
    await expect(page.locator('#response')).toBeVisible();
    await expect(page.locator('#progress')).toBeVisible();
    await expect(page.locator('.print-progress-tracker')).toBeVisible();
    await expect(page.locator('.print-program-footer')).toBeVisible();
    await expect(page.locator('.navbar')).toBeHidden();
    await expect(page.locator('[data-print-program]').first()).toBeHidden();

    const canonical = `https://jeremyswishermd.com/${program.slug}/`;
    const canonicalLink = page.locator(`.print-program-footer a[href="${canonical}"]`);
    await expect(canonicalLink).toHaveCount(1);
    await expect(canonicalLink).toBeVisible();
    await expect(canonicalLink).toHaveText(canonical);
  });
}

test('the print control opens the native dialog and exposes its status lifecycle', async ({ page }) => {
  await page.addInitScript(() => {
    window.__printCallCount = 0;
    window.print = () => {
      window.__printCallCount += 1;
    };
  });
  await blockThirdPartyRequests(page);
  await page.goto(`/${exercisePrograms[0].slug}/`, { waitUntil: 'domcontentloaded' });

  const openedState = await page.locator('[data-print-program]').first().evaluate((button) => {
    button.click();
    const buttons = [...document.querySelectorAll('[data-print-program]')];
    return {
      bodyIsPrinting: document.body.classList.contains('is-printing'),
      buttonsAreBusy: buttons.every((item) => item.disabled && item.getAttribute('aria-busy') === 'true'),
      callCount: window.__printCallCount,
      status: document.getElementById('printStatus')?.textContent || '',
    };
  });

  expect(openedState).toEqual({
    bodyIsPrinting: true,
    buttonsAreBusy: true,
    callCount: 1,
    status: 'Print dialog opened. Choose a printer or Save as PDF.',
  });

  const closedState = await page.evaluate(() => {
    window.dispatchEvent(new Event('afterprint'));
    const buttons = [...document.querySelectorAll('[data-print-program]')];
    return {
      bodyIsPrinting: document.body.classList.contains('is-printing'),
      buttonsAreReady: buttons.every((item) => !item.disabled && !item.hasAttribute('aria-busy')),
      status: document.getElementById('printStatus')?.textContent || '',
    };
  });

  expect(closedState).toEqual({
    bodyIsPrinting: false,
    buttonsAreReady: true,
    status: 'Print dialog closed. Your program is ready on the page.',
  });
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
