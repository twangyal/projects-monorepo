import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { validateProject } from '../src/model.ts';
import { validateAssetHeader } from '../src/images.ts';
import { MAX_PROJECT_BYTES } from './types.ts';
import { parseStrictJson } from './strict-json.ts';
import { validatePng } from './png-admission.ts';

try {
  const parsed = parseStrictJson(workerData as Uint8Array,MAX_PROJECT_BYTES);
  if (!parsed || typeof parsed !== 'object' || Object.getOwnPropertyDescriptor(parsed,'schemaVersion')?.value !== 2) throw new Error('Canonical schema 2 is required.');
  const project = validateProject(parsed);
  for (const layer of project.layers) if (layer.kind === 'image') validatePng(validateAssetHeader(layer.image),layer.image.width,layer.image.height);
  const json = new TextEncoder().encode(JSON.stringify(project));
  if (json.byteLength > MAX_PROJECT_BYTES) throw new Error('Canonical output exceeds its byte limit.');
  const sha256 = createHash('sha256').update(json).digest('hex');
  parentPort?.postMessage({ok:true,project,json,sha256},[json.buffer]);
} catch {
  parentPort?.postMessage({ok:false});
} finally { parentPort?.close(); }
