import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', workers: 2, fullyParallel: true,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4210',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    trace: 'retain-on-failure',
  },
  webServer: { command: 'MOTION_TEST_HARNESS=1 npm run build && npm run preview -- --port 4210', url: 'http://127.0.0.1:4210', reuseExistingServer: false },
});
