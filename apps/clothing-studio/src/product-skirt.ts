import { patternGeometry, validateConstruction, type SkirtDraft } from './construction.ts';
import type { Product, PatternPiece, PartMesh } from './product.ts';

/**
 * Panel measurements; an optional folded band rises above the waist seam. No closure is modelled. `waist` is the
 * finished waist. With `gather`, the panels' waist edge is cut that many times longer and gathered into it. With
 * `pleats`, the panels are cut wider by the pleats' underlays, which are folded under and pressed.
 */
export interface SkirtMeasures { waist: number; hem: number; slant: number; waistbandHeight?: number; gather?: number; pleats?: Pleats }
/**
 * Pressed pleats all round the skirt: `count` knife pleats all folded the same way, or `count` box pleats (each box a
 * pair of knife pleats folded away from each other). Each fold is `depth` cm deep at the waist and, as the skirt flares,
 * deeper in proportion toward the hem.
 */
export interface Pleats { style: PleatStyle; count: number; depth: number }
export const PLEAT_STYLES = ['knife', 'box'] as const;
export type PleatStyle = typeof PLEAT_STYLES[number];
export const PLEAT_COUNT: readonly [number, number] = [8, 40];
export const PLEAT_DEPTH: readonly [number, number] = [1, 6];
/** Gather ratios: the panels' waist edge over the finished waist. */
export const GATHER: readonly [number, number] = [1.1, 2];
/** A gathered waist edge must be this much shorter than the hem, so the panels still flare. */
const GATHER_FLARE_CM = 10;
const cm = (value: number) => Math.round(value * 10) / 10;
export function validateSkirtMeasures(value: unknown): SkirtMeasures {
  const has = (key: string) => !!value && typeof value === 'object' && Object.hasOwn(value, key);
  const band = has('waistbandHeight'), gathered = has('gather'), pleated = has('pleats');
  const keys = ['waist','hem','slant', ...(band ? ['waistbandHeight'] : []), ...(gathered ? ['gather'] : []), ...(pleated ? ['pleats'] : [])];
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value,key)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)!, 'value'))) throw new Error('Skirt measurements require waist, hem, slant and optionally waistband height, gathering or pleats.');
  const m = value as SkirtMeasures;
  const {waist,hem,slant}=validateConstruction({kind:'flared-skirt', waist:m.waist, hem:m.hem, slant:m.slant});
  if (band && (typeof m.waistbandHeight !== 'number' || !Number.isFinite(m.waistbandHeight) || m.waistbandHeight < 2 || m.waistbandHeight > 10)) throw new Error('Skirt waistband height must be from 2 to 10 cm, or 0 to remove it.');
  if (gathered) {
    if (typeof m.gather !== 'number' || !Number.isFinite(m.gather) || m.gather < GATHER[0] || m.gather > GATHER[1]) throw new Error(`Skirt gathering must be from ${GATHER[0]} to ${GATHER[1]} times the waist, or 1 for none.`);
    if (waist * m.gather > hem - GATHER_FLARE_CM) throw new Error(`A gathered waist edge (${Math.round(waist * m.gather * 10) / 10} cm) must be at least ${GATHER_FLARE_CM} cm shorter than the ${hem} cm hem. Widen the hem or gather less.`);
  }
  if (pleated && gathered) throw new Error('A skirt waist is either gathered or pleated, not both.');
  const pleats = pleated ? validatePleats(m.pleats, waist, hem, slant) : undefined;
  return {waist,hem,slant,...(band ? {waistbandHeight:m.waistbandHeight} : {}),...(gathered ? {gather:m.gather} : {}),...(pleats ? {pleats} : {})};
}
function validatePleats(value: unknown, waist: number, hem: number, slant: number): Pleats {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== 3
    || !['style', 'count', 'depth'].every(key => Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'))) throw new Error('Skirt pleats need a style, a count and a depth.');
  const p = value as Pleats;
  if (!PLEAT_STYLES.includes(p.style)) throw new Error('Choose knife or box pleats.');
  if (!Number.isInteger(p.count) || p.count < PLEAT_COUNT[0] || p.count > PLEAT_COUNT[1] || p.count % 2) throw new Error(`Choose an even number of pleats from ${PLEAT_COUNT[0]} to ${PLEAT_COUNT[1]}.`);
  if (typeof p.depth !== 'number' || !Number.isFinite(p.depth) || p.depth < PLEAT_DEPTH[0] || p.depth > PLEAT_DEPTH[1]) throw new Error(`Pleat depth must be from ${PLEAT_DEPTH[0]} to ${PLEAT_DEPTH[1]} cm.`);
  const apart = waist / p.count, deepest = pleatDepthLimit(p.style, p.count, waist);
  if (p.depth > deepest + 1e-9) throw new Error(`${p.count} ${p.style} pleats on a ${waist} cm waist are ${cm(apart)} cm apart, so each can fold at most ${cm(deepest)} cm deep. Use fewer or shallower pleats.`);
  if ((hem - waist) / (2 * slant) * (1 + intake(p, waist)) > Math.PI) throw new Error('With these pleats each panel would take more than a half circle of fabric. Use fewer or shallower pleats, or a narrower hem.');
  return { style: p.style, count: p.count, depth: p.depth };
}
/** The deepest pleat that fits: a knife pleat's underlay reaches the pleat before it; a box's two meet behind it. */
export function pleatDepthLimit(style: PleatStyle, count: number, waist: number): number { return waist / count / (style === 'box' ? 2 : 1); }
/** The pleats' underlays as a share of the visible skirt: each knife pleat folds two layers of its depth under, each box four. */
function intake(pleats: Pleats, waist: number): number { return (pleats.style === 'box' ? 4 : 2) * pleats.depth * pleats.count / waist; }
export function skirtPleats(product: Product): Pleats | undefined { return (product.measurements as SkirtMeasures).pleats; }
/** How much wider than the visible skirt the pleated panels are cut, as a share of it (0 without pleats). */
export function skirtIntake(product: Product): number { const pleats = skirtPleats(product); return pleats ? intake(pleats, skirtDraft(product).waist) : 0; }
/** How many times longer the panels' waist edge is than the finished waist (1 when not gathered). */
export function skirtGather(product: Product): number { return (product.measurements as SkirtMeasures).gather ?? 1; }
/** The panels as cut: a gathered skirt's waist edge is longer than its finished waist. */
export function skirtPanelDraft(product: Product): SkirtDraft {
  const draft = skirtDraft(product);
  return { ...draft, waist: Math.round(draft.waist * skirtGather(product) * 100) / 100 };
}
export function skirtDraft(product: Product): SkirtDraft {
  if(product.base !== 'skirt') throw new Error('Choose a flared skirt.');
  const {waist,hem,slant}=validateSkirtMeasures(product.measurements);
  return {kind:'flared-skirt',waist,hem,slant};
}
export function skirtBandHeight(product: Product): number { return (product.measurements as SkirtMeasures).waistbandHeight ?? 0; }
export function skirtHeight(product: Product): number { return patternGeometry(skirtPanelDraft(product)).height + skirtBandHeight(product); }

/** The flat panel as cut, an annular sector: pleats widen its angle by their underlays. */
export function skirtCutGeometry(product: Product): ReturnType<typeof patternGeometry> {
  const g = patternGeometry(skirtPanelDraft(product)), k = skirtIntake(product);
  if (!k) return g;
  const angle = g.angle * (1 + k), top = g.innerRadius * Math.cos(angle / 2);
  return { ...g, angle, top, width: 2 * g.outerRadius * Math.sin(angle / 2), length: g.outerRadius - top };
}

/**
 * Each pleat's fold line and the line it is folded over to (its placement line), as cut angles across the panel. A
 * knife pleat's visible width comes first, then its two underlay layers; a box starts and ends at the middle of the
 * inverted pleats between boxes, where the side seams fall too.
 */
export function pleatLines(product: Product): { fold: number; placement: number }[] {
  const pleats = skirtPleats(product);
  if (!pleats) return [];
  const n = pleats.count / 2, k = skirtIntake(product), cut = skirtCutGeometry(product).angle, visible = cut / (1 + k) / n;
  const lines: { fold: number; placement: number }[] = [];
  for (let j = 0; j < n; j++) {
    const start = -cut / 2 + j * (1 + k) * visible, end = start + (1 + k) * visible;
    if (pleats.style === 'knife') lines.push({ fold: start + visible, placement: end });
    else lines.push({ fold: start + k / 2 * visible, placement: start }, { fold: start + (k / 2 + 1) * visible, placement: end });
  }
  return lines;
}

/** Circular arcs sampled closely enough for the common polygon pattern/export pipeline. */
export function skirtPieces(product: Product): PatternPiece[] {
  const g=skirtCutGeometry(product),outline:{x:number;y:number}[]=[];
  const segments=96;
  for(const [radius,reverse] of [[g.innerRadius,false],[g.outerRadius,true]] as const){
    for(let i=0;i<=segments;i++){
      const t=(reverse?segments-i:i)/segments, a=-g.angle/2+g.angle*t;
      outline.push({x:g.width/2+radius*Math.sin(a),y:radius*Math.cos(a)-g.top});
    }
  }
  let area=0;
  for(let i=0;i<outline.length;i++){const a=outline[i],b=outline[(i+1)%outline.length];area+=a.x*b.y-b.x*a.y;}
  const radial = (a: number): [{ x: number; y: number }, { x: number; y: number }] => [g.innerRadius, g.outerRadius].map(r => ({ x: g.width / 2 + r * Math.sin(a), y: r * Math.cos(a) - g.top })) as [{ x: number; y: number }, { x: number; y: number }];
  const pleats = pleatLines(product).map(line => ({ fold: radial(line.fold), placement: radial(line.placement) }));
  const pieces: PatternPiece[] = (['front','back'] as const).map(part=>({part,outline:outline.map(p=>({...p})),width:g.width,height:g.length,areaCm2:Math.abs(area)/2,cutCount:1,...(pleats.length ? { pleats: pleats.map(line => ({ fold: [{ ...line.fold[0] }, { ...line.fold[1] }], placement: [{ ...line.placement[0] }, { ...line.placement[1] }] })) as PatternPiece['pleats'] } : {})}));
  const height=skirtBandHeight(product)*2, width=skirtDraft(product).waist;
  if(height) pieces.push({part:'waistband',outline:[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}],width,height,areaCm2:width*height,cutCount:1,foldLine:[{x:0,y:height/2},{x:width,y:height/2}]});
  return pieces;
}

/** Mesh grid per panel: 40 columns around, and rows about 1.5 times as long as a column is wide at the hem, so the
 * cloth simulation's triangles are not slivers. */
export function skirtGrid(product: Product): { columns: number; rows: number } {
  const d=skirtPanelDraft(product),columns=40;
  return {columns,rows:Math.max(12,Math.min(40,Math.round(d.slant/(d.hem/2/columns)/1.5)))};
}

/** 3D layers of pressed pleats are this far apart, cm; box pleats' folded edges that meet are kept this far apart. */
const PLEAT_GAP = 0.15, PLEAT_NUDGE = 0.15;
/** Pleated panels' visible columns are about this wide at the hem, cm. */
const PLEAT_COLUMN_CM = 2.5;
/**
 * A column line of a pleated panel. `flat` is where it is cut and `turn` where it lies round the skirt, both in
 * visible pleat widths from the panel's start; `level` is how many layers in from the outside it lies; `nudge` keeps
 * the folded edges of neighbouring boxes apart; a `crease` line is a pressed fold.
 */
interface PleatColumn { flat: number; turn: number; level: number; nudge: number; crease: boolean }
function pleatColumns(pleats: Pleats, k: number, hem: number): PleatColumn[] {
  const n = pleats.count / 2, columns: PleatColumn[] = [], pleatAtHem = hem / pleats.count;
  // The visible width, split at the underlays' far folds so those folds meet a column line at the waist seam.
  const face = (j: number, flat: number, stops: number[]) => {
    for (let s = 0; s + 1 < stops.length; s++) {
      const from = stops[s]!, to = stops[s + 1]!, count = Math.max(1, Math.round((to - from) * pleatAtHem / PLEAT_COLUMN_CM));
      if (to - from < 1e-9) continue;
      // The segment's first line is already listed (the pleat's start, or the end of the segment before).
      for (let c = 1; c < count; c++) { const t = from + (to - from) * c / count; columns.push({ flat: flat + t, turn: j + t, level: 0, nudge: 0, crease: false }); }
      if (s + 2 < stops.length) columns.push({ flat: flat + to, turn: j + to, level: 0, nudge: 0, crease: false });
    }
  };
  for (let j = 0; j < n; j++) {
    const at = j * (1 + k);
    if (pleats.style === 'knife') {
      // Visible width, the fold, the underlay going back under it, the second fold, the underlay coming forward again.
      columns.push({ flat: at, turn: j, level: 0.5, nudge: 0, crease: false });
      face(j, at, [0, 1 - k / 2, 1]);
      columns.push({ flat: at + 1, turn: j + 1, level: 0, nudge: 0, crease: true }, { flat: at + 1 + k / 2, turn: j + 1 - k / 2, level: 1.5, nudge: 0, crease: true });
    } else {
      // From the middle of the inverted pleat: the underlay under the box's left side, its folded edge, the box, its
      // right folded edge, and the underlay under its right side back to the next inverted pleat.
      columns.push({ flat: at, turn: j, level: 1, nudge: 0, crease: false }, { flat: at + k / 4, turn: j + k / 4, level: 1.5, nudge: 0, crease: true },
        { flat: at + k / 2, turn: j, level: 0, nudge: 1, crease: true });
      face(j, at + k / 2, [0, k / 4, 1 - k / 4, 1]);
      columns.push({ flat: at + k / 2 + 1, turn: j + 1, level: 0, nudge: -1, crease: true }, { flat: at + k / 2 + 1 + k / 4, turn: j + 1 - k / 4, level: 1.5, nudge: 0, crease: true });
    }
  }
  columns.push({ flat: n * (1 + k), turn: n, level: pleats.style === 'knife' ? 0.5 : 1, nudge: 0, crease: false });
  return columns;
}

/** A rigid open frustum; seams, slant and UVs follow the same two annular-sector panels. */
export function skirtMesh(product: Product): PartMesh[] {
  if (skirtPleats(product)) return pleatedMesh(product);
  // A gathered skirt is cut from the wider panels but starts on its finished waist: the waist row is held there and
  // the extra fabric falls into gathers as it drapes.
  const d=skirtPanelDraft(product),finished=skirtDraft(product).waist,g=patternGeometry(d),{columns,rows}=skirtGrid(product);
  const meshes: PartMesh[] = (['front','back'] as const).map((part,side)=>{
    const mesh:PartMesh={part,positions:[],uvs:[],indices:[]};
    for(let r=0;r<=rows;r++)for(let c=0;c<=columns;c++){
      const t=r/rows,u=c/columns,theta=-Math.PI/2+Math.PI*(u+side);
      const radius=(finished+(d.hem-finished)*t)/(2*Math.PI),flat=g.innerRadius+d.slant*t,angle=-g.angle/2+g.angle*u;
      mesh.positions.push(radius*Math.sin(theta),g.height*(1-t),radius*Math.cos(theta));
      mesh.uvs.push(g.width/2+flat*Math.sin(angle),flat*Math.cos(angle)-g.top);
      if(r<rows&&c<columns){const a=r*(columns+1)+c,b=a+1,e=a+columns+1,f=e+1;mesh.indices.push(a,e,b,b,e,f);}
    }
    return mesh;
  });
  const around = columns * 2;
  return [...meshes, ...skirtBand(product, g.height, Array.from({ length: around + 1 }, (_, c) => ({ theta: -Math.PI / 2 + 2 * Math.PI * c / around, share: c / around })))];
}

/**
 * Pressed pleats: each panel starts folded, its underlays a few millimetres inside the visible fabric, the pleats' folds
 * marked as creases the drape keeps. At the waist seam every layer is sewn into the seam (or the band).
 */
function pleatedMesh(product: Product): PartMesh[] {
  const d = skirtDraft(product), pleats = skirtPleats(product)!, k = skirtIntake(product), n = pleats.count / 2;
  const g = patternGeometry(d), cut = skirtCutGeometry(product), visible = cut.angle / (1 + k) / n, lines = pleatColumns(pleats, k, d.hem);
  const faceColumns = lines.filter(line => line.level === 0).length / n;
  const rows = Math.max(12, Math.min(40, Math.round(d.slant / (d.hem / pleats.count / faceColumns) / 1.5)));
  // A fold's vertices are listed twice, once for each side, so the 3D view shades each side on its own (the drape
  // sews the copies back into one particle).
  const copies = lines.map(line => (line.crease ? 2 : 1)), first = copies.map((_, c) => copies.slice(0, c).reduce((sum, n) => sum + n, 0));
  const width = copies.reduce((sum, n) => sum + n, 0), left = (c: number) => first[c]!, right = (c: number) => first[c]! + copies[c]! - 1;
  // Each underlay vertex lies under the visible line at the same place round the skirt.
  const over = lines.map(line => line.level > 0 ? lines.findIndex(other => other.level === 0 && Math.abs(other.turn - line.turn) < 1e-9) : -1);
  const angles: number[] = [];
  const meshes: PartMesh[] = (['front', 'back'] as const).map((part, side) => {
    const mesh: PartMesh = { part, positions: [], uvs: [], indices: [], creases: [], layers: [], inside: [] };
    for (let r = 0; r <= rows; r++) for (const [c, line] of lines.entries()) {
      const t = r / rows, radius = (d.waist + (d.hem - d.waist) * t) / (2 * Math.PI), inset = r ? line.level * PLEAT_GAP : 0;
      const theta = -Math.PI / 2 + Math.PI * (side + line.turn / n) + (r ? line.nudge * PLEAT_NUDGE / radius : 0);
      const flat = g.innerRadius + d.slant * t, angle = -cut.angle / 2 + line.flat * visible;
      for (let copy = 0; copy < copies[c]!; copy++) {
        mesh.positions.push((radius - inset) * Math.sin(theta), g.height * (1 - t), (radius - inset) * Math.cos(theta));
        mesh.uvs.push(cut.width / 2 + flat * Math.sin(angle), flat * Math.cos(angle) - cut.top);
        mesh.layers!.push(r ? line.level : 0);
      }
      if (!r) angles.push(theta);
      if (r < rows && c + 1 < lines.length) { const a = r * width + right(c), b = r * width + left(c + 1), e = a + width, f = b + width; mesh.indices.push(a, e, b, b, e, f); }
      if (r < rows && line.crease) mesh.creases!.push(r * width + left(c), (r + 1) * width + left(c));
      if (r && over[c]! >= 0) mesh.inside!.push(r * width + left(c), r * width + left(over[c]!));
    }
    return mesh;
  });
  // The band's lower edge has a point wherever the panels' waist has one, so every layer is sewn into it.
  const unique = [...angles].sort((a, b) => a - b).filter((angle, i, all) => !i || angle - all[i - 1]! > 1e-9);
  return [...meshes, ...skirtBand(product, g.height, unique.map(theta => ({ theta, share: (theta - unique[0]!) / (2 * Math.PI) })))];
}

/**
 * The folded band above the waist seam. Its points round the waist are the panels' waist points (`theta`), so every
 * seam vertex is sewn by buildCloth, at `share` of the way along the band.
 */
function skirtBand(product: Product, top: number, points: { theta: number; share: number }[]): PartMesh[] {
  const height=skirtBandHeight(product), finished=skirtDraft(product).waist;
  if(!height) return [];
  const band:PartMesh={part:'waistband',positions:[],uvs:[],indices:[]},around=points.length-1,up=Math.ceil(height/1.5),radius=finished/(2*Math.PI);
  // Only the outer face is simulated; the cutting strip folds back inside to make the facing.
  for(let r=0;r<=up;r++)for(let c=0;c<=around;c++){
    const {theta,share}=points[c]!;
    band.positions.push(radius*Math.sin(theta),top+height*r/up,radius*Math.cos(theta));
    band.uvs.push(finished*share,height*(1-r/up));
    if(r<up&&c<around){const a=r*(around+1)+c,b=a+1,e=a+around+1,f=e+1;band.indices.push(a,b,e,b,f,e);}
  }
  return [band];
}
