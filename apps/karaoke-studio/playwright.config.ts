import { defineConfig } from '@playwright/test';

const rawPort = process.env.KARAOKE_TEST_PORT ?? '4188';
const port = Number(rawPort);
if (!/^\d{1,5}$/.test(rawPort) || port < 1024 || port > 65535) throw new Error('KARAOKE_TEST_PORT must be an integer port from 1024 to 65535.');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', workers: 1, fullyParallel: false,
  timeout: 30000,
  use: {
    baseURL,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && python3 tests/browser_server.py',
    url: baseURL, reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGINT', timeout: 10000 },
  },
});
