import { writeFileSync } from 'node:fs';
import { encodePng } from '../src/png.ts';
for (const size of [2,976]) {
  const rgba=new Uint8ClampedArray(size*size*4);
  for(let i=0;i<rgba.length;i++) rgba[i]=(i*73+19)%256;
  rgba[3]=0;
  writeFileSync(`/tmp/color-context-${size}.png`,encodePng({width:size,height:size,rgba}));
  writeFileSync(`/tmp/color-context-${size}.rgba`,rgba);
}
