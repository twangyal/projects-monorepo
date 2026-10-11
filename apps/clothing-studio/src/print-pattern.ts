import {patternSvg,type SkirtDraft} from './construction.ts';
export type PaperFormat='a4'|'letter';
const number=(value:number)=>String(Math.round(value*1e6)/1e6);
export function tileLayout(draft:SkirtDraft,paper:PaperFormat){
 if(paper!=='a4'&&paper!=='letter')throw new Error('Choose A4 or US Letter paper.');
 const svg=patternSvg(draft),match=svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!;
 const patternWidth=Number(match[1]),patternHeight=Number(match[2]);
 const paperWidth=paper==='a4'?21:21.59,paperHeight=paper==='a4'?29.7:27.94,tileWidth=paperWidth-2,tileHeight=paperHeight-4;
 const columns=Math.max(1,Math.ceil((patternWidth-1)/(tileWidth-1))),rows=Math.max(1,Math.ceil((patternHeight-1)/(tileHeight-1)));
 if(columns*rows>256)throw new Error('Pattern exceeds the 256-tile printing limit.');
 const tiles=Array.from({length:columns*rows},(_,i)=>{const row=Math.floor(i/columns),column=i%columns;return {row,column,x:column*(tileWidth-1),y:row*(tileHeight-1)};});
 return {paperWidth,paperHeight,tileWidth,tileHeight,patternWidth,patternHeight,columns,rows,tiles,svg};
}
/** Self-contained HTML: CSS page sizes and SVG units both describe physical centimetres. */
export function tiledPatternHtml(draft:SkirtDraft,paper:PaperFormat):string{
 const l=tileLayout(draft,paper),art=l.svg.replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,''),label=paper==='a4'?'A4':'US Letter';
 const viewport=(body:string,x=0,y=0)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${number(l.tileWidth*10)}mm" height="${number(l.tileHeight*10)}mm" viewBox="${number(x)} ${number(y)} ${number(l.tileWidth)} ${number(l.tileHeight)}" overflow="hidden">${body}</svg>`;
 const calibration=viewport('<g font-family="sans-serif" font-size="0.45" fill="#222"><rect x="2" y="2" width="5" height="5" fill="none" stroke="#222" stroke-width="0.03"/><text x="2" y="8">5 cm × 5 cm scale check</text><text x="2" y="10">Measure between stroke centres before assembly.</text><text x="2" y="11">Use the selected paper; print at 100%.</text><text x="2" y="12">Disable fit-to-page and browser headers/footers.</text><text x="2" y="14">Trim page borders and align identical crosses.</text><text x="2" y="15">Adjacent graphic viewports have 1 cm overlap.</text><text x="2" y="17">Assemble columns left to right, rows top to bottom.</text><text x="2" y="19">Check labelled stitch/cut lines and validate a toile.</text><text x="2" y="20">No waistband, closure or body fit is provided.</text></g>');
 const sheets=l.tiles.map((t,i)=>{
  // Identical global registration coordinates repeat in the overlapping viewports.
  let guides='';for(let row=0;row<l.rows;row++)for(let col=0;col<l.columns;col++){const x=col*(l.tileWidth-1)+.5,y=row*(l.tileHeight-1)+.5;if(x<t.x||x>t.x+l.tileWidth||y<t.y||y>t.y+l.tileHeight)continue;guides+=`<path d="M ${number(x-.2)} ${number(y)} h .4 M ${number(x)} ${number(y-.2)} v .4" stroke="#668" stroke-width="0.02"/><text x="${number(x+.25)}" y="${number(y+.25)}" font-family="sans-serif" font-size="0.22" fill="#668">${row+1}:${col+1}</text>`;}
  const border=`<rect x="${number(t.x)}" y="${number(t.y)}" width="${number(l.tileWidth)}" height="${number(l.tileHeight)}" fill="none" stroke="#999" stroke-width="0.02" stroke-dasharray="0.2 0.2"/>`;
  return `<section class="sheet"><header>${label} · tile ${i+1}/${l.tiles.length} · row ${t.row+1}/${l.rows}, column ${t.column+1}/${l.columns}</header>${viewport(art.replace(/id="/g,`id="tile-${i}-`)+guides+border,t.x,t.y)}<footer>1 cm overlap · align matching crosses · print at 100% · ${l.columns} columns × ${l.rows} rows</footer></section>`;
 }).join('');
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Measured skirt · ${label} tiled pattern</title><style>@page{size:${number(l.paperWidth*10)}mm ${number(l.paperHeight*10)}mm;margin:0}*{box-sizing:border-box}body{margin:0;background:#eee;font-family:sans-serif;color:#222}.instructions{max-width:70ch;padding:1rem;margin:auto}.sheet{width:${number(l.paperWidth*10)}mm;height:${number(l.paperHeight*10)}mm;padding:10mm;margin:10mm auto;background:white;display:grid;grid-template-rows:10mm ${number(l.tileHeight*10)}mm 10mm;break-inside:avoid}header,footer{font-size:9pt;display:flex;align-items:center}svg{display:block}@media print{body{background:white}.instructions{display:none}.sheet{margin:0;break-after:page}.sheet:last-child{break-after:auto}}</style></head><body><aside class="instructions"><h1>${label} tiled measured pattern</h1><p>${l.tiles.length+1} pages: one scale-check page, then ${l.columns} columns × ${l.rows} rows. Open your browser Print dialog, select ${label}, use 100% scale, and disable browser headers/footers. Measure the 5 cm square before assembling with 1 cm overlap. Do not fit to page.</p><p>Committed skirt measurements: waist ${draft.waist} cm, hem ${draft.hem} cm, slant ${draft.slant} cm. Pattern settings and artwork are unchanged by this export. Construction study only; validate fit and construction before cutting fabric.</p></aside><main><section class="sheet"><header>${label} · calibration and assembly · ${l.tiles.length+1} pages total</header>${calibration}<footer>Measured skirt · scale and assembly instructions</footer></section>${sheets}</main></body></html>`;
 if(new TextEncoder().encode(html).byteLength>2_000_000)throw new Error('Printable pattern exceeds the 2 MB export limit.');
 return html;
}
