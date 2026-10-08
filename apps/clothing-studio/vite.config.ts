import { defineConfig } from 'vite';
export default defineConfig({
  build: process.env.CLOTHING_STORAGE_TEST_HARNESS === '1' ? {
    rollupOptions: { input: { main: 'index.html', storage: 'tests/storage-harness.html' } },
  } : {},
});
