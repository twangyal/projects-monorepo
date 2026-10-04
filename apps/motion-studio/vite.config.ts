import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const input: Record<string, string> = { main: resolve('index.html') };
if (process.env.MOTION_TEST_HARNESS === '1') {
  for (const name of ['export', 'media', 'tween']) {
    const path = resolve(`tests/${name}-harness.html`);
    if (existsSync(path)) input[name] = path;
  }
}
export default defineConfig({ build: { rollupOptions: { input } } });
