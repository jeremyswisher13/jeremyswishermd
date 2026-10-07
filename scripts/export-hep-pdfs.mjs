// Actual paginated exports for print QA; these are not checked-in patient assets.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startSiteServer } from './serve-site.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || join(root, '.quality-results/print'));
const programs = JSON.parse(await readFile(join(root, 'scripts/hep-programs.json'), 'utf8'));
if (!Array.isArray(programs) || programs.length !== 25
  || new Set(programs.map(program => program.slug)).size !== 25
  || programs.some(program => program.guidedSession !== true)) {
  throw new Error('Print QA requires all 25 unique maintained programs with guided sessions enabled');
}
await mkdir(output, { recursive: true });
const server = await startSiteServer({ port: 0 });
const baseURL = `http://127.0.0.1:${server.address().port}`;
let browser;
const manifest = [];
// Keep the fixture oracle independent of the session module's response labels.
const summaryResponses = [
  ['not-checked', 'Not checked yet'],
  ['baseline', 'Back to usual baseline'],
  ['more-symptomatic', 'Still more symptomatic'],
  ['not-sure', 'Not sure'],
];

function syntheticSummaryFixture(program) {
  const records = Array.from({ length: 7 }, (_, index) => {
    const number = index + 1;
    const marker = `Synthetic ${program.slug} entry ${number}`;
    const excluded = index === 6;
    const skipped = index % (program.exercises.length + 1);
    const [response, responseText] = summaryResponses[index % summaryResponses.length];
    const note = `${marker}: This fictional print QA note has ordinary spaces so long notes wrap across lines. It checks that every saved word reaches the PDF without clipping or mixing with another entry. `;
    const goal = `${marker} goal: A fictional activity goal for checking the printed table. Keep every word legible when this cell wraps. `;
    return {
      id: `print-qa-${number}`, date: `2026-10-${String(7 - index).padStart(2, '0')}`,
      completed: program.exercises.length - skipped, skipped, response,
      notes: excluded ? `${marker}: EXCLUDED_SEVENTH_SUMMARY_ENTRY` : note.padEnd(200, '.').slice(0, 200),
      goal: excluded ? `${marker}: EXCLUDED_SEVENTH_SUMMARY_GOAL` : goal.padEnd(140, '.').slice(0, 140),
      // Only these independent expected values enter the summary manifest.
      responseText, displayDate: `Oct ${7 - index}, 2026`, marker,
    };
  });
  const goal = `Synthetic ${program.slug} current activity goal: Read all six fictional entries at follow-up.`;
  if (goal.length > 140) throw new Error(`Print QA current goal is too long for ${program.slug}`);
  return {
    slug: program.slug, title: program.title,
    canonical: `https://jeremyswishermd.com/${program.slug}/`, goal,
    entries: records.slice(0, 6), excludedEntry: records[6],
    store: {
      version: 1, slug: program.slug, goal,
      records: records.map(({ responseText, displayDate, marker, ...record }) => record),
    },
    files: ['Letter', 'A4'].map(format => ({ format, file: `${program.slug}-summary-${format}.pdf` })),
  };
}

async function exportFollowUpSummaries() {
  const fixtures = programs.map(syntheticSummaryFixture);
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'UTC' });
  await context.route('**/*', route => (
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort()
  ));
  await context.addInitScript(({ origin, stores }) => {
    if (location.origin !== origin) return;
    for (const store of stores) {
      localStorage.setItem(`swishermd:hep-progress:v1:${store.slug}`, JSON.stringify(store));
    }
    // The real screen control creates the report. A native dialog is unavailable
    // in CI, so print media below models the open dialog while exporting it.
    window.__hepSummaryPrintCalls = 0;
    window.print = () => { window.__hepSummaryPrintCalls += 1; };
  }, { origin: baseURL, stores: fixtures.map(fixture => fixture.store) });

  try {
    for (const fixture of fixtures) {
      for (const { format, file } of fixture.files) {
        // A PDF export may fire afterprint; start with a fresh report per paper.
        const page = await context.newPage();
        try {
          await page.emulateMedia({ media: 'screen' });
          const response = await page.goto(`${baseURL}/${fixture.slug}/`, { waitUntil: 'networkidle' });
          if (response?.status() !== 200) throw new Error(`Cannot export summary for ${fixture.slug}`);
          const session = page.locator('[data-hep-session][data-hep-session-ready="true"]');
          await session.waitFor({ state: 'visible' });
          await session.locator('[data-hep-log]').click();
          if (await session.locator('[data-hep-entry]').count() !== 7) {
            throw new Error(`Summary fixture did not restore seven entries for ${fixture.slug}`);
          }
          await session.locator('[data-hep-print-summary]').click();
          await page.emulateMedia({ media: 'print' });
          await page.evaluate(() => document.fonts.ready);
          const reportIsActive = await page.evaluate(() => (
            window.__hepSummaryPrintCalls === 1
            && document.body.classList.contains('hep-summary-printing')
            && document.querySelectorAll('.hep-summary-printout tbody tr').length === 6
          ));
          if (!reportIsActive) throw new Error(`Summary print control did not create six entries for ${fixture.slug}`);
          await page.pdf({
            path: join(output, file), format, preferCSSPageSize: true,
            printBackground: true, tagged: true, outline: true,
          });
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await context.close();
  }
  const summaries = fixtures.map(({ store, ...fixture }) => ({
    ...fixture,
    otherProgramMarkers: fixtures.filter(other => other.slug !== fixture.slug)
      .flatMap(other => [other.goal, ...other.entries.map(entry => entry.marker)]),
  }));
  // Python reads the seeded source fixture, never text copied from the report.
  await writeFile(join(output, 'summary-manifest.json'), `${JSON.stringify({ version: 1, syntheticOnly: true, summaries }, null, 2)}\n`);
  return summaries.reduce((count, summary) => count + summary.files.length, 0);
}

try {
  browser = await chromium.launch();
  const context = await browser.newContext();
  // No analytics or third-party video requests are needed to print a handout.
  await context.route('**/*', (route) => (
    new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort()
  ));
  const page = await context.newPage();
  await page.emulateMedia({ media: 'print' });
  for (const program of programs) {
    const response = await page.goto(`${baseURL}/${program.slug}/`, { waitUntil: 'networkidle' });
    if (response?.status() !== 200) throw new Error(`Cannot export ${program.slug}`);
    await page.evaluate(() => document.fonts.ready);
    for (const format of ['Letter', 'A4']) {
      const file = `${program.slug}-${format}.pdf`;
      await page.pdf({
        path: join(output, file), format, preferCSSPageSize: true,
        printBackground: true, tagged: true, outline: true,
      });
      manifest.push({ slug: program.slug, format, file });
    }
  }

  // Shared landing-page styles must not label unrelated care guides as exercises.
  await page.goto(`${baseURL}/prp-knee-osteoarthritis/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: join(output, 'care-page-control.pdf'), format: 'Letter',
    preferCSSPageSize: true, printBackground: true,
  });
  const summaryCount = await exportFollowUpSummaries();
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Exported ${manifest.length} exercise PDFs, one care-page control, and ${summaryCount} synthetic follow-up summaries to ${output}`);
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
