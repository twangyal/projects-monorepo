import { createProject, validateProject } from './model.ts';
import type { Garment, Project } from './model.ts';
import { validatePhoto } from './media.ts';

const GARMENT_WIDTH = 400;
const GARMENT_HEIGHT = 440;
const MAX_EXPORT_EDGE = 2048;
let svgSequence = 0;

function number(value: number): string { return String(Math.round(value * 1e6) / 1e6); }

function escape(value: string): string {
  let validXml = '';
  for (const character of value) {
    const code = character.codePointAt(0)!;
    const valid = code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || code >= 0x10000;
    validXml += valid ? character : '\ufffd';
  }
  return validXml.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

function outline(garment: Garment): string {
  const left = 200 - garment.bodyWidth / 2;
  const right = 200 + garment.bodyWidth / 2;
  const bottom = 80 + garment.bodyLength;
  const neck = garment.neckline === 'v' ? 'L 200 112 L 234 64' : 'Q 200 116 234 64';
  return `M ${number(left)} 80 L 166 64 ${neck} L ${number(right)} 80 L ${number(right + garment.sleeveLength)} 118 L ${number(right + garment.sleeveLength - 17)} 169 L ${number(right)} 145 L ${number(right)} ${number(bottom)} L ${number(left)} ${number(bottom)} L ${number(left)} 145 L ${number(left - garment.sleeveLength + 17)} 169 L ${number(left - garment.sleeveLength)} 118 Z`;
}

export function garmentPath(garment: Garment): string {
  return outline(validateProject({ ...createProject(), garment }).garment);
}

function garmentContent(project: Project, prefix: string): string {
  const garment = project.garment;
  const shape = outline(garment);
  const clipId = `${prefix}-clip`;
  const patternId = `${prefix}-pattern`;
  let pattern = '';
  if (garment.pattern === 'stripe') {
    pattern = `<pattern id="${patternId}" patternUnits="userSpaceOnUse" width="16" height="16" patternTransform="rotate(-12)"><path d="M 0 4 L 16 4" stroke="${garment.patternColor}" stroke-width="5" stroke-opacity="0.65"/></pattern>`;
  } else if (garment.pattern === 'weave') {
    pattern = `<pattern id="${patternId}" patternUnits="userSpaceOnUse" width="8" height="8"><path d="M 0 2 L 8 2 M 0 6 L 8 6" stroke="${garment.patternColor}" stroke-width="1" stroke-opacity="0.48"/><path d="M 2 0 L 2 8 M 6 0 L 6 8" stroke="${garment.patternColor}" stroke-width="1" stroke-opacity="0.28"/></pattern>`;
  }
  const strokes = project.strokes.map(stroke => {
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      return `<circle cx="${number(point.x * GARMENT_WIDTH)}" cy="${number(point.y * GARMENT_HEIGHT)}" r="${number(stroke.width / 2)}" fill="${stroke.color}"/>`;
    }
    const path = stroke.points.map((point, i) => `${i ? 'L' : 'M'} ${number(point.x * GARMENT_WIDTH)} ${number(point.y * GARMENT_HEIGHT)}`).join(' ');
    return `<path d="${path}" fill="none" stroke="${stroke.color}" stroke-width="${number(stroke.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join('');
  return `<defs><clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><path d="${shape}"/></clipPath>${pattern}</defs><g clip-path="url(#${clipId})"><path d="${shape}" fill="${garment.color}"/>${pattern ? `<path d="${shape}" fill="url(#${patternId})"/>` : ''}${strokes}</g><path d="${shape}" fill="none" stroke="#403a35" stroke-width="1.5" stroke-linejoin="round"/>`;
}

function svgDocument(title: string, width: number, height: number, prefix: string, content: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${prefix}-title"><title id="${prefix}-title">${escape(title)}</title>${content}</svg>`;
}

function garmentDocument(project: Project): string {
  const prefix = `clothing-svg-${++svgSequence}`;
  return svgDocument(project.title, GARMENT_WIDTH, GARMENT_HEIGHT, prefix, garmentContent(project, prefix));
}

export function garmentSvg(project: Project): string { return garmentDocument(validateProject(project)); }

export function exportGarmentSvg(project: Project): Blob {
  const safe = validateProject(project);
  // Stable IDs keep portable bytes independent of workspace rendering.
  const prefix = 'clothing-export';
  const svg = svgDocument(safe.title, GARMENT_WIDTH, GARMENT_HEIGHT, prefix, garmentContent(safe, prefix));
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  if (blob.size > 1024 * 1024) throw new Error('Garment SVG exceeds the 1 MiB export limit.');
  return blob;
}

function stageSize(project: Project): { width: number; height: number } {
  return project.photo ? { width: project.photo.width, height: project.photo.height } : { width: 600, height: 800 };
}

export function previewSize(project: Project): { width: number; height: number } { return stageSize(validateProject(project)); }

// Original inline front-view figure: a visual placement guide, with no fit simulation.
const SAMPLE_PERSON = '<g data-sample-person="true"><ellipse cx="300" cy="758" rx="118" ry="15" fill="#ded7cc"/><path d="M 256 455 L 340 455 L 357 733 Q 335 746 313 732 L 298 531 L 284 732 Q 260 746 240 733 Z" fill="#797d79"/><path d="M 225 223 Q 204 226 191 277 L 156 459 Q 154 477 168 481 Q 181 485 188 468 L 246 302 Z M 375 223 Q 396 226 409 277 L 444 459 Q 446 477 432 481 Q 419 485 412 468 L 354 302 Z" fill="#cfb6a3"/><path d="M 270 174 L 330 174 L 338 224 L 262 224 Z" fill="#cfb6a3"/><path d="M 263 210 Q 235 215 220 233 L 236 326 L 239 469 Q 300 490 361 469 L 364 326 L 380 233 Q 365 215 337 210 Z" fill="#ccc8bf"/><ellipse cx="300" cy="125" rx="47" ry="59" fill="#d9c1ae"/><path d="M 254 119 Q 249 64 300 61 Q 352 64 346 119 L 332 84 Q 290 98 267 83 Z" fill="#69605b"/><path d="M 243 734 L 282 734 L 290 757 L 229 757 Q 226 743 243 734 Z M 314 734 L 353 734 Q 371 743 369 757 L 308 757 Z" fill="#575953"/></g>';

function previewDocument(project: Project): string {
  const prefix = `clothing-svg-${++svgSequence}`;
  const { width, height } = stageSize(project);
  const placement = project.placement;
  const background = `<rect x="0" y="0" width="${width}" height="${height}" fill="#eee9e0"/>`;
  // validateProject permits only a JPEG prefix plus base64 characters here.
  const person = project.photo ? `<image x="0" y="0" width="${width}" height="${height}" href="${project.photo.dataUrl}" preserveAspectRatio="none"><title>${escape(project.photo.name)}</title></image>` : SAMPLE_PERSON;
  const transform = `translate(${number(placement.x * width)} ${number(placement.y * height)}) rotate(${number(placement.rotation)}) scale(${number(placement.width * width / GARMENT_WIDTH)} ${number(placement.height * height / GARMENT_HEIGHT)}) translate(-200 -220)`;
  const clothing = `<g transform="${transform}" opacity="${number(placement.opacity)}">${garmentContent(project, prefix)}</g>`;
  return svgDocument(project.title, width, height, prefix, `${background}${person}${clothing}`);
}

export function previewSvg(project: Project): string { return previewDocument(validateProject(project)); }

export async function exportPng(project: Project, kind: 'garment' | 'preview'): Promise<Blob> {
  const safe = validateProject(project);
  if (kind !== 'garment' && kind !== 'preview') throw new Error('Export kind must be garment or preview.');
  if (typeof document === 'undefined' || typeof Image === 'undefined') throw new Error('PNG export requires a browser.');
  if (kind === 'preview') await validatePhoto(safe.photo);
  const dimensions = kind === 'garment' ? { width: GARMENT_WIDTH, height: GARMENT_HEIGHT } : stageSize(safe);
  const scale = Math.min(1, MAX_EXPORT_EDGE / Math.max(dimensions.width, dimensions.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(dimensions.width * scale));
  canvas.height = Math.max(1, Math.round(dimensions.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not create an image export canvas.');
  const markup = kind === 'garment' ? garmentDocument(safe) : previewDocument(safe);
  const objectUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { image.onload = null; image.onerror = null; reject(new Error('Image export timed out. Please try again.')); }, 15000);
      image.onload = () => { clearTimeout(timeout); resolve(); };
      image.onerror = () => { clearTimeout(timeout); reject(new Error('The browser could not render this design for export.')); };
      image.src = objectUrl;
    });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The browser could not encode this PNG.')), 'image/png');
    });
  } finally {
    image.onload = null;
    image.onerror = null;
    image.src = '';
    URL.revokeObjectURL(objectUrl);
    canvas.width = 0;
    canvas.height = 0;
  }
}
