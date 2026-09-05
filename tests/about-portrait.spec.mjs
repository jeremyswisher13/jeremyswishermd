import { expect, test } from '@playwright/test';

for (const width of [320, 390, 820, 1280]) {
  test(`About portrait loads without horizontal overflow at ${width}px`, async ({ page, context, baseURL }) => {
    const origin = new URL(baseURL).origin;
    await context.route('**/*', route => new URL(route.request().url()).origin === origin
      ? route.continue() : route.abort());
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/#about');
    const portrait = page.locator('#about .profile-card img');
    await portrait.scrollIntoViewIfNeeded();
    await expect(portrait).toHaveAttribute('alt', 'Jeremy Swisher, MD, wearing a UCLA Health white coat');
    await expect(portrait).toHaveAttribute('width', '1241');
    await expect(portrait).toHaveAttribute('height', '1280');
    await expect.poll(() => portrait.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    const rendered = await portrait.evaluate(image => ({
      src: image.currentSrc,
      left: image.getBoundingClientRect().left,
      right: image.getBoundingClientRect().right,
      pageWidth: document.documentElement.scrollWidth,
    }));
    expect(rendered.src).toContain('/images/jeremy-swisher-ucla-portrait-2026-');
    expect(rendered.left).toBeGreaterThanOrEqual(0);
    expect(rendered.right).toBeLessThanOrEqual(width);
    expect(rendered.pageWidth).toBeLessThanOrEqual(width);
  });
}
