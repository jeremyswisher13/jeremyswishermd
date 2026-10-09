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
const guidedOrder = program => program.guidedExerciseOrder || program.exercises.map((_, index) => index);
const guidedExercises = program => guidedOrder(program).map(index => program.exercises[index]);
const guidedOptions = program => guidedOrder(program).map(index => optionsBySlug[program.slug][index]);
const storageKey = slug => `swishermd:hep-progress:v1:${slug}`;
const session = page => page.locator('[data-hep-session]');
const sets = page => session(page).locator('[data-hep-set]');
const timer = page => session(page).locator('[data-hep-timer]');
const contentTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.avif': 'image/avif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

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

async function start(page, workout = true) {
  await session(page).locator(`[data-hep-mode="${workout ? 'workout' : 'simple'}"]`).check();
  await session(page).locator('[data-hep-start]').click();
  await expect(session(page).locator('[data-hep-exercise]')).toBeVisible();
}

async function finishFrom(page, program = knee, index = 0, choice = 'done') {
  for (let current = index; current < program.exercises.length; current += 1) {
    await session(page).locator(`[data-hep-${choice}]`).click();
  }
  await expect(session(page).locator('[data-hep-save]')).toBeVisible();
}

async function save(page, notes = '') {
  await session(page).getByLabel('Session date', { exact: true }).fill('2026-10-08');
  await session(page).getByLabel('Notes (optional)', { exact: true }).fill(notes);
  await session(page).locator('[data-hep-save]').click();
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

test('simple is the default; workout drafts survive view changes and previous navigation, but skipped sets are not saved', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await expect(session(page).locator('[data-hep-mode="simple"]')).toBeChecked();
  await expect(session(page).locator('[data-hep-mode="workout"]')).not.toBeChecked();
  await session(page).locator('[data-hep-storage]').check();
  await start(page, false);
  await expect(session(page).locator('[data-hep-workout]')).toHaveCount(0);
  await session(page).locator('[data-hep-workout-toggle]').click();
  await expect(sets(page).first().locator('[data-hep-set-amount]')).toHaveValue('');
  await sets(page).first().locator('[data-hep-set-amount]').fill('11');
  await session(page).locator('[data-hep-workout-toggle]').click();
  await expect(session(page).locator('[data-hep-workout]')).toHaveCount(0);
  await session(page).locator('[data-hep-workout-toggle]').click();
  await expect(sets(page).first().locator('[data-hep-set-amount]')).toHaveValue('11');
  await expect(session(page).locator('[data-hep-exercise] dl dd')).toHaveText([knee.exercises[0].dose, knee.exercises[0].frequency]);
  await expect(session(page).locator('[data-hep-exercise] h4 + p').first()).toHaveText(knee.exercises[0].how);
  await session(page).locator('[data-hep-done]').click();
  await sets(page).first().locator('[data-hep-set-amount]').fill('13');
  await sets(page).first().locator('summary').click();
  await sets(page).first().locator('[data-hep-set-note]').fill('SKIPPED_SET_PRIVATE_DRAFT');
  await session(page).locator('[data-hep-skip]').click();
  await session(page).locator('[data-hep-back]').click();
  await expect(sets(page).first().locator('[data-hep-set-amount]')).toHaveValue('13');
  await session(page).locator('[data-hep-back]').click();
  await expect(sets(page).first().locator('[data-hep-set-amount]')).toHaveValue('11');
  await session(page).locator('[data-hep-done]').click();
  await session(page).locator('[data-hep-skip]').click();
  await finishFrom(page, knee, 2);
  await expect(session(page).locator('[data-hep-completed-count]')).toHaveText('4 done');
  await expect(session(page).locator('[data-hep-skipped-count]')).toHaveText('1 skipped');
  const preview = session(page).locator('[data-hep-review-workout] details');
  await expect(preview).toHaveJSProperty('open', false);
  await preview.locator('summary').click();
  await expect(preview.locator('.hep-workout-record-exercise').first()).toContainText('Reps: 11');
  await expect(preview.locator('.hep-workout-record-exercise').nth(1)).toContainText('Skipped');
  await expect(preview).not.toContainText('SKIPPED_SET_PRIVATE_DRAFT');
  await save(page);
  const [record] = (await readStore(page)).records;
  expect(record.workout[0].sets).toEqual([{ ...blankRecordedSet(), amount: 11 }]);
  expect(record.workout[1]).toEqual({ status: 'skipped', measure: 'reps', label: 'Reps per side', sets: [] });
  expect(JSON.stringify(record)).not.toContain('SKIPPED_SET_PRIVATE_DRAFT');
});

test('rep sets record holds, lb, kg, and descriptive bands; add/remove enforces eight sets without converting resistance', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await session(page).locator('[data-hep-storage]').check();
  await start(page);
  const first = sets(page).nth(0);
  await first.locator('[data-hep-set-amount]').fill('12');
  await first.locator('[data-hep-set-unit]').selectOption('lb');
  await first.getByLabel('Weight (lb)', { exact: true }).fill('10');
  await first.locator('summary').click();
  await first.getByLabel('Hold / timed variation (seconds, optional)', { exact: true }).fill('5');
  await first.getByLabel('Side or variation (optional)', { exact: true }).fill('Left side');
  await session(page).locator('[data-hep-add-set]').click();
  await sets(page).nth(1).locator('[data-hep-set-amount]').fill('10');
  await sets(page).nth(1).locator('[data-hep-set-unit]').selectOption('kg');
  await sets(page).nth(1).getByLabel('Weight (kg)', { exact: true }).fill('4.5');
  await session(page).locator('[data-hep-add-set]').click();
  const third = sets(page).nth(2);
  await third.locator('[data-hep-set-amount]').fill('8');
  await third.locator('[data-hep-set-unit]').selectOption('lb');
  await third.locator('[data-hep-set-load]').fill('99');
  await third.locator('[data-hep-set-unit]').selectOption('band');
  await third.getByLabel('Band / resistance description', { exact: true }).fill('Light blue band');
  await expect(third.locator('[data-hep-set-load]')).toBeHidden();
  await expect(third.locator('[data-hep-set-load]')).toBeDisabled();
  for (let index = 3; index < 8; index += 1) await session(page).locator('[data-hep-add-set]').click();
  await expect(sets(page)).toHaveCount(8);
  await expect(session(page).locator('[data-hep-add-set]')).toBeDisabled();
  for (let index = 8; index > 3; index -= 1) await sets(page).last().locator('[data-hep-remove-set]').click();
  await expect(sets(page)).toHaveCount(3);
  await expect(session(page).locator('[data-hep-add-set]')).toBeEnabled();
  await finishFrom(page);
  await save(page);
  const [record] = (await readStore(page)).records;
  expect(record.workout[0].sets).toEqual([
    { amount: 12, holdSeconds: 5, load: 10, unit: 'lb', resistance: '', note: 'Left side' },
    { ...blankRecordedSet(), amount: 10, load: 4.5, unit: 'kg' },
    { ...blankRecordedSet(), amount: 8, unit: 'band', resistance: 'Light blue band' },
  ]);
  await session(page).locator('.hep-workout-record > summary').click();
  await expect(session(page).locator('.hep-workout-record-exercise').first()).toContainText('Reps: 12 · 5-second holds · 10 lb · Left side');
  await expect(session(page).locator('.hep-workout-record-exercise').first()).toContainText('Reps: 10 · 4.5 kg');
  await expect(session(page).locator('.hep-workout-record-exercise').first()).toContainText('Reps: 8 · Band: Light blue band');
});

for (const { slug, index, measure, amount } of [
  { slug: 'achilles-tendinopathy-exercises', index: 0, measure: 'seconds', amount: '30' },
  { slug: 'low-back-pain-exercises', index: 0, measure: 'minutes', amount: '12.5' },
  { slug: 'advanced-meniscus-rehabilitation-exercises', index: 1, measure: 'contacts', amount: '24' },
]) {
  test(`${measure}: actual amounts follow reviewed guided metadata and exclude inapplicable hold/resistance fields`, async ({ context, page, baseURL }) => {
    const program = programFor(slug);
    await localOnly(context, baseURL);
    await visit(page, program);
    const payload = JSON.parse(await page.locator('#hep-session-data').textContent());
    expect(payload.exercises).toEqual(guidedExercises(program));
    expect(payload.workoutOptions).toEqual(guidedOptions(program));
    await session(page).locator('[data-hep-storage]').check();
    await start(page);
    for (let current = 0; current < index; current += 1) await session(page).locator('[data-hep-skip]').click();
    await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(guidedExercises(program)[index].name);
    await expect(session(page).locator('[data-hep-exercise] dl dd')).toHaveText([guidedExercises(program)[index].dose, guidedExercises(program)[index].frequency]);
    await sets(page).first().getByLabel(guidedOptions(program)[index].label, { exact: true }).fill(amount);
    await expect(sets(page).locator('[data-hep-set-holdSeconds], [data-hep-set-unit], [data-hep-set-load]')).toHaveCount(0);
    await session(page).locator('[data-hep-done]').click();
    await finishFrom(page, program, index + 1, 'skip');
    await save(page);
    const [record] = (await readStore(page, program)).records;
    expect(record).toMatchObject({ completed: 1, skipped: program.exercises.length - 1 });
    expect(record.workout[index]).toEqual({ status: 'done', measure, label: guidedOptions(program)[index].label, sets: [{ ...blankRecordedSet(), amount: Number(amount) }] });
  });
}

test('an invalid hidden hold cannot be bypassed by changing mode or marking done', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await start(page);
  const extra = sets(page).first().locator('details');
  await extra.locator('summary').click();
  await sets(page).first().locator('[data-hep-set-holdSeconds]').fill('3601');
  await extra.locator('summary').click();
  await session(page).locator('[data-hep-workout-toggle]').click();
  await expect(session(page).locator('[data-hep-workout]')).toBeVisible();
  await expect(extra).toHaveJSProperty('open', true);
  await session(page).locator('[data-hep-done]').click();
  await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[0].name);
  await session(page).locator('[data-hep-skip]').click();
  await session(page).locator('[data-hep-workout-toggle]').click();
  await session(page).locator('[data-hep-back]').click();
  await expect(session(page).locator('[data-hep-workout]')).toHaveCount(0);
  await session(page).locator('[data-hep-done]').click();
  await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[0].name);
  await expect(session(page).locator('[data-hep-workout]')).toBeVisible();
  await expect(sets(page).first().locator('details')).toHaveJSProperty('open', true);
  await sets(page).first().locator('[data-hep-set-holdSeconds]').fill('8');
  await session(page).locator('[data-hep-workout-toggle]').click();
  await expect(session(page).locator('[data-hep-workout]')).toHaveCount(0);
  await finishFrom(page);
  await save(page);
  await session(page).locator('.hep-workout-record > summary').click();
  await expect(session(page).locator('.hep-workout-record-exercise').first()).toContainText('Timed variation: 8 seconds');
});

test('a completed exercise edited to an invalid value resumes at that exercise and saves only after correction', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await session(page).locator('[data-hep-storage]').check();
  await start(page);
  await finishFrom(page);
  await session(page).locator('[data-hep-back]').click();
  await sets(page).first().locator('[data-hep-set-amount]').fill('10001');
  await session(page).locator('[data-hep-log]').click();
  await session(page).locator('[data-hep-resume]').click();
  await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises.at(-1).name);
  await expect(sets(page).first().locator('[data-hep-set-amount]')).toHaveValue('10001');
  await session(page).locator('[data-hep-done]').click();
  await expect(sets(page).first().locator('[data-hep-set-amount]')).toBeFocused();
  await expect(session(page).locator('[data-hep-save]')).toHaveCount(0);
  expect((await readStore(page)).records).toHaveLength(0);
  await sets(page).first().locator('[data-hep-set-amount]').fill('12');
  await session(page).locator('[data-hep-done]').click();
  await save(page, 'Corrected completed exercise');
  const [record] = (await readStore(page)).records;
  expect(record).toMatchObject({ completed: knee.exercises.length, skipped: 0 });
  expect(record.workout.at(-1).sets).toEqual([{ ...blankRecordedSet(), amount: 12 }]);
});

test('final save revalidates earlier completed sets and focuses an invalid hidden field while retaining review entries', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await session(page).locator('[data-hep-storage]').check();
  await start(page);
  await sets(page).first().locator('summary').click();
  await sets(page).first().locator('[data-hep-set-holdSeconds]').fill('5');
  // Retain the real input to model a late draft update after per-exercise validation.
  await page.evaluate(() => { window.__lateWorkoutInput = document.querySelector('[data-hep-set-holdSeconds]'); });
  await finishFrom(page);
  await session(page).getByLabel('Session date', { exact: true }).fill('2026-10-07');
  await session(page).getByLabel('Activity goal (optional)', { exact: true }).fill('Keep this review goal');
  await session(page).getByLabel('Notes (optional)', { exact: true }).fill('Keep this review note');
  await session(page).getByLabel('Next-morning response', { exact: true }).selectOption('baseline');
  await page.evaluate(() => {
    window.__lateWorkoutInput.value = '3601';
    window.__lateWorkoutInput.dispatchEvent(new Event('input', { bubbles: true }));
    delete window.__lateWorkoutInput;
  });
  await session(page).locator('[data-hep-save]').click();
  await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[0].name);
  await expect(sets(page).first().locator('details')).toHaveJSProperty('open', true);
  await expect(sets(page).first().locator('[data-hep-set-holdSeconds]')).toBeFocused();
  await expect(session(page).locator('[data-hep-status]')).toContainText(`Check the recorded set values for ${knee.exercises[0].name}`);
  expect((await readStore(page)).records).toHaveLength(0);
  await sets(page).first().locator('[data-hep-set-holdSeconds]').fill('5');
  await finishFrom(page);
  await expect(session(page).getByLabel('Session date', { exact: true })).toHaveValue('2026-10-07');
  await expect(session(page).getByLabel('Activity goal (optional)', { exact: true })).toHaveValue('Keep this review goal');
  await expect(session(page).getByLabel('Notes (optional)', { exact: true })).toHaveValue('Keep this review note');
  await expect(session(page).getByLabel('Next-morning response', { exact: true })).toHaveValue('baseline');
  await session(page).locator('[data-hep-save]').click();
  await expect(session(page).locator('[data-hep-entry]')).toHaveCount(1);
  expect((await readStore(page)).records[0].workout[0].sets).toEqual([{ ...blankRecordedSet(), holdSeconds: 5 }]);
});

test('a timed carry records time-only details in review, restored history, and the follow-up summary', async ({ context, page, baseURL }) => {
  const program = programFor('low-back-pain-exercises');
  const index = program.exercises.length - 1;
  await localOnly(context, baseURL);
  await visit(page, program);
  await session(page).locator('[data-hep-storage]').check();
  await start(page);
  for (let current = 0; current < index; current += 1) await session(page).locator('[data-hep-skip]').click();
  await sets(page).first().locator('summary').click();
  await expect(sets(page).first()).toContainText('leave the rep count blank, enter seconds, and name the variation below');
  await sets(page).first().getByLabel('Hold / timed variation (seconds, optional)', { exact: true }).fill('30');
  await sets(page).first().getByLabel('Side or variation (optional)', { exact: true }).fill('Carry');
  await session(page).locator('[data-hep-done]').click();
  const preview = session(page).locator('[data-hep-review-workout] details');
  await expect(preview).toHaveJSProperty('open', false);
  await preview.locator('summary').click();
  await expect(preview.locator('.hep-workout-record-exercise').last()).toContainText('Timed variation: 30 seconds · Carry');
  await save(page);
  const [record] = (await readStore(page, program)).records;
  expect(record.workout[index].sets).toEqual([{ ...blankRecordedSet(), holdSeconds: 30, note: 'Carry' }]);
  await page.reload();
  await session(page).locator('[data-hep-log]').click();
  await session(page).locator('.hep-workout-record > summary').click();
  await expect(session(page).locator('.hep-workout-record-exercise').last()).toContainText('Timed variation: 30 seconds · Carry');
  await page.evaluate(() => { window.print = () => { window.__timedSummary = document.querySelector('.hep-summary-printout').textContent; }; });
  await session(page).locator('[data-hep-print-summary]').click();
  expect(await page.evaluate(() => window.__timedSummary)).toContain('Timed variation: 30 seconds · Carry');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
});

test('legacy v1 records and workout records restore together; response edits preserve sets and previous sets remain a blank-field reference', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await seed(context, [legacyRecord('legacy-simple')]);
  await visit(page);
  await expect(session(page).locator('[data-hep-storage]')).toBeChecked();
  await start(page);
  await expect(session(page).locator('[data-hep-previous-sets]')).toHaveCount(0);
  await sets(page).first().locator('[data-hep-set-amount]').fill('7');
  await sets(page).first().locator('[data-hep-set-unit]').selectOption('kg');
  await sets(page).first().locator('[data-hep-set-load]').fill('5');
  await finishFrom(page);
  await save(page, 'New workout');
  const before = await readStore(page);
  expect(before.version).toBe(1);
  expect(before.records).toHaveLength(2);
  const originalWorkout = before.records.find(record => record.workout).workout;
  expect(before.records.find(record => record.id === 'legacy-simple')).not.toHaveProperty('workout');
  await session(page).locator('[data-hep-entry]').filter({ hasText: 'New workout' }).locator('[data-hep-next-response]').selectOption('baseline');
  await session(page).locator('[data-hep-entry="legacy-simple"] [data-hep-next-response]').selectOption('more-symptomatic');
  await page.reload();
  await session(page).locator('[data-hep-log]').click();
  await expect(session(page).locator('[data-hep-entry]')).toHaveCount(2);
  await expect(session(page).locator('[data-hep-entry="legacy-simple"] [data-hep-next-response]')).toHaveValue('more-symptomatic');
  await expect(session(page).locator('[data-hep-entry]').filter({ hasText: 'New workout' }).locator('[data-hep-next-response]')).toHaveValue('baseline');
  const restored = await readStore(page);
  expect(restored.records.find(record => record.workout).workout).toEqual(originalWorkout);
  await start(page);
  await expect(session(page).locator('[data-hep-previous-sets]')).toContainText('Reps: 7 · 5 kg');
  await expect(sets(page).first().locator('[data-hep-set-amount]')).toHaveValue('');
  await expect(sets(page).first().locator('[data-hep-set-unit]')).toHaveValue('none');
  await expect(sets(page).first().locator('[data-hep-set-load]')).toHaveValue('');
});

test('summary prints the latest six session counts and the most recent workout details even after newer simple sessions', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  const records = [
    ...Array.from({ length: 6 }, (_, index) => legacyRecord(`simple-${index}`, `LATEST_SIX_${index}`, 100 - index)),
    recordedWorkout('recent-workout', 'MOST_RECENT_WORKOUT_DETAIL', 90),
    recordedWorkout('older-workout', 'OLDER_WORKOUT_DETAIL', 80),
  ];
  await seed(context, records);
  await visit(page);
  await session(page).locator('[data-hep-log]').click();
  await page.evaluate(() => {
    window.print = () => {
      const summary = document.querySelector('.hep-summary-printout');
      window.__workoutPrinted = {
        text: summary.textContent,
        rows: [...summary.querySelectorAll('.hep-summary-table tbody tr')].map(row => [...row.children].map(cell => cell.textContent)),
        exerciseNames: [...summary.querySelectorAll('.hep-workout-record-exercise h4')].map(heading => heading.textContent),
        controls: summary.querySelectorAll('input, select, textarea, button').length,
      };
    };
  });
  await session(page).locator('[data-hep-print-summary]').click();
  const printed = await page.evaluate(() => window.__workoutPrinted);
  expect(printed.rows).toHaveLength(6);
  expect(printed.rows.map(row => row.slice(1, 3))).toEqual(Array.from({ length: 6 }, () => ['5', '0']));
  for (let index = 0; index < 6; index += 1) expect(printed.rows[index][4]).toContain(`LATEST_SIX_${index}`);
  expect(printed.text).toContain('MOST_RECENT_WORKOUT_DETAIL');
  expect(printed.text).not.toContain('OLDER_WORKOUT_DETAIL');
  expect(printed.exerciseNames).toEqual(guidedExercises(knee).map(exercise => exercise.name));
  expect(printed.controls).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('.hep-summary-printout')).toHaveCount(0);
  await expect(session(page).locator('[data-hep-print-summary]')).toBeEnabled();
});

test('workout fields stay in the open tab with saving off and never enter production analytics, links, or network requests', async ({ context, page }) => {
  const { origin, requests } = await offlineProduction(context);
  const privateValues = ['PRIVATE_WORKOUT_BAND_481', 'PRIVATE_WORKOUT_SIDE_792', 'PRIVATE_WORKOUT_SESSION_153'];
  await visit(page, knee, origin);
  await page.waitForLoadState('networkidle');
  const initialRequests = requests.length;
  await expect(session(page).locator('[data-hep-storage]')).not.toBeChecked();
  await start(page);
  await sets(page).first().locator('[data-hep-set-amount]').fill('17');
  await sets(page).first().locator('[data-hep-set-unit]').selectOption('band');
  await sets(page).first().locator('[data-hep-set-resistance]').fill(privateValues[0]);
  await sets(page).first().locator('summary').click();
  await sets(page).first().locator('[data-hep-set-note]').fill(privateValues[1]);
  await finishFrom(page);
  await save(page, privateValues[2]);
  await session(page).locator('.hep-workout-record > summary').click();
  for (const value of privateValues) await expect(session(page).locator('[data-hep-entry]')).toContainText(value);
  await page.evaluate(() => { window.print = () => {}; });
  await session(page).locator('[data-hep-print-summary]').click();
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  const events = await page.evaluate(() => window.__hepAnalyticsEvents);
  expect(events).toEqual([{ name: 'page_view', metadata: { page: `/${knee.slug}/`, cta_location: 'page' } }]);
  expect(requests).toHaveLength(initialRequests);
  expect(requests.every(request => request.method === 'GET' && request.body === null)).toBe(true);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug))).toBeNull();
  const destinations = await page.locator('a[href]').evaluateAll(links => links.map(link => link.href));
  const storage = await page.evaluate(() => ({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
  for (const value of privateValues) {
    for (const output of [requests, events, destinations, storage]) expect(JSON.stringify(output)).not.toContain(value);
    expect(page.url()).not.toContain(value);
  }
  await page.reload();
  await session(page).locator('[data-hep-log]').click();
  await expect(session(page).locator('[data-hep-entry]')).toHaveCount(0);
});

async function clockVisit(context, page, baseURL) {
  await localOnly(context, baseURL);
  await page.clock.install({ time: new Date('2026-10-08T12:00:00Z') });
  await visit(page);
  await page.clock.pauseAt(new Date('2026-10-08T12:01:00Z'));
  await start(page);
}

test('a user-entered timer pauses, extends, resumes, cancels, and finishes without marking or advancing an exercise', async ({ context, page, baseURL }) => {
  await clockVisit(context, page, baseURL);
  await expect(timer(page).locator('[data-hep-timer-duration]')).toHaveValue('');
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:00');
  await expect(timer(page).locator('[data-hep-timer-pause]')).toBeDisabled();
  await timer(page).locator('[data-hep-timer-start]').click();
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:00');
  await timer(page).getByLabel('Timer', { exact: true }).selectOption('hold');
  await timer(page).locator('[data-hep-timer-duration]').fill('20');
  await timer(page).locator('[data-hep-timer-start]').click();
  await page.clock.runFor(3000);
  await timer(page).locator('[data-hep-timer-pause]').click();
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:17');
  await page.clock.fastForward(60000);
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:17');
  await timer(page).locator('[data-hep-timer-extend]').click();
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:32');
  await timer(page).getByRole('button', { name: 'Resume', exact: true }).click();
  await page.clock.fastForward(32000);
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:00');
  await expect(session(page).locator('[data-hep-status]')).toContainText('Timer finished');
  await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[0].name);
  await expect(session(page).locator('progress')).toHaveJSProperty('value', 0);
  await timer(page).locator('[data-hep-timer-start]').click();
  await timer(page).locator('[data-hep-timer-extend]').click();
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:35');
  await timer(page).locator('[data-hep-timer-cancel]').click();
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:00');
  await expect(timer(page).locator('[data-hep-timer-start]')).toBeEnabled();
  await page.clock.fastForward(60000);
  await expect(session(page).locator('[data-hep-status]')).toContainText('Timer cancelled');
});

test('pausing between countdown updates immediately displays the remaining time', async ({ context, page, baseURL }) => {
  await clockVisit(context, page, baseURL);
  await timer(page).locator('[data-hep-timer-duration]').fill('20');
  await timer(page).locator('[data-hep-timer-start]').click();
  const startedAt = await page.evaluate(() => Date.now());
  // Change wall time while interval callbacks remain paused.
  await page.clock.setSystemTime(new Date(startedAt + 1050));
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:20');
  await timer(page).locator('[data-hep-timer-pause]').click();
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:19');
  await expect(timer(page).getByRole('button', { name: 'Resume', exact: true })).toBeEnabled();
  await page.clock.setSystemTime(new Date(startedAt + 11050));
  await timer(page).getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:19');
  await page.clock.runFor(1000);
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:18');
  await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[0].name);
  await expect(session(page).locator('progress')).toHaveJSProperty('value', 0);
});

test('pausing just after expiry before an interval callback finishes the timer and enables a fresh timer', async ({ context, page, baseURL }) => {
  await clockVisit(context, page, baseURL);
  await timer(page).locator('[data-hep-timer-duration]').fill('1');
  await timer(page).locator('[data-hep-timer-start]').click();
  const startedAt = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(new Date(startedAt + 1001));
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:01');
  await timer(page).locator('[data-hep-timer-pause]').click();
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:00');
  await expect(session(page).locator('[data-hep-status]')).toContainText('Timer finished');
  for (const control of ['pause', 'extend', 'cancel']) {
    await expect(timer(page).locator(`[data-hep-timer-${control}]`)).toBeDisabled();
  }
  await expect(timer(page).locator('[data-hep-timer-start]')).toBeEnabled();
  await expect(timer(page).locator('[data-hep-timer-duration]')).toBeEnabled();
  await expect(timer(page).getByLabel('Timer', { exact: true })).toBeEnabled();
  await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[0].name);
  await expect(session(page).locator('progress')).toHaveJSProperty('value', 0);
  await timer(page).locator('[data-hep-timer-duration]').fill('5');
  await timer(page).locator('[data-hep-timer-start]').click();
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:05');
});

test('returning from a hidden page uses the wall-clock deadline instead of losing time to delayed ticks', async ({ context, page, baseURL }) => {
  await clockVisit(context, page, baseURL);
  await timer(page).locator('[data-hep-timer-duration]').fill('30');
  await timer(page).locator('[data-hep-timer-start]').click();
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
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:00');
  await expect(session(page).locator('[data-hep-status]')).toContainText('Timer finished');
  await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[0].name);
  await expect(session(page).locator('progress')).toHaveJSProperty('value', 0);
});

test('changing exercise, opening history, changing mode, and cached-page navigation cancel a running timer', async ({ context, page, baseURL }) => {
  await clockVisit(context, page, baseURL);
  const startTimer = async () => {
    await timer(page).locator('[data-hep-timer-duration]').fill('30');
    await timer(page).locator('[data-hep-timer-start]').click();
  };
  const expectCancelled = async () => {
    await page.clock.fastForward(60000);
    await expect(session(page).locator('[data-hep-status]')).not.toContainText('Timer finished');
    if (await timer(page).count()) await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:00');
  };
  await startTimer();
  await session(page).locator('[data-hep-done]').click();
  await expectCancelled();
  await startTimer();
  await session(page).locator('[data-hep-log]').click();
  await expectCancelled();
  await session(page).locator('[data-hep-resume]').click();
  await expect(timer(page).locator('[data-hep-timer-duration]')).toHaveValue('');
  await startTimer();
  await session(page).locator('[data-hep-workout-toggle]').click();
  await expectCancelled();
  await session(page).locator('[data-hep-workout-toggle]').click();
  await startTimer();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.clock.fastForward(60000);
  await expect(session(page).locator('[data-hep-status]')).not.toContainText('Timer finished');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(timer(page).locator('[data-hep-timer-clock]')).toHaveText('00:00');
  await expect(timer(page).locator('[data-hep-timer-start]')).toBeEnabled();
});

test('mobile workout fields, review, and expanded recorded details remain keyboard accessible, pass axe, and avoid overflow', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page);
  await page.evaluate(async () => { await document.fonts?.ready; });
  const accessible = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const results = await new AxeBuilder({ page }).include('[data-hep-session]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  };
  await accessible();
  await start(page);
  await expect(session(page).locator('[data-hep-exercise-title]')).toBeFocused();
  await session(page).locator('.hep-session-detail > summary').focus();
  await page.keyboard.press('Enter');
  await sets(page).first().locator('[data-hep-set-amount]').fill('10');
  await sets(page).first().locator('[data-hep-set-unit]').selectOption('band');
  await sets(page).first().locator('[data-hep-set-resistance]').fill('Light blue band with a comfortable grip');
  await sets(page).first().locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(sets(page).first().locator('details')).toHaveJSProperty('open', true);
  await sets(page).first().locator('[data-hep-set-note]').fill('Left side, supported variation');
  await session(page).locator('[data-hep-add-set]').click();
  await expect(sets(page).nth(1).locator('[data-hep-set-amount]')).toBeFocused();
  await sets(page).nth(1).locator('[data-hep-set-amount]').fill('8');
  await sets(page).nth(1).locator('[data-hep-set-unit]').selectOption('kg');
  await sets(page).nth(1).locator('[data-hep-set-load]').fill('4.5');
  await accessible();
  await finishFrom(page);
  await expect(session(page).getByRole('heading', { name: 'Session review', exact: true })).toBeFocused();
  await accessible();
  await save(page, 'MOBILE_WORKOUT_DETAILS');
  const disclosure = session(page).locator('.hep-workout-record');
  await expect(disclosure).toHaveJSProperty('open', false);
  await accessible();
  await disclosure.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveJSProperty('open', true);
  await expect(disclosure).toContainText('Light blue band with a comfortable grip');
  await expect(disclosure).toContainText('Reps: 8 · 4.5 kg');
  await accessible();
});
