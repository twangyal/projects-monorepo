import { defineConfig } from '@playwright/test';
const port = Number(process.env.MOTION_TEST_PORT ?? 4210);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MOTION_TEST_PORT must be a valid TCP port.');
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', workers: 2, fullyParallel: true,
  timeout: 30000,
  use: {
    baseURL,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    trace: 'retain-on-failure',
  },
  webServer: { command: `MOTION_TEST_HARNESS=1 npm run build && npm run preview -- --port ${port} --strictPort`, url: baseURL, reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 } },
});
