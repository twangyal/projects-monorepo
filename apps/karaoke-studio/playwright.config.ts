import { defineConfig } from '@playwright/test';

const rawPort = process.env.KARAOKE_TEST_PORT ?? '4188';
const port = Number(rawPort);
if (!/^\d{1,5}$/.test(rawPort) || port < 1024 || port > 65534) throw new Error('KARAOKE_TEST_PORT must be an integer port from 1024 to 65534.');
const baseURL = `http://127.0.0.1:${port}`;
const allTools = (origin: string) => ({ cookies: [], origins: [{ origin, localStorage: [{ name: 'karaoke-workspace', value: 'all' }] }] });

export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', workers: 1, fullyParallel: false,
  timeout: 30000,
  use: {
    baseURL,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    trace: 'retain-on-failure',
  },
  // Feature specs work in the view that lists every tool; focused-workspace.spec.ts starts from the default focused view.
  projects: [
    { name: 'original', testIgnore: '**/recognition-cache.spec.ts', use: { storageState: allTools(baseURL) } },
    { name: 'recognition-cache', testMatch: '**/recognition-cache.spec.ts', use: { baseURL: `http://127.0.0.1:${port + 1}`, storageState: allTools(`http://127.0.0.1:${port + 1}`) } },
  ],
  webServer: [{
    command: 'npm run build && python3 tests/browser_server.py',
    url: baseURL, reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGINT', timeout: 10000 },
  }, {
    command: `KARAOKE_TEST_PORT=${port + 1} python3 tests/browser_server.py`,
    url: `http://127.0.0.1:${port + 1}`, reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGINT', timeout: 10000 },
  }],
});
