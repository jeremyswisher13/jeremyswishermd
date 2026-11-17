import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context, page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

async function waitForEnhancement(page) {
  await expect(page.locator('html')).toHaveClass(/\bnav-ready\b/);
  await page.evaluate(() => document.fonts.ready);
}

test('printing reveals closed FAQs and sources, then restores the visitor disclosure state', async ({ page }) => {
  await page.goto('/knee-osteoarthritis/');
  await waitForEnhancement(page);
  const faqs = page.locator('details.faq-item');
  const sources = page.locator('details.oa-source-details');
  await expect(faqs.first()).not.toHaveAttribute('open', '');
  await expect(sources).not.toHaveAttribute('open', '');

  // A disclosure the visitor already opened should remain open afterward.
  await faqs.nth(1).evaluate(disclosure => { disclosure.open = true; });
  const initialState = await page.locator('details:not([data-page-jump])')
    .evaluateAll(disclosures => disclosures.map(disclosure => disclosure.open));

  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('body')).toHaveClass(/\bis-printing\b/);
  expect(await page.locator('details:not([data-page-jump])')
    .evaluateAll(disclosures => disclosures.every(disclosure => disclosure.open))).toBe(true);
  await expect(faqs.first().locator('p')).toBeVisible();
  await expect(page.locator('#source-cochrane')).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('body')).not.toHaveClass(/\bis-printing\b/);
  expect(await page.locator('details:not([data-page-jump])')
    .evaluateAll(disclosures => disclosures.map(disclosure => disclosure.open))).toEqual(initialState);
  await expect(faqs.first().locator('p')).toBeHidden();
  await expect(page.locator('#source-cochrane')).toBeHidden();
  await expect(faqs.nth(1).locator('p')).toBeVisible();
});

test('beforeprint reveals homepage cards that have never entered the viewport', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await waitForEnhancement(page);
  const contactCard = page.locator('#contact .contact-card').first();
  expect(await contactCard.evaluate(card => card.getBoundingClientRect().top)).toBeGreaterThan(768);
  await expect(contactCard).toHaveClass(/\bfade-in\b/);
  await expect(contactCard).toHaveCSS('opacity', '0');

  // Inspect in the same task as beforeprint: a print snapshot cannot wait for
  // the cards' screen hover transitions to finish.
  const printStyles = await page.evaluate(() => {
    window.dispatchEvent(new Event('beforeprint'));
    return [...document.querySelectorAll('.media-card, .coverage-category, .contact-card')]
      .map(card => {
        const style = getComputedStyle(card);
        return { opacity: style.opacity, transform: style.transform, transition: style.transitionDuration };
      });
  });
  expect(printStyles.length).toBeGreaterThan(0);
  expect(printStyles.every(style => style.opacity === '1'
    && style.transform === 'none' && style.transition === '0s')).toBe(true);
  await page.emulateMedia({ media: 'print' });
  expect(await page.locator('.media-card, .coverage-category, .contact-card')
    .evaluateAll(cards => cards.every(card => {
      const style = getComputedStyle(card);
      return style.opacity === '1' && style.transitionDuration === '0s';
    }))).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
});

test('print media makes faded content visible and removes fixed controls and sticky positioning', async ({ page }) => {
  await page.goto('/');
  await waitForEnhancement(page);
  await page.emulateMedia({ media: 'print', reducedMotion: 'no-preference' });
  const contactCard = page.locator('#contact .contact-card').first();
  // Retain a fade state to exercise the CSS fallback independently of beforeprint.
  await contactCard.evaluate(card => {
    card.classList.remove('visible');
    card.classList.add('fade-in');
  });
  await expect(contactCard).toHaveCSS('opacity', '1');
  await expect(contactCard).toHaveCSS('transform', 'none');
  await expect(contactCard).toBeVisible();
  await expect(page.locator('.navbar')).toHaveCSS('display', 'none');
  await expect(page.locator('.skip-link')).toHaveCSS('display', 'none');

  await page.goto('/knee-osteoarthritis/');
  await waitForEnhancement(page);
  await expect(page.locator('.mobile-call-bar')).toHaveCSS('display', 'none');
  await expect(page.locator('.landing-article')).toBeVisible();

  await page.goto('/a2m-knee-osteoarthritis/');
  await waitForEnhancement(page);
  await expect(page.locator('.landing-sidebar')).toHaveCSS('position', 'static');
  await expect(page.locator('.landing-sidebar')).toHaveCSS('top', 'auto');
  await expect(page.locator('.landing-article')).toBeVisible();
});

test('a tall desktop sidebar scrolls normally and becomes sticky again when the viewport fits it', async ({ page }) => {
  await page.goto('/hyaluronic-acid-knee-osteoarthritis/');
  await waitForEnhancement(page);
  const sidebar = page.locator('.landing-sidebar');
  await expect(sidebar).toHaveClass(/\blanding-sidebar-unstuck\b/);
  await expect(sidebar).toHaveCSS('position', 'static');

  await page.setViewportSize({ width: 1366, height: 1200 });
  await expect(sidebar).not.toHaveClass(/\blanding-sidebar-unstuck\b/);
  await expect(sidebar).toHaveCSS('position', 'sticky');

  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(sidebar).toHaveCSS('position', 'static');
});

test('a shorter A2M sidebar remains sticky at desktop laptop height', async ({ page }) => {
  await page.goto('/a2m-knee-osteoarthritis/');
  await waitForEnhancement(page);
  const sidebar = page.locator('.landing-sidebar');
  await expect(sidebar).not.toHaveClass(/\blanding-sidebar-unstuck\b/);
  await expect(sidebar).toHaveCSS('position', 'sticky');
  const requiredHeight = await sidebar.evaluate(element => (
    element.offsetHeight + Number.parseFloat(getComputedStyle(element).top) + 16
  ));
  expect(requiredHeight).toBeLessThanOrEqual(768);
});

test('a numbered citation reveals its initially closed source and lands on it', async ({ page }) => {
  await page.goto('/knee-osteoarthritis/');
  await waitForEnhancement(page);
  const sources = page.locator('details.oa-source-details');
  await expect(page.locator('#source-cochrane')).toBeHidden();
  await page.locator('a.oa-cite[href="#source-cochrane"]').first().click();
  await expect(page).toHaveURL(/#source-cochrane$/);
  await expect(sources).toHaveAttribute('open', '');
  const source = page.locator('#source-cochrane');
  await expect(source).toBeVisible();
  await expect(source).toBeInViewport();
});

for (const { slug, width, height } of [
  { slug: 'knee-osteoarthritis-exercises', width: 320, height: 568 },
  { slug: 'achilles-tendinopathy-return-to-sport-exercises', width: 390, height: 664 },
]) {
  test(`${slug} shows Start a guided session on the first screen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/${slug}/`);
    await waitForEnhancement(page);
    const start = page.getByRole('link', { name: 'Start a guided session', exact: true });
    await expect(start).toBeInViewport({ ratio: 1 });
    expect((await start.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('exercise guides expose the section menu on small phones and keep its links visible on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/knee-osteoarthritis-exercises/');
  await waitForEnhancement(page);

  const navigation = page.getByRole('navigation', { name: 'On this page' });
  const disclosure = navigation.locator('details');
  const summary = disclosure.locator('summary');
  const symptoms = navigation.getByRole('link', { name: 'Symptom rules' });
  const progression = navigation.getByRole('link', { name: 'Progression' });
  await expect(summary).toBeVisible();
  await expect(disclosure).toHaveJSProperty('open', false);
  await expect(symptoms).toBeHidden();

  await summary.press('Enter');
  await expect(disclosure).toHaveJSProperty('open', true);
  await expect(symptoms).toBeVisible();
  await expect(progression).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Guided session' })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Video' })).toBeVisible();
  expect(await navigation.evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(
    await navigation.evaluate(element => element.clientWidth),
  );
  await summary.press('Tab');
  await expect(navigation.getByRole('link', { name: 'Is this for me?' })).toBeFocused();
  await symptoms.press('Enter');
  await expect(page).toHaveURL(/#response$/);
  await expect(page.locator('#response h2')).toBeInViewport({ ratio: 1 });

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(summary).toBeHidden();
  await expect(progression).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(navigation).toBeHidden();
});

test('the exercise guide section menu works without JavaScript or a video companion', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    reducedMotion: 'reduce',
    viewport: { width: 320, height: 568 },
  });
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(new URL('/thumb-cmc-osteoarthritis-exercises/', origin).href);

  const navigation = page.getByRole('navigation', { name: 'On this page' });
  const progression = navigation.getByRole('link', { name: 'Progression' });
  await expect(progression).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Guided session' })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: 'Video' })).toHaveCount(0);
  await progression.click();
  await expect(page).toHaveURL(/#progress$/);
  await expect(page.locator('#progress h2')).toBeInViewport({ ratio: 1 });
  await context.close();
});
