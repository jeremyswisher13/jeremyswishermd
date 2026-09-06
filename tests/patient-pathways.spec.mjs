import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function localOnly(context, baseURL) {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
}

test('homepage puts consultation routes and named booking guidance before biography', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Nonsurgical care for joint pain and sports injuries in Los Angeles.');
  await expect(page.locator('.hero-description')).toHaveText('Appointments in Westwood and West Hills, with a treatment plan built around your daily life and activity goals.');
  await expect(page.locator('.hero-kicker')).toHaveText('Jeremy Swisher, MD | UCLA Sports Medicine');
  await expect(page.locator('.hero-booking-note')).toContainText('Jeremy Swisher, MD');
  await expect(page.locator('.hero-booking-note')).toContainText('Westwood or West Hills');
  for (const path of ['sports-injuries/', 'tendon-pain/', 'knee-hip-shoulder-pain/']) {
    await expect(page.locator(`#expertise a[href="${path}"]`)).toHaveCount(1);
  }
  const care = await page.locator('#expertise').boundingBox();
  const about = await page.locator('#about').boundingBox();
  expect(care.y + care.height).toBeLessThanOrEqual(about.y);
  await page.locator('.hero-insurance-link').click();
  await expect(page).toHaveURL(/\/locations\/#insurance$/);
  await expect(page.locator('#insurance')).toContainText('A consultation and a procedure are separate coverage questions.');
});

test('referral handoff links to the named physician instructions and downloadable PDF', async ({ context, page, request, baseURL }) => {
  await localOnly(context, baseURL);
  await page.goto('/');
  await page.locator('.hero-referral-link').click();
  await expect(page).toHaveURL(/\/locations\/#referrals$/);
  const referral = page.locator('#referrals');
  await expect(referral).toContainText('Requested physician: Jeremy Swisher, MD, Sports Medicine.');
  await expect(referral).toContainText('310-301-5391');
  const link = referral.getByRole('link', { name: 'Download the referral guide (PDF)' });
  await expect(link).toHaveAttribute('download', '');
  const response = await request.get(new URL(await link.getAttribute('href'), page.url()).href);
  expect(response.status()).toBe(200);
  expect((await response.body()).subarray(0, 5).toString()).toBe('%PDF-');
});

for (const path of ['/', '/locations/']) {
  test(`mobile navigation remains in flow without JavaScript: ${path}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    await localOnly(context, baseURL);
    const page = await context.newPage();
    await page.goto(new URL(path, baseURL).href);
    await expect(page.locator('#navLinks a')).toHaveCount(7);
    const nav = await page.locator('#navLinks').boundingBox();
    const main = await page.locator('main').boundingBox();
    expect(nav.y + nav.height).toBeLessThanOrEqual(main.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.locator('#navLinks').getByRole('link', { name: 'Appointments & Insurance' })).toBeVisible();
    await context.close();
  });
}

test('expanded appointment and insurance page has no accessibility violations', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await page.goto('/locations/');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('missing nested pages retain root-relative patient navigation', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  const response = await page.goto('/missing/nested/page/');
  expect(response.status()).toBe(404);
  const hrefs = await page.locator('#navLinks a').evaluateAll(links => links.map(link => link.getAttribute('href')));
  expect(hrefs).toEqual([
    '/#expertise', '/locations/#scheduling', '/home-exercise-programs/',
    '/locations/', '/#about', '/#publications', 'tel:310-319-1234',
  ]);
});

test('delayed navigation enhancement does not move the page content', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  let releaseScript;
  const scriptGate = new Promise(resolve => { releaseScript = resolve; });
  await context.route('**/script.js?*', async route => {
    await scriptGate;
    await route.continue();
  });
  await page.goto('/knee-osteoarthritis-exercises/', { waitUntil: 'commit' });
  try {
    await expect(page.locator('main')).toBeVisible();
    await page.waitForFunction(() => document.querySelector('.navbar')
      && getComputedStyle(document.querySelector('.navbar')).position === 'fixed');
    await expect(page.locator('html')).not.toHaveClass(/nav-ready/);
    const before = await page.locator('main').boundingBox();
    releaseScript();
    await expect(page.locator('html')).toHaveClass(/nav-ready/);
    const after = await page.locator('main').boundingBox();
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  } finally {
    releaseScript();
  }
});
