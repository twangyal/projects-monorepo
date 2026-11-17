// A drawn person outline for testing the body-from-photos estimates: known widths (front) or depths (side) at each
// share of the height, standing in the photo pose (arms angled down, clear of the body; feet apart).
export interface Figure { width: number; height: number; data: Uint8Array }

/** Widths (front) or depths (side), cm, at shares of the height up from the floor; linear between the points. */
export const FRONT = { chest: 32, waist: 27, hip: 35, arm: 9 };
export const SIDE = { chest: 22, waist: 19, hip: 23 };
// The shoulders reach out to the arms (32 cm chest + 3 cm gaps + 9 cm arms), joining them to the body.
const frontProfile: [number, number][] = [[0.47, 34], [0.5, 35], [0.62, 27], [0.68, 32], [0.78, 32], [0.785, 56], [0.84, 56], [0.845, 11], [0.87, 11], [0.875, 15], [1, 15]];
const sideProfile: [number, number][] = [[0, 14], [0.47, 14], [0.48, 22], [0.5, 23], [0.62, 19], [0.72, 22], [0.78, 21], [0.84, 21], [0.845, 11], [0.87, 11], [0.875, 20], [1, 20]];
const at = (profile: [number, number][], share: number) => {
  for (let i = 1; i < profile.length; i++) {
    const [f0, w0] = profile[i - 1]!, [f1, w1] = profile[i]!;
    if (share <= f1) return w0 + (w1 - w0) * (share - f0) / (f1 - f0 || 1);
  }
  return profile.at(-1)![1];
};

/**
 * A `width`×`height` mask of a person `heightCm` tall standing in the middle, `margin` px from the top and bottom.
 * `armsTouching` draws the arms against the body (a refused pose).
 */
export function figure(view: 'front' | 'side', options: { width?: number; height?: number; margin?: number; heightCm?: number; armsTouching?: boolean } = {}): Figure {
  const width = options.width ?? 300, height = options.height ?? 500, margin = options.margin ?? 25, heightCm = options.heightCm ?? 180;
  const data = new Uint8Array(width * height), top = margin, bottom = height - margin - 1, tall = bottom - top + 1, scale = tall / heightCm, centre = width / 2;
  const fill = (y: number, from: number, to: number) => { for (let x = Math.max(0, Math.round(from)); x <= Math.min(width - 1, Math.round(to)); x++) data[y * width + x] = 1; };
  for (let y = top; y <= bottom; y++) {
    const share = (bottom - y) / tall;
    if (view === 'side') { const half = at(sideProfile, share) * scale / 2; fill(y, centre - half, centre + half - 1); continue; }
    if (share < 0.47) {
      // Two legs, 15 cm each, 4 cm apart.
      fill(y, centre - 19 * scale / 2, centre - 2 * scale - 1); fill(y, centre + 2 * scale, centre + 19 * scale / 2 - 1);
      continue;
    }
    const half = at(frontProfile, share) * scale / 2;
    fill(y, centre - half, centre + half - 1);
    if (share >= 0.45 && share < 0.785) {
      // Arms: 9 cm wide, 3 cm clear of the chest (or against the body), from the shoulders down past the hips.
      const gap = options.armsTouching ? 0 : 3 * scale, inner = (options.armsTouching ? Math.max(half, FRONT.chest * scale / 2) : FRONT.chest * scale / 2) + gap;
      fill(y, centre - inner - FRONT.arm * scale, centre - inner - 1); fill(y, centre + inner, centre + inner + FRONT.arm * scale - 1);
    }
  }
  return { width, height, data };
}

/** The mask as row runs [y, start, end], compact enough to hand to a page. */
export function runsOf(mask: Figure): number[] {
  const out: number[] = [];
  for (let y = 0; y < mask.height; y++) {
    let start = -1;
    for (let x = 0; x <= mask.width; x++) {
      const on = x < mask.width && mask.data[y * mask.width + x] === 1;
      if (on && start < 0) start = x; else if (!on && start >= 0) { out.push(y, start, x - 1); start = -1; }
    }
  }
  return out;
}
