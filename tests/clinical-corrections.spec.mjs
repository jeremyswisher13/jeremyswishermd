import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
});

for (const media of ['screen', 'print']) {
  test(`ankle emergency urgency is preserved in the ${media} stop box`, async ({ page }) => {
    await page.goto('/ankle-sprain-return-to-sport-exercises/');
    await page.emulateMedia({ media });
    const stopBox = page.locator('#response .symptom-red');
    await expect(stopBox).toBeVisible();
    await expect(stopBox).toContainText('Seek immediate emergency evaluation for a newly cold, pale, blue, or numb foot.');
    await expect(stopBox).toContainText('Seek same-day urgent assessment');
    await expect(stopBox).toContainText('a new pop with weakness or loss of push-off');
    await expect(stopBox).toContainText('severe or rapidly increasing swelling');
    await expect(stopBox).toContainText('Arrange prompt reassessment for new sharp pain or repeated giving way');
    await expect(stopBox).not.toContainText('Arrange prompt assessment rather than pushing through.');
  });
}

test('patellar video guidance matches the stage-dependent starting prescription', async ({ page }) => {
  await page.goto('/patellar-tendinopathy-exercises/');
  const program = page.locator('#program');
  const video = page.locator('#video');
  for (const section of [program, video]) {
    await expect(section).toContainText('Begin with the isometric on higher-irritability days or two slow-strength movements on nonconsecutive loading days.');
    await expect(section).toContainText('Once slow strength begins, use the isometric on alternate or recovery days, or as a brief warm-up only when it reliably helps.');
  }
  await expect(video).not.toContainText('Start with the isometric and only two slow-strength movements.');
  await expect(video).toContainText('Never improvise a Spanish-squat anchor');
  await expect(video).toContainText('at least 48 hours between early high-load sessions');
});

test('pre-injection warning distinguishes same-day symptoms from diagnostic review', async ({ page }) => {
  await page.goto('/knee-osteoarthritis-injection-comparison/');
  const warning = page.locator('#candidacy .urgent-panel');
  await expect(warning).toBeVisible();
  const paragraphs = warning.locator('p');
  await expect(paragraphs).toHaveCount(2);
  await expect(paragraphs.first()).toContainText('Seek same-day urgent medical assessment');
  await expect(paragraphs.first()).toContainText('with or without fever');
  await expect(paragraphs.first()).toContainText('new inability to bear weight');
  await expect(paragraphs.first()).toContainText('Do not wait for an elective injection appointment.');
  await expect(paragraphs.last()).toContainText('major diagnostic uncertainty also requires evaluation before choosing an elective injection');
  await expect(paragraphs.last()).not.toContainText('emergency');
});
