import { patternSvg, type SkirtDraft } from './construction.ts';
export type PaperFormat = 'a4' | 'letter';
const number = (value: number) => String(Math.round(value * 1e6) / 1e6);
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Physical tile geometry for a studio-generated SVG with a positive centimetre viewport. */
export function drawingTileLayout(svg: string, paper: PaperFormat) {
  if (paper !== 'a4' && paper !== 'letter') throw new Error('Choose A4 or US Letter paper.');
  const match = svg.match(/viewBox="0 0 ([\d.eE+-]+) ([\d.eE+-]+)"/);
  const patternWidth = Number(match?.[1]), patternHeight = Number(match?.[2]);
  if (![patternWidth, patternHeight].every(n => Number.isFinite(n) && n > 0)) throw new Error('The printable drawing needs positive centimetre dimensions.');
  const paperWidth = paper === 'a4' ? 21 : 21.59, paperHeight = paper === 'a4' ? 29.7 : 27.94;
  const tileWidth = paperWidth - 2, tileHeight = paperHeight - 4;
  const columns = Math.max(1, Math.ceil((patternWidth - 1) / (tileWidth - 1))), rows = Math.max(1, Math.ceil((patternHeight - 1) / (tileHeight - 1)));
  if (columns * rows > 256) throw new Error('Pattern exceeds the 256-tile printing limit.');
  const tiles = Array.from({ length: columns * rows }, (_, i) => {
    const row = Math.floor(i / columns), column = i % columns;
    return { row, column, x: column * (tileWidth - 1), y: row * (tileHeight - 1) };
  });
  return { paperWidth, paperHeight, tileWidth, tileHeight, patternWidth, patternHeight, columns, rows, tiles, svg };
}
export function tileLayout(draft: SkirtDraft, paper: PaperFormat) { return drawingTileLayout(patternSvg(draft), paper); }
export interface DrawingTiles { layout: ReturnType<typeof drawingTileLayout>; label: string; detail: string }

/** Self-contained HTML: CSS page sizes and SVG units both describe physical centimetres. */
export function tiledDrawingHtml(drawings: DrawingTiles[], paper: PaperFormat, text: { title: string; description: string; calibrationNote: string; legend?: readonly string[] }): string {
  if (!drawings.length || (paper !== 'a4' && paper !== 'letter')) throw new Error('Choose drawings and A4 or US Letter paper.');
  if ((text.legend?.length ?? 0) > 3) throw new Error('Keep the printed calibration legend to at most three lines.');
  const l = drawings[0].layout, label = paper === 'a4' ? 'A4' : 'US Letter';
  const count = drawings.reduce((sum, item) => sum + item.layout.tiles.length, 0);
  if (count > 256) throw new Error('Pattern exceeds the 256-tile printing limit.');
  if (drawings.some(item => item.layout.paperWidth !== (paper === 'a4' ? 21 : 21.59) || item.layout.paperHeight !== (paper === 'a4' ? 29.7 : 27.94))) throw new Error('Use the same paper for every pattern piece.');
  const viewport = (body: string, x = 0, y = 0) => `<svg xmlns="http://www.w3.org/2000/svg" width="${number(l.tileWidth * 10)}mm" height="${number(l.tileHeight * 10)}mm" viewBox="${number(x)} ${number(y)} ${number(l.tileWidth)} ${number(l.tileHeight)}" overflow="hidden">${body}</svg>`;
  const calibration = viewport(`<g font-family="sans-serif" font-size="0.45" fill="#222"><rect x="2" y="2" width="5" height="5" fill="none" stroke="#222" stroke-width="0.03"/><text x="2" y="8">5 cm × 5 cm scale check</text><text x="2" y="10">Measure between stroke centres before assembly.</text><text x="2" y="11">Use the selected paper; print at 100%.</text><text x="2" y="12">Disable fit-to-page and browser headers/footers.</text><text x="2" y="14">Trim page borders and align identical crosses.</text><text x="2" y="15">Adjacent graphic viewports have 1 cm overlap.</text><text x="2" y="17">For each drawing: columns left to right, rows top to bottom.</text><text x="2" y="19">Check labelled stitch/cut lines and validate a toile.</text><text x="2" y="20">${escape(text.calibrationNote)}</text>${(text.legend ?? []).map((line, i) => `<text x="2" y="${21 + i}" font-size="0.35">${escape(line)}</text>`).join('')}</g>`);
  let tileIndex = 0;
  const sheets: string[] = [];
  let bytes = 0;
  for (const [drawingIndex, drawing] of drawings.entries()) {
    const layout = drawing.layout, art = layout.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    for (const t of layout.tiles) {
      const index = tileIndex++;
      // Marker references must follow their tile-local ids; no SVG shares another tile's definitions.
      const copy = art.replace(/\bid="([^"]+)"/g, (_, id) => `id="tile-${index}-${id}"`)
        .replace(/(marker-(?:start|end)="url\(#)([^)]+)(\)")/g, (_, start, id, end) => `${start}tile-${index}-${id}${end}`);
      let guides = '';
      for (let row = 0; row < layout.rows; row++) for (let col = 0; col < layout.columns; col++) {
        const x = col * (layout.tileWidth - 1) + .5, y = row * (layout.tileHeight - 1) + .5;
        if (x < t.x || x > t.x + layout.tileWidth || y < t.y || y > t.y + layout.tileHeight) continue;
        guides += `<path d="M ${number(x - .2)} ${number(y)} h .4 M ${number(x)} ${number(y - .2)} v .4" stroke="#668" stroke-width="0.02"/><text x="${number(x + .25)}" y="${number(y + .25)}" font-family="sans-serif" font-size="0.22" fill="#668">${drawingIndex + 1} / ${row + 1}:${col + 1}</text>`;
      }
      const border = `<rect x="${number(t.x)}" y="${number(t.y)}" width="${number(layout.tileWidth)}" height="${number(layout.tileHeight)}" fill="none" stroke="#999" stroke-width="0.02" stroke-dasharray="0.2 0.2"/>`;
      const sheet = `<section class="sheet" data-drawing="${drawingIndex + 1}"><header>${label} · ${escape(drawing.label)} · tile ${index + 1}/${count} · row ${t.row + 1}/${layout.rows}, column ${t.column + 1}/${layout.columns}</header>${viewport(copy + guides + border, t.x, t.y)}<footer>${escape(drawing.detail)} · 1 cm overlap · print at 100%</footer></section>`;
      bytes += new TextEncoder().encode(sheet).byteLength;
      if (bytes > 2_000_000) throw new Error('Printable pattern exceeds the 2 MB export limit.');
      sheets.push(sheet);
    }
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(text.title)} · ${label} tiled pattern</title><style>@page{size:${number(l.paperWidth * 10)}mm ${number(l.paperHeight * 10)}mm;margin:0}*{box-sizing:border-box}body{margin:0;background:#eee;font-family:sans-serif;color:#222}.instructions{max-width:70ch;padding:1rem;margin:auto}.sheet{width:${number(l.paperWidth * 10)}mm;height:${number(l.paperHeight * 10)}mm;padding:10mm;margin:10mm auto;background:white;display:grid;grid-template-rows:10mm ${number(l.tileHeight * 10)}mm 10mm;break-inside:avoid}header,footer{font-size:8pt;line-height:1.15;display:flex;align-items:center;overflow-wrap:anywhere}svg{display:block}@media print{body{background:white}.instructions{display:none}.sheet{margin:0;break-after:page}.sheet:last-child{break-after:auto}}</style></head><body><aside class="instructions"><h1>${escape(text.title)} · ${label} tiled pattern</h1><p>${count + 1} pages: one scale-check page, then ${drawings.length} drawing${drawings.length === 1 ? '' : 's'}. Open your browser Print dialog, select ${label}, use 100% scale, and disable browser headers/footers. Measure the 5 cm square before assembling with 1 cm overlap. Do not fit to page.</p><p>${escape(text.description)}</p><p>Assemble each numbered drawing separately, using the piece name and row/column labels on every page. Confirm the cutting instructions before cutting fabric.</p></aside><main><section class="sheet"><header>${label} · calibration and assembly · ${count + 1} pages total</header>${calibration}<footer>${escape(text.title)} · scale and assembly instructions</footer></section>${sheets.join('')}</main></body></html>`;
  if (new TextEncoder().encode(html).byteLength > 2_000_000) throw new Error('Printable pattern exceeds the 2 MB export limit.');
  return html;
}
export function tiledPatternHtml(draft: SkirtDraft, paper: PaperFormat): string {
  return tiledDrawingHtml([{ layout: tileLayout(draft, paper), label: 'Measured skirt', detail: 'Measured skirt · cutting and stitch lines' }], paper, {
    title: 'Measured skirt',
    description: `Committed skirt measurements: waist ${draft.waist} cm, hem ${draft.hem} cm, slant ${draft.slant} cm. Pattern settings and artwork are unchanged by this export. Construction study only; validate fit and construction before cutting fabric.`,
    calibrationNote: draft.waistband ? 'Waistband included; closure and body fit are not simulated.' : 'No waistband, closure or body fit is provided.',
  });
}
