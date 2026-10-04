import { defineConfig } from '@playwright/test';

const port = Number(process.env.MELODY_TEST_PORT ?? '4174');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('MELODY_TEST_PORT must be an integer port from 1024 to 65535.');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  use: {
    baseURL,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    trace: 'retain-on-failure',
  },
  webServer: { command: `MELODY_TEST_HARNESS=1 npm run build && npm run preview -- --port ${port} --strictPort`, url: baseURL, reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 } },
});
