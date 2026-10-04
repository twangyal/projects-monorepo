import { createImageAsset, decodePixels, validateProject } from './model.ts';
import type { Comparison, Raster, Project, ImageAsset } from './types.ts';

function rgb(color: string): number[] { return [1,3,5].map(at=>parseInt(color.slice(at,at+2),16)); }
function luminance(color: number[]): number {
  const linear = color.map(c => { const s=c/255; return s<=.04045 ? s/12.92 : ((s+.055)/1.055)**2.4; });
  return .2126*linear[0]+.7152*linear[1]+.0722*linear[2];
}
export function renderComparison(project: Project): Comparison {
  const p=validateProject(project); const source=decodePixels(p.image); const s=p.settings;
  const width=source.width+2*s.border; const height=source.height+2*s.border;
  const baseline: Raster={width,height,rgba:new Uint8ClampedArray(width*height*4)};
  const result: Raster={width,height,rgba:new Uint8ClampedArray(width*height*4)};
  const colors=[rgb(s.colorA),rgb(s.colorB)]; const neutral=[128,128,128];
  const gray=luminance(neutral); const deltas=colors.map(color=>({
    square:color.reduce((sum,c)=>sum+(c-128)**2,0),
    max:Math.max(...color.map(c=>Math.abs(c-128))),
    luminance:Math.abs(luminance(color)-gray),
  }));
  const counts=[0,0];
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const at=(y*width+x)*4;
    if (x>=s.border && x<s.border+source.width && y>=s.border && y<s.border+source.height) {
      const start=((y-s.border)*source.width+x-s.border)*4;
      for (let channel=0;channel<4;channel++) baseline.rgba[at+channel]=result.rgba[at+channel]=source.rgba[start+channel];
    } else {
      const i=s.mode==='checker' ? (Math.floor(x/s.cellSize)+Math.floor(y/s.cellSize))%2 : 0;
      counts[i]++;
      for (let channel=0;channel<3;channel++) { baseline.rgba[at+channel]=128; result.rgba[at+channel]=colors[i][channel]; }
      baseline.rgba[at+3]=result.rgba[at+3]=255;
    }
  }
  const total=width*height; const surround=counts[0]+counts[1];
  return { baseline,result,metrics: {
    artworkChangedPixels:0,artworkMaxChannelDelta:0,surroundPixels:surround,totalPixels:total,
    rgbRmse:Math.sqrt((counts[0]*deltas[0].square+counts[1]*deltas[1].square)/(3*total)),
    maxRgbDelta:Math.max(...deltas.map((d,i)=>counts[i] ? d.max : 0)),
    meanAbsoluteLuminanceDelta:(counts[0]*deltas[0].luminance+counts[1]*deltas[1].luminance)/total,
  } };
}
export function createDemoImage(): ImageAsset {
  const rgba=new Uint8ClampedArray(128*128*4);
  for (let y=0;y<128;y++) for (let x=0;x<128;x++) {
    const i=(y*128+x)*4;
    const color=(x-64)**2+(y-64)**2<900 ? [239,85,93] : [2*x,2*y,255-x];
    rgba.set([...color,x<8 ? 0 : x<16 ? 64 : 255],i);
  }
  return createImageAsset({width:128,height:128,rgba},{fileName:'Procedural color study',format:'procedural',width:128,height:128});
}
