// Actual paginated exports for print QA; these are not checked-in patient assets.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startSiteServer } from './serve-site.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || join(root, '.quality-results/print'));
const programs = JSON.parse(await readFile(join(root, 'scripts/hep-programs.json'), 'utf8'));
await mkdir(output, { recursive: true });
const server = await startSiteServer({ port: 0 });
const baseURL = `http://127.0.0.1:${server.address().port}`;
let browser;
const manifest = [];

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
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Exported ${manifest.length} exercise PDFs and one care-page control to ${output}`);
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
