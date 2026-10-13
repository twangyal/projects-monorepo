import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const harness = process.env.LENS_STUDIO_TEST_HARNESS === '1';
// Cross-origin isolation lets onnxruntime-web use worker threads for depth estimation.
// Static hosting needs the same two headers for multithreaded estimates (single-threaded otherwise).
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
const fixture = fileURLToPath(new URL('tests/fixtures/fixture-depth.onnx', import.meta.url));

/** Test builds serve a 214-byte stand-in model with the real model's input/output contract. */
function fixtureModel(): Plugin {
  return {
    name: 'lens-fixture-depth-model',
    configureServer(server) {
      server.middlewares.use('/models/fixture-depth.onnx', (_request, response) => { response.setHeader('Content-Type', 'application/octet-stream'); response.end(readFileSync(fixture)); });
    },
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'models/fixture-depth.onnx', source: readFileSync(fixture) }); },
  };
}

export default defineConfig({
  server: { port: 4260, strictPort: true, headers: isolation },
  preview: { headers: isolation },
  // onnxruntime-web's package exports hide its wasm binary; expose that one file as a URL asset.
  resolve: { alias: [{ find: /^onnxruntime-wasm-binary(\?.*)?$/, replacement: `${fileURLToPath(new URL('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', import.meta.url))}$1` }] },
  worker: { format: 'es' },
  define: harness ? {
    __LENS_DEPTH_MODEL__: JSON.stringify({
      name: 'test fixture depth model', file: 'fixture-depth.onnx', bytes: readFileSync(fixture).length,
      sha256: createHash('sha256').update(readFileSync(fixture)).digest('hex'), license: 'test only', source: 'tests/fixtures/fixture-depth.onnx',
    }),
  } : {},
  plugins: harness ? [fixtureModel()] : [],
  build: harness ? {
    rollupOptions: { input: { main: 'index.html', images: 'tests/images-harness.html', storage: 'tests/storage-harness.html', jobs: 'tests/jobs-harness.html' } },
  } : {},
});
