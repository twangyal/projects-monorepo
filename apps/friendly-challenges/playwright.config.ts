import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: '**/*.spec.ts', workers: 1, fullyParallel: false, timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:4250', launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}, trace: 'retain-on-failure' },
  // New lifecycle regressions use a separate notebook so the original suite keeps
  // its production 20-record capacity coverage without consuming synthetic records.
  projects: [
    { name: 'original', testIgnore: '**/circles-lifecycle.spec.ts' },
    { name: 'circle-lifecycle', testMatch: '**/circles-lifecycle.spec.ts', use: { baseURL: 'http://127.0.0.1:4251' } },
  ],
  webServer: [
    { command: 'npm run build && python3 tests/browser_server.py', url: 'http://127.0.0.1:4250', reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 } },
    { command: 'FRIENDLY_BROWSER_PORT=4251 python3 tests/browser_server.py', url: 'http://127.0.0.1:4251', reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 } },
  ],
});
