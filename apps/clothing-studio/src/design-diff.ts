import { grainAngleOf } from './grain.ts';
// What a saved copy of a design changes from the current one, in plain words, for comparing versions.
import { colourDifference } from './photo-colours.ts';
import { NAMED_COLOURS } from './style-prompt.ts';
import { FIT_NAMES, PART_IDS, garmentName, material, optionsOf, partName, printName, type FitKey, type PartStyle, type Product } from './product.ts';
import type { Project } from './model.ts';
import type { ProfileBody } from './top-body-profiles.ts';

/** The everyday name nearest a colour ("navy", "sage green"). */
export function colourWord(hex: string): string {
  let best = '', distance = Infinity;
  for (const [name, value] of Object.entries(NAMED_COLOURS)) {
    const d = colourDifference(hex.toLowerCase(), value);
    if (d < distance) { best = name; distance = d; }
  }
  return best;
}

const MEASURE_NAMES: Record<string, string> = { chest: 'Chest', length: 'Body length', sleeve: 'Sleeve length', waist: 'Waist', hip: 'Hip', rise: 'Rise',
  inseam: 'Inseam', legOpening: 'Leg opening', cuffHeight: 'Ankle cuff height', waistbandHeight: 'Waistband height', hem: 'Hem', slant: 'Side slant', gather: 'Gathering', sleeveGather: 'Sleeve cap gathering', bustDart: 'Bust dart intake', waistDart: 'Waist dart intake' };
const MODULE_NAMES: Record<string, string> = { chestPocket: 'Chest pocket', zip: 'Front zip', zipOpen: 'Worn open', collar: 'Collar', buttons: 'Button front', waistSeam: 'Waist seam', yoke: 'Back yoke', cuffs: 'Shirt cuffs', coat: 'Coat', lapels: 'Lapels', peakLapels: 'Peak lapels', lining: 'Lining', backPockets: 'Back pockets', frontPockets: 'Front pockets', fly: 'Fly front', beltLoops: 'Belt loops' };
const style = (product: Product, part: PartStyle) => `${material(part.material).name}, ${colourWord(part.color)}${part.print ? `, ${printName(part.print, product).toLowerCase()}` : ''}${grainAngleOf(part) ? `, grain ${grainAngleOf(part)}°` : ''}`;
const sameStyle = (one: PartStyle, two: PartStyle) => one.material === two.material && one.color.toLowerCase() === two.color.toLowerCase()
  && JSON.stringify(one.print) === JSON.stringify(two.print) && grainAngleOf(one) === grainAngleOf(two);

// The same supported garment settings are compared for the edited product and each worn copy.
function productDifferences(then: Product | undefined, now: Product | undefined, includeName = true): string[] {
  const lines: string[] = [];
  if (!then || !now) {
    if (!!then !== !!now) lines.push(then ? 'Garment: a product design → none' : 'Garment: none → a product design');
    return lines;
  }
  if (includeName && garmentName(then) !== garmentName(now)) lines.push(`Garment: ${garmentName(then)} → ${garmentName(now)}`);
  const measures = { ...then.measurements, ...now.measurements } as Record<string, unknown>;
  for (const key of Object.keys(measures)) {
    const a = (then.measurements as unknown as Record<string, unknown>)[key], b = (now.measurements as unknown as Record<string, unknown>)[key];
    // Gathering is a ratio of the cut edge to the seam it is gathered into, not a length.
    if (a !== b && (typeof a === 'number' || typeof b === 'number')) lines.push(`${MEASURE_NAMES[key] ?? key}: ${a ?? 'none'} → ${b ?? 'none'}${key === 'gather' || key === 'sleeveGather' ? ' times' : ' cm'}`);
  }
  if (then.neckline !== now.neckline) lines.push(`Neckline: ${then.neckline === 'v' ? 'V-neck' : 'crew'} → ${now.neckline === 'v' ? 'V-neck' : 'crew'}`);
  const [oldOptions, newOptions] = [optionsOf(then), optionsOf(now)] as unknown as Record<string, unknown>[];
  if (oldOptions!.hem !== newOptions!.hem) lines.push(`Hem: ${oldOptions!.hem} → ${newOptions!.hem}`);
  for (const [key, label] of Object.entries(MODULE_NAMES)) {
    if (!!oldOptions![key] !== !!newOptions![key]) lines.push(`${label}: ${oldOptions![key] ? 'on' : 'off'} → ${newOptions![key] ? 'on' : 'off'}`);
  }
  for (const key of Object.keys(FIT_NAMES) as FitKey[]) {
    const a = then.fit?.[key], b = now.fit?.[key];
    if (a !== b) lines.push(`${FIT_NAMES[key]}: ${a ?? 'automatic'} → ${b ?? 'automatic'}${typeof (a ?? b) === 'number' ? ' cm' : ''}`);
  }
  for (const part of PART_IDS) {
    const a = then.parts[part] as PartStyle | undefined, b = now.parts[part] as PartStyle | undefined;
    if (!a && !b) continue;
    const label = partName(b ? now : then, part);
    if (!a || !b) lines.push(`${label}: ${a ? 'removed' : `added (${style(now, b!)})`}`);
    else if (!sameStyle(a, b)) lines.push(`${label}: ${style(then, a)} → ${style(now, b)}`);
  }
  if (then.artwork.length !== now.artwork.length || then.artwork.some((art, i) => art.name !== now.artwork[i]?.name || art.dataUrl !== now.artwork[i]?.dataUrl)) {
    lines.push(`Artwork: ${then.artwork.map(art => art.name || 'untitled').join(', ') || 'none'} → ${now.artwork.map(art => art.name || 'untitled').join(', ') || 'none'}`);
  }
  if ((then.colorways?.length ?? 0) !== (now.colorways?.length ?? 0)) lines.push(`Colorways: ${then.colorways?.length ?? 0} → ${now.colorways?.length ?? 0}`);
  return lines;
}

const BODY_NAMES: Record<keyof ProfileBody, string> = {
  chest: 'chest girth', waist: 'waist girth', hip: 'hip girth', chestDepth: 'chest depth', height: 'height', hipDepth: 'waist to hip',
  upperArmGirth: 'upper-arm girth', neckGirth: 'neck girth', underbust: 'underbust girth', torsoLength: 'shoulder to waist', shoulderWidth: 'shoulder width',
};
const bodyValue = (value: number | null | undefined) => value == null ? 'automatic' : `${value} cm`;

/** Differences in the compared garment and shared-body settings, from saved to current. */
export function designDifferences(saved: Project, current: Project): string[] {
  const lines: string[] = [];
  if (saved.title !== current.title) lines.push(`Name: “${saved.title}” → “${current.title}”`);
  for (const key of Object.keys(BODY_NAMES) as (keyof ProfileBody)[]) {
    const a = saved.topBody?.[key] ?? null, b = current.topBody?.[key] ?? null;
    if (a !== b) lines.push(`Body ${BODY_NAMES[key]}: ${bodyValue(a)} → ${bodyValue(b)}`);
  }
  lines.push(...productDifferences(saved.product, current.product));
  for (const [key, label] of [['wornWith', 'Worn with'], ['wornAlso', 'And with']] as const) {
    const a = saved[key], b = current[key];
    if ((a ? garmentName(a) : null) !== (b ? garmentName(b) : null)) lines.push(`${label}: ${a ? garmentName(a) : 'nothing'} → ${b ? garmentName(b) : 'nothing'}`);
    if (a && b && a.base === b.base) lines.push(...productDifferences(a,b,false).map(line => `${label} · ${line}`));
  }
  if (!!saved.tucked !== !!current.tucked) lines.push(`Tucked in: ${saved.tucked ? 'yes' : 'no'} → ${current.tucked ? 'yes' : 'no'}`);
  return lines;
}

/** The next automatic version name for a design: “Oxford shirt · v3” after v1 and v2 are saved. */
export function nextVersionName(base: string, saved: readonly string[]): string {
  const stem = base.trim().slice(0, 70) || 'Design', pattern = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · v(\\d+)$`, 'i');
  const highest = Math.max(0, ...saved.map(name => Number(pattern.exec(name)?.[1] ?? 0)));
  return `${stem} · v${highest + 1}`;
}
