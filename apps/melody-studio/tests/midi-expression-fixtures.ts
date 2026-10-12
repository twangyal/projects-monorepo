export function midiControls(bytes:Uint8Array){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(String.fromCharCode(...bytes.slice(0,4))!=='MThd')throw new Error('Missing header');const ppqn=view.getUint16(12),tracks:{tick:number;channel:number;cc:number;value:number}[][]=[];let offset=14,count=0;
 for(let t=0;t<view.getUint16(10);t++){
  if(String.fromCharCode(...bytes.slice(offset,offset+4))!=='MTrk')throw new Error('Missing track');const end=offset+8+view.getUint32(offset+4);offset+=8;let tick=0;const controls:{tick:number;channel:number;cc:number;value:number}[]=[];
  const vlq=()=>{let n=0;for(let i=0;i<4;i++){if(offset>=end)throw new Error('Truncated');const b=bytes[offset++];n=n*128+(b&127);if(!(b&128))return n;}throw new Error('BadVLQ');};
  while(offset<end){tick+=vlq();count++;const status=bytes[offset++];if(status===255){offset++;const size=vlq();offset+=size;}else{const kind=status&240,a=bytes[offset++],b=kind===192||kind===208?0:bytes[offset++];if(kind===176)controls.push({tick,channel:status&15,cc:a,value:b});}if(offset>end)throw new Error('Track overflow');}
  tracks.push(controls);
 }
 if(offset!==bytes.length)throw new Error('Trailing bytes');return{ppqn,tracks,count};
}
