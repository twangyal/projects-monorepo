import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 4260, strictPort: true },
  build: process.env.LENS_STUDIO_TEST_HARNESS === '1' ? {
    rollupOptions: { input: { main: 'index.html', images: 'tests/images-harness.html', storage: 'tests/storage-harness.html', jobs: 'tests/jobs-harness.html' } },
  } : {},
});
