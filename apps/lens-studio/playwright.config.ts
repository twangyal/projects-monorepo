import { defineConfig } from '@playwright/test';
const rawPort = process.env.LENS_TEST_PORT ?? '4261';
const port = Number(rawPort);
if (!/^\d{1,5}$/.test(rawPort) || port < 1024 || port > 65535) throw new Error('LENS_TEST_PORT must be an integer port from 1024 to 65535.');
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/browser', testMatch: '**/*.spec.ts', workers: 1, fullyParallel: false, timeout: 45000,
  use: { baseURL, launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}, trace: 'retain-on-failure' },
  webServer: { command: `LENS_STUDIO_TEST_HARNESS=1 npm run build && npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`, url: baseURL, reuseExistingServer: false, timeout: 120000, gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 } },
});
