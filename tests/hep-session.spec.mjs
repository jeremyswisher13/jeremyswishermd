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
  await expect(card.locator('dl dt')).toHaveText(['How much', 'How often']);
  await expect(card.locator('dl dd')).toHaveText([exercise.dose, exercise.frequency]);
  await expect(card.locator(':scope > h4')).toHaveText(['How to do it', 'Easier option']);
  await expect(card.locator(':scope > h4 + p')).toHaveText([exercise.how, exercise.easier]);
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
  await session(page).locator('.hep-session-log-details > summary').click();
  await session(page).getByLabel('Session date', { exact: true }).fill('2026-10-07');
  await session(page).getByLabel('Activity goal (optional)', { exact: true }).fill(goal);
  await session(page).getByLabel('Notes (optional)', { exact: true }).fill(notes);
  await session(page).getByLabel('Next-morning response', { exact: true }).selectOption(response);
  await session(page).locator('[data-hep-save]').click();
  await expect(session(page).locator('[data-hep-history]')).toContainText(notes);
}

test('a phone user can finish a simple session without opening the log or recording an entry', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page);
  await page.locator('[data-hep-launch-start]').click();
  await finish(page);

  const panel = session(page);
  await expect(panel.locator('.hep-session-log-details')).toHaveJSProperty('open', false);
  const finishWithoutLogging = panel.locator('[data-hep-finish]');
  await expect(finishWithoutLogging).toBeInViewport({ ratio: 1 });
  await finishWithoutLogging.click();
  await expect(panel.getByRole('heading', { name: 'Session finished', exact: true })).toBeFocused();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug))).toBeNull();
  await panel.locator('[data-hep-log]').click();
  await expect(panel.locator('[data-hep-history]')).toContainText('No entries yet');
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

test('advanced meniscus strength shortcut leaves impact drills unmarked until the patient chooses how to log them', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, advancedMeniscus);
  const panel = session(page);
  const title = panel.locator('[data-hep-exercise-title]');
  const progress = panel.getByRole('progressbar');
  const jump = panel.getByRole('button', { name: 'Go to strength exercises' });
  await panel.locator('[data-hep-storage]').check();
  await panel.locator('[data-hep-mode="workout"]').check();
  await start(page);
  await expect(title).toHaveText(guidedExercises(advancedMeniscus)[0].name);
  await jump.press('Enter');
  await expect(title).toBeFocused();
  await expect(title).toHaveText(advancedMeniscus.exercises[0].name);
  await expect(progress).toHaveJSProperty('value', 0);
  await panel.locator('[data-hep-set-amount]').first().fill('6');
  for (const exercise of advancedMeniscus.exercises.slice(0, 3)) {
    await expect(title).toHaveText(exercise.name);
    await panel.locator('[data-hep-done]').click();
  }
  await expect(panel.locator('[data-hep-completed-count]')).toHaveText('3 done');
  await expect(panel.locator('[data-hep-skipped-count]')).toHaveText('0 skipped');
  await expect(panel.locator('[data-hep-save]')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Return to unmarked exercises' }).click();
  await expect(title).toHaveText(guidedExercises(advancedMeniscus)[0].name);
  await expect(progress).toHaveJSProperty('value', 3);
  await panel.locator('[data-hep-skip]').click();
  await panel.locator('[data-hep-back]').click();
  await jump.click();
  await expect(panel.locator('[data-hep-set-amount]').first()).toHaveValue('6');
  for (let i = 0; i < 3; i++) await panel.locator('[data-hep-done]').click();
  await expect(panel.locator('[data-hep-skipped-count]')).toHaveText('1 skipped');
  await panel.getByRole('button', { name: 'Mark 2 as skipped' }).click();
  await expect(panel.locator('[data-hep-completed-count]')).toHaveText('3 done');
  await expect(panel.locator('[data-hep-skipped-count]')).toHaveText('3 skipped');
  await panel.locator('[data-hep-save]').click();
  await page.reload();
  await panel.locator('[data-hep-log]').click();
  await expect(panel.locator('[data-hep-history]')).toContainText('3 done · 3 skipped');
  const [record] = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).records, storageKey(advancedMeniscus.slug));
  expect(record.workout.map(entry => entry.status)).toEqual(['skipped', 'skipped', 'skipped', 'done', 'done', 'done']);
  expect(record.workout[3].sets[0].amount).toBe(6);
});

test('the final unmarked exercise offers review even when it is in the middle of the program', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page, advancedMeniscus);
  await start(page);
  const panel = session(page);
  await panel.locator('[data-hep-strength-start]').click();
  for (let index = 0; index < 3; index++) await panel.locator('[data-hep-done]').click();
  await panel.getByRole('button', { name: 'Return to unmarked exercises' }).click();
  await panel.locator('[data-hep-skip]').click();
  await panel.locator('[data-hep-skip]').click();
  await expect(panel.locator('[data-hep-exercise-title]')).toHaveAccessibleDescription('Exercise 3 of 6');
  await expect(panel.locator('[data-hep-done]')).toHaveText('Done & review');
  await panel.getByRole('button', { name: 'Skip & review' }).click();
  await expect(panel.getByRole('heading', { name: 'Session review' })).toBeFocused();
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
    const heroGuide = page.locator('.landing-hero .hep-start-guide');
    await expect(heroGuide).toHaveJSProperty('open', false);
    await heroGuide.locator('summary').click();
    await expect(heroGuide.locator('p')).toHaveText(program.programIntro);
    await expect(heroGuide.locator('a')).toHaveCount(2);
    await expect(heroGuide.locator('a').first()).toHaveAttribute('href', '#fit');
    await expect(heroGuide.locator('a').last()).toHaveAttribute('href', '#progress');
    await start(page);
    const first = session(page).locator('[data-hep-exercise]');
    await expect(first.locator('.hep-first-stage')).toContainText(program.progression[0].text);
    if (program.firstStrengthExercise !== undefined) {
      await expect(first.locator('.hep-first-stage + [data-hep-strength-start] + dl')).toHaveCount(1);
    } else {
      await expect(first.locator('dl + .hep-first-stage')).toHaveCount(1);
    }
    const plan = session(page).locator('.hep-session-safety');
    await expect(plan).toHaveJSProperty('open', false);
    await plan.locator('summary').click();
    await expect(plan.getByText(program.programIntro, { exact: true })).toBeVisible();
    await expect(plan.getByRole('link', { name: 'When to move to the next stage' })).toHaveAttribute('href', '#progress');
    await plan.locator('summary').click();
    for (const [index, exercise] of exercises.entries()) {
      const card = session(page).locator('[data-hep-exercise]');
      await expect(card.locator('[data-hep-exercise-title]')).toHaveText(exercise.name);
      await expect(card.locator('[data-hep-exercise-title]')).toHaveAccessibleDescription(`Exercise ${index + 1} of ${exercises.length}`);
      await expect(card.locator('[data-hep-done]')).toHaveText(index === exercises.length - 1 ? 'Done & review' : 'Done & next');
      await expect(card.locator('[data-hep-skip]')).toHaveText(index === exercises.length - 1 ? 'Skip & review' : 'Skip & next');
      await expectExercisePrescription(card, exercise);
      if (data.timerOptions?.[exercise.name]?.length) {
        await expect(card.locator('h4:text-is("How to do it") + p + [data-hep-timer]')).toHaveCount(1);
      }
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
      const disclosure = card.locator('.hep-session-detail');
      const toggle = disclosure.locator('summary');
      const harder = disclosure.locator('p');
      const readinessLink = disclosure.getByRole('link', { name: 'When to move to the next stage', exact: true, includeHidden: true });
      await expect(card.locator('[data-hep-exercise-title]')).toHaveText(exercise.name);
      await expect(disclosure).toHaveCount(1);
      await expect(toggle).toHaveText('Harder option');
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

for (const slug of [
  'insertional-achilles-tendinopathy-exercises',
  'proximal-hamstring-tendinopathy-exercises',
  'rotator-cuff-return-to-throwing-exercises',
]) {
  test(`${slug}: mobile users can check later-stage criteria and stop signs from an active exercise`, async ({ context, page, baseURL }) => {
    const program = programFor(slug);
    await localOnly(context, baseURL);
    await page.setViewportSize({ width: 390, height: 844 });
    await visit(page, program);
    await page.locator('[data-hep-launch-start]').click();
    const card = session(page).locator('[data-hep-exercise]');
    await expect(card.locator('.hep-first-stage')).toContainText(program.progression[0].text);
    const safety = session(page).locator('.hep-session-safety');
    await safety.locator('summary').click();
    await expect(safety.getByText(program.programIntro, { exact: true })).toBeVisible();
    await safety.locator('summary').click();
    const exercises = guidedExercises(program);
    for (let index = 1; index < exercises.length; index += 1) await card.locator('[data-hep-skip]').click();
    const finalExercise = exercises.at(-1);
    await expect(card.locator('[data-hep-exercise-title]')).toHaveText(finalExercise.name);
    await expectExercisePrescription(card, finalExercise);
    await card.locator('.hep-session-detail summary').click();
    await expect(card.getByText(finalExercise.harder, { exact: true })).toBeVisible();
    await card.getByRole('link', { name: 'When to move to the next stage' }).click();
    await expect(page).toHaveURL(new RegExp('/' + slug + '/#progress$'));
    await expect(page.locator('#progress h2')).toBeInViewport();
    await expect(page.locator('#progress .care-step p')).toHaveText(program.progression.map(stage => stage.text));
    await expect(page.locator('#progress .readiness-block li')).toHaveText(program.readyItems);
    await page.goBack();
    await expect(card.locator('[data-hep-exercise-title]')).toHaveText(finalExercise.name);
    await safety.locator('summary').click();
    await expect(safety.getByText(program.red, { exact: true })).toBeVisible();
    await safety.getByRole('link', { name: 'Read the full program fit & safety guidance' }).click();
    await expect(page.locator('#fit h2')).toBeInViewport();
    await expect(page.locator('#fit .urgent-panel p')).toHaveText(program.redFlags);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
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

for (const keep of [false, true]) {
  test(`reload ${keep ? 'restores opted-in completed entries' : 'clears unsaved completed entries'} and never restores an in-progress workout`, async ({ context, page, baseURL }) => {
    await localOnly(context, baseURL);
    await visit(page);
    const storageHelp = session(page).locator('#hep-session-storage-help');
    await expect(session(page).locator('[data-hep-storage]')).not.toBeChecked();
    await expect(storageHelp).toHaveText('Saving is off. Unsaved entries can be lost if you refresh, leave this page, or close the tab.');
    await expect(session(page)).toContainText('In-progress exercise steps, set drafts, and timers are not saved');
    await expect(session(page)).toContainText('even when saving is on.');
    await addRecord(page, { notes: 'COMPLETED_ENTRY_RELOAD_SENTINEL' });
    if (keep) {
      await session(page).locator('[data-hep-storage]').check();
      await expect(storageHelp).toContainText('Up to 30 completed log entries and your activity goal are kept.');
    } else {
      await expect(session(page).locator('[data-hep-status]')).toContainText('Unsaved entries can be lost if you refresh, leave this page, or close the tab.');
    }
    await session(page).locator('[data-hep-mode="workout"]').check();
    await start(page);
    await session(page).locator('[data-hep-set-amount]').first().fill('11');
    await session(page).locator('[data-hep-done]').click();
    await session(page).locator('[data-hep-set-amount]').first().fill('13');
    await session(page).locator('[data-hep-timer-duration]').fill('60');
    await session(page).locator('[data-hep-timer-start]').click();
    await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[1].name);
    await expect(session(page).locator('[data-hep-timer-pause]')).toBeEnabled();
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey(knee.slug));
    if (keep) {
      expect(saved.records).toHaveLength(1);
      expect(saved.records[0].notes).toBe('COMPLETED_ENTRY_RELOAD_SENTINEL');
      expect(saved.records[0].workout).toBeUndefined();
    } else {
      expect(saved).toBeNull();
    }

    await page.reload();
    await expect(session(page).getByRole('heading', { name: 'Your next session', exact: true })).toBeVisible();
    await expect(session(page).locator('[data-hep-storage]')).toBeChecked({ checked: keep });
    await session(page).locator('[data-hep-log]').click();
    await expect(session(page).locator('[data-hep-entry]')).toHaveCount(keep ? 1 : 0);
    if (keep) await expect(session(page).locator('[data-hep-history]')).toContainText('COMPLETED_ENTRY_RELOAD_SENTINEL');
    await expect(session(page).locator('[data-hep-resume]')).toHaveCount(0);
    await session(page).locator('[data-hep-mode="workout"]').check();
    await start(page);
    await expect(session(page).locator('[data-hep-exercise-title]')).toHaveText(knee.exercises[0].name);
    await expect(session(page).locator('[data-hep-set-amount]').first()).toHaveValue('');
    await expect(session(page).locator('[data-hep-timer-duration]')).toHaveValue('');
    await expect(session(page).locator('[data-hep-timer-clock]')).toHaveText('00:00');
    await expect(session(page).locator('[data-hep-timer-pause]')).toBeDisabled();
  });
}

test('exercise privacy explains opt-in saving and the loss of unfinished sessions', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await page.goto('/privacy/#exercise-progress');
  const privacy = page.locator('#exercise-progress');
  await expect(privacy).toContainText('Saving is off by default.');
  await expect(privacy).toContainText('Unsaved entries can be lost if you refresh, leave the program page, or close the tab.');
  await expect(privacy).toContainText('To retain a completed session, select Add to progress log and turn on Keep my progress on this device.');
  await expect(privacy).toContainText('In-progress exercise steps, set drafts, and timers are not saved. Refreshing, leaving the program page, or closing the tab can erase them, even when saving is on.');
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
  await session(page).locator('.hep-session-log-details > summary').click();
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
  await expect(session(peer).locator('[data-hep-entry]')).toHaveCount(0);
  await expect(session(peer).locator('[data-hep-print-summary]')).toBeDisabled();
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug))).toBeNull();
  await session(peer).locator('[data-hep-storage]').check();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey(knee.slug))).toMatchObject({ goal: '', records: [] });
  await peer.close();
});

test('clear reaches open tabs with only unsaved entries and preserves the peer review draft', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await addRecord(page, { notes: 'UNSAVED_LOCAL_ENTRY' });
  const peer = await context.newPage();
  await visit(peer);
  await addRecord(peer, { notes: 'UNSAVED_PEER_ENTRY', goal: 'UNSAVED_PEER_GOAL' });
  await start(peer);
  await finish(peer, knee, { skip: true });
  await session(peer).locator('.hep-session-log-details > summary').click();
  const peerGoal = session(peer).getByLabel('Activity goal (optional)', { exact: true });
  const peerNotes = session(peer).getByLabel('Notes (optional)', { exact: true });
  await expect(peerGoal).toHaveValue('UNSAVED_PEER_GOAL');
  await peerNotes.fill('IN_PROGRESS_PEER_NOTE');
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey(knee.slug))).toBeNull();

  await session(page).locator('[data-hep-clear]').click();
  await session(page).locator('[data-hep-confirm-clear]').click();
  await expect(peerGoal).toHaveValue('');
  await expect(peerNotes).toHaveValue('IN_PROGRESS_PEER_NOTE');
  await expect(session(peer).locator('[data-hep-skipped-count]')).toHaveText(`${knee.exercises.length} skipped`);
  await session(peer).locator('[data-hep-storage]').check();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey(knee.slug))).toMatchObject({ goal: '', records: [] });
  await session(peer).locator('[data-hep-save]').click();
  await expect(session(peer).locator('[data-hep-entry]')).toHaveCount(1);
  await expect(session(peer).locator('[data-hep-history]')).toContainText('IN_PROGRESS_PEER_NOTE');
  await expect(session(peer).locator('[data-hep-history]')).not.toContainText('UNSAVED_PEER_ENTRY');
});

test('an older write that races with a confirmed clear cannot restore deleted progress', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await session(page).locator('[data-hep-storage]').check();
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
  await expect(session(peer).locator('[data-hep-storage]')).not.toBeChecked();
  await session(peer).locator('[data-hep-log]').click();
  await expect(session(peer).locator('[data-hep-entry]')).toHaveCount(0);
  await session(peer).locator('[data-hep-storage]').check();
  expect(await peer.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey(knee.slug))).toMatchObject({ goal: '', records: [] });
});

test('clear still reaches open tabs if browser storage refuses the clear signal', async ({ context, page, baseURL }) => {
  await localOnly(context, baseURL);
  await visit(page);
  await session(page).locator('[data-hep-storage]').check();
  await addRecord(page, { notes: 'PEER_CLEAR_FALLBACK' });
  const peer = await context.newPage();
  await visit(peer);
  await session(peer).locator('[data-hep-log]').click();
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
    const stepHeader = session(page).locator('.hep-session-step-header');
    const exerciseTitle = stepHeader.locator('[data-hep-exercise-title]');
    const assertStepIsInView = async index => {
      await expect(exerciseTitle).toBeFocused();
      await expect(exerciseTitle).toHaveAccessibleDescription(`Exercise ${index + 1} of ${program.exercises.length}`);
      await expect(stepHeader).toBeInViewport({ ratio: 1 });
      const header = await stepHeader.boundingBox();
      const navigation = await page.locator('#navbar').boundingBox();
      expect(header.y).toBeGreaterThanOrEqual(navigation.y + navigation.height);
      expect(header.y).toBeLessThan(navigation.y + navigation.height + 50);
    };
    await assertStepIsInView(0);
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({ tag: document.activeElement.tagName, inside: Boolean(document.activeElement.closest('[data-hep-session]')) }));
    expect(focus.inside).toBe(true);
    expect(['BUTTON', 'SUMMARY']).toContain(focus.tag);
    const startGuide = session(page).locator('.hep-session-safety');
    await startGuide.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(startGuide.getByText(program.programIntro, { exact: true })).toBeVisible();
    await expect(startGuide.getByText(program.red, { exact: true })).toBeVisible();
    const harder = session(page).locator('[data-hep-exercise] .hep-session-detail');
    const harderToggle = harder.locator('summary');
    await harderToggle.focus();
    await page.keyboard.press('Enter');
    await expect(harderToggle).toBeFocused();
    await expect(harder.locator('p')).toBeVisible();
    await expect(harder.locator('p')).toHaveText(guidedExercises(program)[0].harder);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.evaluate(async () => { await document.fonts?.ready; });
    const activeResults = await new AxeBuilder({ page }).include('[data-hep-session]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(activeResults.violations, JSON.stringify(activeResults.violations, null, 2)).toEqual([]);
    await session(page).locator('[data-hep-done]').click();
    await assertStepIsInView(1);
    for (let index = 1; index < program.exercises.length; index += 1) await session(page).locator('[data-hep-done]').click();
    await expect(session(page).getByRole('heading', { name: 'Session review', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const reviewResults = await new AxeBuilder({ page }).include('[data-hep-session]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(reviewResults.violations, JSON.stringify(reviewResults.violations, null, 2)).toEqual([]);
  });
}
