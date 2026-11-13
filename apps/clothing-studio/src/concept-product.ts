import { validateProject, type Project } from './model.ts';
import { GARMENT_WIDTH } from './graphics.ts';
import { LIMITS, RIB_PARTS, panelSize, template, validateProduct, type Artwork, type Product } from './product.ts';

/** The body rectangle in the concept's 400 × 440 drawing coordinates (shoulder to hem). */
export function conceptBodyBox(project: Project) {
  const { bodyWidth, bodyLength } = validateProject(project).garment;
  return { left: GARMENT_WIDTH / 2 - bodyWidth / 2, top: 64, width: bodyWidth, height: bodyLength + 16 };
}

/** A reviewable starting point, not a measurement recovered from a photo or freehand contour. */
export function conceptTee(value: Project, chest: number, artwork: Artwork | null = null): { product: Product; summary: string } {
  const project = validateProject(value), garment = project.garment;
  if (!Number.isFinite(chest) || chest < LIMITS.chest[0] || chest > LIMITS.chest[1]) throw new Error('Choose a product chest measurement from 80 to 150 cm.');
  const product = template('blank'), scale = panelSize({ chest, length: 72, sleeve: 21 }).width / garment.bodyWidth;
  const notes: string[] = [];
  const dimension = (name: string, raw: number, range: readonly [number, number]) => {
    const rounded = Math.round(raw * 10) / 10, bounded = Math.min(range[1], Math.max(range[0], rounded));
    if (rounded !== bounded) notes.push(`${name} limited to ${bounded} cm; concept proportions would give ${rounded} cm.`);
    return bounded;
  };
  const length = dimension('Body length', (garment.bodyLength + 16) * scale, LIMITS.length);
  const sleeve = dimension('Sleeve length', Math.hypot(garment.sleeveLength, 38) * scale, LIMITS.sleeve);
  product.name = project.title.trim() === 'Untitled concept' ? 'Concept tee' : project.title.trim();
  product.measurements = { chest, length, sleeve }; product.neckline = garment.neckline === 'v' ? 'v' : 'crew';
  for (const [id, part] of Object.entries(product.parts)) {
    part.color = garment.color;
    part.print = garment.pattern === 'stripe' && !RIB_PARTS.has(id as keyof Product['parts'])
      ? { motif: 'stripe', color: garment.patternColor, scaleCm: Math.max(2, Math.min(40, Math.round(16 * scale * 10) / 10)), layout: 'grid', direction: 'horizontal' } : null;
  }
  if (garment.pattern === 'stripe') notes.push('Soft stripes become an editable horizontal stripe print; the drawing’s angled texture is approximate.');
  if (garment.pattern === 'weave') notes.push('Crosshatch stays in the source sketch; no fabric construction is inferred from that illustration.');
  product.artwork = artwork ? [structuredClone(artwork)] : [];
  return { product: validateProduct(product), summary: `Chest ${chest} cm · body length ${length} cm · sleeves ${sleeve} cm · ${product.neckline === 'v' ? 'V-neck' : 'round neck'}. Cotton jersey body and rib neckband are starting fabrics. ${notes.join(' ')}`.trim() };
}
