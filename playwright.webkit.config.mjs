import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.mjs';

export default defineConfig({
  ...base,
  testMatch: 'webkit-smoke.spec.mjs',
  testIgnore: [],
  outputDir: '.quality-results/webkit',
  projects: [{
    name: 'mobile-webkit',
    use: { ...devices['iPhone 13'] },
  }],
});
