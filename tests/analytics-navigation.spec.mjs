import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://jeremyswishermd.com';
test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
const contentTypes = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.avif': 'image/avif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

// Exercise the production-host branch without contacting the real site,
// analytics service, appointment service, or any other external endpoint.
async function useOfflineProduction(context, { mode = 'no-callback', privacy = null } = {}) {
  const events = [];
  const requests = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (url.origin !== origin) return route.abort();
    const pathname = decodeURIComponent(url.pathname);
    const file = resolve(root, '.' + pathname, ...(pathname.endsWith('/') ? ['index.html'] : []));
    if (!file.startsWith(root + sep)) return route.abort();
    try {
      return await route.fulfill({
        status: 200,
        contentType: contentTypes[extname(file)] || 'application/octet-stream',
        body: await readFile(file),
      });
    } catch {
      return route.fulfill({ status: 404, body: 'Not found' });
    }
  });
  await context.exposeBinding('__recordSiteEvent', (_, event) => events.push(event));
  await context.addInitScript(({ mode, privacy }) => {
    if (privacy === 'gpc') Object.defineProperty(navigator, 'globalPrivacyControl', { value: true });
    if (privacy === 'dnt') Object.defineProperty(navigator, 'doNotTrack', { value: '1' });
    if (mode === 'blocked') return;
    window.sa_loaded = mode !== 'not-loaded';
    const nativeSetTimeout = window.setTimeout.bind(window);
    let navigationTimerArmed = false;
    window.setTimeout = (callback, delay, ...args) => {
      if (delay === 350) navigationTimerArmed = true;
      return nativeSetTimeout(callback, delay, ...args);
    };
    window.sa_event = (name, metadata, callback) => {
      window.__recordSiteEvent({ name, metadata, navigationTimerArmed, hasCallback: typeof callback === 'function' });
      if (mode === 'throw') throw new Error('Simulated analytics failure');
      if (mode === 'callback' && callback) callback();
      if (mode === 'late-callback' && callback) nativeSetTimeout(callback, 700);
    };
  }, { mode, privacy });
  return { events, requests };
}

for (const mode of ['throw', 'no-callback', 'callback', 'late-callback', 'not-loaded', 'blocked']) {
  test(`Locations navigation survives analytics mode: ${mode}`, async ({ context, page }) => {
    const { events, requests } = await useOfflineProduction(context, { mode });
    await page.goto(origin + '/?audit_query=PRIVATE_SENTINEL#PRIVATE_SENTINEL');
    await page.getByRole('navigation', { name: 'Primary navigation', exact: true })
      .getByRole('link', { name: 'Locations', exact: true }).click();
    await expect(page).toHaveURL(origin + '/locations/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Westwood and West Hills');
    expect(requests.filter(url => url === origin + '/locations/')).toHaveLength(1);
    if (mode !== 'blocked') {
      const click = events.find(event => event.name === 'location_page_click');
      expect(click).toBeDefined();
      expect(click.metadata).toEqual({ page: '/', cta_location: 'navigation' });
      expect(click.hasCallback).toBe(mode !== 'not-loaded');
      if (click.hasCallback) expect(click.navigationTimerArmed).toBe(true);
      expect(JSON.stringify(events)).not.toContain('PRIVATE_SENTINEL');
    }
  });
}

for (const privacy of ['gpc', 'dnt']) {
  test(`${privacy} suppresses analytics without breaking navigation`, async ({ context, page }) => {
    const { events, requests } = await useOfflineProduction(context, { privacy });
    await page.goto(origin);
    await expect(page.locator('script[data-site-analytics]')).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Primary navigation', exact: true })
      .getByRole('link', { name: 'Locations', exact: true }).click();
    await expect(page).toHaveURL(origin + '/locations/');
    await expect(page.locator('script[data-site-analytics]')).toHaveCount(0);
    expect(events).toEqual([]);
    expect(requests.some(url => url.includes('simpleanalytics'))).toBe(false);
  });
}

test('404 page suppresses analytics', async ({ context, page }) => {
  const { events, requests } = await useOfflineProduction(context);
  await page.goto(origin + '/404.html');
  await expect(page.locator('script[data-site-analytics]')).toHaveCount(0);
  expect(events).toEqual([]);
  expect(requests.some(url => url.includes('simpleanalytics'))).toBe(false);
});

test('measurement leaves phone, new-tab, and modified clicks to the browser', async ({ context, page }) => {
  const { events } = await useOfflineProduction(context, { mode: 'throw' });
  await page.goto(origin);
  const results = await page.evaluate(() => {
    const clicks = [];
    const selectors = [
      ['phone', 'a[href^="tel:"]', {}],
      ['new-tab', 'a[href*="cloud.h.uclahealth.org/appointment-request"]', {}],
      ['control-click', 'nav a[href="locations/"]', { ctrlKey: true }],
      ['command-click', 'nav a[href="locations/"]', { metaKey: true }],
      ['middle-click', 'nav a[href="locations/"]', { type: 'auxclick', button: 1 }],
    ];
    for (const [name, selector, options] of selectors) {
      const anchor = document.querySelector(selector);
      anchor.addEventListener(options.type || 'click', event => {
        clicks.push({ name, preventedByMeasurement: event.defaultPrevented });
        // Suppress only the test's native action; never open a phone app or submit a request.
        event.preventDefault();
      }, { once: true });
      anchor.dispatchEvent(new MouseEvent(options.type || 'click', { bubbles: true, cancelable: true, button: 0, ...options }));
    }
    return clicks;
  });
  expect(results).toHaveLength(5);
  expect(results.every(result => result.preventedByMeasurement === false)).toBe(true);
  await expect.poll(() => events.filter(event => event.name !== 'page_view').length).toBe(5);
  expect(events.filter(event => event.name !== 'page_view').every(event => !event.hasCallback)).toBe(true);
});
