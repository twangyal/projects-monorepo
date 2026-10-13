// Procedural fabric and repeat-print tiles. A tile covers `tileCm` × `tileCm` of fabric, so 3D UVs in cm
// divided by tileCm repeat it at physical size.
import { material, type Layout, type Motif, type PartStyle, type Print, type UploadedMotif } from './product.ts';

// Uploaded motif images are decoded once; tiles painted before decoding report `complete: false`.
const images = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();
export function motifImage(dataUrl: string): HTMLImageElement | null {
  let image = images.get(dataUrl);
  if (!image) {
    image = new Image(); image.src = dataUrl; images.set(dataUrl, image);
    image.decode().then(() => { for (const listener of listeners) listener(); }).catch(() => undefined);
    if (images.size > 24) images.delete(images.keys().next().value!);
  }
  return image.complete && image.naturalWidth ? image : null;
}
/** Wait for the snapshot's exact uploaded motifs before painting export textures. */
export async function prepareMotifImages(motifs: readonly UploadedMotif[]) {
  await Promise.all(motifs.map(motif => { motifImage(motif.dataUrl); return images.get(motif.dataUrl)!.decode(); }));
}
/** Called whenever an uploaded motif finishes decoding, so views can repaint. */
export function onMotifImage(listener: () => void) { listeners.add(listener); }

export interface MotifPlacement { x: number; y: number; flipX: boolean; flipY: boolean }
/**
 * Where motifs sit in one repeat tile (unit square), for each repeat layout. Each layout's tile is seamless:
 * half-drop offsets alternate columns by half a repeat vertically, half-brick alternate rows horizontally,
 * and mirror reflects neighbouring cells.
 */
export function motifPlacements(layout: Layout): MotifPlacement[] {
  const cells = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const;
  return cells.map(([x, y], index) => {
    const column = index % 2, row = Math.floor(index / 2);
    if (layout === 'half-drop') return { x, y: (y + (column ? 0.25 : 0)) % 1, flipX: false, flipY: false };
    if (layout === 'half-brick') return { x: (x + (row ? 0.25 : 0)) % 1, y, flipX: false, flipY: false };
    if (layout === 'mirror') return { x, y, flipX: column === 1, flipY: row === 1 };
    return { x, y, flipX: false, flipY: false };
  });
}

const TILE_PX = 512;
function drawMotif(ctx: CanvasRenderingContext2D, motif: Motif, size: number, color: string) {
  ctx.fillStyle = color; ctx.strokeStyle = color;
  const r = size / 2;
  switch (motif) {
    case 'dots': ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2); ctx.fill(); break;
    case 'floral':
      for (let i = 0; i < 5; i++) { ctx.beginPath(); const a = i * Math.PI * 2 / 5; ctx.ellipse(Math.cos(a) * r * 0.22, Math.sin(a) * r * 0.22, r * 0.2, r * 0.12, a, 0, Math.PI * 2); ctx.fill(); }
      ctx.beginPath(); ctx.arc(0, 0, r * 0.1, 0, Math.PI * 2); ctx.globalAlpha = 0.6; ctx.fill(); ctx.globalAlpha = 1; break;
    case 'triangles': ctx.beginPath(); ctx.moveTo(0, -r * 0.4); ctx.lineTo(r * 0.38, r * 0.3); ctx.lineTo(-r * 0.38, r * 0.3); ctx.closePath(); ctx.fill(); break;
    case 'waves': ctx.lineWidth = r * 0.12; ctx.beginPath(); for (let i = 0; i <= 20; i++) { const x = -r + i / 20 * 2 * r, y = Math.sin(i / 20 * Math.PI * 2) * r * 0.18; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke(); break;
    default: break;
  }
}

/** The fabric width/height (cm) one tile covers: the print repeat, or about 6 cm of the fabric structure. */
export function tileSizeCm(style: PartStyle): number {
  const fabric = material(style.material);
  return style.print ? style.print.scaleCm : fabric.tileCm * Math.max(1, Math.round(6 / fabric.tileCm));
}

/** Paint one tile for a part's fabric, color and print. Returns the canvas and the fabric area it covers. */
export function paintTile(style: PartStyle, canvas: HTMLCanvasElement = document.createElement('canvas'), motifs: readonly UploadedMotif[] = []): { canvas: HTMLCanvasElement; tileCm: number; complete: boolean } {
  const fabric = material(style.material), print: Print | null = style.print;
  const tileCm = tileSizeCm(style);
  canvas.width = canvas.height = TILE_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = style.color; ctx.fillRect(0, 0, TILE_PX, TILE_PX);
  // Print first (dyed into the fabric), then the knit/weave structure over both.
  let complete = true;
  if (print?.motif.startsWith('upload:')) {
    const motif = motifs.find(m => `upload:${m.id}` === print.motif), image = motif ? motifImage(motif.dataUrl) : null;
    complete = !!image;
    if (image && motif) {
      // Each of the four cells holds the motif, fitted to 85% of the cell and keeping its proportions.
      const fit = (TILE_PX / 2) * 0.85 / Math.max(motif.width, motif.height), w = motif.width * fit, h = motif.height * fit;
      for (const place of motifPlacements(print.layout)) for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
        ctx.save(); ctx.translate((place.x + dx) * TILE_PX, (place.y + dy) * TILE_PX); ctx.scale(place.flipX ? -1 : 1, place.flipY ? -1 : 1);
        ctx.drawImage(image, -w / 2, -h / 2, w, h); ctx.restore();
      }
    }
  } else if (print) {
    if (print.motif === 'stripe') { ctx.fillStyle = print.color; ctx.fillRect(0, 0, TILE_PX, TILE_PX * 0.4); }
    else if (print.motif === 'gingham') {
      ctx.fillStyle = print.color; ctx.globalAlpha = 0.55; ctx.fillRect(0, 0, TILE_PX / 2, TILE_PX); ctx.fillRect(0, 0, TILE_PX, TILE_PX / 2);
      ctx.globalAlpha = 0.45; ctx.fillRect(0, 0, TILE_PX / 2, TILE_PX / 2); ctx.globalAlpha = 1;
    } else {
      for (const place of motifPlacements(print.layout)) for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
        ctx.save(); ctx.translate((place.x + dx) * TILE_PX, (place.y + dy) * TILE_PX); ctx.scale(place.flipX ? -1 : 1, place.flipY ? -1 : 1);
        drawMotif(ctx, print.motif as Motif, TILE_PX / 2, print.color); ctx.restore();
      }
    }
  }
  const unit = TILE_PX * fabric.tileCm / tileCm, shade = (alpha: number) => `rgba(0,0,0,${alpha})`, light = (alpha: number) => `rgba(255,255,255,${alpha})`;
  let seed = 9;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let y = 0; y < TILE_PX; y += unit / 4) for (let x = 0; x < TILE_PX; x += unit / 4) {
    switch (fabric.texture) {
      case 'jersey': ctx.fillStyle = (Math.floor(x / (unit / 4)) % 2) ? shade(0.06) : light(0.05); ctx.fillRect(x, y, unit / 8, unit / 4); break;
      case 'rib': ctx.fillStyle = (Math.floor(x / (unit / 4)) % 2) ? shade(0.14) : light(0.06); ctx.fillRect(x, y, unit / 4, unit / 4); break;
      case 'pique': if ((Math.floor(x / (unit / 4)) + Math.floor(y / (unit / 4))) % 2 === 0) { ctx.fillStyle = shade(0.1); ctx.beginPath(); ctx.arc(x + unit / 8, y + unit / 8, unit / 12, 0, Math.PI * 2); ctx.fill(); } break;
      case 'twill': ctx.fillStyle = (Math.floor((x + y) / (unit / 4)) % 4 === 0) ? light(0.18) : shade(0.04); ctx.fillRect(x, y, unit / 4, unit / 4); break;
      case 'terry': ctx.fillStyle = random() > 0.5 ? shade(0.07) : light(0.05); ctx.fillRect(x, y, unit / 4, unit / 4); break;
      case 'linen': case 'canvas': ctx.fillStyle = (Math.floor(x / (unit / 4)) + Math.floor(y / (unit / 4))) % 2 ? shade(0.05 + random() * 0.05) : light(0.04); ctx.fillRect(x, y, unit / 4, unit / 4); break;
      case 'slub': if (random() > 0.985) { ctx.fillStyle = light(0.12); ctx.fillRect(x, y, unit * (0.6 + random()), unit / 8); } else if ((Math.floor(x / (unit / 4))) % 2) { ctx.fillStyle = shade(0.04); ctx.fillRect(x, y, unit / 8, unit / 4); } break;
    }
  }
  return { canvas, tileCm, complete };
}
