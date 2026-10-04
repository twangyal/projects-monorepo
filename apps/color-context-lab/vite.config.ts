import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const inputs: Record<string, string> = { main: resolve(import.meta.dirname, 'index.html') };
if (process.env.COLOR_CONTEXT_TEST_HARNESS === '1') {
  for (const name of ['storage', 'media']) {
    const file = resolve(import.meta.dirname, `tests/${name}-harness.html`);
    if (existsSync(file)) inputs[name] = file;
  }
}
export default defineConfig({
  server: { port: 4289, strictPort: true },
  build: { rollupOptions: { input: inputs } },
});
