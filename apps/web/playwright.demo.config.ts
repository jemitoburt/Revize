import { defineConfig } from '@playwright/test';

// The GitHub Pages demo build (API in the browser, ADR-0015) under the same base path as Pages.
const base = '/Revize/app/';

export default defineConfig({
  testDir: 'e2e-demo',
  globalSetup: './e2e/field/global-setup.ts',
  timeout: 90_000,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:4181${base}`,
    viewport: { width: 1440, height: 900 },
    locale: 'cs-CZ',
  },
  webServer: {
    command: 'pnpm build:demo && pnpm vite preview --mode demo --strictPort --port 4181',
    url: `http://localhost:4181${base}`,
    env: { BASE_PATH: base },
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
