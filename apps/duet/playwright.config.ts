import { defineConfig } from '@playwright/test';
const port = Number(process.env.DUET_TEST_PORT ?? 4220);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DUET_TEST_PORT must be an available port between 1 and 65535.');
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', workers: 1, fullyParallel: false, timeout: 45000,
  use: { baseURL, launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}, trace: 'retain-on-failure' },
  webServer: { command: 'DUET_TEST_HARNESS=1 npm run build && python3 tests/browser_server.py', url: baseURL, reuseExistingServer: false, gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 } },
});
