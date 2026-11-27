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
// The inline panel on the page, and the full-screen view an active session opens in.
const session = page => page.locator('[data-hep-session]');
const focusView = page => page.locator('[data-hep-focus]');
const contentTypes = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.avif': 'image/avif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};
const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

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

async function openIntro(page) {
  await session(page).locator('[data-hep-start]').click();
  await expect(focusView(page).locator('[data-hep-begin]')).toBeVisible();
}

async function start(page) {
  await openIntro(page);
  await focusView(page).locator('[data-hep-begin]').click();
  await expect(focusView(page).locator('[data-hep-exercise]')).toBeVisible();
}

async function finish(page, program = knee, { skip = false } = {}) {
  for (let index = 0; index < program.exercises.length; index += 1) {
    await focusView(page).locator(skip ? '[data-hep-skip]' : '[data-hep-done]').click();
  }
  await expect(focusView(page).getByRole('heading', { name: 'Session complete', exact: true })).toBeVisible();
}

async function fillEntry(page, { date = '2026-10-07', goal, notes } = {}) {
  const details = focusView(page).locator('.hep-session-log-details');
  if (!(await details.evaluate(element => element.open))) await details.locator('summary').click();
  await focusView(page).getByLabel('Session date', { exact: true }).fill(date);
  if (goal !== undefined) await focusView(page).getByLabel('Activity goal (optional)', { exact: true }).fill(goal);
  if (notes !== undefined) await focusView(page).getByLabel('Notes (optional)', { exact: true }).fill(notes);
}

// Saves a finished session (answering the save question when it is asked, or
// updating the automatic entry once saving is on) and opens the progress log.
async function saveFinished(page, entry = {}) {
  await fillEntry(page, entry);
  if (await focusView(page).locator('[data-hep-save]').count()) await focusView(page).locator('[data-hep-save]').click();
  else await focusView(page).locator('[data-hep-update-entry]').click();
  await expect(focusView(page).locator('[data-hep-saved]')).toBeVisible();
  await focusView(page).locator('[data-hep-log]').click();
  await expect(focusView(page)).toBeHidden();
  await expect(session(page).locator('[data-hep-history]')).toBeVisible();
}

async function addRecord(page, { notes = 'A short session felt manageable.', goal = 'Walk to the park.', response = 'not-checked' } = {}) {
  await start(page);
  await finish(page);
  await saveFinished(page, { notes, goal });
  const entry = session(page).locator('[data-hep-entry]').filter({ hasText: notes });
  await expect(entry).toHaveCount(1);
  if (response !== 'not-checked') await entry.locator('[data-hep-next-response]').selectOption(response);
}

async function openLog(page) {
  await session(page).locator('.hep-session-panel [data-hep-log]').click();
  await expect(session(page).locator('[data-hep-history]')).toBeVisible();
}

async function expectExercisePrescription(card, exercise) {
  await expect(card.locator('dl dt')).toHaveText(['How much', 'How often']);
  await expect(card.locator('dl dd')).toHaveText([exercise.dose, exercise.frequency]);
  await expect(card.locator(':scope > h4')).toHaveText(['How to do it']);
  await expect(card.locator(':scope > h4 + p')).toHaveText([exercise.how]);
}

test('a phone user can follow a whole session with Done always on screen and finish without saving', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page);
  await page.locator('[data-hep-launch-start]').click();
  const view = focusView(page);
  await expect(view.getByRole('heading', { name: 'Beginner Knee Osteoarthritis Exercises', exact: true })).toBeFocused();
  await expect(view.locator('.hep-session-plan li')).toHaveText(knee.exercises.map(exercise => exercise.name));
  await expect(view.locator('[data-hep-begin]')).toBeInViewport({ ratio: 1 });
  await view.locator('[data-hep-begin]').click();
  for (const exercise of knee.exercises) {
    await expect(view.locator('[data-hep-exercise-title]')).toHaveText(exercise.name);
    // The main action stays at the bottom of the screen without scrolling.
    await expect(view.locator('[data-hep-done]')).toBeInViewport({ ratio: 1 });
    await expect(view.locator('[data-hep-skip]')).toBeInViewport({ ratio: 1 });
    await view.locator('[data-hep-done]').click();
  }
  await expect(view.getByRole('heading', { name: 'Session complete', exact: true })).toBeFocused();
  await expect(view.locator('.hep-session-log-details')).toHaveJSProperty('open', false);
  await expect(view.locator('[data-hep-save-panel]')).toContainText('Anyone using this browser can see saved entries.');
  const notNow = view.locator('[data-hep-finish]');
  await expect(notNow).toBeInViewport({ ratio: 1 });
  await notNow.click();
  await expect(view).toBeHidden();
  await expect(session(page).getByRole('heading', { name: 'Your next session', exact: true })).toBeFocused();
  await expect(session(page).locator('[data-hep-status]')).toHaveText('Session finished without a log entry.');
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug))).toBeNull();
  await openLog(page);
  await expect(session(page).locator('[data-hep-history]')).toContainText('No entries yet');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('all 28 maintained programs have unique routes and enable guided sessions', () => {
  expect(programs).toHaveLength(28);
  expect(new Set(programs.map(program => program.slug)).size).toBe(programs.length);
  expect(programs.every(program => program.guidedSession === true)).toBe(true);
  expect(advancedMeniscus.guidedExerciseOrder).toEqual([3, 4, 5, 0, 1, 2]);
  expect(advancedMeniscus.firstStrengthExercise).toBe(0);
  expect(advancedMeniscus.programIntro).toContain('Perform impact work before heavy strength when both occur in one session.');
  for (const program of programs.filter(program => program.slug !== advancedMeniscus.slug)) {
    expect(program.guidedExerciseOrder).toBeUndefined();
    expect(program.firstStrengthExercise).toBeUndefined();
  }
});

test('advanced meniscus strength shortcut leaves impact drills unmarked until the patient decides', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, advancedMeniscus);
  const view = focusView(page);
  const title = view.locator('[data-hep-exercise-title]');
  const progress = view.getByRole('progressbar');
  const jump = view.getByRole('button', { name: 'Go to strength exercises' });
  await start(page);
  await expect(title).toHaveText(guidedExercises(advancedMeniscus)[0].name);
  await jump.press('Enter');
  await expect(title).toBeFocused();
  await expect(title).toHaveText(advancedMeniscus.exercises[0].name);
  await expect(progress).toHaveJSProperty('value', 0);
  await view.locator('[data-hep-set-count="1"]').click();
  for (const exercise of advancedMeniscus.exercises.slice(0, 3)) {
    await expect(title).toHaveText(exercise.name);
    await view.locator('[data-hep-done]').click();
  }
  await expect(view.getByRole('heading', { name: 'Almost done', exact: true })).toBeFocused();
  await expect(view.locator('[data-hep-completed-count]')).toHaveText('3 done');
  await expect(view.locator('[data-hep-skipped-count]')).toHaveText('0 skipped');
  await expect(view.locator('[data-hep-save]')).toHaveCount(0);
  await view.getByRole('button', { name: 'Return to unmarked exercises' }).click();
  await expect(title).toHaveText(guidedExercises(advancedMeniscus)[0].name);
  await expect(progress).toHaveJSProperty('value', 3);
  await view.locator('[data-hep-skip]').click();
  await view.locator('[data-hep-back]').click();
  await jump.click();
  await expect(view.locator('[data-hep-set-count="1"]')).toHaveAttribute('aria-pressed', 'true');
  for (let i = 0; i < 3; i++) await view.locator('[data-hep-done]').click();
  await expect(view.locator('[data-hep-skipped-count]')).toHaveText('1 skipped');
  await view.getByRole('button', { name: 'Mark 2 as skipped' }).click();
  await expect(view.locator('[data-hep-completed-count]')).toHaveText('3 done');
  await expect(view.locator('[data-hep-skipped-count]')).toHaveText('3 skipped');
  await view.locator('[data-hep-save]').click();
  await expect(view.locator('[data-hep-saved]')).toBeFocused();
  await page.reload();
  await openLog(page);
  await expect(session(page).locator('[data-hep-history]')).toContainText('3 done · 3 skipped');
  await expect(session(page).locator('[data-hep-entry]')).toContainText(`Sets: ${advancedMeniscus.exercises[0].name} 1`);
  const [record] = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).records, storageKey(advancedMeniscus.slug));
  expect(record).toMatchObject({ completed: 3, skipped: 3, setCounts: [0, 0, 0, 1, 0, 0] });
  expect(record.workout).toBeUndefined();
});

test('the final unmarked exercise offers to finish even when it is in the middle of the program', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page, advancedMeniscus);
  await start(page);
  const view = focusView(page);
  await view.locator('[data-hep-strength-start]').click();
  for (let index = 0; index < 3; index++) await view.locator('[data-hep-done]').click();
  await view.getByRole('button', { name: 'Return to unmarked exercises' }).click();
  await view.locator('[data-hep-skip]').click();
  await view.locator('[data-hep-skip]').click();
  await expect(view.locator('[data-hep-exercise-title]')).toHaveAccessibleDescription('Exercise 3 of 6');
  await expect(view.locator('[data-hep-done]')).toHaveText('Done & finish');
  await view.getByRole('button', { name: 'Skip & finish' }).click();
  await expect(view.getByRole('heading', { name: 'Session complete', exact: true })).toBeFocused();
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
    await expect(session(page).locator('.hep-session-panel')).toContainText(program.frequency);
    const heroGuide = page.locator('.landing-hero .hep-start-guide');
    await expect(heroGuide).toHaveJSProperty('open', false);
    await heroGuide.locator('summary').click();
    await expect(heroGuide.locator('p')).toHaveText(program.programIntro);
    await expect(heroGuide.locator('a')).toHaveCount(2);
    await expect(heroGuide.locator('a').first()).toHaveAttribute('href', '#fit');
    await expect(heroGuide.locator('a').last()).toHaveAttribute('href', '#progress');
    const plan = session(page).locator('.hep-session-safety');
    await expect(plan).toHaveJSProperty('open', false);
    await plan.locator('summary').click();
    await expect(plan.getByText(program.programIntro, { exact: true })).toBeVisible();
    await expect(plan.getByRole('link', { name: 'When to move to the next stage' })).toHaveAttribute('href', '#progress');
    await plan.locator('summary').click();

    await openIntro(page);
    const view = focusView(page);
    await expect(view.locator('.hep-first-stage')).toContainText(program.progression[0].text);
    await expect(view.locator('.hep-session-plan li')).toHaveText(exercises.map(exercise => exercise.name));
    await expect(view.locator('[data-hep-stop-signs]')).toHaveJSProperty('open', false);
    await view.locator('[data-hep-stop-signs] summary').click();
    await expect(view.locator('[data-hep-stop-signs] p')).toHaveText(program.red);
    await view.locator('[data-hep-begin]').click();
    const first = view.locator('[data-hep-exercise]');
    if (program.firstStrengthExercise !== undefined) {
      await expect(first.locator('.hep-first-stage + [data-hep-strength-start] + dl')).toHaveCount(1);
    } else {
      await expect(first.locator('.hep-first-stage')).toHaveCount(0);
    }
    for (const [index, exercise] of exercises.entries()) {
      const card = view.locator('[data-hep-exercise]');
      await expect(card.locator('[data-hep-exercise-title]')).toHaveText(exercise.name);
      await expect(card.locator('[data-hep-exercise-title]')).toHaveAccessibleDescription(`Exercise ${index + 1} of ${exercises.length}`);
      await expect(view.locator('[data-hep-done]')).toHaveText(index === exercises.length - 1 ? 'Done & finish' : 'Done');
      await expect(view.locator('[data-hep-skip]')).toHaveText(index === exercises.length - 1 ? 'Skip & finish' : 'Skip');
      await expectExercisePrescription(card, exercise);
      if (data.timerOptions?.[exercise.name]?.length) await expect(card.locator('[data-hep-timer]')).toHaveCount(1);
      for (const instruction of [exercise.name, exercise.dose, exercise.frequency, exercise.how]) await expect(card).toContainText(instruction);
      await card.locator('[data-hep-easier]').click();
      await expect(card.locator('#hep-session-modifier p')).toHaveText(exercise.easier);
      await view.locator('[data-hep-done]').click();
    }
    for (const rule of [program.responseIntro, program.green, program.yellow, program.red]) {
      await expect(view.locator('.hep-session-check-in')).toContainText(rule);
    }
    await expect(view.locator('[data-hep-completed-count]')).toHaveText(`${program.exercises.length} done`);
    await expect(view.locator('[data-hep-skipped-count]')).toHaveText('0 skipped');
    await view.locator('[data-hep-back]').click();
    await expect(view.locator('[data-hep-exercise-title]')).toHaveText(exercises.at(-1).name);
    await expectExercisePrescription(view.locator('[data-hep-exercise]'), exercises.at(-1));
    await expect(page.locator('#program .exercise-item')).toHaveCount(program.exercises.length);
  });
}

for (const program of programs) {
  test(`${program.slug}: easier and harder versions start hidden and reveal the maintained wording without changing the prescription`, async ({ context, page, baseURL }) => {
    await localOnly(context, baseURL);
    await visit(page, program);
    await expect(session(page).locator('.hep-session-panel dl dd').first()).toHaveText(program.frequency);
    await expect(page.locator('#progress')).toHaveCount(1);
    await start(page);
    for (const exercise of guidedExercises(program)) {
      const card = focusView(page).locator('[data-hep-exercise]');
      const easier = card.locator('[data-hep-easier]');
      const harder = card.locator('[data-hep-harder]');
      const box = card.locator('#hep-session-modifier');
      const readinessLink = box.getByRole('link', { name: 'When to move to the next stage', exact: true });
      await expect(card.locator('[data-hep-exercise-title]')).toHaveText(exercise.name);
      await expect(easier).toHaveAttribute('aria-expanded', 'false');
      await expect(harder).toHaveAttribute('aria-expanded', 'false');
      await expect(box).toBeHidden();
      await expectExercisePrescription(card, exercise);

      await harder.focus();
      await page.keyboard.press('Enter');
      await expect(harder).toHaveAttribute('aria-expanded', 'true');
      await expect(box.locator('p')).toHaveText(exercise.harder);
      await expect(readinessLink).toHaveAttribute('href', '#progress');
      await expect(harder).toBeFocused();
      await expectExercisePrescription(card, exercise);

      await easier.click();
      await expect(easier).toHaveAttribute('aria-expanded', 'true');
      await expect(harder).toHaveAttribute('aria-expanded', 'false');
      await expect(box.locator('p')).toHaveText(exercise.easier);
      await expect(readinessLink).toHaveCount(0);
      await easier.focus();
      await page.keyboard.press('Space');
      await expect(box).toBeHidden();
      await expectExercisePrescription(card, exercise);
      await focusView(page).locator('[data-hep-done]').click();
    }
    await expect(focusView(page).locator('[data-hep-completed-count]')).toHaveText(`${program.exercises.length} done`);
    await expect(focusView(page).locator('[data-hep-skipped-count]')).toHaveText('0 skipped');
  });
}

for (const slug of [
  'insertional-achilles-tendinopathy-exercises',
  'proximal-hamstring-tendinopathy-exercises',
  'rotator-cuff-return-to-throwing-exercises',
]) {
  test(`${slug}: mobile users can check later-stage criteria and stop signs from an active exercise, then resume`, async ({ context, page, baseURL }) => {
    const program = programFor(slug);
    await localOnly(context, baseURL);
    await page.setViewportSize({ width: 390, height: 844 });
    await visit(page, program);
    await page.locator('[data-hep-launch-start]').click();
    const view = focusView(page);
    await expect(view.locator('.hep-first-stage')).toContainText(program.progression[0].text);
    await view.locator('[data-hep-begin]').click();
    const exercises = guidedExercises(program);
    for (let index = 1; index < exercises.length; index += 1) await view.locator('[data-hep-skip]').click();
    const finalExercise = exercises.at(-1);
    const card = view.locator('[data-hep-exercise]');
    await expect(card.locator('[data-hep-exercise-title]')).toHaveText(finalExercise.name);
    await expectExercisePrescription(card, finalExercise);
    await card.locator('[data-hep-harder]').click();
    await expect(card.getByText(finalExercise.harder, { exact: true })).toBeVisible();
    await card.getByRole('link', { name: 'When to move to the next stage' }).click();
    await expect(view).toBeHidden();
    await expect(page).toHaveURL(new RegExp('/' + slug + '/#progress$'));
    await expect(page.locator('#progress h2')).toBeInViewport();
    await expect(page.locator('#progress .care-step p')).toHaveText(program.progression.map(stage => stage.text));
    await expect(page.locator('#progress .readiness-block li')).toHaveText(program.readyItems);
    await page.goBack();
    await expect(session(page).getByRole('heading', { name: 'Session in progress', exact: true })).toBeVisible();
    await session(page).locator('[data-hep-resume]').click();
    await expect(card.locator('[data-hep-exercise-title]')).toHaveText(finalExercise.name);
    await card.locator('[data-hep-stop-signs] summary').click();
    await expect(card.getByText(program.red, { exact: true })).toBeVisible();
    await card.getByRole('link', { name: 'Read the full program fit & safety guidance' }).click();
    await expect(view).toBeHidden();
    await expect(page.locator('#fit h2')).toBeInViewport();
    await expect(page.locator('#fit .urgent-panel p')).toHaveText(program.redFlags);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
}

test('browser Back from the guided session reveals the previous section and keeps the current exercise', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await page.goto(`/${knee.slug}/#fit`);
  await page.locator('[data-hep-launch-start]').click();
  const view = focusView(page);
  await view.locator('[data-hep-begin]').click();
  await view.locator('[data-hep-done]').click();
  await page.goBack();
  await expect(page).toHaveURL(/#fit$/);
  await expect(view).toBeHidden();
  await expect(page.locator('#fit h2')).toBeFocused();
  await expect(page.locator('#fit h2')).toBeInViewport();
  await session(page).locator('[data-hep-resume]').click();
  await expect(view.locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[1].name);
});

test('closing the session pauses it; Return to session continues where the patient left off', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await start(page);
  const view = focusView(page);
  await view.locator('[data-hep-done]').click();
  await view.locator('[data-hep-set-count="2"]').click();
  await page.keyboard.press('Escape');
  await expect(view).toBeHidden();
  await expect(session(page).getByRole('heading', { name: 'Session in progress', exact: true })).toBeFocused();
  await expect(session(page).locator('.hep-session-panel')).toContainText(`Exercise 2 of ${knee.exercises.length}: ${knee.exercises[1].name}`);
  await session(page).locator('[data-hep-resume]').click();
  await expect(view.locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[1].name);
  await expect(view.locator('[data-hep-set-count="2"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(view.getByRole('progressbar')).toHaveJSProperty('value', 1);
  await view.locator('[data-hep-close]').click();
  await session(page).locator('[data-hep-restart]').click();
  await view.locator('[data-hep-begin]').click();
  await expect(view.locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[0].name);
  await expect(view.getByRole('progressbar')).toHaveJSProperty('value', 0);
});

test('done, skip, and previous exercise replace a decision without double-counting', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await start(page);
  const view = focusView(page);
  await view.locator('[data-hep-done]').click();
  await view.locator('[data-hep-skip]').click();
  await view.locator('[data-hep-back]').click();
  await expect(view.locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[1].name);
  await expect(view.locator('[data-hep-exercise]')).toContainText('Previously marked skipped');
  await view.locator('[data-hep-done]').click();
  await view.locator('[data-hep-back]').click();
  await view.locator('[data-hep-skip]').click();
  for (let index = 2; index < knee.exercises.length; index += 1) {
    await view.locator('[data-hep-done]').click();
  }
  await expect(view.locator('[data-hep-completed-count]')).toHaveText(`${knee.exercises.length - 1} done`);
  await expect(view.locator('[data-hep-skipped-count]')).toHaveText('1 skipped');
  await view.locator('[data-hep-back]').click();
  await expect(view.locator('[data-hep-exercise-title]')).toHaveText(knee.exercises.at(-1).name);
  await view.locator('[data-hep-skip]').click();
  await expect(view.locator('[data-hep-completed-count]')).toHaveText(`${knee.exercises.length - 2} done`);
  await expect(view.locator('[data-hep-skipped-count]')).toHaveText('2 skipped');
  await view.locator('[data-hep-save]').click();
  await view.locator('[data-hep-log]').click();
  await expect(session(page).locator('[data-hep-entry]')).toHaveCount(1);
  await expect(session(page).locator('[data-hep-entry]')).toContainText(`${knee.exercises.length - 2} done · 2 skipped`);
});

test('saving is off by default and private session details never enter requests, URLs, or analytics', async ({ context, page }) => {
  const { origin, requests } = await offlineProduction(context);
  const privateNote = 'PRIVATE_HEP_NOTE_2026_OCT07';
  const privateGoal = 'PRIVATE_HEP_GOAL_PARK_390';
  await visit(page, knee, origin);
  await openLog(page);
  await expect(session(page).locator('[data-hep-storage]')).not.toBeChecked();
  // A finished session that is not saved leaves nothing behind.
  await start(page);
  await finish(page);
  await fillEntry(page, { notes: 'UNSAVED_PRIVATE_NOTE', goal: 'UNSAVED_PRIVATE_GOAL' });
  await focusView(page).locator('[data-hep-finish]').click();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug))).toBeNull();
  const unsavedStorage = await page.evaluate(() => ({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
  expect(JSON.stringify(unsavedStorage)).not.toContain('UNSAVED_PRIVATE');
  // A saved session stays in this browser only.
  await addRecord(page, { notes: privateNote, goal: privateGoal, response: 'more-symptomatic' });
  await page.evaluate(() => { window.print = () => {}; });
  await session(page).locator('[data-hep-print-summary]').click();
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(session(page).locator('[data-hep-storage]')).toBeChecked();
  const events = await page.evaluate(() => window.__hepAnalyticsEvents);
  expect(events).toEqual([{ name: 'page_view', metadata: { page: `/${knee.slug}/`, cta_location: 'page' } }]);
  const destinations = await page.locator('a[href]').evaluateAll(links => links.map(link => link.href));
  for (const privateValue of [privateNote, privateGoal, 'UNSAVED_PRIVATE_NOTE', 'UNSAVED_PRIVATE_GOAL']) {
    expect(JSON.stringify(requests)).not.toContain(privateValue);
    expect(JSON.stringify(events)).not.toContain(privateValue);
    expect(page.url()).not.toContain(privateValue);
    expect(JSON.stringify(destinations)).not.toContain(privateValue);
  }
  const stored = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('swishermd:hep-progress')));
  expect(stored).toEqual([storageKey(knee.slug)]);
});

for (const keep of [false, true]) {
  test(`reload ${keep ? 'restores a saved session' : 'keeps nothing from a session that was not saved'} and never restores an in-progress session`, async ({ context, page, baseURL }) => {
    await localOnly(context, baseURL);
    await visit(page);
    await openLog(page);
    const storageHelp = session(page).locator('#hep-session-storage-help');
    await expect(session(page).locator('[data-hep-storage]')).not.toBeChecked();
    await expect(storageHelp).toHaveText('Saving is off. Unsaved entries can be lost if you refresh, leave this page, or close the tab.');
    await expect(session(page).locator('.hep-session-storage')).toContainText('An unfinished session, including tapped sets and timers, is not saved');
    await expect(session(page).locator('.hep-session-storage')).toContainText('even when saving is on.');
    await start(page);
    await finish(page);
    if (keep) {
      await saveFinished(page, { notes: 'COMPLETED_ENTRY_RELOAD_SENTINEL' });
      await expect(storageHelp).toContainText('Up to 30 completed log entries and your activity goal are kept.');
    } else {
      await focusView(page).locator('[data-hep-finish]').click();
    }
    await session(page).locator('[data-hep-start]').click();
    await focusView(page).locator('[data-hep-begin]').click();
    await focusView(page).locator('[data-hep-set-count="2"]').click();
    await focusView(page).locator('[data-hep-done]').click();
    await focusView(page).locator('[data-hep-set-count="1"]').click();
    await expect(focusView(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[1].name);
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey(knee.slug));
    if (keep) {
      expect(saved.records).toHaveLength(1);
      expect(saved.records[0].notes).toBe('COMPLETED_ENTRY_RELOAD_SENTINEL');
      expect(saved.records[0].setCounts).toBeUndefined();
    } else {
      expect(saved).toBeNull();
    }

    await page.reload();
    await expect(session(page).getByRole('heading', { name: 'Your next session', exact: true })).toBeVisible();
    await expect(focusView(page)).toBeHidden();
    await expect(session(page).locator('[data-hep-resume]')).toHaveCount(0);
    await openLog(page);
    await expect(session(page).locator('[data-hep-storage]')).toBeChecked({ checked: keep });
    await expect(session(page).locator('[data-hep-entry]')).toHaveCount(keep ? 1 : 0);
    if (keep) await expect(session(page).locator('[data-hep-history]')).toContainText('COMPLETED_ENTRY_RELOAD_SENTINEL');
    await session(page).locator('[data-hep-start]').click();
    await focusView(page).locator('[data-hep-begin]').click();
    await expect(focusView(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[0].name);
    await expect(focusView(page).locator('[data-hep-set-count][aria-pressed="true"]')).toHaveCount(0);
  });
}

test('once saving is on, later sessions save automatically and a note can be added afterward', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await addRecord(page, { notes: 'FIRST_SAVED_SESSION' });
  await start(page);
  await focusView(page).locator('[data-hep-set-count="3"]').click();
  await finish(page);
  const view = focusView(page);
  await expect(view.locator('[data-hep-save]')).toHaveCount(0);
  await expect(view.locator('[data-hep-saved]')).toHaveText('Saved to your progress log on this device.');
  await expect(view.getByRole('heading', { name: 'Session complete', exact: true })).toBeFocused();
  let store = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey(knee.slug));
  expect(store.records).toHaveLength(2);
  expect(store.records[0]).toMatchObject({ notes: '', setCounts: [3, 0, 0, 0, 0] });
  await fillEntry(page, { notes: 'ADDED_AFTER_AUTOMATIC_SAVE', date: '2026-10-09' });
  await view.locator('[data-hep-update-entry]').click();
  store = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey(knee.slug));
  expect(store.records).toHaveLength(2);
  expect(store.records[0]).toMatchObject({ notes: 'ADDED_AFTER_AUTOMATIC_SAVE', date: '2026-10-09', setCounts: [3, 0, 0, 0, 0] });
  await view.locator('[data-hep-finish-done]').click();
  await expect(view).toBeHidden();
  await expect(session(page).locator('[data-hep-status]')).toHaveText('Session finished and saved on this device.');
  await openLog(page);
  await expect(session(page).locator('[data-hep-entry]').first()).toContainText(`Sets: ${knee.exercises[0].name} 3`);
});

test('exercise privacy explains opt-in saving and the loss of unfinished sessions', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await page.goto('/privacy/#exercise-progress');
  const privacy = page.locator('#exercise-progress');
  await expect(privacy).toContainText('Saving is off by default.');
  await expect(privacy).toContainText('At the end of a session, the program asks whether to save it on this device. Choosing Save session turns saving on for that program, and later sessions save automatically.');
  await expect(privacy).toContainText('You can turn saving off from the program’s progress log with Keep my progress on this device.');
  await expect(privacy).toContainText('An unfinished session, including tapped sets and timers, is not saved. Refreshing, leaving the program page, or closing the tab can erase it, even when saving is on.');
});

test('saved progress restores and syncs across tabs; turning saving off removes only this program key', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  const otherKey = storageKey(rotatorCuff.slug);
  await context.addInitScript(({ otherKey }) => {
    if (localStorage.getItem(otherKey) === null) localStorage.setItem(otherKey, 'other-program-sentinel');
    if (localStorage.getItem('unrelated-setting') === null) localStorage.setItem('unrelated-setting', 'keep-me');
  }, { otherKey });
  await visit(page);
  await addRecord(page, { notes: 'RESTORED_PROGRESS_SENTINEL' });
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey(knee.slug));
  expect(saved.version).toBe(1);
  expect(saved.slug).toBe(knee.slug);
  expect(saved.records).toHaveLength(1);
  expect(saved.records[0]).toMatchObject({ completed: knee.exercises.length, skipped: 0, notes: 'RESTORED_PROGRESS_SENTINEL' });
  await start(page);
  const peer = await context.newPage();
  await visit(peer);
  await openLog(peer);
  await expect(session(peer).locator('[data-hep-storage]')).toBeChecked();
  await addRecord(peer, { notes: 'SECOND_TAB_PROGRESS_SENTINEL' });
  await expect(focusView(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[0].name);
  await finish(page);
  await saveFinished(page, { notes: 'ACTIVE_FIRST_TAB_SENTINEL' });
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
  await openLog(page);
  await expect(session(page).locator('[data-hep-storage]')).toBeChecked();
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
  await openLog(page);
  await expect(session(page).locator('[data-hep-storage]')).not.toBeChecked();
  await peer.close();
});

test('blocked reads and quota failures keep the session usable and say why it cannot be saved', async ({ browser, baseURL }) => {
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
      await start(page);
      await finish(page);
      const view = focusView(page);
      if (failure === 'read-blocked') {
        await expect(view.locator('[data-hep-save-panel]')).toContainText('This browser is blocking storage, so this session can’t be saved here.');
        await expect(view.locator('[data-hep-save]')).toHaveCount(0);
        await view.locator('[data-hep-finish-done]').click();
      } else {
        await fillEntry(page, { notes: 'STORAGE_FAILURE_write-blocked' });
        await view.locator('[data-hep-save]').click();
        await expect(view.locator('[data-hep-saved]')).toContainText('Added to your progress log for this visit.');
        await expect(session(page).locator('[data-hep-status]')).toContainText('Progress could not be saved on this device.');
        await view.locator('[data-hep-log]').click();
        await expect(session(page).locator('[data-hep-history]')).toContainText('STORAGE_FAILURE_write-blocked');
        await expect(session(page).locator('[data-hep-storage]')).toBeDisabled();
      }
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
    JSON.stringify({ version: 1, slug: knee.slug, goal: '', records: [{ id: 'bad-sets', date: '2026-10-07', completed: 5, skipped: 0, response: 'baseline', notes: 'UNSAFE_RECORD_SENTINEL', goal: '', setCounts: [99, 0, 0, 0, 0] }] }),
  ]) {
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: storageKey(knee.slug), raw });
    await page.reload();
    await expect(session(page)).toBeVisible();
    await openLog(page);
    await expect(session(page).locator('[data-hep-storage]')).not.toBeChecked();
    await expect(session(page).locator('[data-hep-history]')).not.toContainText('UNSAFE_RECORD_SENTINEL');
    await start(page);
    await expect(focusView(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[0].name);
  }
  expect(errors).toEqual([]);
});

test('next-morning response edits survive reload and notes remain plain text in history and summary', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  const note = '<img src=x onerror="window.__hepNoteExecuted=true"> PRIVATE_NOTE_TEXT';
  await visit(page);
  await addRecord(page, { notes: note });
  await session(page).locator('[data-hep-next-response]').selectOption('more-symptomatic');
  await session(page).locator('[data-hep-next-response]').selectOption('baseline');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).records[0].response, storageKey(knee.slug))).toBe('baseline');
  await session(page).locator('[data-hep-next-response]').selectOption('more-symptomatic');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).records[0].response, storageKey(knee.slug))).toBe('more-symptomatic');
  await page.reload();
  await openLog(page);
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
  await addRecord(page, { notes: 'CLEAR_CONFIRM_SENTINEL' });
  const peer = await context.newPage();
  await visit(peer);
  await openLog(peer);
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
  await expect(session(peer).locator('[data-hep-entry]')).toHaveCount(0);
  await expect(session(peer).locator('[data-hep-print-summary]')).toBeDisabled();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug))).toBeNull();
  await session(peer).locator('[data-hep-storage]').check();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey(knee.slug))).toMatchObject({ goal: '', records: [] });
  await peer.close();
});

test('a clear in another tab withdraws an automatic save but keeps the open finish-screen note', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await addRecord(page, { notes: 'SAVED_LOCAL_ENTRY', goal: 'SAVED_GOAL' });
  const peer = await context.newPage();
  await visit(peer);
  await start(peer);
  await finish(peer, knee, { skip: true });
  const peerView = focusView(peer);
  await expect(peerView.locator('[data-hep-saved]')).toBeVisible();
  await fillEntry(peer, { notes: 'IN_PROGRESS_PEER_NOTE' });
  await expect(peerView.getByLabel('Activity goal (optional)', { exact: true })).toHaveValue('SAVED_GOAL');

  await session(page).locator('[data-hep-clear]').click();
  await session(page).locator('[data-hep-confirm-clear]').click();
  await expect(peerView.locator('[data-hep-saved]')).toHaveCount(0);
  await expect(peerView.locator('[data-hep-save]')).toBeVisible();
  await expect(peerView.getByLabel('Activity goal (optional)', { exact: true })).toHaveValue('');
  await expect(peerView.getByLabel('Notes (optional)', { exact: true })).toHaveValue('IN_PROGRESS_PEER_NOTE');
  await expect(peerView.locator('[data-hep-skipped-count]')).toHaveText(`${knee.exercises.length} skipped`);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug))).toBeNull();
  await peerView.locator('[data-hep-save]').click();
  await peerView.locator('[data-hep-log]').click();
  await expect(session(peer).locator('[data-hep-entry]')).toHaveCount(1);
  await expect(session(peer).locator('[data-hep-history]')).toContainText('IN_PROGRESS_PEER_NOTE');
  await expect(session(peer).locator('[data-hep-history]')).not.toContainText('SAVED_LOCAL_ENTRY');
});

test('an older write that races with a confirmed clear cannot restore deleted progress', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await addRecord(page, { notes: 'IN_FLIGHT_ENTRY' });
  await page.evaluate(key => {
    const setItem = Storage.prototype.setItem;
    const removeItem = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) {
        // Interleave another tab's clear after this tab read the old key.
        removeItem.call(this, key);
        setItem.call(this, `${key}:clear`, 'simulated-clear-revision');
      }
      setItem.call(this, name, value);
    };
    // A subsequent removal may be blocked even though writes are allowed.
    Storage.prototype.removeItem = function (name) {
      if (name === key) throw new DOMException('Storage unavailable', 'SecurityError');
      removeItem.call(this, name);
    };
  }, storageKey(knee.slug));
  await session(page).locator('[data-hep-next-response]').selectOption('baseline');
  await expect(session(page).locator('[data-hep-entry]')).toHaveCount(0);
  await expect(session(page).locator('[data-hep-storage]')).not.toBeChecked();

  const peer = await context.newPage();
  await visit(peer);
  await openLog(peer);
  await expect(session(peer).locator('[data-hep-storage]')).not.toBeChecked();
  await expect(session(peer).locator('[data-hep-entry]')).toHaveCount(0);
  await session(peer).locator('[data-hep-storage]').check();
  expect(await peer.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey(knee.slug))).toMatchObject({ goal: '', records: [] });
});

test('clear still reaches open tabs if browser storage refuses the clear signal', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await addRecord(page, { notes: 'PEER_CLEAR_FALLBACK' });
  const peer = await context.newPage();
  await visit(peer);
  await openLog(peer);
  await expect(session(peer).locator('[data-hep-history]')).toContainText('PEER_CLEAR_FALLBACK');
  await page.evaluate(key => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === `${key}:clear`) throw new DOMException('Storage unavailable', 'QuotaExceededError');
      setItem.call(this, name, value);
    };
  }, storageKey(knee.slug));
  await session(page).locator('[data-hep-clear]').click();
  await session(page).locator('[data-hep-confirm-clear]').click();
  await expect(session(peer).locator('[data-hep-entry]')).toHaveCount(0);
  await expect(session(peer).locator('[data-hep-storage]')).not.toBeChecked();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug))).toBeNull();
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
  await expect(page.locator('.hep-summary-printout')).toContainText('Latest 1 entry');
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

test('the program video sits right after the guided session and before the written program', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  for (const program of programs.filter(item => item.video)) {
    await page.goto(`/${program.slug}/`);
    const order = await page.evaluate(() => ['guided-session', 'video', 'program'].map(id => {
      const element = document.getElementById(id);
      return element ? [...document.querySelectorAll('section[id]')].indexOf(element) : -1;
    }));
    expect(order[0], program.slug).toBeGreaterThanOrEqual(0);
    expect(order[1], program.slug).toBe(order[0] + 1);
    expect(order[2], program.slug).toBe(order[1] + 1);
    await expect(page.locator('#video .section-intro')).toContainText('The written program below remains the prescription.');
    await expect(session(page).getByRole('link', { name: 'Watch the exercise video' })).toHaveAttribute('href', '#video');
  }
});

for (const program of mobilePrograms) {
  test(`${program.slug}: the mobile session supports keyboard focus, avoids overflow, and passes axe in active views`, async ({ context, page, baseURL }) => {
    await localOnly(context, baseURL);
    await page.setViewportSize({ width: 390, height: 844 });
    await visit(page, program);
    const view = focusView(page);
    const accessible = async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.evaluate(async () => { await document.fonts?.ready; });
      const results = await new AxeBuilder({ page }).include('[data-hep-session]').withTags(wcag).analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    };
    await page.locator('[data-hep-launch-start]').focus();
    await page.keyboard.press('Enter');
    await expect(view.locator('#hep-focus-title')).toBeFocused();
    await accessible();
    await view.locator('[data-hep-begin]').focus();
    await page.keyboard.press('Enter');
    const exerciseTitle = view.locator('[data-hep-exercise-title]');
    const assertStepIsInView = async index => {
      await expect(exerciseTitle).toBeFocused();
      await expect(exerciseTitle).toHaveAccessibleDescription(`Exercise ${index + 1} of ${program.exercises.length}`);
      await expect(exerciseTitle).toBeInViewport({ ratio: 1 });
      await expect(view.locator('[data-hep-close]')).toBeInViewport({ ratio: 1 });
      await expect(view.locator('[data-hep-done]')).toBeInViewport({ ratio: 1 });
    };
    await assertStepIsInView(0);
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({ tag: document.activeElement.tagName, inside: Boolean(document.activeElement.closest('[data-hep-focus]')) }));
    expect(focus.inside).toBe(true);
    expect(['BUTTON', 'SUMMARY', 'A']).toContain(focus.tag);
    const harderToggle = view.locator('[data-hep-harder]');
    await harderToggle.focus();
    await page.keyboard.press('Enter');
    await expect(harderToggle).toBeFocused();
    await expect(view.locator('#hep-session-modifier p')).toHaveText(guidedExercises(program)[0].harder);
    await accessible();
    await view.locator('[data-hep-done]').click();
    await assertStepIsInView(1);
    for (let index = 1; index < program.exercises.length; index += 1) await view.locator('[data-hep-done]').click();
    await expect(view.getByRole('heading', { name: 'Session complete', exact: true })).toBeFocused();
    await accessible();
    await page.keyboard.press('Escape');
    await expect(view).toBeHidden();
    await expect(session(page).getByRole('heading', { name: 'Session in progress', exact: true })).toBeFocused();
    await accessible();
  });
}
