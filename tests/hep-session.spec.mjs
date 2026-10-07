import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const programs = JSON.parse(readFileSync(new URL('../scripts/hep-programs.json', import.meta.url), 'utf8'));
const mobileProgramSlugs = [
  'knee-osteoarthritis-exercises',
  'rotator-cuff-pain-exercises',
  'patellofemoral-pain-exercises',
  'lateral-elbow-tendinopathy-exercises',
  'medial-elbow-tendinopathy-exercises',
  'advanced-meniscus-rehabilitation-exercises',
  'adhesive-capsulitis-exercises',
  'thumb-cmc-osteoarthritis-exercises',
  'plantar-fasciitis-exercises',
];
function programFor(slug) {
  const program = programs.find(item => item.slug === slug);
  if (!program) throw new Error(`Missing maintained exercise program: ${slug}`);
  return program;
}
const mobilePrograms = mobileProgramSlugs.map(programFor);
const knee = programFor('knee-osteoarthritis-exercises');
const rotatorCuff = programFor('rotator-cuff-pain-exercises');
const advancedMeniscus = programFor('advanced-meniscus-rehabilitation-exercises');
const guidedExercises = program => program.guidedExerciseOrder
  ? program.guidedExerciseOrder.map(index => program.exercises[index]) : program.exercises;
const storageKey = slug => `swishermd:hep-progress:v1:${slug}`;
const session = page => page.locator('[data-hep-session]');
const contentTypes = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.avif': 'image/avif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' });

async function localOnly(context, baseURL) {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
}

// Run the real production analytics branch using local files only.
async function offlineProduction(context) {
  const origin = 'https://jeremyswishermd.com';
  const requests = [];
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ url: url.href, body: request.postData() });
    if (url.origin !== origin) return route.abort();
    const file = resolve(root, `.${decodeURIComponent(url.pathname)}`, ...(url.pathname.endsWith('/') ? ['index.html'] : []));
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
  await context.addInitScript(() => {
    window.__hepAnalyticsEvents = [];
    window.sa_loaded = true;
    window.sa_event = (name, metadata) => window.__hepAnalyticsEvents.push({ name, metadata });
  });
  return { origin, requests };
}

async function visit(page, program = knee, origin = '') {
  await page.goto(`${origin}/${program.slug}/`);
  await expect(page.locator('[data-hep-launch]').first()).toBeVisible();
  await expect(session(page)).toBeVisible();
}

async function start(page) {
  await session(page).locator('[data-hep-start]').click();
  await expect(session(page).locator('[data-hep-exercise]')).toBeVisible();
}

async function expectExercisePrescription(card, exercise) {
  await expect(card.locator('dl dt')).toHaveText(['Dose', 'Frequency']);
  await expect(card.locator('dl dd')).toHaveText([exercise.dose, exercise.frequency]);
  await expect(card.locator('h4')).toHaveText(['How to do it', 'Easier option']);
  await expect(card.locator('h4 + p')).toHaveText([exercise.how, exercise.easier]);
}

async function finish(page, program = knee, { skip = false } = {}) {
  for (let index = 0; index < program.exercises.length; index += 1) {
    await session(page).locator(skip ? '[data-hep-skip]' : '[data-hep-done]').click();
  }
  await expect(session(page).locator('[data-hep-save]')).toBeVisible();
}

async function addRecord(page, { notes = 'A short session felt manageable.', goal = 'Walk to the park.', response = 'not-checked' } = {}) {
  await start(page);
  await finish(page);
  await session(page).getByLabel('Session date', { exact: true }).fill('2026-10-07');
  await session(page).getByLabel('Activity goal (optional)', { exact: true }).fill(goal);
  await session(page).getByLabel('Notes (optional)', { exact: true }).fill(notes);
  await session(page).getByLabel('Next-morning response', { exact: true }).selectOption(response);
  await session(page).locator('[data-hep-save]').click();
  await expect(session(page).locator('[data-hep-history]')).toContainText(notes);
}

test('all 25 maintained programs have unique routes and enable guided sessions', () => {
  expect(programs).toHaveLength(25);
  expect(new Set(programs.map(program => program.slug)).size).toBe(25);
  expect(programs.every(program => program.guidedSession === true)).toBe(true);
  expect(advancedMeniscus.guidedExerciseOrder).toEqual([3, 4, 5, 0, 1, 2]);
  expect(advancedMeniscus.programIntro).toContain('Perform impact work before heavy strength when both occur in one session.');
  for (const program of programs.filter(program => program.slug !== advancedMeniscus.slug)) {
    expect(program.guidedExerciseOrder).toBeUndefined();
  }
});

for (const program of programs) {
  test(`${program.slug}: the guided session preserves every original exercise prescription in the maintained guided order`, async ({ context, page, baseURL }) => {
    await localOnly(context, baseURL);
    await visit(page, program);
    const exercises = guidedExercises(program);
    await expect(page.locator('[data-hep-session], #hep-session-data')).toHaveCount(2);
    const data = JSON.parse(await page.locator('#hep-session-data').textContent());
    expect(data.exercises).toEqual(exercises);
    expect(data.frequency).toBe(program.frequency);
    await expect(session(page)).toContainText(program.frequency);
    await start(page);
    await expect(session(page).locator('[data-hep-exercise]')).toContainText(program.programIntro);
    for (const exercise of exercises) {
      const card = session(page).locator('[data-hep-exercise]');
      await expect(card.locator('[data-hep-exercise-title]')).toHaveText(exercise.name);
      await expectExercisePrescription(card, exercise);
      for (const instruction of Object.values(exercise)) await expect(card).toContainText(instruction);
      await card.locator('[data-hep-done]').click();
    }
    for (const rule of [program.responseIntro, program.green, program.yellow, program.red]) {
      await expect(session(page)).toContainText(rule);
    }
    await expect(session(page).locator('[data-hep-completed-count]')).toHaveText(`${program.exercises.length} done`);
    await expect(session(page).locator('[data-hep-skipped-count]')).toHaveText('0 skipped');
    await session(page).locator('[data-hep-back]').click();
    await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(exercises.at(-1).name);
    await expectExercisePrescription(session(page).locator('[data-hep-exercise]'), exercises.at(-1));
    await expect(page.locator('#program .exercise-item')).toHaveCount(program.exercises.length);
  });
}

for (const program of programs) {
  test(`${program.slug}: harder options start collapsed and reveal the maintained progression without changing the prescription`, async ({ context, page, baseURL }) => {
    await localOnly(context, baseURL);
    await visit(page, program);
    await expect(session(page).locator('dl dd').first()).toHaveText(program.frequency);
    await expect(page.locator('#progress')).toHaveCount(1);
    await start(page);
    for (const exercise of guidedExercises(program)) {
      const card = session(page).locator('[data-hep-exercise]');
      const disclosure = card.locator('details');
      const toggle = disclosure.locator('summary');
      const harder = disclosure.locator('p');
      const readinessLink = disclosure.getByRole('link', { name: 'See progression & readiness criteria', exact: true, includeHidden: true });
      await expect(card.locator('[data-hep-exercise-title]')).toHaveText(exercise.name);
      await expect(disclosure).toHaveCount(1);
      await expect(toggle).toHaveText('Harder option from this program');
      await expect(disclosure).toHaveJSProperty('open', false);
      await expect(harder).toBeHidden();
      await expect(readinessLink).toHaveCount(1);
      await expect(readinessLink).toHaveAttribute('href', '#progress');
      await expect(readinessLink).toBeHidden();
      await expectExercisePrescription(card, exercise);

      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(disclosure).toHaveJSProperty('open', true);
      await expect(harder).toBeVisible();
      await expect(harder).toHaveText(exercise.harder);
      await expect(readinessLink).toBeVisible();
      await expectExercisePrescription(card, exercise);

      await toggle.click();
      await expect(disclosure).toHaveJSProperty('open', false);
      await expect(harder).toBeHidden();
      await expect(readinessLink).toBeHidden();
      await toggle.click();
      await expect(disclosure).toHaveJSProperty('open', true);
      await expect(harder).toBeVisible();
      await expect(harder).toHaveText(exercise.harder);
      await expect(readinessLink).toBeVisible();
      await expectExercisePrescription(card, exercise);
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(disclosure).toHaveJSProperty('open', false);
      await expect(harder).toBeHidden();
      await expect(readinessLink).toBeHidden();
      await card.locator('[data-hep-done]').click();
    }
    await expect(session(page).locator('[data-hep-completed-count]')).toHaveText(`${program.exercises.length} done`);
    await expect(session(page).locator('[data-hep-skipped-count]')).toHaveText('0 skipped');
  });
}

test('done, skip, and previous exercise replace a decision without double-counting', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await start(page);
  await session(page).locator('[data-hep-done]').click();
  await session(page).locator('[data-hep-skip]').click();
  await session(page).locator('[data-hep-back]').click();
  await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[1].name);
  await session(page).locator('[data-hep-done]').click();
  await session(page).locator('[data-hep-back]').click();
  await session(page).locator('[data-hep-skip]').click();
  for (let index = 2; index < knee.exercises.length; index += 1) {
    await session(page).locator('[data-hep-done]').click();
  }
  await expect(session(page).locator('[data-hep-completed-count]')).toHaveText(`${knee.exercises.length - 1} done`);
  await expect(session(page).locator('[data-hep-skipped-count]')).toHaveText('1 skipped');
  await session(page).locator('[data-hep-back]').click();
  await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises.at(-1).name);
  await session(page).locator('[data-hep-skip]').click();
  await expect(session(page).locator('[data-hep-completed-count]')).toHaveText(`${knee.exercises.length - 2} done`);
  await expect(session(page).locator('[data-hep-skipped-count]')).toHaveText('2 skipped');
  await session(page).locator('[data-hep-save]').click();
  await expect(session(page).locator('[data-hep-entry]')).toHaveCount(1);
  await expect(session(page).locator('[data-hep-entry]')).toContainText(`${knee.exercises.length - 2} done · 2 skipped`);
});

test('progress is off by default and private session details never enter requests, URLs, or analytics', async ({ context, page }) => {
  const { origin, requests } = await offlineProduction(context);
  const privateNote = 'PRIVATE_HEP_NOTE_2026_OCT07';
  const privateGoal = 'PRIVATE_HEP_GOAL_PARK_390';
  await visit(page, knee, origin);
  await expect(session(page).locator('[data-hep-storage]')).not.toBeChecked();
  await addRecord(page, { notes: privateNote, goal: privateGoal, response: 'more-symptomatic' });
  await page.evaluate(() => { window.print = () => {}; });
  await session(page).locator('[data-hep-print-summary]').click();
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug))).toBeNull();
  await expect(session(page).locator('[data-hep-storage]')).not.toBeChecked();
  const events = await page.evaluate(() => window.__hepAnalyticsEvents);
  expect(events).toEqual([{ name: 'page_view', metadata: { page: `/${knee.slug}/`, cta_location: 'page' } }]);
  const destinations = await page.locator('a[href]').evaluateAll(links => links.map(link => link.href));
  for (const privateValue of [privateNote, privateGoal]) {
    expect(JSON.stringify(requests)).not.toContain(privateValue);
    expect(JSON.stringify(events)).not.toContain(privateValue);
    expect(page.url()).not.toContain(privateValue);
    expect(JSON.stringify(destinations)).not.toContain(privateValue);
    const storedValues = await page.evaluate(() => ({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
    expect(JSON.stringify(storedValues)).not.toContain(privateValue);
  }
  await page.reload();
  await session(page).locator('[data-hep-log]').click();
  await expect(session(page).locator('[data-hep-history]')).not.toContainText(privateNote);
});

test('opting in saves and restores progress; opting out removes only this program key', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  const otherKey = storageKey(rotatorCuff.slug);
  await context.addInitScript(({ otherKey }) => {
    if (localStorage.getItem(otherKey) === null) localStorage.setItem(otherKey, 'other-program-sentinel');
    if (localStorage.getItem('unrelated-setting') === null) localStorage.setItem('unrelated-setting', 'keep-me');
  }, { otherKey });
  await visit(page);
  await addRecord(page, { notes: 'RESTORED_PROGRESS_SENTINEL' });
  await session(page).locator('[data-hep-storage]').check();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey(knee.slug));
  expect(saved.version).toBe(1);
  expect(saved.slug).toBe(knee.slug);
  expect(saved.records).toHaveLength(1);
  expect(saved.records[0]).toMatchObject({ completed: knee.exercises.length, skipped: 0, notes: 'RESTORED_PROGRESS_SENTINEL' });
  await start(page);
  const peer = await context.newPage();
  await visit(peer);
  await expect(session(peer).locator('[data-hep-storage]')).toBeChecked();
  await addRecord(peer, { notes: 'SECOND_TAB_PROGRESS_SENTINEL' });
  await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[0].name);
  await finish(page);
  await session(page).getByLabel('Notes (optional)', { exact: true }).fill('ACTIVE_FIRST_TAB_SENTINEL');
  await session(page).locator('[data-hep-save]').click();
  await expect(session(page).locator('[data-hep-entry]')).toHaveCount(3);
  await expect(session(peer).locator('[data-hep-entry]')).toHaveCount(3);
  await session(page).locator('[data-hep-entry]').filter({ hasText: 'RESTORED_PROGRESS_SENTINEL' })
    .locator('[data-hep-next-response]').selectOption('baseline');
  await expect(session(peer).locator('[data-hep-entry]').filter({ hasText: 'RESTORED_PROGRESS_SENTINEL' })
    .locator('[data-hep-next-response]')).toHaveValue('baseline');
  await session(peer).locator('[data-hep-entry]').filter({ hasText: 'SECOND_TAB_PROGRESS_SENTINEL' })
    .locator('[data-hep-next-response]').selectOption('more-symptomatic');
  await expect(session(page).locator('[data-hep-entry]').filter({ hasText: 'SECOND_TAB_PROGRESS_SENTINEL' })
    .locator('[data-hep-next-response]')).toHaveValue('more-symptomatic');
  await page.reload();
  await expect(session(page).locator('[data-hep-storage]')).toBeChecked();
  await session(page).locator('[data-hep-log]').click();
  await expect(session(page).locator('[data-hep-history]')).toContainText('RESTORED_PROGRESS_SENTINEL');
  await expect(session(page).locator('[data-hep-history]')).toContainText('SECOND_TAB_PROGRESS_SENTINEL');
  await expect(session(page).locator('[data-hep-history]')).toContainText('ACTIVE_FIRST_TAB_SENTINEL');
  await expect(session(page).locator('[data-hep-entry]')).toHaveCount(3);
  await session(page).locator('[data-hep-storage]').uncheck();
  await expect(session(peer).locator('[data-hep-storage]')).not.toBeChecked();
  await session(peer).locator('[data-hep-entry]').filter({ hasText: 'SECOND_TAB_PROGRESS_SENTINEL' })
    .locator('[data-hep-next-response]').selectOption('not-sure');
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug))).toBeNull();
  expect(await page.evaluate(key => localStorage.getItem(key), otherKey)).toBe('other-program-sentinel');
  expect(await page.evaluate(() => localStorage.getItem('unrelated-setting'))).toBe('keep-me');
  await page.reload();
  await expect(session(page).locator('[data-hep-storage]')).not.toBeChecked();
  await peer.close();
});

test('blocked reads and quota failures keep the session and in-memory progress usable', async ({ browser, baseURL }) => {
  for (const failure of ['read-blocked', 'write-blocked']) {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await localOnly(context, baseURL);
    await context.addInitScript(failure => {
      const method = failure === 'read-blocked' ? 'getItem' : 'setItem';
      Storage.prototype[method] = () => { throw new DOMException('Storage unavailable', failure === 'read-blocked' ? 'SecurityError' : 'QuotaExceededError'); };
    }, failure);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await visit(page, knee, baseURL);
      await addRecord(page, { notes: `STORAGE_FAILURE_${failure}` });
      const checkbox = session(page).locator('[data-hep-storage]');
      if (await checkbox.isEnabled()) await checkbox.click();
      await expect(session(page).locator('[data-hep-history]')).toContainText(`STORAGE_FAILURE_${failure}`);
      await expect(session(page).locator('[data-hep-status]')).toContainText(/memory|device|storage|sav/i);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

test('malformed and incompatible saved data are ignored without displaying an unsafe record', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/${knee.slug}/`);
  for (const raw of [
    '{not-json',
    JSON.stringify({ version: 999, slug: knee.slug, goal: '', records: [] }),
    JSON.stringify({ version: 1, slug: rotatorCuff.slug, goal: '', records: [] }),
    JSON.stringify({ version: 1, slug: knee.slug, goal: '', records: [{ id: 'bad', date: '2026-02-31', completed: 100, skipped: -1, response: 'baseline', notes: 'UNSAFE_RECORD_SENTINEL', goal: '' }] }),
  ]) {
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: storageKey(knee.slug), raw });
    await page.reload();
    await expect(session(page)).toBeVisible();
    await expect(session(page).locator('[data-hep-storage]')).not.toBeChecked();
    await session(page).locator('[data-hep-log]').click();
    await expect(session(page).locator('[data-hep-history]')).not.toContainText('UNSAFE_RECORD_SENTINEL');
    await start(page);
    await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[0].name);
  }
  expect(errors).toEqual([]);
});

test('next-morning response edits survive reload and notes remain plain text in history and summary', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  const note = '<img src=x onerror="window.__hepNoteExecuted=true"> PRIVATE_NOTE_TEXT';
  await visit(page);
  await session(page).locator('[data-hep-storage]').check();
  await addRecord(page, { notes: note });
  await session(page).locator('[data-hep-next-response]').selectOption('more-symptomatic');
  await session(page).locator('[data-hep-next-response]').selectOption('baseline');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).records[0].response, storageKey(knee.slug))).toBe('baseline');
  await session(page).locator('[data-hep-next-response]').selectOption('more-symptomatic');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).records[0].response, storageKey(knee.slug))).toBe('more-symptomatic');
  await page.reload();
  await session(page).locator('[data-hep-log]').click();
  await expect(session(page).locator('[data-hep-next-response]')).toHaveValue('more-symptomatic');
  await expect(session(page).locator('[data-hep-history]')).toContainText(note);
  await expect(session(page).locator('[data-hep-history] img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__hepNoteExecuted)).toBeUndefined();
  await page.evaluate(() => {
    window.print = () => {
      const summary = document.querySelector('.hep-summary-printout');
      window.__hepPrintedSummary = { text: summary?.textContent, imageCount: summary?.querySelectorAll('img').length };
    };
  });
  await session(page).locator('[data-hep-print-summary]').click();
  const summary = await page.evaluate(() => window.__hepPrintedSummary);
  expect(summary.text).toContain(note);
  expect(summary.text).toContain('Still more symptomatic');
  expect(summary.imageCount).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
});

test('clearing progress requires confirmation, cancel preserves it, and unrelated storage survives', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await page.evaluate(() => localStorage.setItem('unrelated-setting', 'keep-me'));
  await session(page).locator('[data-hep-storage]').check();
  await addRecord(page, { notes: 'CLEAR_CONFIRM_SENTINEL' });
  const peer = await context.newPage();
  await visit(peer);
  await session(peer).locator('[data-hep-log]').click();
  const before = await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug));
  await session(page).locator('[data-hep-clear]').click();
  await expect(session(page).locator('[data-hep-confirm-clear]')).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug))).toBe(before);
  await session(page).locator('[data-hep-cancel-clear]').click();
  await expect(session(page).locator('[data-hep-history]')).toContainText('CLEAR_CONFIRM_SENTINEL');
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug))).toBe(before);
  await session(page).locator('[data-hep-clear]').click();
  await session(page).locator('[data-hep-confirm-clear]').click();
  await expect(session(page).locator('[data-hep-history]')).not.toContainText('CLEAR_CONFIRM_SENTINEL');
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('unrelated-setting'))).toBe('keep-me');
  await expect(session(peer).locator('[data-hep-storage]')).not.toBeChecked();
  if (await session(peer).locator('[data-hep-next-response]').count()) {
    await session(peer).locator('[data-hep-next-response]').selectOption('baseline');
  }
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug))).toBeNull();
  await peer.close();
});

test('program printing excludes interactive progress and summary printing excludes the original guide', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await addRecord(page, { notes: 'SUMMARY_PRINT_SENTINEL' });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#program')).toBeVisible();
  await expect(page.locator('#response')).toBeVisible();
  await expect(page.locator('.print-progress-tracker')).toBeVisible();
  await expect(session(page)).toBeHidden();
  await expect(page.locator('.hep-summary-printout')).toHaveCount(0);
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => {
    window.print = () => { window.__hepSummaryWasPrinting = document.body.classList.contains('hep-summary-printing'); };
  });
  await session(page).locator('[data-hep-print-summary]').click();
  expect(await page.evaluate(() => window.__hepSummaryWasPrinting)).toBe(true);
  await page.emulateMedia({ media: 'print' });
  // Model a dialog that enters print media after opening and stays open past
  // the fallback deadline. Its report must survive until afterprint.
  await page.waitForTimeout(1100);
  await expect(page.locator('.hep-summary-printout')).toBeVisible();
  await expect(page.locator('.hep-summary-printout')).toContainText('SUMMARY_PRINT_SENTINEL');
  for (const selector of ['#program', '#response', '#progress', '.print-progress-tracker', '.print-program-header', '[data-hep-session]']) {
    await expect(page.locator(selector)).toBeHidden();
  }
  await expect(page.locator('.hep-summary-printout button, .hep-summary-printout input, .hep-summary-printout select, .hep-summary-printout textarea')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('body')).not.toHaveClass(/hep-summary-printing/);
  await expect(page.locator('.hep-summary-printout')).toHaveCount(0);
  await expect(page.locator('#program')).toBeVisible();
});

test('unavailable and throwing summary printing restore the page and leave controls usable', async ({ browser, baseURL }) => {
  for (const failure of ['unavailable', 'throws']) {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await localOnly(context, baseURL);
    await context.addInitScript(failure => {
      window.print = failure === 'unavailable' ? undefined : () => { throw new Error('Simulated print failure'); };
    }, failure);
    const page = await context.newPage();
    try {
      await visit(page, knee, baseURL);
      await addRecord(page);
      await session(page).locator('[data-hep-print-summary]').click();
      await expect(page.locator('body')).not.toHaveClass(/hep-summary-printing/);
      await expect(page.locator('.hep-summary-printout')).toHaveCount(0);
      await expect(session(page).locator('[data-hep-print-summary]')).toBeEnabled();
      await expect(session(page).locator('[data-hep-status]')).toContainText(/print|browser/i);
      await expect(page.locator('#program')).toBeVisible();
    } finally {
      await context.close();
    }
  }
});

test('without JavaScript or a loaded session module the complete program remains readable', async ({ browser, baseURL }) => {
  for (const failure of ['disabled', 'module-blocked']) {
    const context = await browser.newContext({ javaScriptEnabled: failure !== 'disabled', viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await localOnly(context, baseURL);
    if (failure === 'module-blocked') await context.route('**/hep-session.js*', route => route.abort());
    const page = await context.newPage();
    try {
      await page.goto(new URL(`/${knee.slug}/`, baseURL).href);
      await expect(page.locator('[data-hep-launch]').first()).toBeHidden();
      await expect(session(page)).toBeHidden();
      await expect(page.locator('#program')).toBeVisible();
      await expect(page.locator('#response')).toBeVisible();
      for (const exercise of knee.exercises) {
        const original = page.locator('#program .exercise-item').filter({ hasText: exercise.name });
        await expect(original).toContainText(exercise.dose);
        await expect(original).toContainText(exercise.frequency);
        await expect(original).toContainText(exercise.easier);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    } finally {
      await context.close();
    }
  }
});

for (const program of mobilePrograms) {
  test(`${program.slug}: the mobile session supports keyboard focus, avoids overflow, and passes axe in active views`, async ({ context, page, baseURL }) => {
    await localOnly(context, baseURL);
    await page.setViewportSize({ width: 390, height: 844 });
    await visit(page, program);
    await page.locator('[data-hep-launch]').first().focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => {
      const active = document.activeElement;
      return active?.matches('[data-hep-start], [data-hep-exercise-title]');
    })).toBe(true);
    if (await session(page).locator('[data-hep-start]').isVisible()) await page.keyboard.press('Enter');
    await expect(session(page).locator('[data-hep-exercise-title]')).toBeFocused();
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({ tag: document.activeElement.tagName, inside: Boolean(document.activeElement.closest('[data-hep-session]')) }));
    expect(focus.inside).toBe(true);
    expect(['BUTTON', 'SUMMARY']).toContain(focus.tag);
    const harderToggle = session(page).locator('[data-hep-exercise] details summary');
    await harderToggle.focus();
    await page.keyboard.press('Enter');
    await expect(harderToggle).toBeFocused();
    await expect(session(page).locator('[data-hep-exercise] details p')).toBeVisible();
    await expect(session(page).locator('[data-hep-exercise] details p')).toHaveText(guidedExercises(program)[0].harder);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.evaluate(async () => { await document.fonts?.ready; });
    const activeResults = await new AxeBuilder({ page }).include('[data-hep-session]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(activeResults.violations, JSON.stringify(activeResults.violations, null, 2)).toEqual([]);
    await session(page).locator('[data-hep-done]').click();
    await expect(session(page).locator('[data-hep-exercise-title]')).toBeFocused();
    const heading = await session(page).locator('[data-hep-exercise-title]').boundingBox();
    const navigation = await page.locator('#navbar').boundingBox();
    expect(heading.y).toBeGreaterThanOrEqual(navigation.y + navigation.height);
    for (let index = 1; index < program.exercises.length; index += 1) await session(page).locator('[data-hep-done]').click();
    await expect(session(page).getByRole('heading', { name: 'Session review', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const reviewResults = await new AxeBuilder({ page }).include('[data-hep-session]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(reviewResults.violations, JSON.stringify(reviewResults.violations, null, 2)).toEqual([]);
  });
}
