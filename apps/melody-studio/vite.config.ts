import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const input: Record<string, string> = { main: resolve(import.meta.dirname, 'index.html') };
if (process.env.MELODY_TEST_HARNESS === '1') {
  input.storageReceipts = resolve(import.meta.dirname, 'tests/storage-receipts-harness.html');
  input.backedAudio = resolve(import.meta.dirname, 'tests/backed-audio-harness.html');
}

export default defineConfig({ build: { rollupOptions: { input } } });
