import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const input: Record<string, string> = { main: resolve('index.html') };
if (process.env.DUET_TEST_HARNESS === '1' && existsSync('tests/sync-harness.html')) input.sync = resolve('tests/sync-harness.html');
export default defineConfig({ build: { rollupOptions: { input } } });
