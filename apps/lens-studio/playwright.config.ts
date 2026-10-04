import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: '**/*.spec.ts', workers: 1, fullyParallel: false, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:4261', launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}, trace: 'retain-on-failure' },
  webServer: { command: 'LENS_STUDIO_TEST_HARNESS=1 npm run build && npm run preview -- --host 127.0.0.1 --port 4261 --strictPort', url: 'http://127.0.0.1:4261', reuseExistingServer: false, timeout: 120000 },
});
