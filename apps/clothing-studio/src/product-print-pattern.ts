import { garmentName, validateProduct, type Product } from './product.ts';
import { patternPieceSvgs, SEAM_ALLOWANCE_CM, validatePatternAllowance } from './pattern-export.ts';
import { drawingTileLayout, tiledDrawingHtml, type PaperFormat } from './print-pattern.ts';

/** Each piece is tiled independently, avoiding the blank space between pieces in a long overview strip. */
export function productTileLayouts(product: Product, paper: PaperFormat, allowance = SEAM_ALLOWANCE_CM) {
  allowance = validatePatternAllowance(allowance);
  const design = validateProduct(product);
  const layouts = patternPieceSvgs(design, allowance).map(piece => ({ ...piece, layout: drawingTileLayout(piece.svg, paper) }));
  if (layouts.reduce((sum, item) => sum + item.layout.tiles.length, 0) > 256) throw new Error('Pattern exceeds the 256-tile printing limit.');
  return layouts;
}
export function tiledProductPatternHtml(product: Product, paper: PaperFormat, allowance = SEAM_ALLOWANCE_CM): string {
  allowance = validatePatternAllowance(allowance);
  const design = validateProduct(product);
  return tiledDrawingHtml(productTileLayouts(design, paper, allowance), paper, {
    title: `${design.name} · ${garmentName(design)} · size ${design.spec?.sampleSize ?? 'M'}`,
    description: `Applied product pattern, including ${allowance} cm seam allowance. Solid: cutting line. Dashed: sewing line. Arrow: grainline. Red dash-dot: fold; blue solid/dashed: pleat fold and placement; V: dart. Keep the stated cut counts and mirror instructions. No styling images, personal body measurements or concept notes are included. Simplified uniform offsets: inspect corners and verify hem/closure construction and fit with a toile.`,
    calibrationNote: `${allowance} cm seam allowance included. Validate construction and fit.`,
    legend: ['Solid: cut; dashed: sew; arrow: grainline.', 'Red dash-dot: fold. Blue solid/dashed: pleat fold/placement.', 'V: sew dart legs together. Cut counts are on every tile.'],
  });
}
