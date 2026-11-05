import { validateProject, type Project } from './model.ts';
import { canWearTogether, LIMITS, partsOf } from './product.ts';
import { validateRasterHeader, type RasterAsset } from './media.ts';
import { threePiece } from './garment-drape.ts';
import { patternDxf, patternSvg } from './pattern-export.ts';
import { buildTechPack, measurementDiagram, techPackHtml, techPackXlsx, zip } from './techpack.ts';

/** Each applied outfit garment keeps its own sample measurements and spec; view/export grades are not inputs. */
export function buildOutfitBundle(project: Project, date: string): Uint8Array<ArrayBuffer> {
  const current = validateProject(project), first = current.product, second = current.wornWith, third = current.wornAlso;
  if (!first || !second) throw new Error('Choose an outfit with Wear with before downloading its patterns and tech packs.');
  if (!canWearTogether(first, second) || (third && !threePiece([first, second, third]))) throw new Error('Choose compatible outfit garments before exporting.');
  const garments = third ? [first, second, third] : [first, second], encoder = new TextEncoder();
  const files: { name: string; data: Uint8Array }[] = [];
  const entries = garments.map((garment, index) => {
    // Fixed ASCII paths cannot collide or inherit slashes/control characters from a garment's display name.
    const folder = `${String(index + 1).padStart(2, '0')}-${garment.base}`;
    const paths = { svg: `${folder}/pattern.svg`, dxf: `${folder}/pattern.dxf`, xlsx: `${folder}/tech-pack.xlsx`, html: `${folder}/tech-pack.html` };
    const pack = buildTechPack(garment, date);
    files.push({ name: paths.svg, data: encoder.encode(patternSvg(garment)) },
      { name: paths.dxf, data: encoder.encode(patternDxf(garment)) },
      { name: paths.xlsx, data: techPackXlsx(pack) },
      { name: paths.html, data: encoder.encode(techPackHtml(pack, { diagram: measurementDiagram(garment) })) });
    const includeRaster = (asset: RasterAsset, label: string, maxBytes: number, maxEdge: number) => {
      const { bytes, mimeType } = validateRasterHeader(asset, maxBytes, maxEdge);
      const file = `${folder}/${label}.${mimeType.slice('image/'.length)}`;
      files.push({ name: file, data: bytes });
      return file;
    };
    const artwork = garment.artwork.map(art => ({
      file: includeRaster(art, `artwork-${art.part}`, LIMITS.artworkBytes, 4096),
      name: art.name, part: art.part, widthPx: art.width, heightPx: art.height,
      xCm: art.xCm, yCm: art.yCm, widthCm: art.widthCm,
      heightCm: art.widthCm * art.height / art.width, rotation: art.rotation ?? 0,
    }));
    let repeatNumber = 0;
    const repeatMotifs = (garment.motifs ?? []).flatMap(motif => {
      const parts = partsOf(garment).flatMap(part => {
        const print = garment.parts[part].print;
        return print?.motif === `upload:${motif.id}` ? [{ part, scaleCm: print.scaleCm, layout: print.layout }] : [];
      });
      return parts.length ? [{
        file: includeRaster(motif, `repeat-${String(++repeatNumber).padStart(2, '0')}`, LIMITS.motifBytes, 2048),
        name: motif.name, widthPx: motif.width, heightPx: motif.height, parts,
      }] : [];
    });
    return { name: garment.name, base: garment.base, sampleSize: pack.sampleSize, styleNumber: pack.styleNumber, files: paths,
      ...(artwork.length ? { artwork } : {}), ...(repeatMotifs.length ? { repeatMotifs } : {}) };

  });
  files.unshift({ name: 'manifest.json', data: encoder.encode(JSON.stringify({ format: 'clothing-studio-outfit', version: 1, title: current.title, date, garments: entries }, null, 2)) },
    { name: 'README.txt', data: encoder.encode('OUTFIT PATTERNS AND TECH PACKS\n\nEach numbered folder holds one garment at its applied sample size, identified in manifest.json. Temporary 3D size previews and individual pattern export sizes do not change this bundle.\n\npattern.svg: printable 1:1 pattern; print at 100% scale.\npattern.dxf: CAD pattern in millimetres.\ntech-pack.xlsx: measurements, materials and construction.\ntech-pack.html: printable tech pack with a measurement diagram (no front/back render images).\nartwork-* and repeat-*: applied raster artwork and uploaded repeat source images, when used. The manifest lists placements and repeats. Artwork x is the centre offset (positive toward the right when viewing that panel from outside), y is the unrotated top edge below the shoulder, and positive rotation is clockwise viewed from outside. Repeat scale is the width of the four-cell square, not one image; the source image is fitted to 85% of each cell’s longest edge. Unused images and reference photos are not included.\n\nThis is an export bundle, not a restorable project backup.\n') });
  return zip(files);
}
