export const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
export function multiply(a,b){
  const out=Array(16).fill(0);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];
  return out;
}
export const transform=(m,v)=>[0,1,2,3].map(r=>v.reduce((sum,x,c)=>sum+m[c*4+r]*x,0));
const normalize=v=>{const l=Math.hypot(...v);if(l<1e-9)throw Error('Degenerate camera');return v.map(x=>x/l);};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
export function lookAt(eye,target){
  const z=normalize(eye.map((v,i)=>v-target[i])),x=normalize(cross([0,1,0],z)),y=cross(z,x);
  return [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1];
}
export function perspective(fov,aspect,near,far){
  const f=1/Math.tan(fov*Math.PI/360),nf=1/(near-far);
  return [f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0];
}
export function modelMatrix(x,y,z,sx,sy,sz,roll=0){
  const c=Math.cos(roll),s=Math.sin(roll);
  return [c*sx,s*sx,0,0,-s*sy,c*sy,0,0,0,0,sz,0,x,y,z,1];
}
export function groundHit(origin,direction){
  if(direction[1]>=-1e-5)return null;
  const t=-origin[1]/direction[1],x=origin[0]+t*direction[0],z=origin[2]+t*direction[2];
  return t>0&&Math.abs(x)<=4&&Math.abs(z)<=4?[x,z]:null;
}
