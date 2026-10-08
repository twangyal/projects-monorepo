import { defineConfig } from '@playwright/test';

const portText = process.env.CLOTHING_TEST_PORT ?? '4186';
if (!/^\d+$/.test(portText) || Number(portText) < 1024 || Number(portText) > 65535) {
  throw new Error('CLOTHING_TEST_PORT must be an integer from 1024 to 65535.');
}
const origin = `http://127.0.0.1:${Number(portText)}`;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  use: {
    baseURL: origin,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `CLOTHING_STORAGE_TEST_HARNESS=1 npm run build && npm run preview -- --port ${Number(portText)} --strictPort`,
    url: origin, reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
  },
});
