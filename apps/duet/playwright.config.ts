import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', workers: 1, fullyParallel: false, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:4220', launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}, trace: 'retain-on-failure' },
  webServer: { command: 'DUET_TEST_HARNESS=1 npm run build && python3 tests/browser_server.py', url: 'http://127.0.0.1:4220', reuseExistingServer: false },
});
