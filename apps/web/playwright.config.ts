import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/field/global-setup.ts',
  timeout: 45_000,
  // All tests share one database: run them in order.
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4180',
    viewport: { width: 1440, height: 900 },
    locale: 'cs-CZ',
  },
  projects: [
    { name: 'office', testIgnore: 'field/**' },
    {
      name: 'field',
      testMatch: 'field/**/*.spec.ts',
      use: {
        // iPad Pro 11" landscape with touch; Chromium is the only browser that can fake a camera.
        viewport: { width: 1194, height: 834 },
        hasTouch: true,
        permissions: ['camera'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--use-file-for-fake-video-capture=e2e/.generated/qr-R10001.y4m',
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'node e2e/start-api.mjs',
      url: 'http://localhost:3100/api/health',
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm build && pnpm vite preview --strictPort --port 4180',
      url: 'http://localhost:4180',
      env: { API_URL: 'http://localhost:3100' },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
