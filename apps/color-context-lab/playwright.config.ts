import { defineConfig } from '@playwright/test';

const port = Number(process.env.COLOR_CONTEXT_TEST_PORT ?? 4290);
export default defineConfig({
  testDir: './tests/browser', testMatch: '**/*.spec.ts', workers: 1, fullyParallel: false, timeout: 45000,
  use: { baseURL: `http://127.0.0.1:${port}`, launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}, trace: 'retain-on-failure' },
  webServer: { command: `COLOR_CONTEXT_TEST_HARNESS=1 npm run build && npm run preview -- --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 120000 },
});
