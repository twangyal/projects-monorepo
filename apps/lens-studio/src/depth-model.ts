/**
 * The learned depth model: Depth Anything V2 Small (Apache-2.0), dynamic-shape ONNX export by the
 * Depth-Anything-ONNX project. It is never bundled in Git. `npm run fetch-depth-model` places the
 * pinned file under `public/models/` so the app serves it same-origin; people can also choose a
 * downloaded copy. Either way the bytes must match the pinned size and SHA-256 before use.
 */
export interface DepthModelInfo { name: string; file: string; bytes: number; sha256: string; license: string; source: string }

declare const __LENS_DEPTH_MODEL__: DepthModelInfo | undefined;

export const DEPTH_MODEL: DepthModelInfo = typeof __LENS_DEPTH_MODEL__ === 'object' && __LENS_DEPTH_MODEL__ ? __LENS_DEPTH_MODEL__ : {
  name: 'Depth Anything V2 Small',
  file: 'depth-anything-v2-small.onnx',
  bytes: 99_092_268,
  sha256: '46c4e8eeda3a27f34701831b6a2ec7753d7b38779b215acb5633424703deed8f',
  license: 'Apache-2.0',
  source: 'https://github.com/fabio-sim/Depth-Anything-ONNX/releases/download/v2.0.0/depth_anything_v2_vits_dynamic.onnx',
};

let verified: Blob | null = null;

export function verifiedModel(): Blob | null { return verified; }

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Accept a model file only when it is exactly the pinned artifact. */
export async function verifyModel(blob: Blob): Promise<Blob> {
  if (!(blob instanceof Blob) || blob.size !== DEPTH_MODEL.bytes) throw new Error(`This is not the pinned ${DEPTH_MODEL.name} file (expected ${DEPTH_MODEL.bytes.toLocaleString('en-US')} bytes).`);
  if (await sha256(blob) !== DEPTH_MODEL.sha256) throw new Error(`This file does not match the pinned ${DEPTH_MODEL.name} checksum. It was not used.`);
  verified = new Blob([blob], { type: 'application/octet-stream' });
  return verified;
}

/** The model served next to the app, or null when this installation does not host it. */
export async function loadHostedModel(signal?: AbortSignal): Promise<Blob | null> {
  if (verified) return verified;
  let response: Response;
  try { response = await fetch(`${import.meta.env.BASE_URL}models/${DEPTH_MODEL.file}`, { signal, cache: 'force-cache', credentials: 'same-origin' }); }
  catch (error) { if (signal?.aborted) throw error; return null; }
  if (response.status === 404 || !response.ok) return null;
  const length = Number(response.headers.get('Content-Length') ?? DEPTH_MODEL.bytes);
  if (length !== DEPTH_MODEL.bytes) { void response.body?.cancel(); throw new Error('The hosted depth model has an unexpected size. It was not used.'); }
  return await verifyModel(await response.blob());
}
