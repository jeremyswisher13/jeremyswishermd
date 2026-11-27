import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const programs = JSON.parse(readFileSync(new URL('../scripts/hep-programs.json', import.meta.url), 'utf8'));
const optionsBySlug = JSON.parse(readFileSync(new URL('../scripts/hep-workout-options.json', import.meta.url), 'utf8'));
const programFor = slug => programs.find(program => program.slug === slug);
const knee = programFor('knee-osteoarthritis-exercises');
const patellar = programFor('patellar-tendinopathy-exercises');
const meniscus = programFor('meniscus-tear-rehabilitation-exercises');
const guidedOrder = program => program.guidedExerciseOrder || program.exercises.map((_, index) => index);
const guidedExercises = program => guidedOrder(program).map(index => program.exercises[index]);
const guidedOptions = program => guidedOrder(program).map(index => optionsBySlug[program.slug][index]);
const storageKey = slug => `swishermd:hep-progress:v1:${slug}`;
const session = page => page.locator('[data-hep-session]');
const focusView = page => page.locator('[data-hep-focus]');
const timer = page => focusView(page).locator('[data-hep-timer]');
const contentTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.avif': 'image/avif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// These browser tests are committed for the existing CI Playwright job.
test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' });

async function localOnly(context, baseURL) {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
}

async function offlineProduction(context) {
  const origin = 'https://jeremyswishermd.com';
  const requests = [];
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ url: url.href, method: request.method(), body: request.postData() });
    if (url.origin !== origin) return route.abort();
    const file = resolve(root, `.${decodeURIComponent(url.pathname)}`, ...(url.pathname.endsWith('/') ? ['index.html'] : []));
    if (!file.startsWith(root + sep)) return route.abort();
    try {
      return await route.fulfill({ status: 200, contentType: contentTypes[extname(file)] || 'application/octet-stream', body: await readFile(file) });
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
  await expect(session(page)).toBeVisible();
}

async function start(page) {
  await session(page).locator('.hep-session-panel [data-hep-start]').click();
  await focusView(page).locator('[data-hep-begin]').click();
  await expect(focusView(page).locator('[data-hep-exercise]')).toBeVisible();
}

async function openLog(page) {
  await session(page).locator('.hep-session-panel [data-hep-log]').click();
  await expect(session(page).locator('[data-hep-history]')).toBeVisible();
}

async function recordLoads(page) {
  const settings = focusView(page).locator('[data-hep-settings]');
  await expect(settings).toHaveAttribute('aria-expanded', 'false');
  await settings.click();
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
  await focusView(page).locator('[data-hep-record-load]').check();
}

async function finishFrom(page, program = knee, index = 0, choice = 'done') {
  for (let current = index; current < program.exercises.length; current += 1) {
    await focusView(page).locator(`[data-hep-${choice}]`).click();
  }
  await expect(focusView(page).locator('[data-hep-completed-count]')).toBeVisible();
}

// Saves the finished session (answering the save question) and opens the log.
async function save(page, notes = '') {
  const logDetails = focusView(page).locator('.hep-session-log-details');
  if (!(await logDetails.evaluate(details => details.open))) await logDetails.locator('summary').click();
  await focusView(page).getByLabel('Session date', { exact: true }).fill('2026-10-08');
  await focusView(page).getByLabel('Notes (optional)', { exact: true }).fill(notes);
  if (await focusView(page).locator('[data-hep-save]').count()) await focusView(page).locator('[data-hep-save]').click();
  else await focusView(page).locator('[data-hep-update-entry]').click();
  await focusView(page).locator('[data-hep-log]').click();
  await expect(session(page).locator('[data-hep-history]')).toBeVisible();
}

const readStore = (page, program = knee) => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey(program.slug));
const blankRecordedSet = () => ({ amount: null, holdSeconds: null, load: null, unit: 'none', resistance: '', note: '' });
function legacyRecord(id, notes = id, stamp = 0) {
  return { id, date: '2026-10-07', completed: knee.exercises.length, skipped: 0, response: 'not-checked', notes, goal: '', ...(stamp ? { createdAt: stamp, updatedAt: stamp } : {}) };
}
function recordedWorkout(id, note, stamp = 0) {
  return { ...legacyRecord(id, id, stamp), workout: guidedOptions(knee).map((option, index) => ({ status: 'done', measure: option.measure, sets: index === 0 ? [{ ...blankRecordedSet(), amount: 7, load: 5, unit: 'kg', note }] : [] })) };
}
async function seed(context, records) {
  await context.addInitScript(({ key, records }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify({ version: 1, slug: 'knee-osteoarthritis-exercises', goal: '', records }));
  }, { key: storageKey(knee.slug), records });
}

test('tapped sets follow the written range, are saved only for completed exercises, and appear in the log and summary', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await start(page);
  const view = focusView(page);
  const circles = view.locator('[data-hep-set-count]');
  await expect(view.locator('.hep-session-sets-label')).toHaveText('Tap a circle after each set. Sets 2 to 3 are optional.');
  await expect(circles).toHaveCount(3);
  await expect(view.locator('.hep-session-set.is-optional')).toHaveCount(2);
  await expect(view.locator('[data-hep-set-count][aria-pressed="true"]')).toHaveCount(0);
  await view.locator('[data-hep-set-count="3"]').click();
  await expect(view.locator('[data-hep-set-count][aria-pressed="true"]')).toHaveCount(3);
  await expect(view.locator('.hep-focus-status')).toHaveText('3 sets marked.');
  await view.locator('[data-hep-set-count="3"]').click();
  await expect(view.locator('[data-hep-set-count][aria-pressed="true"]')).toHaveCount(2);
  await expect(view.locator('[data-hep-exercise] dl dd')).toHaveText([knee.exercises[0].dose, knee.exercises[0].frequency]);
  await view.locator('[data-hep-done]').click();
  await view.locator('[data-hep-set-count="1"]').click();
  await view.locator('[data-hep-skip]').click();
  await view.locator('[data-hep-done]').click();
  await view.locator('[data-hep-done]').click();
  await expect(view.locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[4].name);
  await expect(view.locator('[data-hep-set-count]')).toHaveCount(0);
  await view.locator('[data-hep-done]').click();
  await expect(view.locator('[data-hep-completed-count]')).toHaveText('4 done');
  await save(page, 'SET_COUNT_SESSION');
  const [record] = (await readStore(page)).records;
  expect(record.setCounts).toEqual([2, 0, 0, 0, 0]);
  expect(record.workout).toBeUndefined();
  await expect(session(page).locator('[data-hep-entry]')).toContainText(`Sets: ${knee.exercises[0].name} 2`);
  await page.evaluate(() => { window.print = () => { window.__setSummary = document.querySelector('.hep-summary-printout').textContent; }; });
  await session(page).locator('[data-hep-print-summary]').click();
  expect(await page.evaluate(() => window.__setSummary)).toContain(`Sets: ${knee.exercises[0].name} 2`);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
});

test('weight or band boxes appear only when turned on and only for exercises that use resistance', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await start(page);
  const view = focusView(page);
  await expect(view.locator('[data-hep-load]')).toHaveCount(0);
  await recordLoads(page);
  await expect(view.locator('[data-hep-record-load]')).toBeFocused();
  await view.locator('[data-hep-load]').fill('10 lb');
  await view.locator('[data-hep-done]').click();
  await view.locator('[data-hep-load]').fill('SKIPPED_BAND_PRIVATE_DRAFT');
  await view.locator('[data-hep-skip]').click();
  await view.locator('[data-hep-back]').click();
  await expect(view.locator('[data-hep-load]')).toHaveValue('SKIPPED_BAND_PRIVATE_DRAFT');
  await view.locator('[data-hep-back]').click();
  await expect(view.locator('[data-hep-load]')).toHaveValue('10 lb');
  await view.locator('[data-hep-done]').click();
  await view.locator('[data-hep-skip]').click();
  await view.locator('[data-hep-done]').click();
  await view.locator('[data-hep-done]').click();
  expect(guidedOptions(knee)[4].resistance).toBe(false);
  await expect(view.locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[4].name);
  await expect(view.locator('[data-hep-load]')).toHaveCount(0);
  await view.locator('[data-hep-done]').click();
  await save(page, 'LOAD_SESSION');
  const [record] = (await readStore(page)).records;
  expect(record.workout[0].sets).toEqual([{ ...blankRecordedSet(), unit: 'other', resistance: '10 lb' }]);
  expect(record.workout[1]).toEqual({ status: 'skipped', measure: 'reps', label: 'Reps per side', sets: [] });
  expect(record.workout[2].sets).toEqual([]);
  expect(JSON.stringify(record)).not.toContain('SKIPPED_BAND_PRIVATE_DRAFT');
  await session(page).locator('.hep-workout-record > summary').click();
  await expect(session(page).locator('.hep-workout-record-exercise').first()).toContainText('Resistance: 10 lb');
  // The setting stays on for later sessions during this visit.
  await start(page);
  await expect(view.locator('[data-hep-previous-sets]')).toContainText(/^Last recorded .+: Resistance: 10 lb$/);
  await expect(view.locator('[data-hep-load]')).toHaveValue('');
});

test('legacy v1 records and earlier workout records restore together; response edits preserve sets', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await seed(context, [legacyRecord('legacy-simple'), recordedWorkout('legacy-workout', 'LEGACY_SET_NOTE', 50)]);
  await visit(page);
  await openLog(page);
  await expect(session(page).locator('[data-hep-storage]')).toBeChecked();
  await expect(session(page).locator('[data-hep-entry]')).toHaveCount(2);
  const before = await readStore(page);
  const originalWorkout = before.records.find(record => record.workout).workout;
  await session(page).locator('[data-hep-entry="legacy-workout"] .hep-workout-record > summary').click();
  await expect(session(page).locator('[data-hep-entry="legacy-workout"]')).toContainText('7 reps · 5 kg · LEGACY_SET_NOTE');
  await session(page).locator('[data-hep-entry="legacy-workout"] [data-hep-next-response]').selectOption('baseline');
  await session(page).locator('[data-hep-entry="legacy-simple"] [data-hep-next-response]').selectOption('more-symptomatic');
  await page.reload();
  await openLog(page);
  await expect(session(page).locator('[data-hep-entry="legacy-simple"] [data-hep-next-response]')).toHaveValue('more-symptomatic');
  await expect(session(page).locator('[data-hep-entry="legacy-workout"] [data-hep-next-response]')).toHaveValue('baseline');
  const restored = await readStore(page);
  expect(restored.records.find(record => record.workout).workout).toEqual(originalWorkout);
  await start(page);
  await recordLoads(page);
  await expect(focusView(page).locator('[data-hep-previous-sets]')).toContainText('7 reps · 5 kg · LEGACY_SET_NOTE');
  await expect(focusView(page).locator('[data-hep-load]')).toHaveValue('');
});

test('summary prints the latest six sessions and takes set details from the newest workout with a recorded set', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  const blankWorkout = recordedWorkout('blank-workout', '', 100);
  blankWorkout.notes = 'LATEST_SIX_0';
  blankWorkout.workout[0].sets = [blankRecordedSet()];
  const zeroWorkout = recordedWorkout('recent-workout', '', 90);
  zeroWorkout.workout[0].sets = [blankRecordedSet(), { ...blankRecordedSet(), amount: 0 }];
  const records = [
    blankWorkout,
    ...Array.from({ length: 5 }, (_, index) => legacyRecord(`simple-${index}`, `LATEST_SIX_${index + 1}`, 99 - index)),
    zeroWorkout,
    recordedWorkout('older-workout', 'OLDER_WORKOUT_DETAIL', 80),
  ];
  await seed(context, records);
  await visit(page);
  await openLog(page);
  await page.evaluate(() => {
    window.print = () => {
      const summary = document.querySelector('.hep-summary-printout');
      window.__workoutPrinted = {
        text: summary.textContent,
        rows: [...summary.querySelectorAll('.hep-summary-table tbody tr')].map(row => [...row.children].map(cell => cell.textContent)),
        exerciseNames: [...summary.querySelectorAll('.hep-workout-record-exercise h4')].map(heading => heading.textContent),
        recordedSets: [...summary.querySelectorAll('.hep-workout-record-exercise li')].map(item => item.textContent),
        controls: summary.querySelectorAll('input, select, textarea, button').length,
      };
    };
  });
  await session(page).locator('[data-hep-print-summary]').click();
  const printed = await page.evaluate(() => window.__workoutPrinted);
  expect(printed.rows).toHaveLength(6);
  expect(printed.rows.map(row => row.slice(1, 3))).toEqual(Array.from({ length: 6 }, () => ['5', '0']));
  for (let index = 0; index < 6; index += 1) expect(printed.rows[index][4]).toContain(`LATEST_SIX_${index}`);
  expect(printed.text).toContain('Most recent workout with recorded sets');
  expect(printed.text).not.toContain('OLDER_WORKOUT_DETAIL');
  expect(printed.recordedSets).toEqual(['0 reps']);
  expect(printed.exerciseNames).toEqual(guidedExercises(knee).map(exercise => exercise.name));
  expect(printed.controls).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('.hep-summary-printout')).toHaveCount(0);
  await expect(session(page).locator('[data-hep-print-summary]')).toBeEnabled();
});

async function clockVisit(context, page, baseURL, program = knee) {
  await localOnly(context, baseURL);
  await page.clock.install({ time: new Date('2026-10-08T12:00:00Z') });
  await visit(page, program);
  await page.clock.pauseAt(new Date('2026-10-08T12:01:00Z'));
  await start(page);
}

test('clear keeps decisions, tapped sets, and typed weights in both tabs', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await seed(context, [recordedWorkout('saved-workout', 'CLEARED_SET_REFERENCE')]);
  await visit(page);
  await start(page);
  await focusView(page).locator('[data-hep-set-count="2"]').click();
  await focusView(page).locator('[data-hep-done]').click();
  await focusView(page).locator('[data-hep-skip]').click();
  await page.keyboard.press('Escape');

  const peer = await context.newPage();
  await visit(peer);
  await start(peer);
  await recordLoads(peer);
  await expect(focusView(peer).locator('[data-hep-previous-sets]')).toContainText('CLEARED_SET_REFERENCE');
  await focusView(peer).locator('[data-hep-load]').fill('9 lb');

  await openLog(page);
  await session(page).locator('[data-hep-clear]').click();
  await session(page).locator('[data-hep-confirm-clear]').click();
  await expect(focusView(peer).locator('[data-hep-previous-sets]')).toHaveCount(0);
  await expect(focusView(peer).locator('[data-hep-load]')).toHaveValue('9 lb');

  await session(page).locator('[data-hep-resume]').click();
  await expect(focusView(page).getByRole('progressbar')).toHaveJSProperty('value', 2);
  await focusView(page).locator('[data-hep-back]').click();
  await expect(focusView(page).locator('[data-hep-exercise]')).toContainText('Previously marked skipped');
  await focusView(page).locator('[data-hep-back]').click();
  await expect(focusView(page).locator('[data-hep-exercise]')).toContainText('Previously marked done');
  await expect(focusView(page).locator('[data-hep-set-count="2"]')).toHaveAttribute('aria-pressed', 'true');
});

test('a running timer survives a clear in another tab', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await seed(context, [legacyRecord('saved-entry')]);
  await visit(page);
  await openLog(page);
  const peer = await context.newPage();
  await clockVisit(context, peer, baseURL);
  for (let index = 0; index < knee.exercises.length - 1; index += 1) await focusView(peer).locator('[data-hep-done]').click();
  await timer(peer).getByRole('button', { name: 'Activity 5 min', exact: true }).click();
  await session(page).locator('[data-hep-clear]').click();
  await session(page).locator('[data-hep-confirm-clear]').click();
  await expect(session(page).locator('[data-hep-entry]')).toHaveCount(0);
  await peer.clock.runFor(3000);
  await expect(timer(peer).getByRole('timer')).toHaveText('04:57');
});

test('weight, band, and notes never enter production analytics, links, or network requests', async ({ context, page }) => {
  const { origin, requests } = await offlineProduction(context);
  const privateValues = ['PRIVATE_WORKOUT_BAND_481', 'PRIVATE_WORKOUT_SESSION_153'];
  await visit(page, knee, origin);
  await page.waitForLoadState('networkidle');
  const initialRequests = requests.length;
  await start(page);
  await recordLoads(page);
  await focusView(page).locator('[data-hep-set-count="1"]').click();
  await focusView(page).locator('[data-hep-load]').fill(privateValues[0]);
  await finishFrom(page);
  const logDetails = focusView(page).locator('.hep-session-log-details');
  await logDetails.locator('summary').click();
  await focusView(page).getByLabel('Notes (optional)', { exact: true }).fill(privateValues[1]);
  await focusView(page).locator('[data-hep-finish]').click();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug))).toBeNull();
  await start(page);
  await recordLoads(page);
  await focusView(page).locator('[data-hep-load]').fill(privateValues[0]);
  await finishFrom(page);
  await save(page, privateValues[1]);
  await session(page).locator('.hep-workout-record > summary').click();
  for (const value of privateValues) await expect(session(page).locator('[data-hep-entry]')).toContainText(value);
  await page.evaluate(() => { window.print = () => {}; });
  await session(page).locator('[data-hep-print-summary]').click();
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  const events = await page.evaluate(() => window.__hepAnalyticsEvents);
  expect(events).toEqual([{ name: 'page_view', metadata: { page: `/${knee.slug}/`, cta_location: 'page' } }]);
  expect(requests).toHaveLength(initialRequests);
  expect(requests.every(request => request.method === 'GET' && request.body === null)).toBe(true);
  const destinations = await page.locator('a[href]').evaluateAll(links => links.map(link => link.href));
  for (const value of privateValues) {
    for (const output of [requests, events, destinations]) expect(JSON.stringify(output)).not.toContain(value);
    expect(page.url()).not.toContain(value);
  }
});

test('wall-sit hold and rest timers work on the written card and in a session without logging', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.clock.install({ time: new Date('2026-11-17T12:00:00Z') });
  await visit(page, patellar);
  await page.clock.pauseAt(new Date('2026-11-17T12:01:00Z'));
  const written = page.locator('.exercise-instructions + [data-hep-card-timer]').first();
  const labels = ['Hold 30 sec', 'Hold 45 sec', 'Rest 1 min', 'Rest 2 min'];
  await expect(written.locator('[data-hep-timer-preset]')).toHaveText(labels);
  const hold = written.getByRole('button', { name: labels[0], exact: true });
  await hold.focus();
  await page.keyboard.press('Enter');
  await expect(written.getByRole('timer')).toHaveText('00:30');
  await expect(written.getByRole('button', { name: 'Pause' })).toBeFocused();
  await page.clock.fastForward(30000);
  await expect(written.getByRole('status')).toContainText('Hold 30 sec timer finished');
  await expect(hold).toBeFocused();
  await written.getByRole('button', { name: 'Rest 2 min' }).click();
  await expect(written.getByRole('timer')).toHaveText('02:00');
  await start(page);
  await expect(timer(page).locator('[data-hep-timer-preset]')).toHaveText(labels);
  await timer(page).getByRole('button', { name: 'Hold 45 sec' }).click();
  await expect(written.getByRole('timer')).toHaveCount(0);
  await expect(timer(page).getByRole('timer')).toHaveText('00:45');
  await page.clock.fastForward(45000);
  await expect(timer(page).getByRole('status')).toContainText('Hold 45 sec timer finished');
  await expect(focusView(page).getByRole('progressbar')).toHaveJSProperty('value', 0);
  await timer(page).getByRole('button', { name: 'Rest 1 min' }).click();
  await expect(timer(page).getByRole('timer')).toHaveText('01:00');
  await focusView(page).locator('[data-hep-skip]').click();
  await expect(timer(page)).toHaveCount(0);
  expect(await readStore(page, patellar)).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.keyboard.press('Escape');
  await page.clock.resume();
  const audit = await new AxeBuilder({ page }).include('[data-hep-card-timer]').withTags(wcag).analyze();
  expect(audit.violations).toEqual([]);
  await page.emulateMedia({ media: 'print' });
  await expect(written).toBeHidden();
});

test('a session timer pauses, resumes, cancels, and finishes without marking or advancing an exercise', async ({ context, page, baseURL }) => {
  await clockVisit(context, page, baseURL, patellar);
  const clock = timer(page).locator('[data-hep-timer-clock]');
  const status = timer(page).getByRole('status');
  await expect(clock).toBeHidden();
  await timer(page).getByRole('button', { name: 'Hold 30 sec', exact: true }).click();
  await page.clock.runFor(3000);
  await timer(page).locator('[data-hep-timer-pause]').click();
  await expect(clock).toHaveText('00:27');
  await expect(timer(page).locator('[data-hep-timer-preset]').first()).toBeDisabled();
  await page.clock.fastForward(60000);
  await expect(clock).toHaveText('00:27');
  await timer(page).getByRole('button', { name: 'Resume', exact: true }).click();
  await page.clock.fastForward(27000);
  await expect(clock).toBeHidden();
  await expect(status).toHaveText('Hold 30 sec timer finished.');
  await expect(focusView(page).locator('[data-hep-exercise-title]')).toHaveText(patellar.exercises[0].name);
  await expect(focusView(page).getByRole('progressbar')).toHaveJSProperty('value', 0);
  await timer(page).getByRole('button', { name: 'Rest 1 min', exact: true }).click();
  await expect(clock).toHaveText('01:00');
  await timer(page).locator('[data-hep-timer-cancel]').click();
  await expect(clock).toBeHidden();
  await expect(timer(page).locator('[data-hep-timer-preset]').first()).toBeEnabled();
  await page.clock.fastForward(60000);
  await expect(status).toHaveText('Timer cancelled.');
});

test('pausing between countdown updates immediately displays the remaining time', async ({ context, page, baseURL }) => {
  await clockVisit(context, page, baseURL, patellar);
  const clock = timer(page).locator('[data-hep-timer-clock]');
  await timer(page).getByRole('button', { name: 'Hold 30 sec', exact: true }).click();
  const startedAt = await page.evaluate(() => Date.now());
  // Change wall time while interval callbacks remain paused.
  await page.clock.setSystemTime(new Date(startedAt + 1050));
  await expect(clock).toHaveText('00:30');
  await timer(page).locator('[data-hep-timer-pause]').click();
  await expect(clock).toHaveText('00:29');
  await expect(timer(page).getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
  await page.clock.setSystemTime(new Date(startedAt + 11050));
  await timer(page).getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(clock).toHaveText('00:29');
  await page.clock.runFor(1000);
  await expect(clock).toHaveText('00:28');
  await expect(focusView(page).locator('[data-hep-exercise-title]')).toHaveText(patellar.exercises[0].name);
  await expect(focusView(page).getByRole('progressbar')).toHaveJSProperty('value', 0);
});

test('pausing just after expiry before an interval callback finishes the timer and enables a fresh timer', async ({ context, page, baseURL }) => {
  await clockVisit(context, page, baseURL, meniscus);
  const clock = timer(page).locator('[data-hep-timer-clock]');
  const preset = timer(page).getByRole('button', { name: 'Hold 5 sec', exact: true });
  await preset.click();
  const startedAt = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(new Date(startedAt + 5001));
  await expect(clock).toHaveText('00:05');
  await timer(page).locator('[data-hep-timer-pause]').click();
  await expect(clock).toBeHidden();
  await expect(timer(page).getByRole('status')).toHaveText('Hold 5 sec timer finished.');
  for (const control of ['pause', 'cancel']) {
    await expect(timer(page).locator(`[data-hep-timer-${control}]`)).toBeDisabled();
  }
  await expect(preset).toBeEnabled();
  await expect(focusView(page).locator('[data-hep-exercise-title]')).toHaveText(meniscus.exercises[0].name);
  await expect(focusView(page).getByRole('progressbar')).toHaveJSProperty('value', 0);
  await preset.click();
  await expect(clock).toHaveText('00:05');
});

test('returning from a hidden page uses the wall-clock deadline instead of losing time to delayed ticks', async ({ context, page, baseURL }) => {
  await clockVisit(context, page, baseURL, patellar);
  await timer(page).getByRole('button', { name: 'Hold 30 sec', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const deadlinePassed = (await page.evaluate(() => Date.now())) + 45000;
  // Move system time without firing the paused interval; visibility must reconcile it.
  await page.clock.setSystemTime(new Date(deadlinePassed));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(timer(page).locator('[data-hep-timer-clock]')).toBeHidden();
  await expect(timer(page).getByRole('status')).toHaveText('Hold 30 sec timer finished.');
  await expect(focusView(page).locator('[data-hep-exercise-title]')).toHaveText(patellar.exercises[0].name);
  await expect(focusView(page).getByRole('progressbar')).toHaveJSProperty('value', 0);
});

test('changing exercise, closing the session, and cached-page navigation cancel a running timer', async ({ context, page, baseURL }) => {
  await clockVisit(context, page, baseURL, patellar);
  const startTimer = async () => {
    await timer(page).getByRole('button', { name: 'Hold 30 sec', exact: true }).click();
    await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:30');
  };
  const expectCancelled = async () => {
    await page.clock.fastForward(60000);
    if (await timer(page).count()) {
      await expect(timer(page).getByRole('status')).not.toContainText('timer finished');
      await expect(timer(page).locator('[data-hep-timer-clock]')).toBeHidden();
    }
  };
  await startTimer();
  await focusView(page).locator('[data-hep-done]').click();
  await expectCancelled();
  await focusView(page).locator('[data-hep-back]').click();
  await startTimer();
  await page.keyboard.press('Escape');
  await expect(focusView(page)).toBeHidden();
  await page.clock.fastForward(60000);
  await session(page).locator('[data-hep-resume]').click();
  await expect(timer(page).locator('[data-hep-timer-clock]')).toBeHidden();
  await expect(timer(page).getByRole('status')).toHaveText('');
  await startTimer();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.clock.fastForward(60000);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(timer(page).locator('[data-hep-timer-clock]')).toBeHidden();
  await expect(timer(page).locator('[data-hep-timer-preset]').first()).toBeEnabled();
});

test('mobile set circles, weight boxes, finish screen, and recorded details remain keyboard accessible, pass axe, and avoid overflow', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page);
  await page.evaluate(async () => { await document.fonts?.ready; });
  const accessible = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const results = await new AxeBuilder({ page }).include('[data-hep-session]').withTags(wcag).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  };
  await accessible();
  await start(page);
  await expect(focusView(page).locator('[data-hep-exercise-title]')).toBeFocused();
  await focusView(page).locator('[data-hep-set-count="1"]').focus();
  await page.keyboard.press('Enter');
  await expect(focusView(page).locator('[data-hep-set-count="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(focusView(page).locator('[data-hep-set-count="1"]')).toBeFocused();
  await focusView(page).locator('[data-hep-settings]').focus();
  await page.keyboard.press('Enter');
  await focusView(page).locator('[data-hep-record-load]').focus();
  await page.keyboard.press('Space');
  await focusView(page).locator('[data-hep-load]').fill('Light blue band with a comfortable grip');
  await accessible();
  await finishFrom(page);
  await expect(focusView(page).getByRole('heading', { name: 'Session complete', exact: true })).toBeFocused();
  await accessible();
  await save(page, 'MOBILE_WORKOUT_DETAILS');
  const disclosure = session(page).locator('.hep-workout-record');
  await expect(disclosure).toHaveJSProperty('open', false);
  await accessible();
  await disclosure.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveJSProperty('open', true);
  await expect(disclosure).toContainText('Resistance: Light blue band with a comfortable grip');
  await accessible();
});
