// Pattern export for cutting: each piece's finished outline (the sewing line) plus a cutting line with seam
// allowance, a grainline and labels, as DXF (AutoCAD R12 ASCII, millimetres) or a printable 1:1 SVG (cm).
import { BASE_NAMES, material, partName, patternPieces, type PatternPiece, type Product } from './product.ts';

type Pt = { x: number; y: number };
export const SEAM_ALLOWANCE_CM = 1;
const GAP_CM = 6;

function signedArea(points: Pt[]) { let s = 0; for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; s += a.x * b.y - b.x * a.y; } return s / 2; }

/** The outline without repeated or degenerate points, so every edge has a direction. */
export function cleanOutline(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) if (!out.length || Math.hypot(p.x - out[out.length - 1].x, p.y - out[out.length - 1].y) > 1e-6) out.push({ ...p });
  while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-6) out.pop();
  return out;
}

/**
 * The outline moved outward by `distance` (seam allowance). Corners are mitred; very sharp corners are
 * bevelled so the cutting line never spikes away from the piece.
 */
export function offsetOutline(points: readonly Pt[], distance: number): Pt[] {
  const p = cleanOutline(points), n = p.length;
  if (n < 3) throw new Error('A pattern piece needs at least three corners.');
  // Outward normals, whichever way round the outline is listed.
  const sign = signedArea(p) > 0 ? 1 : -1, out: Pt[] = [];
  const normal = (a: Pt, b: Pt) => { const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy); return { x: sign * dy / length, y: -sign * dx / length }; };
  for (let i = 0; i < n; i++) {
    const prev = p[(i - 1 + n) % n], cur = p[i], next = p[(i + 1) % n];
    const n1 = normal(prev, cur), n2 = normal(cur, next), bisector = { x: n1.x + n2.x, y: n1.y + n2.y }, length = Math.hypot(bisector.x, bisector.y);
    const cos = n1.x * n2.x + n1.y * n2.y;
    if (length < 1e-9) { out.push({ x: cur.x + n1.x * distance, y: cur.y + n1.y * distance }); continue; }
    const miter = distance / Math.sqrt((1 + cos) / 2);
    if (miter > distance * 3) {
      // Bevel: two points, one off each edge.
      out.push({ x: cur.x + n1.x * distance, y: cur.y + n1.y * distance }, { x: cur.x + n2.x * distance, y: cur.y + n2.y * distance });
    } else out.push({ x: cur.x + bisector.x / length * miter, y: cur.y + bisector.y / length * miter });
  }
  return out;
}

export interface LaidOutPiece { piece: PatternPiece; label: string; detail: string; sewing: Pt[]; cutting: Pt[]; grain: [Pt, Pt]; at: Pt }

/** Pieces with their cutting lines, laid out left to right with a gap, origin at the top-left of the layout. */
export function layoutPattern(product: Product, allowance = SEAM_ALLOWANCE_CM): { pieces: LaidOutPiece[]; width: number; height: number } {
  let x = allowance;
  const size = product.spec?.sampleSize ?? 'M', laid: LaidOutPiece[] = [];
  for (const piece of patternPieces(product)) {
    const sewing = cleanOutline(piece.outline), cutting = offsetOutline(sewing, allowance);
    const minX = Math.min(...cutting.map(p => p.x)), minY = Math.min(...cutting.map(p => p.y));
    const shift = (p: Pt) => ({ x: p.x - minX + x, y: p.y - minY + allowance });
    const xs = sewing.map(p => p.x), ys = sewing.map(p => p.y), cx = (Math.min(...xs) + Math.max(...xs)) / 2, top = Math.min(...ys), bottom = Math.max(...ys);
    const grain: [Pt, Pt] = [shift({ x: cx, y: top + (bottom - top) * 0.2 }), shift({ x: cx, y: top + (bottom - top) * 0.8 })];
    const fabric = material(product.parts[piece.part].material).name;
    laid.push({ piece, label: partName(product, piece.part), detail: `${product.name} · ${BASE_NAMES[product.base]} · size ${size} · cut ${piece.cutCount}${piece.cutCount > 1 ? ' (mirror)' : ''} · ${fabric}`,
      sewing: sewing.map(shift), cutting: cutting.map(shift), grain, at: { x, y: allowance } });
    x += Math.max(...cutting.map(p => p.x)) - minX + GAP_CM;
  }
  const height = Math.max(...laid.flatMap(item => item.cutting.map(p => p.y))) + allowance;
  return { pieces: laid, width: x - GAP_CM + allowance, height };
}

// DXF (R12 ASCII). Layers: CUT (cutting line), SEW (finished line), GRAIN, TEXT. Units mm; y points up.
// R12 DXF has no UTF-8: user text loses control codes and backslashes (DXF format codes), and characters
// outside ASCII become \U+XXXX escapes, which CAD readers decode.
const plainText = (text: string) => [...text.replace(/[\\{}]/g, ' ')].filter(c => c.charCodeAt(0) >= 32).slice(0, 250)
  .map(c => (c.codePointAt(0)! > 0x7e ? (c.codePointAt(0)! > 0xffff ? '?' : `\\U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`) : c)).join('');
export function patternDxf(product: Product, allowance = SEAM_ALLOWANCE_CM): string {
  const { pieces } = layoutPattern(product, allowance), lines: string[] = [];
  const pair = (code: number, value: string | number) => { lines.push(String(code), typeof value === 'number' ? (Math.round(value * 1000) / 1000).toString() : value); };
  const mm = (p: Pt) => ({ x: p.x * 10, y: -p.y * 10 });
  const polyline = (layer: string, points: Pt[]) => {
    pair(0, 'POLYLINE'); pair(8, layer); pair(66, 1); pair(70, 1);
    for (const p of points.map(mm)) { pair(0, 'VERTEX'); pair(8, layer); pair(10, p.x); pair(20, p.y); pair(30, 0); }
    pair(0, 'SEQEND'); pair(8, layer);
  };
  pair(0, 'SECTION'); pair(2, 'HEADER'); pair(9, '$ACADVER'); pair(1, 'AC1009'); pair(9, '$INSUNITS'); pair(70, 4); pair(0, 'ENDSEC');
  pair(0, 'SECTION'); pair(2, 'ENTITIES');
  for (const item of pieces) {
    polyline('CUT', item.cutting);
    polyline('SEW', item.sewing);
    const [a, b] = item.grain.map(mm);
    pair(0, 'LINE'); pair(8, 'GRAIN'); pair(10, a.x); pair(20, a.y); pair(30, 0); pair(11, b.x); pair(21, b.y); pair(31, 0);
    const xs = item.sewing.map(p => p.x), ys = item.sewing.map(p => p.y), label = mm({ x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
    for (const [text, dy, height] of [[item.label, 0, 18], [item.detail, -26, 9]] as const) {
      pair(0, 'TEXT'); pair(8, 'TEXT'); pair(10, label.x); pair(20, label.y + dy); pair(30, 0); pair(40, height); pair(1, plainText(text)); pair(72, 1); pair(11, label.x); pair(21, label.y + dy); pair(31, 0);
    }
  }
  pair(0, 'ENDSEC'); pair(0, 'EOF');
  return `${lines.join('\n')}\n`;
}

// Printable SVG at 1:1 (user units are centimetres), with a 10 cm square to check the print scale.
const xml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function patternSvg(product: Product, allowance = SEAM_ALLOWANCE_CM): string {
  const { pieces, width, height } = layoutPattern(product, allowance), total = { w: width, h: height + 16 };
  const points = (list: Pt[]) => list.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const body = pieces.map(item => {
    const xs = item.sewing.map(p => p.x), ys = item.sewing.map(p => p.y), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const [a, b] = item.grain;
    return `<g data-piece="${item.piece.part}"><polygon points="${points(item.cutting)}" fill="none" stroke="#111" stroke-width="0.05"/>` +
      `<polygon points="${points(item.sewing)}" fill="none" stroke="#666" stroke-width="0.04" stroke-dasharray="0.4 0.3"/>` +
      `<line x1="${a.x.toFixed(2)}" y1="${a.y.toFixed(2)}" x2="${b.x.toFixed(2)}" y2="${b.y.toFixed(2)}" stroke="#111" stroke-width="0.05" marker-start="url(#grain)" marker-end="url(#grain)"/>` +
      `<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" font-size="1.6" text-anchor="middle" font-family="sans-serif">${xml(item.label)}</text>` +
      `<text x="${cx.toFixed(2)}" y="${(cy + 1.6).toFixed(2)}" font-size="0.7" text-anchor="middle" font-family="sans-serif">${xml(item.detail)}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total.w.toFixed(2)}cm" height="${total.h.toFixed(2)}cm" viewBox="0 0 ${total.w.toFixed(2)} ${total.h.toFixed(2)}">` +
    `<defs><marker id="grain" viewBox="0 0 4 4" refX="2" refY="2" markerWidth="1.2" markerHeight="1.2" orient="auto-start-reverse"><path d="M0,0 L4,2 L0,4 z" fill="#111"/></marker></defs>` +
    `<title>${xml(product.name)} pattern</title>${body}` +
    `<g transform="translate(${allowance} ${(height + 2).toFixed(2)})"><rect width="10" height="10" fill="none" stroke="#111" stroke-width="0.05"/>` +
    `<text x="11" y="5" font-size="0.8" font-family="sans-serif">10 cm square: print at 100% and check it. Solid: cutting line (${allowance} cm seam allowance). Dashed: sewing line. Arrow: grainline.</text></g></svg>`;
}
