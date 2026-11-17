/**
 * Body measurements estimated from photo outlines (person masks): a front photo, standing straight with the arms held
 * a little away from the body and the feet slightly apart, and optionally a side photo, with the person's height for
 * scale. Each level is found as a share of the height, measured up from the floor, then read across the outline:
 * widths from the front, depths from the side. Girths are linear in those widths and depths, fitted to tape
 * measurements (see FIT). Everything here is plain arithmetic on the masks; the masks themselves come from a pose model
 * elsewhere.
 */

/** A person mask: one byte per pixel, row by row, non-zero where the person is. */
export interface Mask { width: number; height: number; data: Uint8Array }

/** A horizontal line across the outline, in mask pixels, for showing where something was measured. */
export interface MaskLine { y: number; x0: number; x1: number }

/**
 * Where the levels are searched, as shares of the height up from the floor, and how outline widths and depths (cm)
 * become girths. The girths are least-squares fits to the tape measurements of people in the BodyM training set
 * (Amazon, CC BY-NC 4.0; the first photo pair of each of 400 people, 280 of whose outlines could be read), whose
 * front and side outlines were taken in this pose; `scripts/evaluate-body-photos.ts` refits and scores them.
 * `side`: girth = a·width + b·depth + c; `front` (no side photo): girth = a·width + c; `depth`: the median
 * depth-to-width ratio, for a chest depth without a side photo.
 */
export const FIT = {
  chest: [0.69, 0.76], underArms: [0.6, 0.76], waist: [0.57, 0.67], hip: [0.44, 0.55],
  girth: {
    chest: { side: [1.42, 1.73, 10.569], front: [2.876, 9.186], depth: 0.814 },
    waist: { side: [2.022, 1.217, 3.596], front: [3.305, -4.648], depth: 0.812 },
    hip: { side: [2.138, 0.812, 3.637], front: [2.763, 0.336], depth: 0.652 },
  },
  /** Upper-arm girth over the circle through the arm's outline width (median ratio). */
  armGirth: 1.06,
} as const;

/** The mask's largest 4-connected region, so specks and other people do not count. */
export function largestRegion(mask: Mask): Mask {
  const { width, height, data } = mask, label = new Int32Array(width * height), stack: number[] = [];
  let best = 0, bestSize = 0, next = 0;
  for (let start = 0; start < data.length; start++) {
    if (!data[start] || label[start]) continue;
    const id = ++next;
    let size = 0;
    label[start] = id; stack.push(start);
    while (stack.length) {
      const at = stack.pop()!, x = at % width;
      size++;
      for (const near of [x > 0 ? at - 1 : -1, x < width - 1 ? at + 1 : -1, at - width, at + width]) {
        if (near >= 0 && near < data.length && data[near] && !label[near]) { label[near] = id; stack.push(near); }
      }
    }
    if (size > bestSize) { best = id; bestSize = size; }
  }
  const kept = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) kept[i] = label[i] === best && best ? 1 : 0;
  return { width, height, data: kept };
}

/** The runs of person pixels along row y, as [start, end] inclusive. */
export function runs(mask: Mask, y: number): [number, number][] {
  const out: [number, number][] = [], row = y * mask.width;
  let start = -1;
  for (let x = 0; x <= mask.width; x++) {
    const on = x < mask.width && mask.data[row + x] !== 0;
    if (on && start < 0) start = x;
    else if (!on && start >= 0) { out.push([start, x - 1]); start = -1; }
  }
  return out;
}

interface Frame { mask: Mask; top: number; bottom: number; centre: number; pixelsPerCm: number }

/** The outline's top and bottom rows, its centre line and its scale, given the person's height. */
function frame(source: Mask, heightCm: number): Frame {
  const mask = largestRegion(source);
  let top = -1, bottom = -1;
  for (let y = 0; y < mask.height; y++) if (runs(mask, y).length) { if (top < 0) top = y; bottom = y; }
  if (top < 0) throw new Error('No person was found in the photo.');
  const tall = bottom - top + 1;
  if (top === 0 || bottom === mask.height - 1) throw new Error('The whole body, head to feet, must be in the photo.');
  if (tall < 200) throw new Error('The person is too small in the photo: stand closer, with the whole body still in it.');
  // The centre line: the median of person pixels across the torso, where the arms balance each other.
  const xs: number[] = [];
  for (let y = Math.round(top + tall * 0.3); y <= top + tall * 0.55; y += 2) for (const [a, b] of runs(mask, y)) for (let x = a; x <= b; x += 2) xs.push(x);
  xs.sort((p, q) => p - q);
  return { mask, top, bottom, centre: xs[xs.length >> 1]!, pixelsPerCm: tall / heightCm };
}

/** The row at this share of the height up from the floor. */
const rowAt = (f: Frame, share: number) => Math.round(f.bottom - share * (f.bottom - f.top + 1));
/** The share of the height up from the floor of this row. */
const shareAt = (f: Frame, y: number) => (f.bottom - y) / (f.bottom - f.top + 1);

/** The run through the centre line at row y, or null where the centre is not the person (between the legs). */
function through(f: Frame, y: number): { run: [number, number]; count: number } | null {
  const row = runs(f.mask, y), run = row.find(([a, b]) => a <= f.centre && f.centre <= b);
  return run ? { run, count: row.length } : null;
}

export interface FrontMeasure {
  pixelsPerCm: number;
  /** Shares of the height up from the floor where each was found. */
  levels: { chest: number; waist: number; hip: number };
  /** Outline widths, cm. */
  widths: { chest: number; waist: number; hip: number; arm: number | null };
  lines: Record<'chest' | 'waist' | 'hip', MaskLine>;
}

/**
 * The front outline: the hip is its widest row in its band, the waist its narrowest; a row counts for the body only
 * where the arms are clear of it (the row has at least three runs: arm, body, arm).
 */
export function measureFront(mask: Mask, heightCm: number): FrontMeasure {
  const f = frame(mask, heightCm);
  // A band is read only where most of it is clear of the arms: a few clear rows at its edge would give the wrong level.
  const band = (range: readonly [number, number], pick: 'max' | 'min') => {
    let best: { y: number; run: [number, number] } | null = null, rows = 0, clear = 0;
    for (let y = rowAt(f, range[1]); y <= rowAt(f, range[0]); y++) {
      const at = through(f, y);
      if (at) rows++;
      if (!at || at.count < 3) continue;
      clear++;
      const width = at.run[1] - at.run[0] + 1;
      if (!best || (pick === 'max' ? width > best.run[1] - best.run[0] + 1 : width < best.run[1] - best.run[0] + 1)) best = { y, run: at.run };
    }
    return clear * 2 >= rows ? best : null;
  };
  // In this pose the upper arms usually touch the chest, so its width is read at the highest row under the arms where
  // they are clear of the body (the ribcage below the bust); the bust's forward depth comes from the side.
  let chest: { y: number; run: [number, number] } | null = null;
  for (let y = rowAt(f, FIT.underArms[1]); y <= rowAt(f, FIT.underArms[0]) && !chest; y++) {
    const at = through(f, y);
    if (at && at.count >= 3) chest = { y, run: at.run };
  }
  const waist = band(FIT.waist, 'min'), hip = band(FIT.hip, 'max');
  if (!chest || !waist || !hip) throw new Error('Hold your arms a little away from your sides (angled down, not raised), so the outline shows the body between them.');
  // The upper arm: the run beside the body at the chest, its width taken across the arm's slope (from its centre a
  // little lower down).
  let arm: number | null = null;
  const armWidths: number[] = [];
  const lower = rowAt(f, FIT.chest[0] - 0.04);
  for (const side of [-1, 1]) {
    const pick = (y: number) => {
      const row = runs(f.mask, y), body = row.findIndex(([a, b]) => a <= f.centre && f.centre <= b);
      return body < 0 ? null : row[body + side] ?? null;
    };
    const upper = pick(chest.y), below = pick(lower);
    if (!upper || !below) continue;
    const slope = ((below[0] + below[1]) / 2 - (upper[0] + upper[1]) / 2) / (lower - chest.y);
    armWidths.push((upper[1] - upper[0] + 1) / Math.sqrt(1 + slope * slope));
  }
  if (armWidths.length) arm = armWidths.reduce((sum, w) => sum + w, 0) / armWidths.length / f.pixelsPerCm;
  const line = (at: { y: number; run: [number, number] }): MaskLine => ({ y: at.y, x0: at.run[0], x1: at.run[1] });
  const cm = (at: { run: [number, number] }) => (at.run[1] - at.run[0] + 1) / f.pixelsPerCm;
  return {
    pixelsPerCm: f.pixelsPerCm,
    levels: { chest: shareAt(f, chest.y), waist: shareAt(f, waist.y), hip: shareAt(f, hip.y) },
    widths: { chest: cm(chest), waist: cm(waist), hip: cm(hip), arm },
    lines: { chest: line(chest), waist: line(waist), hip: line(hip) },
  };
}

export interface SideMeasure { pixelsPerCm: number; depths: { chest: number; waist: number; hip: number }; lines: Record<'chest' | 'waist' | 'hip', MaskLine> }

/** The side outline's depth (front to back, cm) at the front's levels: its widest row within about a centimetre of each. */
export function measureSide(mask: Mask, heightCm: number, levels: FrontMeasure['levels']): SideMeasure {
  const f = frame(mask, heightCm), reach = Math.max(1, Math.round(f.pixelsPerCm * 1.2));
  const depth = (share: number) => {
    let best: [number, number] | null = null, at = rowAt(f, share);
    for (let y = rowAt(f, share) - reach; y <= rowAt(f, share) + reach; y++) {
      const hit = through(f, y);
      if (hit && (!best || hit.run[1] - hit.run[0] > best[1] - best[0])) { best = hit.run; at = y; }
    }
    if (!best) throw new Error('The side photo must show the body in profile, from head to feet.');
    return { cm: (best[1] - best[0] + 1) / f.pixelsPerCm, line: { y: at, x0: best[0], x1: best[1] } };
  };
  // The bust: the deepest row in the chest band (the front's row may be under it).
  let chest = depth(FIT.chest[0]);
  for (let share = FIT.chest[0]; share <= FIT.chest[1]; share += 0.005) { const at = depth(share); if (at.cm > chest.cm) chest = at; }
  const waist = depth(levels.waist), hip = depth(levels.hip);
  return { pixelsPerCm: f.pixelsPerCm, depths: { chest: chest.cm, waist: waist.cm, hip: hip.cm }, lines: { chest: chest.line, waist: waist.line, hip: hip.line } };
}

export interface BodyEstimate {
  chest: number; waist: number; hip: number;
  /** Front-to-back depth of the chest, cm: measured from a side photo, else assumed. */
  chestDepth: number;
  /** Waist to hip, measured down the body, cm. */
  hipDepth: number;
  upperArmGirth: number | null;
  /** How each value was found, for showing beside it. */
  basis: Record<'chest' | 'waist' | 'hip' | 'chestDepth' | 'hipDepth' | 'upperArmGirth', string>;
}

const round = (value: number) => Math.round(value * 2) / 2;

/** Girths and depths from a front outline and, when there is one, a side outline. */
export function estimateBody(front: FrontMeasure, side: SideMeasure | null, heightCm: number): BodyEstimate {
  const depth = (level: 'chest' | 'waist' | 'hip') => side ? side.depths[level] : front.widths[level] * FIT.girth[level].depth;
  const girth = (level: 'chest' | 'waist' | 'hip') => {
    const fit = FIT.girth[level], width = front.widths[level];
    return round(side ? fit.side[0] * width + fit.side[1] * side.depths[level] + fit.side[2] : fit.front[0] * width + fit.front[1]);
  };
  const from = side ? 'front width and side depth' : 'front width alone (no side photo)';
  const share = (value: number) => `${Math.round(value * 100)}% of the height`;
  return {
    chest: girth('chest'), waist: girth('waist'), hip: girth('hip'),
    chestDepth: round(depth('chest')),
    hipDepth: round((front.levels.waist - front.levels.hip) * heightCm),
    upperArmGirth: front.widths.arm === null ? null : round(Math.PI * front.widths.arm * FIT.armGirth),
    basis: {
      chest: `Widest at ${share(front.levels.chest)}, from the ${from}`,
      waist: `Narrowest at ${share(front.levels.waist)}, from the ${from}`,
      hip: `Widest at ${share(front.levels.hip)}, from the ${from}`,
      chestDepth: side ? 'Measured on the side photo at the chest' : 'Assumed: a typical share of the chest width',
      hipDepth: 'From the waist down to the widest part of the hips, on the front photo',
      upperArmGirth: front.widths.arm === null ? 'Not found: the arms must be clear of the body' : 'A circle across the upper arm\'s width on the front photo',
    },
  };
}
