import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 4270, strictPort: true },
  build: process.env.STOCK_NOTEBOOK_TEST_HARNESS === '1' ? {
    rollupOptions: { input: { main: 'index.html', storage: 'tests/storage-harness.html' } },
  } : {},
});
