import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    // The 3D product view (three.js) is a lazily loaded chunk of about 600 kB; the first screen does not load it.
    chunkSizeWarningLimit: 800,
    ...(process.env.CLOTHING_STORAGE_TEST_HARNESS === '1' ? { rollupOptions: { input: { main: 'index.html', storage: 'tests/storage-harness.html' } } } : {}),
  },
});
