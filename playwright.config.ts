import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests (`npm run e2e`). They drive the Vite dev server in the locally installed
 * Chrome (`channel: 'chrome'`): Playwright's bundled browsers are not installed.
 * Fixtures live in e2e/fixtures (regenerate with `node scripts/generate-fixtures.mjs`).
 *
 * The dev server runs on port 5299 (reused when already running); set E2E_PORT to test
 * against another one.
 */
const PORT = Number(process.env.E2E_PORT || 5299)
const APP_URL = `http://localhost:${PORT}/FillFlow/`

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // One worker: every test opens PDFs in a fresh context, and the dev server warms up once.
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    channel: 'chrome',
    // The interface follows the browser's language: the specs expect English unless they pick another.
    locale: 'en-US',
    baseURL: APP_URL,
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: APP_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
