// Automatic tech pack: generated from the current product design, so it is always in sync with it.
// Pure builder plus a dependency-free .xlsx writer and a printable HTML document.
import { BASE_NAMES, NECK_RIB_RATIO, POCKET_FOLD_CM, flare, partName, WAISTBAND_CM, isBottoms, material, optionsOf, printName, LAYOUT_NAMES, SIZES, patternPieces, teeDimensions, topMeasurements, trouserDimensions, type PartId, type PartStyle, type Product, type Size } from './product.ts';

export interface BomRow { item: string; description: string; color: string; placement: string; quantity: string }
export interface Pom { code: string; name: string; howToMeasure: string; tolerance: number; values: Record<Size, number> }
export interface ConstructionRow { area: string; operation: string; detail: string }
export interface TechPack {
  name: string; styleNumber: string; season: string; sampleSize: Size; base: string; neckline: string; date: string;
  bom: BomRow[]; poms: Pom[]; construction: ConstructionRow[]; notes: string[];
}

export const FABRIC_WIDTH_CM = 150, WASTE = 1.15;
const round = (value: number, step = 0.5) => Math.round(value / step) * step;
const cm = (value: number) => `${round(value, 0.1).toFixed(1)} cm`;

export interface FabricUsage { style: PartStyle; parts: PartId[]; areaM2: number; linearM: number }
/** Fabric needed per garment for each distinct fabric + colour + print: finished pattern area plus waste. */
export function fabricUsage(product: Product): FabricUsage[] {
  const groups = new Map<string, { style: PartStyle; parts: PartId[]; area: number }>();
  for (const piece of patternPieces(product)) {
    const style = product.parts[piece.part], key = JSON.stringify(style);
    const group = groups.get(key) ?? { style, parts: [], area: 0 };
    group.parts.push(piece.part); group.area += piece.areaCm2 * piece.cutCount; groups.set(key, group);
  }
  return [...groups.values()].map(({ style, parts, area }) => {
    const areaM2 = area * WASTE / 10_000;
    return { style, parts, areaM2, linearM: areaM2 / (FABRIC_WIDTH_CM / 100) };
  });
}

export function buildTechPack(product: Product, date: string): TechPack {
  const spec = product.spec ?? { styleNumber: '', season: '', sampleSize: 'M' as Size };
  // Fabrics: one BoM line per distinct fabric + color + print, with its parts and estimated consumption.
  const bom: BomRow[] = fabricUsage(product).map((usage, index) => {
    const { style } = usage, fabric = material(style.material);
    const colours = style.print?.motif.startsWith('upload:') ? 'from supplied artwork in its own colours' : `${style.print?.color} on ground`;
    const print = style.print ? `; ${printName(style.print, product)} print ${colours}, ${LAYOUT_NAMES[style.print.layout].toLowerCase()} repeat ${style.print.scaleCm} cm` : '';
    return { item: `F${index + 1} ${fabric.name}`, description: `${fabric.composition}, ${fabric.gsm} gsm${print}`, color: style.color,
      placement: usage.parts.map(part => partName(product, part)).join(', '),
      quantity: `${usage.areaM2.toFixed(2)} m² (≈ ${usage.linearM.toFixed(2)} m at ${FABRIC_WIDTH_CM} cm wide)` };
  });
  const label = (code: string, item: string, description: string, placement: string): BomRow => ({ item: `${code} ${item}`, description, color: '—', placement, quantity: '1 pc' });
  bom.push({ item: 'T1 Sewing thread', description: '100% polyester core-spun, Tex 27', color: 'Match each fabric', placement: 'All seams', quantity: '1 cone per colour' });
  if (isBottoms(product)) {
    const legs = trouserDimensions(product);
    bom.push({ item: 'T2 Waistband elastic', description: 'Knitted elastic, 3 cm wide', color: 'White', placement: 'Waistband channel', quantity: `${cm(legs.elastic)} (relaxed waist less 4 cm)` },
      label('T3', 'Waistband label', 'Woven label, 5 × 2 cm', 'Centre back waistband, inside'),
      { ...label('T4', 'Care and content label', 'Printed satin label', 'Left side seam, 10 cm below the waistband'), color: 'White' });
    return { ...trouserPack(product, spec, date), bom };
  }
  bom.push(label('T2', 'Neck label', 'Woven label, 5 × 2 cm', 'Centre back neck'),
    { ...label('T3', 'Care and content label', 'Printed satin label', 'Left side seam, 8 cm above hem'), color: 'White' });
  const dims = teeDimensions(product), modules = optionsOf(product);
  for (const art of product.artwork) {
    const height = art.widthCm * art.height / art.width;
    bom.push({ item: `A${art.part === 'front' ? 1 : 2} Artwork`, description: `${art.name || 'Artwork'} — screen print or DTG`, color: 'Per artwork file',
      placement: `${art.part === 'front' ? 'Front' : 'Back'}: ${cm(art.yCm)} below shoulder, ${art.xCm === 0 ? 'centred' : `${cm(Math.abs(art.xCm))} ${art.xCm > 0 ? 'toward wearer’s left' : 'toward wearer’s right'}`}${art.rotation ? `, ${Math.abs(art.rotation)}° ${art.rotation > 0 ? 'clockwise' : 'counterclockwise'} about its centre` : ''}`,
      quantity: `${cm(art.widthCm)} × ${cm(height)}` });
  }
  // Points of measure for the sample size, graded by fixed increments per size step.
  const long = topMeasurements(product).sleeve > 40, pom = pomMaker(spec.sampleSize), chest = chestLine(product);
  const poms = [
    pom('A', 'Chest width (½)', '2.5 cm below armhole, side seam to side seam', chest.right - chest.left, 2.5, 1),
    pom('B', 'Body length', 'High point shoulder to hem', dims.length, 1.5, 1),
    pom('C', 'Sleeve length', 'Shoulder point to cuff edge', dims.sleeveLength, long ? 1 : 0.5, long ? 1 : 0.5),
    pom('D', 'Armhole depth', 'Shoulder point straight down to underarm', dims.armDepth, 1, 0.5),
    pom('E', 'Shoulder width', 'Shoulder point to shoulder point', dims.shoulderX * 2, 1.5, 1),
    pom('F', 'Neck width', 'Neck seam to neck seam', dims.neckHalf * 2, 0.5, 0.5),
    pom('G', 'Front neck drop', 'High point shoulder line to front neck seam', dims.neckDepthFront, 0.25, 0.5),
    pom('H', 'Back neck drop', 'High point shoulder line to back neck seam', dims.neckDepthBack, 0, 0.5),
    pom('I', 'Hem width (½)', 'Side seam to side seam at hem', dims.hemHalf * 2, 2.5, 1),
    pom('J', 'Sleeve opening (½)', 'Along cuff edge', dims.cuffHalf, 0.5, 0.5),
    ...(product.base === 'hoodie' ? [pom('K', 'Hood side height', 'Side pattern base to top; no seam allowance; 3D crown is illustrative', dims.hoodHeight, 0.5, 1)]
      : [pom('K', 'Neck rib height', 'Finished rib', dims.ribHeight, 0, 0.25)]),
    ...(product.base === 'tee' ? [] : [
      pom('L', 'Cuff height', 'Finished rib cuff', dims.cuffHeight, 0, 0.25),
      pom('M', 'Hem band height', 'Finished rib hem band', dims.band, 0, 0.25),
    ]),
    ...(product.base === 'hoodie' ? [
      pom('N', 'Hood width (½)', 'Face edge to back of hood, at the widest point', dims.hoodHalf * 2, 0.5, 1),
      pom('O', 'Pocket width at bottom', 'Pocket edge to pocket edge along its lower seam', dims.pocketHalfBottom * 2, 1, 0.5),
    ] : []),
    ...(dims.hemCurve ? [
      pom('S', 'Side length', 'Underarm straight down the side seam to the hem', dims.length - dims.hemCurve - dims.shoulderDrop - dims.armDepth, 1, 1),
      pom('T', 'Hem curve drop', 'Hem at the side seam to hem at centre front, measured straight down', dims.hemCurve, 0, 0.5),
    ] : []),
    pom('U', 'Shoulder drop', 'High point shoulder line vertically down to the shoulder point at the armhole', dims.shoulderDrop, 0, 0.5),
    ...(modules.chestPocket ? [
      pom('P', 'Chest pocket width', 'Finished, across the top edge', dims.chestPocketWidth, 0.5, 0.3),
      pom('Q', 'Chest pocket height', 'Finished, top edge to bottom edge', dims.chestPocketHeight, 0.5, 0.3),
      pom('R', 'Chest pocket placement', 'High point shoulder line straight down to the pocket top', dims.chestPocketY, 0.5, 0.5),
      pom('V', 'Chest pocket centre offset', 'Horizontal from centre front; positive toward wearer’s left, negative toward right', dims.chestPocketX, 0, 0.5),
    ] : []),
  ];
  const construction: ConstructionRow[] = [
    { area: 'Shoulder seams', operation: '4-thread overlock', detail: 'Back neck to shoulder point; stabilise with 6 mm clear tape' },
    ...(product.base === 'hoodie' ? [
      { area: 'Hood', operation: '4-thread overlock centre seam, then attach to neckline', detail: `Hood sides cut 2; ${cm(dims.hoodHeight)} high; face edge turned 2 cm and coverstitched` },
      { area: 'Kangaroo pocket', operation: 'Turn pocket openings 2 cm and coverstitch; edgestitch top to front', detail: `${cm(dims.pocketHalfBottom * 2)} wide at the bottom; sides caught in the hem band seam` },
    ] : [{ area: 'Neck rib', operation: 'Overlock attach, then 2-needle coverstitch', detail: `${product.neckline === 'v' ? 'Mitred at centre front V' : 'Joined at left shoulder'}; rib ${cm(dims.ribLength)} long (${Math.round((1 - NECK_RIB_RATIO) * 100)}% shorter than the flat neckline sewing path; confirm for the chosen rib), ${cm(dims.ribHeight)} finished` }]),
    { area: 'Sleeves', operation: '4-thread overlock (set in flat)', detail: 'Ease cap evenly; match sleeve head to shoulder seam' },
    { area: 'Side seams', operation: '4-thread overlock', detail: product.base === 'tee' ? 'Underarm to hem in one pass; insert care label at left side' : 'Cuff edge to hem in one pass with the underarm seam; insert care label at left side' },
    ...(product.base === 'tee' ? [
      { area: 'Sleeve hems', operation: '2-needle coverstitch', detail: '2 cm turn-back' },
      { area: 'Body hem', operation: '2-needle coverstitch', detail: dims.hemCurve ? `Curved shirttail, ${cm(dims.hemCurve)} higher at the side seams; 1.5 cm turn-back to follow the curve` : '2.5 cm turn-back' },
    ] : [
      { area: 'Cuffs', operation: 'Close into a loop, fold, then overlock to the sleeve', detail: `${cm(dims.cuffHeight)} finished; cut about 15% shorter than the sleeve opening` },
      { area: 'Hem band', operation: 'Close into a loop, fold, then overlock to the body', detail: `${cm(dims.band)} finished; cut about 15% shorter than the hem` },
    ]),
    ...(modules.chestPocket ? [{ area: 'Chest pocket', operation: `Turn the top ${cm(POCKET_FOLD_CM)} and coverstitch; press the edges under 1 cm and edgestitch to the front`,
      detail: `${cm(dims.chestPocketWidth)} × ${cm(dims.chestPocketHeight)} finished; top ${cm(dims.chestPocketY)} below the shoulder line, ${dims.chestPocketX === 0 ? 'centred on the front' : `centre ${cm(Math.abs(dims.chestPocketX))} toward the wearer’s ${dims.chestPocketX > 0 ? 'left' : 'right'}`}; bar-tack both top corners` }] : []),
    ...product.artwork.map(art => ({ area: `${art.part === 'front' ? 'Front' : 'Back'} artwork`, operation: 'Screen print or DTG after sewing', detail: `${cm(art.widthCm)} wide, ${cm(art.yCm)} below shoulder` })),
  ];
  return {
    name: product.name, styleNumber: spec.styleNumber, season: spec.season, sampleSize: spec.sampleSize, base: BASE_NAMES[product.base], neckline: product.base === 'hoodie' ? 'Hood' : product.neckline === 'v' ? 'V-neck' : 'Crew neck', date,
    bom, poms, construction,
    notes: [
      `Consumption is estimated from finished pattern areas plus ${Math.round((WASTE - 1) * 100)}% for seam allowance and cutting waste; confirm with a marker.`,
      `Points of measure are for the sample size (${spec.sampleSize}); other sizes use fixed grade increments. Confirm with a fit sample.`,
      'Generated by Clothing Studio from the 3D design; the garment shape is a styling model, not a fitted drape.',
    ],
  };
}

/** Chest POM endpoints from the actual sewing side seams, including taper/flare and curved hems. */
function chestLine(product: Product) {
  const d = teeDimensions(product), y = d.shoulderDrop + d.armDepth + 2.5;
  const outline = patternPieces(product).find(piece => piece.part === 'front')!.outline;
  const xs = outline.flatMap((a, i) => {
    const b = outline[(i + 1) % outline.length];
    return (a.y <= y && b.y > y) || (b.y <= y && a.y > y) ? [a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)] : [];
  });
  return { left: Math.min(...xs), right: Math.max(...xs), y };
}

/** Points of measure for the sample size, graded by fixed increments per size step. */
function pomMaker(sampleSize: Size) {
  const base = SIZES.indexOf(sampleSize);
  return (code: string, name: string, howToMeasure: string, value: number, grade: number, tolerance: number): Pom =>
    ({ code, name, howToMeasure, tolerance, values: Object.fromEntries(SIZES.map((size, i) => [size, round(value + (i - base) * grade)])) as Record<Size, number> });
}

/** Shorts and trousers: leg points of measure and construction; the bill of materials is shared. */
function trouserPack(product: Product, spec: NonNullable<Product['spec']>, date: string): Omit<TechPack, 'bom'> {
  const d = trouserDimensions(product), pom = pomMaker(spec.sampleSize), shorts = d.inseam < 35;
  // Rises are measured along the centre seam: from the centre waist (outline point 1) round the crotch curve (to point 8).
  const seam = (part: 'front' | 'back') => { const o = patternPieces(product).find(piece => piece.part === part)!.outline; let length = 0; for (let i = 1; i < 8; i++) length += Math.hypot(o[i + 1].x - o[i].x, o[i + 1].y - o[i].y); return length; };
  const poms = [
    pom('A', 'Waist (½), relaxed', 'Along the top of the waistband, elastic relaxed', d.waist / 2, 2.5, 1),
    pom('B', 'Waist (½), extended', 'Along the top of the waistband, fully stretched', d.waistbandLength / 2, 2.5, 1),
    pom('C', 'Hip (½)', `${cm(d.hipDepth)} below the waist seam, side seam to side seam`, (d.frontHip + d.backHip) - 1, 2.5, 1),
    pom('D', 'Front rise', 'Waist seam to the inseam, along the centre front seam', seam('front'), 0.5, 0.5),
    pom('E', 'Back rise', 'Waist seam to the inseam, along the centre back seam', seam('back'), 0.75, 0.5),
    pom('F', 'Thigh (½)', '2.5 cm below the crotch, across the leg', d.thighHalf, 1, 0.5),
    pom('G', 'Inseam', 'Crotch seam to hem along the inside leg', d.inseam, 0, 1),
    pom('H', 'Outseam', 'Top of the waistband to hem along the side seam', d.outseam, 0.5, 1),
    pom('I', 'Leg opening (½)', 'Along the hem edge', d.legOpening / 2, 0.5, 0.5),
    pom('J', 'Waistband height', 'Finished', WAISTBAND_CM, 0, 0.25),
  ];
  const construction: ConstructionRow[] = [
    { area: 'Inseams', operation: '4-thread overlock, then topstitch', detail: 'Join each front leg to its back leg from hem to crotch' },
    { area: 'Side seams', operation: '4-thread overlock', detail: 'Waist to hem; insert the care label at the left side' },
    { area: 'Crotch seam', operation: 'Overlock, then double-stitch through the crotch', detail: 'Join the two legs from centre front waist through the crotch to centre back waist' },
    { area: 'Waistband', operation: 'Close into a loop, fold, insert elastic, then attach with a 4-thread overlock', detail: `${cm(WAISTBAND_CM)} finished; 3 cm elastic ${cm(d.elastic)} long, ends overlapped 2 cm and box-stitched; topstitch 1 cm from the top edge` },
    { area: 'Leg hems', operation: shorts ? 'Double-turn 1.5 cm and edgestitch' : 'Double-turn 2 cm and edgestitch', detail: `Leg opening ${cm(d.legOpening)} around` },
  ];
  return {
    name: product.name, styleNumber: spec.styleNumber, season: spec.season, sampleSize: spec.sampleSize, base: shorts ? 'Pull-on shorts' : BASE_NAMES[product.base],
    neckline: 'Elasticated waistband', date, poms, construction,
    notes: [
      `Consumption is estimated from finished pattern areas plus ${Math.round((WASTE - 1) * 100)}% for seam allowance and cutting waste; confirm with a marker.`,
      `Points of measure are for the sample size (${spec.sampleSize}); other sizes use fixed grade increments. Confirm with a fit sample.`,
      'Generated by Clothing Studio from the 3D design; the garment shape is a styling model, not a fitted drape.',
    ],
  };
}

// --- .xlsx (Office Open XML) writer: store-only ZIP, inline strings, one bold header style. ---------------
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(bytes: Uint8Array): number { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder(), chunks: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name), crc = crc32(file.data), local = new Uint8Array(30 + name.length), view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(8, 0, true);
    view.setUint32(14, crc, true); view.setUint32(18, file.data.length, true); view.setUint32(22, file.data.length, true); view.setUint16(26, name.length, true);
    local.set(name, 30); chunks.push(local, file.data);
    const entry = new Uint8Array(46 + name.length), ev = new DataView(entry.buffer);
    ev.setUint32(0, 0x02014b50, true); ev.setUint16(4, 20, true); ev.setUint16(6, 20, true);
    ev.setUint32(16, crc, true); ev.setUint32(20, file.data.length, true); ev.setUint32(24, file.data.length, true); ev.setUint16(28, name.length, true);
    ev.setUint32(42, offset, true); entry.set(name, 46); central.push(entry);
    offset += local.length + file.data.length;
  }
  const size = central.reduce((sum, c) => sum + c.length, 0), end = new Uint8Array(22), endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, files.length, true); endView.setUint16(10, files.length, true);
  endView.setUint32(12, size, true); endView.setUint32(16, offset, true);
  const total = new Uint8Array(offset + size + 22); let at = 0;
  for (const part of [...chunks, ...central, end]) { total.set(part, at); at += part.length; }
  return total;
}
// XML 1.0 forbids control characters other than tab, line feed and carriage return.
const xml = (text: string) => [...text].filter(c => c.charCodeAt(0) >= 32 || c === '\t' || c === '\n' || c === '\r').join('').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
function column(index: number) { let s = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }
function sheet(rows: (string | number)[][], widths: number[]): string {
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => {
    const ref = `${column(c)}${r + 1}`, style = r === 0 ? ' s="1"' : '';
    return typeof cell === 'number' ? `<c r="${ref}"${style}><v>${cell}</v></c>` : `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(cell)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData></worksheet>`;
}
export interface Sheet { name: string; rows: (string | number)[][]; widths: number[] }
export function techPackXlsx(pack: TechPack): Uint8Array<ArrayBuffer> {
  return xlsx([
    { name: 'Cover', widths: [22, 60], rows: [['Field', 'Value'], ['Style name', pack.name], ['Style number', pack.styleNumber || '—'], ['Season', pack.season || '—'],
      ['Product', pack.base], ['Neckline', pack.neckline], ['Sample size', pack.sampleSize], ['Generated', pack.date], ...pack.notes.map((note, i) => [`Note ${i + 1}`, note])] },
    { name: 'Bill of materials', widths: [26, 70, 16, 40, 34], rows: [['Item', 'Description', 'Colour', 'Placement', 'Quantity'], ...pack.bom.map(r => [r.item, r.description, r.color, r.placement, r.quantity])] },
    { name: 'Points of measure', widths: [6, 22, 44, 12, ...SIZES.map(() => 8)], rows: [['Code', 'Point of measure', 'How to measure', 'Tol. ± cm', ...SIZES.map(s => s === pack.sampleSize ? `${s} (sample)` : s)],
      ...pack.poms.map(p => [p.code, p.name, p.howToMeasure, p.tolerance, ...SIZES.map(s => p.values[s])])] },
    { name: 'Construction', widths: [22, 40, 70], rows: [['Area', 'Operation', 'Detail'], ...pack.construction.map(r => [r.area, r.operation, r.detail])] },
  ]);
}
/** A workbook of plain sheets: the first row of each is a bold header. */
export function xlsx(sheets: Sheet[]): Uint8Array<ArrayBuffer> {
  const e = new TextEncoder();
  const files = [
    { name: '[Content_Types].xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheet(s.rows, s.widths) })),
  ];
  return zip(files.map(file => ({ name: file.name, data: e.encode(file.text) })));
}

// --- Printable HTML -------------------------------------------------------------------------------
const html = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Bill of materials, points of measure (with the diagram) and construction, as HTML sections. */
export function techPackSections(pack: TechPack, diagram: string, level: number): string {
  const h = (text: string) => `<h${level}>${html(text)}</h${level}>`;
  const table = (head: string[], rows: string[][]) => `<div class="table-scroll"><table><thead><tr>${head.map(c => `<th scope="col">${html(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${html(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  return `${h('Bill of materials')}${table(['Item', 'Description', 'Colour', 'Placement', 'Quantity'], pack.bom.map(r => [r.item, r.description, r.color, r.placement, r.quantity]))}
${h('Points of measure (cm)')}<div class="diagram">${diagram}</div>${table(['Code', 'Point of measure', 'How to measure', 'Tol. ±', ...SIZES.map(s => s === pack.sampleSize ? `${s}*` : s)], pack.poms.map(p => [p.code, p.name, p.howToMeasure, String(p.tolerance), ...SIZES.map(s => String(p.values[s]))]))}
<p class="notes">* sample size</p>
${h('Construction')}${table(['Area', 'Operation', 'Detail'], pack.construction.map(r => [r.area, r.operation, r.detail]))}`;
}
export function techPackHtml(pack: TechPack, images: { front?: string; back?: string; diagram: string }): string {
  const render = (src: string | undefined, label: string) => src && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(src) ? `<figure><img src="${src}" alt="${label} render"><figcaption>${label}</figcaption></figure>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${html(pack.name)} — tech pack</title>
<style>body{font:13px/1.5 system-ui,sans-serif;color:#222;margin:24px;max-width:1100px}h1{font-size:22px;margin:0}h2{font-size:15px;margin:28px 0 8px;border-bottom:2px solid #222;padding-bottom:4px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:5px 7px;text-align:left;vertical-align:top}th{background:#f1ede6}.cover{display:grid;grid-template-columns:1fr 1fr;gap:16px}.renders{display:flex;gap:12px}.renders figure{margin:0;flex:1}.renders img{width:100%;border:1px solid #ddd;background:#f6f2ea}dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0}dt{font-weight:600}.diagram svg{width:100%;height:auto;max-height:520px}.notes{color:#555}@media print{body{margin:10mm}h2{break-after:avoid}table{break-inside:auto}}</style></head><body>
<h1>${html(pack.name)}</h1><p>Tech pack · generated ${html(pack.date)}</p>
<section class="cover"><dl><dt>Style number</dt><dd>${html(pack.styleNumber || '—')}</dd><dt>Season</dt><dd>${html(pack.season || '—')}</dd><dt>Product</dt><dd>${html(pack.base)}</dd><dt>Neckline</dt><dd>${html(pack.neckline)}</dd><dt>Sample size</dt><dd>${html(pack.sampleSize)}</dd></dl>
<div class="renders">${render(images.front, 'Front')}${render(images.back, 'Back')}</div></section>
${techPackSections(pack, images.diagram, 2)}
<h2>Notes</h2><ul class="notes">${pack.notes.map(n => `<li>${html(n)}</li>`).join('')}</ul></body></html>`;
}

/** Flat front sketch and sleeve with the points of measure drawn on them (cm user units). */
export function measurementDiagram(product: Product): string {
  if (isBottoms(product)) return trouserDiagram(product);
  const pieces = patternPieces(product), front = pieces.find(p => p.part === 'front')!, sleeve = pieces.find(p => p.part === 'sleeveLeft')!;
  const d = teeDimensions(product), w = front.width, gap = 14, sx = w + gap;
  const arrow = (x1: number, y1: number, x2: number, y2: number, code: string, lx: number, ly: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#b5452b" stroke-width="0.35" marker-start="url(#pom-arrow)" marker-end="url(#pom-arrow)"/><text x="${lx}" y="${ly}" font-size="3.2" fill="#b5452b" font-weight="700">${code}</text>`;
  const outline = (piece: typeof front, dx: number) => `<polygon transform="translate(${dx} 0)" points="${piece.outline.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" fill="#f6f2ea" stroke="#333" stroke-width="0.4"/>`;
  // Marks are drawn on the unflared body (the group below shifts them onto a flared piece).
  const half = d.half, body = d.panelWidth, chest = chestLine(product), armY = chest.y;
  // The chest pocket is on the wearer's left, which is the right of a front view.
  const px = half + d.chestPocketX - d.chestPocketWidth / 2, py = d.chestPocketY;
  const pocketMarks = optionsOf(product).chestPocket ? `<rect x="${px}" y="${py}" width="${d.chestPocketWidth}" height="${d.chestPocketHeight}" fill="none" stroke="#333" stroke-width="0.35" stroke-dasharray="1 0.6"/>`
    + arrow(px, py - 1.5, px + d.chestPocketWidth, py - 1.5, 'P', px + d.chestPocketWidth / 2 - 1, py - 2.7)
    + arrow(px + d.chestPocketWidth + 1.5, py, px + d.chestPocketWidth + 1.5, py + d.chestPocketHeight, 'Q', px + d.chestPocketWidth + 2.5, py + d.chestPocketHeight / 2) : '';
  const sideTop = d.shoulderDrop + d.armDepth, sideBottom = d.length - d.hemCurve;
  const hemMarks = d.hemCurve ? arrow(-2.5, sideTop, -2.5, sideBottom, 'S', -6, (sideTop + sideBottom) / 2) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 ${sx + sleeve.width + 12} ${Math.max(front.height, sleeve.height) + 12}" role="img" aria-label="Measurement diagram" font-family="system-ui, sans-serif"><defs><marker id="pom-arrow" viewBox="0 0 4 4" refX="2" refY="2" markerWidth="3" markerHeight="3" orient="auto-start-reverse"><path d="M0,0 L4,2 L0,4 z" fill="#b5452b"/></marker></defs>
${outline(front, 0)}${outline(sleeve, sx)}<g transform="translate(${flare(product)} 0)">
${arrow(chest.left - flare(product), armY, chest.right - flare(product), armY, 'A', half - 2, armY - 1.2)}${arrow(half - d.neckHalf - 3, 0, half - d.neckHalf - 3, d.length, 'B', half - d.neckHalf - 7, d.length / 2)}
${arrow(half - d.shoulderX, d.shoulderDrop + 0.8, half + d.shoulderX, d.shoulderDrop + 0.8, 'E', half + d.shoulderX - 7, d.shoulderDrop + 4.5)}${arrow(half - d.neckHalf, -2, half + d.neckHalf, -2, 'F', half - 1.5, -3)}
${arrow(half + 1.5, 0, half + 1.5, d.neckDepthFront, 'G', half - 4.5, d.neckDepthFront + 4)}${arrow(half - d.hemHalf, d.length - d.hemCurve - 1.5, half + d.hemHalf, d.length - d.hemCurve - 1.5, 'I', half - 2, d.length - d.hemCurve - 3)}
${arrow(body + 2.5, d.shoulderDrop, body + 2.5, d.shoulderDrop + d.armDepth, 'D', body + 4, d.shoulderDrop + d.armDepth / 2)}
${arrow(body + 2.5, 0, body + 2.5, d.shoulderDrop, 'U', body + 4, d.shoulderDrop / 2)}
${pocketMarks}${hemMarks}</g>
${arrow(sx + sleeve.width / 2, 2, sx + sleeve.width / 2, sleeve.height, 'C', sx + sleeve.width / 2 + 1.5, sleeve.height / 2)}${arrow(sx + (sleeve.width - d.cuffHalf * 2) / 2, sleeve.height + 2.5, sx + (sleeve.width + d.cuffHalf * 2) / 2, sleeve.height + 2.5, 'J', sx + sleeve.width / 2 - 1.5, sleeve.height + 6)}
</svg>`;
}

/** Shorts and trousers: the front and back leg panels with their measurements. */
function trouserDiagram(product: Product): string {
  const pieces = patternPieces(product), front = pieces.find(p => p.part === 'front')!, back = pieces.find(p => p.part === 'back')!;
  const d = trouserDimensions(product), gap = 16, bx = front.width + gap;
  const arrow = (x1: number, y1: number, x2: number, y2: number, code: string, lx: number, ly: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#b5452b" stroke-width="0.5" marker-start="url(#pom-arrow)" marker-end="url(#pom-arrow)"/><text x="${lx}" y="${ly}" font-size="4.2" fill="#b5452b" font-weight="700">${code}</text>`;
  const outline = (piece: typeof front, dx: number) => `<polygon transform="translate(${dx} 0)" points="${piece.outline.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" fill="#f6f2ea" stroke="#333" stroke-width="0.5"/>`;
  const crotchY = d.rise, hemY = d.rise + d.inseam, centre = (d.frontHip + d.frontCrotch) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 ${bx + back.width + 16} ${Math.max(front.height, back.height) + 16}" role="img" aria-label="Measurement diagram" font-family="system-ui, sans-serif"><defs><marker id="pom-arrow" viewBox="0 0 4 4" refX="2" refY="2" markerWidth="3" markerHeight="3" orient="auto-start-reverse"><path d="M0,0 L4,2 L0,4 z" fill="#b5452b"/></marker></defs>
${outline(front, 0)}${outline(back, bx)}
${arrow(0, d.hipDepth, d.frontHip, d.hipDepth, 'C', d.frontHip / 2 - 2, d.hipDepth - 1.5)}${arrow(d.frontHip + 2.5, 0, d.frontHip + 2.5, crotchY, 'D', d.frontHip + 4, crotchY / 2)}
${arrow(centre + d.frontHem / 2 + 3, crotchY + 2, centre + d.frontHem / 2 + 3, hemY, 'G', centre + d.frontHem / 2 + 4.5, (crotchY + hemY) / 2)}${arrow(-3, 0, -3, hemY, 'H', -7.5, hemY / 2)}
${arrow(centre - d.frontHem / 2, hemY + 3, centre + d.frontHem / 2, hemY + 3, 'I', centre - 1.5, hemY + 7.5)}${arrow(0, crotchY + 2.5, d.frontHip + d.frontCrotch, crotchY + 2.5, 'F', (d.frontHip + d.frontCrotch) / 2 - 1.5, crotchY + 6.5)}
${arrow(bx + d.backHip + d.backCrotch + 2.5, 0, bx + d.backHip + d.backCrotch + 2.5, d.backRaise + crotchY, 'E', bx + d.backHip + d.backCrotch + 4, (d.backRaise + crotchY) / 2)}
</svg>`;
}
