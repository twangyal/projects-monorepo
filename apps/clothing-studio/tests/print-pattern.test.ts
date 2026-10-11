import test from 'node:test';
import assert from 'node:assert/strict';
import * as printing from '../src/print-pattern.ts';
import {DEFAULT_CONSTRUCTION} from '../src/construction.ts';
test('physical tile layout independently covers the original sheet with exactly 1cm overlap',()=>{
 for(const paper of ['a4','letter'] as const){const l=printing.tileLayout(DEFAULT_CONSTRUCTION,paper);assert.equal(l.paperWidth,paper==='a4'?21:21.59);assert.equal(l.paperHeight,paper==='a4'?29.7:27.94);assert.ok(l.tiles.length>1&&l.tiles.length<=256);assert.equal(l.tileWidth,l.paperWidth-2);assert.equal(l.tileHeight,l.paperHeight-4);for(const t of l.tiles){assert.equal(t.x,t.column*(l.tileWidth-1));assert.equal(t.y,t.row*(l.tileHeight-1));}assert.equal(l.columns*l.rows,l.tiles.length);assert.ok((l.columns-1)*(l.tileWidth-1)+l.tileWidth>=l.patternWidth);assert.ok((l.rows-1)*(l.tileHeight-1)+l.tileHeight>=l.patternHeight);assert.ok(l.columns===1||(l.columns-2)*(l.tileWidth-1)+l.tileWidth<l.patternWidth);assert.ok(l.rows===1||(l.rows-2)*(l.tileHeight-1)+l.tileHeight<l.patternHeight);}
});
test('printable documents retain measured paths calibration and bounded resource-free pages',()=>{
 for(const paper of ['a4','letter'] as const){const d={...DEFAULT_CONSTRUCTION,allowances:{seam:1,hem:3}},l=printing.tileLayout(d,paper),html=printing.tiledPatternHtml(d,paper);assert.equal((html.match(/class="sheet"/g)||[]).length,l.tiles.length+1);assert.match(html,/5 cm × 5 cm/);assert.match(html,/print at 100%/);assert.match(html,/Seam\/waist allowance 1 cm/);assert.match(html,/id="tile-0-cut-front"/);assert.match(html,/1 cm overlap/);assert.doesNotMatch(html,/<script|<image|foreignObject|https?:\/\/(?!www.w3.org\/2000\/svg)/);assert.ok(html.length<2_000_000);}assert.throws(()=>printing.tileLayout(DEFAULT_CONSTRUCTION,'bad' as 'a4'));assert.throws(()=>printing.tiledPatternHtml({...DEFAULT_CONSTRUCTION,slant:NaN},'a4'));
});

test('admitted extreme patterns stay within export bounds for both paper formats',()=>{
 for(const waist of [50,150])for(const slant of [20,40,120])for(const hem of [Math.max(70,waist+5),300])for(const seam of [0,2.5])for(const allowanceHem of [0,5])for(const paper of ['a4','letter'] as const){if((hem-waist)/(2*Math.PI)>=slant)continue;const d={kind:'flared-skirt' as const,waist,hem,slant,allowances:{seam,hem:allowanceHem}},l=printing.tileLayout(d,paper),html=printing.tiledPatternHtml(d,paper);assert.ok(l.tiles.length<=256);assert.ok(new TextEncoder().encode(html).byteLength<2_000_000);assert.equal((html.match(/class="sheet"/g)||[]).length,l.tiles.length+1);assert.ok((l.columns-1)*(l.tileWidth-1)+l.tileWidth>=l.patternWidth);assert.ok((l.rows-1)*(l.tileHeight-1)+l.tileHeight>=l.patternHeight);}
});
