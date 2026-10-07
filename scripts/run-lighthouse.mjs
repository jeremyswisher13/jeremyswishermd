import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

import { startSiteServer } from './serve-site.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(root, '.quality-results', 'lighthouse');
const programs = JSON.parse(await readFile(join(root, 'scripts/hep-programs.json'), 'utf8'));
if (!Array.isArray(programs) || programs.length !== 25
  || new Set(programs.map(program => program.slug)).size !== 25
  || programs.some(program => program.guidedSession !== true)) {
  throw new Error('Lighthouse QA requires all 25 unique maintained programs with guided sessions enabled');
}
const thresholds = { performance: 0.8, accessibility: 0.95, 'best-practices': 0.9, seo: 0.9 };
const routes = [
  { name: 'homepage', path: '/', thresholds },
  { name: 'prp-guide', path: '/prp-knee-osteoarthritis/', thresholds },
  { name: 'a2m-guide', path: '/a2m-knee-osteoarthritis/', thresholds },
  { name: 'exercise-library', path: '/home-exercise-programs/', thresholds },
  { name: 'athlete-hub', path: '/sports-injuries/', thresholds },
  ...programs.map(program => ({ name: program.slug, path: `/${program.slug}/`, thresholds })),
  { name: '404', path: '/404.html', thresholds: { performance: 0.8, accessibility: 0.95, 'best-practices': 0.9 } },
];

let server;
let chrome;
let failed = false;

try {
  await mkdir(outputDirectory, { recursive: true });
  server = await startSiteServer({ port: 0 });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  chrome = await launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage'],
    logLevel: 'silent',
  });

  for (const route of routes) {
    const result = await lighthouse(`${baseUrl}${route.path}`, {
      port: chrome.port,
      logLevel: 'error',
      output: 'json',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      formFactor: 'mobile',
      throttlingMethod: 'simulate',
      maxWaitForLoad: 45_000,
      screenEmulation: {
        mobile: true,
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        disabled: false,
      },
    });

    if (!result?.lhr) throw new Error(`Lighthouse did not return a report for ${route.name}`);
    await writeFile(join(outputDirectory, `${route.name}.json`), result.report);

    const scoreSummary = Object.fromEntries(
      Object.entries(result.lhr.categories).map(([category, value]) => [category, value.score]),
    );
    console.log(`${route.name}: ${Object.entries(scoreSummary)
      .map(([category, score]) => `${category} ${Math.round(score * 100)}`)
      .join(', ')}`);

    for (const [category, minimum] of Object.entries(route.thresholds)) {
      const score = scoreSummary[category];
      if (typeof score !== 'number' || score < minimum) {
        failed = true;
        console.error(
          `${route.name}: ${category} score ${Math.round((score || 0) * 100)} is below ${Math.round(minimum * 100)}`,
        );
      }
    }
  }
} finally {
  await chrome?.kill();
  if (server) await new Promise((resolvePromise) => server.close(resolvePromise));
}

if (failed) process.exitCode = 1;
