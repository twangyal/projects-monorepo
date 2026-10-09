import {validateConstruction,patternGeometry,type SkirtDraft} from './construction.ts';
export interface Vertex {x:number;y:number;z:number}
/** Open rigid shell: two joined 16-face panels, no cloth or body simulation. */
export function skirtMesh(input:SkirtDraft){
 const d=validateConstruction(input),h=patternGeometry(d).height,vertices:Vertex[]=[],faces:number[][]=[];
 for(const [radius,y] of [[d.waist/(2*Math.PI),0],[d.hem/(2*Math.PI),h]])for(let i=0;i<32;i++){const angle=2*Math.PI*i/32;vertices.push({x:radius*Math.cos(angle),y,z:radius*Math.sin(angle)});}
 for(let i=0;i<32;i++){const j=(i+1)%32;faces.push([i,i+32,j+32,j]);}
 return {vertices,faces,seams:[[0,32],[16,48]],height:h};
}
const n=(v:number)=>String(Math.round(v*1e4)/1e4);
export function shellSvg(input:SkirtDraft,yaw:number,color:string):string{
 if(!Number.isFinite(yaw)||Math.abs(yaw)>360)throw new Error('View rotation must be finite from -360 to 360 degrees.');
 if(!/^#[0-9a-fA-F]{6}$/.test(color))throw new Error('Shell color must be a six-digit hex color.');
 const d=validateConstruction(input),mesh=skirtMesh(d),angle=yaw*Math.PI/180,tilt=20*Math.PI/180,scale=240/Math.max(d.hem/Math.PI,mesh.height);
 const projected=mesh.vertices.map(v=>{const x=v.x*Math.cos(angle)-v.z*Math.sin(angle),z=v.x*Math.sin(angle)+v.z*Math.cos(angle),y=v.y-mesh.height/2;return {x:240+x*scale,y:180+(y*Math.cos(tilt)-z*Math.sin(tilt))*scale,depth:y*Math.sin(tilt)+z*Math.cos(tilt)}});
 const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
 const faces=mesh.faces.map((indices,index)=>({indices,index,depth:indices.reduce((s,i)=>s+projected[i].depth,0)/4})).sort((a,b)=>a.depth-b.depth||a.index-b.index).map(face=>{
  const light=.65+.3*(.5+.5*Math.cos(2*Math.PI*(face.index+.5)/32+angle-.7)),fill=`#${rgb.map(c=>Math.round(c*light).toString(16).padStart(2,'0')).join('')}`;
  return `<polygon data-face="${face.index}" data-panel="${face.index<16?'front':'back'}" points="${face.indices.map(i=>`${n(projected[i].x)},${n(projected[i].y)}`).join(' ')}" fill="${fill}" stroke="#fff9ef" stroke-width="0.5"/>`;
 }).join('');
 const seams=mesh.seams.map(([a,b],index)=>`<line data-seam="${index}" x1="${n(projected[a].x)}" y1="${n(projected[a].y)}" x2="${n(projected[b].x)}" y2="${n(projected[b].y)}" stroke="#aa4f13" stroke-width="2" stroke-dasharray="5 4"/>`).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360" role="img" aria-label="Rigid skirt construction at ${yaw} degrees"><title>Two-panel rigid construction preview, no cloth or body simulation</title>${faces}${seams}</svg>`;
}
/** OBJ is unitless; the header explicitly records cm and the downward +Y axis. */
export function shellObj(input:SkirtDraft):string{
 const mesh=skirtMesh(input),coordinate=(v:number)=>String(Math.round(v*1e6)/1e6);
 const lines=['# Units: centimetres. Waist-center origin; +Y points toward hem.','# Open rigid construction shell; no allowances, thickness, materials, body or cloth simulation.',...mesh.vertices.map(v=>`v ${coordinate(v.x)} ${coordinate(v.y)} ${coordinate(v.z)}`)];
 mesh.faces.forEach((face,i)=>{if(i===0||i===16)lines.push(`g ${i===0?'Front':'Back'}_Panel`);lines.push(`f ${face.map(index=>index+1).join(' ')}`);});
 mesh.seams.forEach(([a,b],i)=>lines.push(`g Side_Seam_${i===0?'A':'B'}`,`l ${a+1} ${b+1}`));return lines.join('\n')+'\n';
}
