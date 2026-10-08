import type { Project } from './types.ts';
import { createProject, encodeMask, validateProject } from './model.ts';
import { normalizePhoto } from './images.ts';

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Authored demo cancelled.', 'AbortError');
}

/** Original local illustration: distant landscape, central subject, foreground terrace. */
export async function createDemoProject(signal?: AbortSignal): Promise<Project> {
  checkAbort(signal);
  if (typeof document === 'undefined') throw new Error('Canvas is required for the authored demo. Use current desktop Chromium.');
  const canvas = document.createElement('canvas');
  const width = 720;
  const height = 480;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable. Use current desktop Chromium for the authored demo.');
  const labels = new Uint8Array(width * height).fill(2);
  const rectangle = (x: number, y: number, w: number, h: number, color: string, plane?: 0 | 1 | 2) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    if (plane !== undefined) {
      for (let row = y; row < y + h; row++) labels.fill(plane, row * width + x, row * width + x + w);
    }
  };
  rectangle(0, 0, width, height, '#c3ddd9');
  ctx.fillStyle = '#f1c37a';
  ctx.beginPath(); ctx.arc(560, 96, 42, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#87aaa4';
  ctx.beginPath(); ctx.moveTo(0, 300); ctx.lineTo(128, 160); ctx.lineTo(272, 300);
  ctx.lineTo(436, 184); ctx.lineTo(720, 316); ctx.lineTo(720, 480); ctx.lineTo(0, 480); ctx.closePath(); ctx.fill();
  rectangle(0, 316, width, 164, '#73958f');
  for (let x = 0; x < width; x += 48) rectangle(x, 336 + (x % 3) * 8, 28, 4, '#b3ccc0');
  rectangle(288, 112, 144, 280, '#d89562', 1);
  rectangle(304, 128, 112, 28, '#fae6bd');
  rectangle(304, 172, 112, 136, '#35565a');
  for (let y = 180; y < 308; y += 16) rectangle(312, y, 96, 4, '#72938c');
  rectangle(312, 324, 96, 44, '#f1c37a');
  rectangle(264, 360, 192, 40, '#c17e57', 1);
  rectangle(0, 400, width, 80, '#375b55', 0);
  for (let y = 416; y < height; y += 24) rectangle(0, y, width, 2, '#6a8a70');
  rectangle(0, 304, 104, 96, '#456b58', 0);
  rectangle(616, 304, 104, 96, '#456b58', 0);
  for (const x of [16, 48, 80, 632, 664, 696]) rectangle(x, 304, 6, 96, '#a4b97b');
  checkAbort(signal);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => {
    if (signal?.aborted) reject(new DOMException('Authored demo cancelled.', 'AbortError'));
    else if (value) resolve(value);
    else reject(new Error('Canvas could not encode the authored demo. Retry in current desktop Chromium.'));
  }, 'image/png'));
  checkAbort(signal);
  const photo = await normalizePhoto(new File([blob], 'authored-lens-demo.png', { type: 'image/png' }), signal);
  checkAbort(signal);
  const project = createProject(photo);
  project.title = 'Authored three-plane study';
  project.depth = encodeMask(labels, width, height);
  return validateProject(project);
}
