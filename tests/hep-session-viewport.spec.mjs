import { expect, test } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

test.beforeEach(async ({ page }) => {
  await page.goto('/knee-osteoarthritis-exercises/');
  await page.locator('[data-hep-launch-start]').click();
  await page.getByRole('button', { name: 'Begin', exact: true }).click();
});

test('rotating a phone keeps the session full screen and its actions reachable', async ({ page }) => {
  const dialog = page.getByRole('dialog');
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => dialog.boundingBox()).toEqual({
      x: expect.closeTo(0, 0), y: expect.closeTo(0, 0),
      width: expect.closeTo(viewport.width, 0), height: expect.closeTo(viewport.height, 0),
    });
    await dialog.locator('.hep-focus-body').evaluate(body => { body.scrollTop = body.scrollHeight; });
    await expect(dialog.getByRole('button', { name: 'Close session' })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeInViewport({ ratio: 1 });
  }
});

test('enlarged text keeps the new exercise and save confirmation visibly focused', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  const dialog = page.getByRole('dialog');
  const done = dialog.getByRole('button', { name: 'Done', exact: true });
  await dialog.getByRole('button', { name: 'Session settings' }).click();
  await done.focus();
  await page.keyboard.press('Enter');
  const heading = dialog.getByRole('heading', { name: 'Low step-up' });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport({ ratio: 1 });

  while (await done.count()) await done.click();
  await dialog.getByRole('button', { name: 'Done & finish' }).click();
  await dialog.getByRole('button', { name: 'Save session' }).click();
  const confirmation = dialog.locator('[data-hep-saved]');
  await expect(confirmation).toBeFocused();
  await expect(confirmation).toBeInViewport({ ratio: 1 });
});
