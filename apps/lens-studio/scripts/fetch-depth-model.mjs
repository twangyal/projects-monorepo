/* global console, fetch, process */
// Download (or copy with --from PATH) the pinned Depth Anything V2 Small ONNX model into
// public/models/, so the app serves it same-origin. The file is git-ignored and verified by size
// and SHA-256 before it is published; a mismatching file is never kept.
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = {
  file: 'depth-anything-v2-small.onnx', bytes: 99_092_268,
  sha256: '46c4e8eeda3a27f34701831b6a2ec7753d7b38779b215acb5633424703deed8f',
  source: 'https://github.com/fabio-sim/Depth-Anything-ONNX/releases/download/v2.0.0/depth_anything_v2_vits_dynamic.onnx',
};
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'public', 'models', MODEL.file);
const from = process.argv.indexOf('--from') >= 0 ? process.argv[process.argv.indexOf('--from') + 1] : null;

async function verify(path) {
  const info = await stat(path);
  if (info.size !== MODEL.bytes) throw new Error(`Expected ${MODEL.bytes} bytes, found ${info.size}.`);
  const digest = createHash('sha256').update(await readFile(path)).digest('hex');
  if (digest !== MODEL.sha256) throw new Error(`SHA-256 mismatch: ${digest}.`);
}

try {
  await verify(target);
  console.log(`Depth model already present and verified: ${target}`);
  process.exit(0);
} catch { /* Missing or wrong: fetch below. */ }
await mkdir(dirname(target), { recursive: true });
const partial = `${target}.part`;
try {
  if (from) await copyFile(from, partial);
  else {
    const response = await fetch(MODEL.source, { redirect: 'follow' });
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== MODEL.bytes) throw new Error(`Expected ${MODEL.bytes} bytes, downloaded ${bytes.length}.`);
    await writeFile(partial, bytes);
  }
  await verify(partial);
  await rename(partial, target);
  console.log(`Depth model verified (SHA-256 ${MODEL.sha256}) at ${target}\nSource: ${MODEL.source} · License: Apache-2.0 (Depth Anything V2 Small)`);
} catch (error) {
  await rm(partial, { force: true });
  console.error(`Depth model setup failed: ${error.message}`);
  process.exit(1);
}
