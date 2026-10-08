import { defineConfig } from 'vite';
export default defineConfig({ build: process.env.STYLE_STUDIO_TEST_HARNESS === '1' ? {
  rollupOptions: { input: { main: 'index.html', storage: 'tests/storage-harness.html', images: 'tests/images-harness.html' } },
} : {} });
