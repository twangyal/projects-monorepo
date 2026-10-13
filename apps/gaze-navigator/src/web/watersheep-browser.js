// Loads WaterSheep in a browser page: the vendored runtime (dist/vendor/watersheep, see
// scripts/vendor-watersheep.js) and the model at a pinned revision from Hugging Face. The model is
// checked against its published SHA-256 and kept in this origin's Cache Storage, so it downloads once.
import { waterSheepFromFiles } from './watersheep.js';

export const WATERSHEEP_MODEL = {
  repository: 'samratduttaofficial/WaterSheep',
  revision: '236de6496b530d37e36a8ac63ff8412e92940f6e',
  onnx: { path: 'onnx/model_quantized.onnx', bytes: 158_196_995, sha256: '160ae91868f919ae0ddc6d1bd509b17d93194102aa33a466095469fbf04dc25b' },
};
const CACHE = `gaze-watersheep-${WATERSHEEP_MODEL.revision.slice(0, 12)}`;

const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');

async function download(url, fetch, progress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The matching model could not be downloaded (${response.status}).`);
  const total = Number(response.headers.get('Content-Length')) || WATERSHEEP_MODEL.onnx.bytes;
  const reader = response.body.getReader(), parts = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); received += value.length;
    if (received > WATERSHEEP_MODEL.onnx.bytes) throw new Error('The matching model download is larger than expected.');
    progress(received, total);
  }
  const bytes = new Uint8Array(received);
  let at = 0;
  for (const part of parts) { bytes.set(part, at); at += part.length; }
  return bytes;
}

/**
 * @param {object} options
 * @param {string} options.runtimeBase URL of the vendored runtime directory (ending in /)
 * @param {(received: number, total: number) => void} [options.progress]
 */
export async function loadWaterSheepInBrowser({ runtimeBase, progress = () => {}, fetch = globalThis.fetch.bind(globalThis), caches = globalThis.caches, crypto = globalThis.crypto }) {
  const ort = await import(`${runtimeBase}ort.wasm.bundle.min.mjs`);
  const { Tokenizer } = await import(`${runtimeBase}tokenizers.min.mjs`);
  // Only the wasm binary is a separate file; the bundle carries its own glue code (no dynamic imports).
  ort.env.wasm.wasmPaths = { wasm: `${runtimeBase}ort-wasm-simd-threaded.wasm` };
  ort.env.logLevel = 'error';
  // Threads need cross-origin isolation (the extension's model page has it); ordinary pages run single-threaded.
  ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, globalThis.navigator?.hardwareConcurrency || 1) : 1;
  ort.env.wasm.proxy = false;
  const base = `https://huggingface.co/${WATERSHEEP_MODEL.repository}/resolve/${WATERSHEEP_MODEL.revision}/`;
  const json = async path => { const response = await fetch(base + path); if (!response.ok) throw new Error(`The matching model's ${path} could not be downloaded (${response.status}).`); return response.json(); };
  const [meta, tokenizerJson, tokenizerConfig] = await Promise.all([json('watersheep.json'), json('tokenizer/tokenizer.json'), json('tokenizer/tokenizer_config.json')]);
  const key = base + WATERSHEEP_MODEL.onnx.path;
  const cache = await caches?.open(CACHE).catch(() => null);
  let bytes = null;
  const cached = await cache?.match(key);
  if (cached) bytes = new Uint8Array(await cached.arrayBuffer());
  // Cached or fresh, the model must be exactly the published file.
  if (!bytes || hex(await crypto.subtle.digest('SHA-256', bytes)) !== WATERSHEEP_MODEL.onnx.sha256) {
    bytes = await download(key, fetch, progress);
    if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== WATERSHEEP_MODEL.onnx.sha256) throw new Error('The matching model did not match its published checksum, so it was not used.');
    await cache?.put(key, new Response(bytes)).catch(() => undefined);
  }
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  return waterSheepFromFiles({ ort, Tokenizer, session, meta, tokenizerJson, tokenizerConfig });
}
