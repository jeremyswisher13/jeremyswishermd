import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

export default defineConfig({
  ...base,
  testMatch: 'visual-text.spec.mjs',
  testIgnore: [],
  timeout: 60_000,
  retries: 0,
  workers: 2,
  outputDir: '.quality-results/visual-text/playwright',
});
