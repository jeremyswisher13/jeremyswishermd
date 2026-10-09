// Real paginated exports. Every seeded entry is fictional print QA data.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startSiteServer } from './serve-site.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || join(root, '.quality-results/print'));
const programs = JSON.parse(await readFile(join(root, 'scripts/hep-programs.json'), 'utf8'));
const optionsBySlug = JSON.parse(await readFile(join(root, 'scripts/hep-workout-options.json'), 'utf8'));
const definitions = [
  { id: 'common-extensor-standard', slug: 'lateral-elbow-tendinopathy-exercises', latestWorkoutIndex: 2 },
  { id: 'advanced-meniscus-standard', slug: 'advanced-meniscus-rehabilitation-exercises', latestWorkoutIndex: 6 },
  { id: 'common-extensor-eight-sets', slug: 'lateral-elbow-tendinopathy-exercises', latestWorkoutIndex: 2, stress: true },
];
const responses = [
  ['not-checked', 'Not checked yet'], ['baseline', 'Back to usual baseline'],
  ['more-symptomatic', 'Still more symptomatic'], ['not-sure', 'Not sure'],
];
const blankSet = () => ({ amount: null, holdSeconds: null, load: null, unit: 'none', resistance: '', note: '' });
const maximumText = (text, length) => text.padEnd(length, '.').slice(0, length);

// This oracle deliberately does not import the application's describeSet().
function expectedSetText(set, label) {
  const parts = [];
  if (set.amount !== null) parts.push(`${label}: ${set.amount}`);
  if (set.holdSeconds !== null) parts.push(`${set.holdSeconds}-second holds`);
  if (set.unit === 'lb' || set.unit === 'kg') parts.push(set.load === null ? `${set.unit} (weight not entered)` : `${set.load} ${set.unit}`);
  if (set.unit === 'bodyweight') parts.push('body weight');
  if (set.unit === 'band') parts.push(set.resistance ? `Band: ${set.resistance}` : 'Band (not described)');
  if (set.unit === 'other') parts.push(set.resistance ? `Resistance: ${set.resistance}` : 'Other resistance (not described)');
  if (set.note) parts.push(set.note);
  return parts.join(' · ');
}

function standardSets(option, index, id) {
  return Array.from({ length: 3 }, (_, setIndex) => {
    const amount = option.measure === 'minutes' ? 1.5 + setIndex * 0.5
      : option.measure === 'seconds' ? 31 + setIndex : 8 + index + setIndex;
    const set = { ...blankSet(), amount, note: `Synthetic QA ${id} E${index + 1} S${setIndex + 1}: ${setIndex % 2 ? 'Right' : 'Left'} side` };
    if (option.measure === 'reps' && setIndex === 0) set.holdSeconds = 5;
    if (option.resistance) {
      const units = index % 2 ? ['lb', 'kg', 'band'] : ['bodyweight', 'other', 'none'];
      set.unit = units[setIndex];
      if (set.unit === 'lb') set.load = 7.5;
      if (set.unit === 'kg') set.load = 3.25;
      if (set.unit === 'band') set.resistance = '<light> blue & "QA" band';
      if (set.unit === 'other') set.resistance = 'Fictional towel & "QA" grip';
    }
    if (set.note.length > 80) throw new Error(`Synthetic note exceeds the saved-field limit: ${id}`);
    return set;
  });
}

function fixtureFor(definition) {
  const program = programs.find(item => item.slug === definition.slug);
  if (!program || program.guidedSession !== true) throw new Error(`Missing guided program ${definition.slug}`);
  const order = program.guidedExerciseOrder || program.exercises.map((_, index) => index);
  if (definition.slug === 'advanced-meniscus-rehabilitation-exercises' && JSON.stringify(order) !== '[3,4,5,0,1,2]') {
    throw new Error('Advanced meniscus print QA requires the maintained guided order [3,4,5,0,1,2]');
  }
  const options = order.map(index => optionsBySlug[program.slug]?.[index]);
  if (options.some(option => !option)) throw new Error(`Missing workout options for ${program.slug}`);
  const workout = options.map((option, index) => ({
    status: index === options.length - 1 ? 'skipped' : 'done',
    measure: option.measure, label: option.label,
    sets: index === options.length - 1 ? [] : standardSets(option, index, definition.id),
  }));
  // A blank completed exercise is valid optional logging and needs its own text.
  if (definition.slug === 'advanced-meniscus-rehabilitation-exercises') workout[4].sets = [];
  if (definition.stress) {
    workout[1].sets = Array.from({ length: 8 }, (_, index) => ({
      ...blankSet(), amount: 101 + index, holdSeconds: index + 1,
      unit: index % 2 ? 'other' : 'band',
      resistance: maximumText(`Synthetic QA resistance ${index + 1}: <band> & "quoted" long descriptor `, 60),
      note: maximumText(`Synthetic QA eight-set note ${index + 1}: <b>plain</b> & "quoted" Left side long note `, 80),
    }));
  }
  const records = Array.from({ length: 8 }, (_, index) => {
    const [response, responseText] = responses[index % responses.length];
    const skipped = index % 3;
    const marker = `Synthetic QA ${definition.id} row ${index + 1}`;
    return {
      id: `qa-${definition.id}-${index + 1}`, date: `2026-10-${String(8 - index).padStart(2, '0')}`,
      createdAt: 1000 - index, updatedAt: 1000 - index,
      completed: options.length - skipped, skipped, response,
      notes: `${marker}: ${index < 6 ? 'Fictional follow-up entry.' : 'EXCLUDED_SUMMARY_ROW'}`,
      goal: `${marker}: Fictional entry goal.`, responseText, displayDate: `Oct ${8 - index}, 2026`, marker,
    };
  });
  const latest = records[definition.latestWorkoutIndex];
  latest.workout = workout;
  latest.completed = workout.filter(entry => entry.status === 'done').length;
  latest.skipped = workout.length - latest.completed;
  // These unique older sets must never enter the most-recent-workout detail block.
  const older = records[7];
  older.workout = options.map((option, index) => ({
    status: 'done', measure: option.measure, label: option.label,
    sets: [{ ...blankSet(), amount: 901 + index, note: `OLDER_WORKOUT_SET ${definition.id} E${index + 1}` }],
  }));
  older.completed = options.length;
  older.skipped = 0;
  const goal = `Synthetic QA ${definition.id}: Bring these fictional entries to print QA.`;
  return {
    ...definition, title: program.title, canonical: `https://jeremyswishermd.com/${program.slug}/`,
    goal, guidedOrder: order, records, latestWorkoutId: latest.id,
    exercises: workout.map((entry, index) => ({
      sourceIndex: order[index], name: program.exercises[order[index]].name,
      status: entry.status, measure: entry.measure, label: entry.label,
      expectedLines: entry.status === 'skipped' ? ['Skipped']
        : entry.sets.length ? entry.sets.map(set => expectedSetText(set, entry.label)) : ['Done · No set details recorded'],
      keepTogether: !(definition.stress && index === 1),
    })),
    files: ['Letter', 'A4'].map(format => ({ format, file: `${definition.id}-workout-${format}.pdf` })),
  };
}

const fixtures = definitions.map(fixtureFor);
const storeFor = fixture => ({
  version: 1, slug: fixture.slug, goal: fixture.goal,
  records: fixture.records.map(({ responseText, displayDate, marker, ...record }) => record),
});
await mkdir(output, { recursive: true });
const server = await startSiteServer({ port: 0 });
const baseURL = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch();
  for (const fixture of fixtures) {
    const otherPrograms = fixtures.filter(other => other.slug !== fixture.slug);
    const stores = [storeFor(fixture), ...otherPrograms.map(storeFor)];
    const context = await browser.newContext({ locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' });
    try {
      await context.route('**/*', route => new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
      await context.addInitScript(({ origin, stores }) => {
        if (location.origin !== origin) return;
        for (const store of stores) localStorage.setItem(`swishermd:hep-progress:v1:${store.slug}`, JSON.stringify(store));
        window.__workoutPrintCalls = 0;
        window.print = () => { window.__workoutPrintCalls += 1; };
      }, { origin: baseURL, stores });
      for (const { format, file } of fixture.files) {
        const page = await context.newPage();
        try {
          await page.emulateMedia({ media: 'screen' });
          const response = await page.goto(`${baseURL}/${fixture.slug}/`, { waitUntil: 'networkidle' });
          if (response?.status() !== 200) throw new Error(`Cannot export ${fixture.id}`);
          const session = page.locator('[data-hep-session][data-hep-session-ready="true"]');
          await session.waitFor({ state: 'visible' });
          if (!await session.locator('[data-hep-storage]').isChecked()) throw new Error(`${fixture.id}: v1 opted-in store did not restore`);
          await session.locator('[data-hep-log]').click();
          if (await session.locator('[data-hep-entry]').count() !== fixture.records.length) throw new Error(`${fixture.id}: record fixture did not restore`);
          await session.locator('[data-hep-print-summary]').click();
          await page.emulateMedia({ media: 'print' });
          await page.evaluate(() => document.fonts.ready);
          const active = await page.evaluate(() => {
            const report = document.querySelector('.hep-summary-printout');
            return window.__workoutPrintCalls === 1 && document.body.classList.contains('hep-summary-printing')
              && report?.querySelectorAll('tbody tr').length === 6
              && report.querySelectorAll('input, select, textarea, button').length === 0;
          });
          if (!active) throw new Error(`${fixture.id}: real summary control did not create a clean six-row print report`);
          await page.pdf({ path: join(output, file), format, preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
          await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
          await page.emulateMedia({ media: 'screen' });
          const clean = await page.evaluate(() => !document.querySelector('.hep-summary-printout')
            && !document.body.classList.contains('hep-summary-printing')
            && [...document.querySelectorAll('[data-hep-print-summary]')].every(button => !button.disabled && !button.hasAttribute('aria-busy')));
          if (!clean) throw new Error(`${fixture.id}: afterprint did not restore the progress log`);
        } finally {
          await page.close();
        }
      }
    } finally {
      await context.close();
    }
  }
  const manifestFixtures = fixtures.map(fixture => ({
    ...fixture,
    otherProgramMarkers: fixtures.filter(other => other.slug !== fixture.slug)
      .flatMap(other => [other.title, other.canonical, other.goal, ...other.exercises.map(exercise => exercise.name), ...other.records.map(record => record.marker),
        ...other.records.flatMap(record => record.workout?.flatMap(entry => entry.sets.map(set => set.note)) || [])]),
  }));
  await writeFile(join(output, 'workout-manifest.json'), `${JSON.stringify({ version: 1, syntheticOnly: true, fixtures: manifestFixtures }, null, 2)}\n`);
  console.log(`Exported ${fixtures.length * 2} synthetic workout follow-up PDFs in Letter and A4 to ${output}`);
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
