import { decodePixels, validateProject } from './model.ts';
import { encodePng } from './png.ts';
import { renderComparison } from './render.ts';
import { LIMITS } from './types.ts';
import type { Project } from './types.ts';
function check(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('Operation cancelled.', 'AbortError'); }
function escape(value: string): string { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!); }
function base64(bytes: Uint8Array): string {
  let raw = '';
  for (let start = 0; start < bytes.length; start += 16384) raw += String.fromCharCode(...bytes.subarray(start, start + 16384));
  return btoa(raw);
}
export async function buildHtmlReport(project: Project, signal?: AbortSignal): Promise<string> {
  const snapshot = validateProject(project);
  check(signal);
  const comparison = renderComparison(snapshot);
  const raw = decodePixels(snapshot.image).rgba;
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(raw).buffer);
  check(signal);
  const sha = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let bytes = 0;
  function append(value: string): void {
    check(signal);
    bytes += encoder.encode(value).length;
    if (bytes > LIMITS.reportBytes) throw new Error('HTML report exceeds 16 MiB. Download the complete project JSON instead.');
    parts.push(value);
  }
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  append(`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(csp)}"><title>${escape(snapshot.title)} — Color Context Lab</title><style>body{font:16px system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:1rem;color:#202020;background:#fff}figure{margin:1rem 0}img{max-width:100%;height:auto;image-rendering:auto}dl{display:grid;grid-template-columns:1fr 2fr;gap:.5rem}dt{font-weight:bold}dd{margin:0;overflow-wrap:anywhere}</style></head><body><h1>${escape(snapshot.title)}</h1><p>Color Context Lab — exact normalized RGBA comparison</p><dl>`);
  const fields: [string, string | number][] = [
    ['Source label', snapshot.image.source.fileName], ['Source format', snapshot.image.source.format], ['Source dimensions', `${snapshot.image.source.width} × ${snapshot.image.source.height}`], ['Normalized dimensions', `${snapshot.image.width} × ${snapshot.image.height}`], ['Output dimensions', `${comparison.result.width} × ${comparison.result.height}`], ['Normalized raw RGBA SHA-256', sha], ['Surround mode', snapshot.settings.mode], ['Border pixels', snapshot.settings.border], ['Color A', snapshot.settings.colorA], ['Color B', snapshot.settings.colorB], ['Checker cell pixels', snapshot.settings.cellSize],
    ['Artwork changed pixels (any RGBA byte)', comparison.metrics.artworkChangedPixels], ['Artwork maximum RGBA byte delta', comparison.metrics.artworkMaxChannelDelta], ['Surround pixels', comparison.metrics.surroundPixels], ['Total pixels', comparison.metrics.totalPixels], ['RGB RMSE (encoded-sRGB bytes; denominator 3 × total pixels)', comparison.metrics.rgbRmse], ['Maximum encoded-sRGB RGB byte delta', comparison.metrics.maxRgbDelta], ['Mean absolute linear-Y luminance delta (denominator total pixels)', comparison.metrics.meanAbsoluteLuminanceDelta],
  ];
  for (const [label, value] of fields) append(`<dt>${escape(label)}</dt><dd>${escape(String(value))}</dd>`);
  append('</dl><p>Linear-Y uses sRGB decoding and coefficients 0.2126, 0.7152, 0.0722. Metrics include the entire output and measure numerical changes, not perceptual similarity or model behavior.</p>');
  for (const [label, raster] of [['Baseline: neutral gray surround', comparison.baseline], ['Result: applied surround', comparison.result]] as const) {
    const png = encodePng(raster);
    check(signal);
    append(`<figure><figcaption>${label}</figcaption><img alt="${label}" width="${raster.width}" height="${raster.height}" src="data:image/png;base64,${base64(png)}"></figure>`);
  }
  append('<p>The normalized artwork RGBA bytes, including transparent RGB, are preserved exactly in both PNGs. Browser presentation can quantize translucent colors. Native PNG decoding, color conversion, premultiplication and downsampling may change the original file pixels: the retained normalized image is a lossy baseline, not the compressed source file. This surround edit offers no protection, robustness or perceptual guarantee, and is separate from narrowly measured procedural experiments.</p></body></html>');
  check(signal);
  return parts.join('');
}

export function validateVariantPair(project: Project, first: number, second: number): void {
  if (!Number.isInteger(first) || !Number.isInteger(second) || first === second || first < 0 || second < 0 || first >= (project.variants?.length ?? 0) || second >= (project.variants?.length ?? 0)) throw new Error('Choose two distinct retained surround variants.');
}
export async function buildVariantReport(project: Project, first: number, second: number, signal?: AbortSignal): Promise<string> {
  const snapshot = validateProject(project);
  validateVariantPair(snapshot, first, second); check(signal);
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(decodePixels(snapshot.image).rgba).buffer);
  check(signal);
  const sha = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const parts: string[] = [], encoder = new TextEncoder(); let bytes = 0;
  function append(value: string): void {
    check(signal); bytes += encoder.encode(value).length;
    if (bytes > LIMITS.reportBytes) throw new Error('HTML report exceeds 16 MiB. Download the complete project JSON instead.');
    parts.push(value);
  }
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  append(`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(csp)}"><title>${escape(snapshot.title)} — Named surrounds</title><style>body{font:16px system-ui,sans-serif;max-width:1200px;margin:2rem auto;padding:1rem;color:#202020;background:#fff}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2rem}section{min-width:0;overflow-wrap:anywhere}img{max-width:100%;height:auto}dl{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}dd{margin:0;overflow-wrap:anywhere}code{overflow-wrap:anywhere}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style></head><body><h1>${escape(snapshot.title)}</h1><p>Color Context Lab — two retained surround variants</p><p>Source: ${escape(snapshot.image.source.fileName)} (${escape(snapshot.image.source.format)}, ${snapshot.image.source.width} × ${snapshot.image.source.height}); normalized artwork: ${snapshot.image.width} × ${snapshot.image.height}. Shared normalized raw RGBA SHA-256: <code>${sha}</code>.</p><p>Both PNGs preserve the same normalized artwork, including hidden and low-alpha RGB. Each variant is measured against its own same-size neutral gray surround; these diagnostics are not a direct difference between the two variants and are not perceptual measurements or protection scores. Different border widths can scale the displayed artwork differently; inspect each PNG at actual pixels for an unscaled comparison.</p><div class="pair">`);
  for (const index of [first, second]) {
    check(signal);
    const variant = snapshot.variants![index]!, comparison = renderComparison({...snapshot, settings: variant.settings}), settings = variant.settings;
    append(`<section><h2>${escape(variant.name)}</h2><img alt="${escape(variant.name)} — retained surround" width="${comparison.result.width}" height="${comparison.result.height}" src="data:image/png;base64,${base64(encodePng(comparison.result))}"><h3>Surround settings and neutral-reference diagnostics</h3><dl>`);
    const fields: [string, string | number][] = [
      ['Output dimensions', `${comparison.result.width} × ${comparison.result.height}`], ['Pattern', settings.mode], ['Border pixels', settings.border], ['Color A', settings.colorA], ['Color B', settings.colorB], ['Checker cell pixels', settings.cellSize],
      ['Changed artwork pixels', comparison.metrics.artworkChangedPixels], ['Artwork maximum RGBA delta', comparison.metrics.artworkMaxChannelDelta], ['Surround pixels', comparison.metrics.surroundPixels], ['Total pixels', comparison.metrics.totalPixels],
      ['Encoded-sRGB RGB RMSE (byte units)', comparison.metrics.rgbRmse], ['Maximum encoded-sRGB RGB delta', comparison.metrics.maxRgbDelta], ['Mean absolute linear-Y luminance delta', comparison.metrics.meanAbsoluteLuminanceDelta],
    ];
    for (const [label, value] of fields) append(`<dt>${escape(label)}</dt><dd>${escape(String(value))}</dd>`);
    append('</dl></section>');
  }
  append('</div><p>Numerical diagnostics use the whole output. RGB RMSE divides by 3 × total pixels; mean absolute linear-Y delta divides by total pixels. Linear-Y decodes sRGB and uses coefficients 0.2126, 0.7152, 0.0722. Browser presentation may quantize translucent colors. The retained normalized baseline may differ from original uploaded file pixels after native decoding, color conversion and downsampling. No human perceived similarity, model behavior, artwork protection or generative-model transfer is established.</p></body></html>');
  check(signal); return parts.join('');
}
