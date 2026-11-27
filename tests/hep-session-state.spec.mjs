import { expect, test } from '@playwright/test';

const knee = 'knee-osteoarthritis-exercises';
const advancedMeniscus = 'advanced-meniscus-rehabilitation-exercises';
const key = 'swishermd:hep-progress:v1:' + knee;
const view = page => page.locator('[data-hep-focus]');
const panel = page => page.locator('.hep-session-panel');
const store = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});

async function begin(page, slug = knee) {
  await page.goto('/' + slug + '/');
  await panel(page).locator('[data-hep-start]').click();
  await view(page).locator('[data-hep-begin]').click();
}

async function completeKnee(page) {
  for (let n = 0; n < 5; n++) await view(page).locator('[data-hep-done]').click();
}

test('correcting saved exercise decisions, sets and weight updates the same log entry', async ({ page }) => {
  await begin(page);
  const player = view(page);
  await player.locator('[data-hep-settings]').click();
  await player.locator('[data-hep-record-load]').check();
  await player.locator('[data-hep-set-count="2"]').click();
  await player.locator('[data-hep-load]').fill('5 lb');
  await completeKnee(page);
  await player.locator('[data-hep-save]').click();
  const [original] = (await store(page)).records;
  expect(original.setCounts).toEqual([2, 0, 0, 0, 0]);
  expect(original.workout[0].sets[0].resistance).toBe('5 lb');
  const peer = await page.context().newPage();
  await peer.goto('/' + knee + '/');
  await panel(peer).locator('[data-hep-log]').click();
  await peer.locator('[data-hep-next-response]').selectOption('baseline');
  await expect(page.locator('[data-hep-status]')).toContainText('updated from another tab');
  for (let n = 0; n < 5; n++) await player.locator('[data-hep-back]').click();
  await player.locator('[data-hep-skip]').click();
  for (let n = 1; n < 5; n++) await player.locator('[data-hep-done]').click();
  await expect(player.locator('[data-hep-completed-count]')).toHaveText('4 done');
  expect((await store(page)).records).toEqual([expect.objectContaining({
    id: original.id, createdAt: original.createdAt, completed: 4, skipped: 1, response: 'baseline',
  })]);
  expect((await store(page)).records[0]).not.toHaveProperty('setCounts');
  expect((await store(page)).records[0]).not.toHaveProperty('workout');
  await page.reload();
  await panel(page).locator('[data-hep-log]').click();
  await expect(page.locator('[data-hep-entry]')).toHaveCount(1);
  await expect(page.locator('[data-hep-entry]')).toContainText('4 done · 1 skipped');
});

test('opening session settings and recording weight preserve the timed exercise', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 568 });
  await begin(page, 'patellar-tendinopathy-exercises');
  const player = view(page);
  await player.getByRole('button', { name: 'Hold 45 sec' }).click();
  const body = player.locator('.hep-focus-body');
  await body.evaluate(node => { node.scrollTop = node.scrollHeight; });
  expect(await body.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await player.locator('[data-hep-settings]').click();
  const bounds = await body.boundingBox();
  const option = await player.locator('[data-hep-record-load]').boundingBox();
  expect(option.y).toBeGreaterThanOrEqual(bounds.y);
  expect(option.y + option.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  await expect(player.getByRole('timer')).toBeVisible();
  await player.getByRole('button', { name: 'Pause', exact: true }).click();
  const time = await player.getByRole('timer').textContent();
  await player.locator('[data-hep-record-load]').check();
  await expect(player.locator('[data-hep-load]')).toBeVisible();
  await player.locator('[data-hep-settings]').click();
  await expect(player.getByRole('timer')).toHaveText(time);
  await expect(player.getByRole('button', { name: 'Resume' })).toBeVisible();
});

test('correcting an automatic entry keeps the pending note private and follows device consent changes', async ({ page }) => {
  await begin(page);
  const player = view(page);
  await player.locator('[data-hep-close]').click();
  await panel(page).locator('[data-hep-log]').click();
  await page.locator('[data-hep-storage]').check();
  await panel(page).locator('[data-hep-resume]').click();
  await completeKnee(page);
  await player.locator('.hep-session-log-details summary').click();
  await player.locator('#hep-session-notes').fill('Pending change');
  await player.locator('[data-hep-back]').click();
  await player.locator('[data-hep-skip]').click();
  const records = (await store(page)).records;
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ completed: 4, skipped: 1, notes: '' });
  await player.locator('.hep-session-log-details summary').click();
  await expect(player.locator('#hep-session-notes')).toHaveValue('Pending change');
  const peer = await page.context().newPage();
  await peer.goto('/' + knee + '/');
  await panel(peer).locator('[data-hep-log]').click();
  await peer.locator('[data-hep-storage]').uncheck();
  await expect(player.locator('[data-hep-saved]')).toContainText('for this visit');
  await expect(player.locator('#hep-session-notes')).toHaveValue('Pending change');
  expect(await store(page)).toBeNull();
});

test('discarding a finish-screen goal keeps it out of device storage and the next session', async ({ page }) => {
  await begin(page);
  await completeKnee(page);
  const player = view(page);
  await player.locator('.hep-session-log-details summary').click();
  await player.locator('#hep-session-goal').fill('Discarded draft');
  await player.locator('[data-hep-finish]').click();
  await panel(page).locator('[data-hep-log]').click();
  await page.locator('[data-hep-storage]').check();
  expect((await store(page)).goal).toBe('');
  await panel(page).locator('[data-hep-start]').click();
  await player.locator('[data-hep-begin]').click();
  await completeKnee(page);
  expect((await store(page)).records[0].goal).toBe('');
});

test('an invalid date can be corrected after resuming a session with saving enabled', async ({ page }) => {
  await begin(page);
  await completeKnee(page);
  const player = view(page);
  await player.locator('.hep-session-log-details summary').click();
  await player.locator('#hep-session-date').fill('');
  await player.locator('[data-hep-close]').click();
  await panel(page).locator('[data-hep-log]').click();
  await page.locator('[data-hep-storage]').check();
  await panel(page).locator('[data-hep-resume]').click();
  await expect(player.locator('#hep-session-date')).toBeVisible();
  await player.locator('#hep-session-date').fill('2026-10-20');
  await player.locator('[data-hep-save]').click();
  expect((await store(page)).records[0].date).toBe('2026-10-20');
});

test('pause and back describe the actual progress after the strength shortcut', async ({ page }) => {
  await begin(page, advancedMeniscus);
  const player = view(page);
  await player.locator('[data-hep-strength-start]').click();
  for (let n = 0; n < 3; n++) await player.locator('[data-hep-done]').click();
  await player.locator('[data-hep-close]').click();
  await expect(panel(page)).toContainText('3 exercises are still unmarked.');
  await panel(page).locator('[data-hep-resume]').click();
  await player.locator('[data-hep-return-unmarked]').click();
  for (let n = 0; n < 3; n++) await player.locator('[data-hep-skip]').click();
  await player.locator('[data-hep-back]').click();
  await expect(player.locator('[data-hep-exercise-title]')).toHaveAccessibleDescription('Exercise 3 of 6');
});
