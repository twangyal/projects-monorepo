import { renderProject, exportPng } from '../src/jobs.ts';
import { createProject, encodeMask, updateSettings } from '../src/model.ts';
import { decodePhoto, normalizePhoto } from '../src/images.ts';
import { encodePng } from '../src/png.ts';
import { presentFrame, renderPixels } from '../src/render.ts';
import type { Project } from '../src/types.ts';

const NativeWorker = window.Worker;
const workers: { stopped: boolean }[] = [];
window.Worker = class extends NativeWorker {
  private entry = { stopped: false };
  constructor(url: string | URL, options?: WorkerOptions) { super(url, options); workers.push(this.entry); }
  override terminate(): void { this.entry.stopped = true; super.terminate(); }
};
function stats() { return { created: workers.length, live: workers.filter(w => !w.stopped).length, stopped: workers.filter(w => w.stopped).length }; }
function base64(bytes: Uint8Array): string {
  let text = ''; for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192)); return btoa(text);
}
function fixture(width = 31, height = 19, targetFocal = 40): Project {
  const rgba = new Uint8ClampedArray(width * height * 4), labels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    rgba.set([(x * 71 + y * 13) % 256, (x * 23 + y * 97) % 256, (x * 37 + y * 47) % 256, index % 7 === 0 ? 1 : index % 11 === 0 ? 0 : 255], index * 4);
    labels[index] = x < width / 3 ? 2 : x < width * 2 / 3 ? 1 : 0;
  }
  const photo = { id: crypto.randomUUID(), width, height, dataUrl: `data:image/png;base64,${base64(encodePng({ width, height, rgba }))}` };
  const project = updateSettings(createProject(photo), { mode: 'perspective', targetFocal }); project.depth = encodeMask(labels, width, height); return project;
}
async function roundTrip(targetFocal: number) {
  const project = fixture(31, 19, targetFocal), original = JSON.stringify(project);
  const source = await decodePhoto(project.photo), expected = renderPixels(source, project);
  const frame = await renderProject(project), blob = await exportPng(project);
  const canvas = document.createElement('canvas'); canvas.width = frame.width; canvas.height = frame.height;
  const ctx = canvas.getContext('2d')!; presentFrame(ctx, frame); const displayed = [...ctx.getImageData(0, 0, canvas.width, canvas.height).data];
  const image = await createImageBitmap(blob);
  try { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0); }
  finally { image.close(); }
  return { width: frame.width, height: frame.height, rgba: [...frame.rgba], expected: [...expected.rgba], coverage: frame.missingFraction,
    expectedCoverage: expected.missingFraction, png: [...new Uint8Array(await blob.arrayBuffer())], displayed,
    decodedDisplay: [...ctx.getImageData(0, 0, canvas.width, canvas.height).data], preserved: original === JSON.stringify(project), stats: stats() };
}
const outcome = (promise: Promise<unknown>): Promise<string> => promise.then(() => 'success', error => error instanceof Error ? error.name : 'unknown');
async function lifecycle() {
  const project = fixture(), old = outcome(renderProject(project));
  const invalid = await outcome(renderProject({ ...project, title: '' })); const afterInvalid = stats();
  const pre = new AbortController(); pre.abort(); const preAborted = await outcome(exportPng(project, pre.signal)); const afterPreAborted = stats();
  const exported = exportPng(project); const superseded = await old; await exported;
  const live = new AbortController(); const aborted = outcome(renderProject(project, live.signal)); live.abort(); const abortedName = await aborted;
  const recovered = await renderProject(project);
  return { invalid, preAborted, afterInvalid, afterPreAborted, superseded, abortedName, recovered: recovered.width === 31, stats: stats() };
}
function badCompressedPhoto(project: Project): Project {
  const bytes = Uint8Array.from(atob(project.photo.dataUrl.split(',')[1]!), char => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset);
    if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'IDAT') {
      bytes[offset + 8] = 0; // Invalid zlib header, with a valid PNG chunk checksum.
      let crc = 0xffffffff;
      for (const byte of bytes.subarray(offset + 4, offset + 8 + length)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
      view.setUint32(offset + 8 + length, (crc ^ 0xffffffff) >>> 0); break;
    }
    offset += length + 12;
  }
  return { ...project, photo: { ...project.photo, dataUrl: `data:image/png;base64,${base64(bytes)}` } };
}
async function decodeFailure() {
  const project = fixture(); const before = JSON.stringify(project); const failed = await outcome(renderProject(badCompressedPhoto(project)));
  const recovered = await renderProject(project);
  return { failed, preserved: before === JSON.stringify(project), recovered: recovered.width === 31, stats: stats() };
}
async function measure(side = 1280) {
  const project = fixture(side, side); const start = performance.now();
  const frame = await renderProject(project); const rendered = performance.now();
  const png = await exportPng(project); const exported = performance.now();
  return { width: frame.width, height: frame.height, renderMs: rendered - start, exportMs: exported - rendered, pngBytes: png.size, missingFraction: frame.missingFraction, stats: stats() };
}
const api = { roundTrip, lifecycle, decodeFailure, measure, renderProject, exportPng, normalizePhoto, createProject, encodeMask, updateSettings, encodePng, decodePhoto };
declare global { interface Window { lensJobs: typeof api } }
window.lensJobs = api;
