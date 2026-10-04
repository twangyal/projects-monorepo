import {test as base,expect,type Page} from '@playwright/test';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Snapshot} from '../../src/types';

export const IMAGE_WIDTH=64,IMAGE_HEIGHT=48;
export const IMAGE_CAPTION='<script>Original four-panel study</script>\nSupplied, not verified.';
// Original literal fixture and expectations frozen before media implementation:
// red/green upper quarters, opaque blue lower left, hidden-blue transparent lower
// right. White flattening makes ONLY that last quarter white. Interior pixels
// avoid JPEG boundary ringing; no production decoder/normalizer feeds this oracle.
export function originalPng(width=IMAGE_WIDTH,height=IMAGE_HEIGHT):Buffer{
  const crc=(bytes:Buffer)=>{let c=0xffffffff;for(const byte of bytes){c^=byte;for(let bit=0;bit<8;bit++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;};
  const chunk=(type:string,data:Buffer)=>{const kind=Buffer.from(type),length=Buffer.alloc(4),check=Buffer.alloc(4);length.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([kind,data])));return Buffer.concat([length,kind,data,check]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const raw=Buffer.alloc(height*(1+width*4));for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*(1+width*4)+1+x*4;const color=y<height/2?(x<width/2?[255,0,0,255]:[0,255,0,255]):(x<width/2?[0,0,255,255]:[0,0,255,0]);
    color.forEach((value,index)=>{raw[i+index]=value;});
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
export function checkNormalized(bytes:Buffer,width=IMAGE_WIDTH,height=IMAGE_HEIGHT,clockwise=false){
  const decoded=execFileSync('python3',['-c',"import sys;from PIL import Image;from io import BytesIO;im=Image.open(BytesIO(sys.stdin.buffer.read()));assert im.format=='JPEG';assert im.mode=='RGB';print('%d %d'%im.size);sys.stdout.flush();sys.stdout.buffer.write(im.tobytes())"],{input:bytes,maxBuffer:4*1024**2,timeout:10000});
  const newline=decoded.indexOf(10);expect(decoded.subarray(0,newline).toString()).toBe(`${width} ${height}`);const rgb=decoded.subarray(newline+1);expect(rgb.length).toBe(width*height*3);
  const colors=clockwise?[[0,0,255],[255,0,0],[255,255,255],[0,255,0]]:[[255,0,0],[0,255,0],[0,0,255],[255,255,255]];
  const samples=[[.25,.25,colors[0]],[.75,.25,colors[1]],[.25,.75,colors[2]],[.75,.75,colors[3]]] as const;
  for(const [fx,fy,expected] of samples){const index=(Math.floor(height*fy)*width+Math.floor(width*fx))*3;for(let channel=0;channel<3;channel++)expect(Math.abs(rgb[index+channel]-expected[channel])).toBeLessThanOrEqual(12);}
  return{width,height,bytes:bytes.length,sha256:hash(bytes)};
}
export async function credentials(page:Page){
  await expect.poll(()=>new URL(page.url()).searchParams.get('challenge')).toMatch(/^[a-f0-9]{32}$/);
  const id=new URL(page.url()).searchParams.get('challenge')!;
  const read=()=>page.evaluate(id=>(JSON.parse(localStorage.getItem('friendly-challenges.sessions.v1')||'{}') as Record<string,string>)[id],id);
  await expect.poll(read).toMatch(/^[a-f0-9]{64}$/);return{id,token:await read()};
}
export async function snapshot(page:Page):Promise<Snapshot>{const{id,token}=await credentials(page);const response=await page.request.get(`/api/challenges/${id}`,{headers:{Authorization:`Bearer ${token}`}});expect(response.status()).toBe(200);return response.json() as Promise<Snapshot>;}
export async function revision(page:Page){const state=await snapshot(page);await expect(page.locator('#challenge-revision')).toContainText(`Revision ${state.revision} ·`);return state.revision;}
export async function propose(page:Page,title='Original image evidence'){
  await page.goto('/');const form=page.locator('#create-form');await form.locator('[name=name]').fill('Alex');await form.locator('[name=title]').fill(title);
  await form.locator('[name=description]').fill('Finish the original four-panel color study.');await form.locator('[name=successCriteria]').fill('Share our completed studies before the deadline.');await form.locator('[name=evidenceRule]').fill('Supply a caption and an optional image of the work.');await form.locator('[name=stake]').selectOption('pick-a-movie');await form.locator('[name=deadline]').fill(new Date(Date.now()+86400000).toISOString().slice(0,16));
  await form.getByRole('button',{name:'Propose challenge',exact:true}).click();await expect(page.locator('#shared-link')).toHaveValue(/#invite=[a-f0-9]{64}$/);return page.locator('#shared-link').inputValue();
}
export async function claim(page:Page,link:string,arbiter=false){await page.goto(link);await expect.poll(()=>new URL(page.url()).hash).toBe('');await page.locator('#claim-form [name=name]').fill(arbiter?'Taylor':'Sam');await page.getByRole('button',{name:arbiter?'Claim arbiter seat':'Claim opponent seat',exact:true}).click();await expect.poll(async()=>(await snapshot(page)).myRole).toBe(arbiter?'arbiter':'opponent');}
export async function accept(page:Page){page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Accept these terms',exact:true}).click();await expect.poll(async()=>(await snapshot(page)).status).toBe('active');}

// Observe genuine native Blob publication without fetching blob: through connect-src.
// The browser still decodes the actual image; no payload or app state is replaced.
async function observeImageBlobs(page:Page){await page.evaluate(()=>{
  const target=window as unknown as {nativeImageBlobs?:Map<string,Blob>};if(target.nativeImageBlobs)return;
  const blobs=new Map<string,Blob>();target.nativeImageBlobs=blobs;const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
  URL.createObjectURL=object=>{const url=create(object);if(object instanceof Blob)blobs.set(url,object);return url;};
  URL.revokeObjectURL=url=>{blobs.delete(url);revoke(url);};
});}
export async function displayedImageBytes(image:import('@playwright/test').Locator){return Buffer.from(await image.evaluate(async element=>{
  const img=element as HTMLImageElement;await img.decode();const blob=(window as unknown as {nativeImageBlobs:Map<string,Blob>}).nativeImageBlobs.get(img.src);
  if(!blob)throw Error('Displayed image was not published from a captured native Blob.');return [...new Uint8Array(await blob.arrayBuffer())];
}));}
export interface ImageDescriptor {mime:'image/jpeg';bytes:number;width:number;height:number;sha256:string}
export async function chooseImage(page:Page,caption=IMAGE_CAPTION,png=originalPng(),mimeType='image/png'){
  await observeImageBlobs(page);await revision(page);await page.locator('#evidence-form [name=text]').fill(caption);
  await page.locator('#evidence-image').setInputFiles({name:mimeType==='image/jpeg'?'oriented-study.jpg':'original-study.png',mimeType,buffer:png});
  await expect(page.locator('#add-image-evidence')).toBeEnabled({timeout:15000});
  await expect(page.locator('#evidence-image-preview')).toBeVisible();
  return displayedImageBytes(page.locator('#evidence-image-preview'));
}
export async function submitImage(page:Page){
  const count=(await snapshot(page)).evidence.length;await revision(page);await page.locator('#add-image-evidence').click();
  await expect.poll(async()=>(await snapshot(page)).evidence.length).toBe(count+1);
  const entry=(await snapshot(page)).evidence.at(-1)!;expect('image' in entry).toBe(true);
  return entry as typeof entry&{image:ImageDescriptor};
}
export async function retainedBytes(page:Page,evidenceId:string){
  const{id,token}=await credentials(page);const response=await page.request.get(`/api/challenges/${id}/evidence/${evidenceId}/image`,{headers:{Authorization:`Bearer ${token}`}});
  expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('image/jpeg');expect(response.headers()['cache-control']).toContain('no-store');return response.body();
}
export async function viewImage(page:Page,evidenceId:string){
  await observeImageBlobs(page);
  const row=page.locator(`[data-evidence-id="${evidenceId}"]`);await expect(row).toBeVisible();
  await row.getByRole('button',{name:'View retained image',exact:true}).click();
  const image=row.getByAltText('Retained normalized evidence image',{exact:true});await expect(image).toBeVisible();
  return displayedImageBytes(image);
}
export function uploadFrame(revision:number,jpeg:Buffer,text:string){const metadata=Buffer.from(JSON.stringify({revision,text,url:null}));const header=Buffer.alloc(16);header.write('FCEVID01');header.writeUInt32LE(metadata.length,8);header.writeUInt32LE(jpeg.length,12);return Buffer.concat([header,metadata,jpeg]);}
export async function command(page:Page,action:string,payload:Record<string,unknown>){const{id,token}=await credentials(page);return page.request.post(`/api/challenges/${id}/${action}`,{headers:{Authorization:`Bearer ${token}`},data:{revision:(await snapshot(page)).revision,...payload}});}

export interface ImageService {url:string;restart():Promise<void>}
const serverCode=`import sys,signal,threading
from pathlib import Path
from challenges.server import create_server
server=create_server(Path(sys.argv[1]),port=int(sys.argv[2]))
print(server.server_address[1],flush=True)
signal.signal(signal.SIGTERM,lambda *_:threading.Thread(target=server.shutdown,daemon=True).start())
try:server.serve_forever(poll_interval=.05)
finally:server.server_close()
`;
async function launchService(directory:string,port=0){
  const child=spawn('python3',['-u','-c',serverCode,directory,String(port)],{cwd:fileURLToPath(new URL('../../',import.meta.url)),stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stderr.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString()).slice(-65536);});
  const actual=await new Promise<number>((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Independent service startup timed out.'));},10000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(Error(`Service exited ${code}: ${stderr}`));});
    child.stdout.on('data',(chunk:Buffer)=>{stdout+=chunk.toString();if(stdout.includes('\n')){const value=Number(stdout.split('\n')[0]);clearTimeout(timer);if(Number.isInteger(value)&&value>0)resolve(value);else reject(Error('Service did not provide a port.'));}});
  });
  return{port:actual,async stop(){if(child.exitCode!==null)return;await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Independent service failed to stop.'));},10000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});}};
}
export const imageTest=base.extend<{imageService:ImageService}>({
  // Playwright requires destructuring even when this isolated fixture has no dependencies.
  // eslint-disable-next-line no-empty-pattern
  imageService:async({},use)=>{const directory=await mkdtemp(join(tmpdir(),'friendly87-native-'));let server=await launchService(directory);const port=server.port;
    try{await use({url:`http://127.0.0.1:${port}`,async restart(){await server.stop();server=await launchService(directory,port);}});}
    finally{await server.stop();await rm(directory,{recursive:true,force:true});}
  },
  baseURL:async({imageService},use)=>{await use(imageService.url);},
});

export function orientedJpeg(){return execFileSync('python3',['-c',"import sys;from PIL import Image;im=Image.new('RGB',(40,60));colors=[(255,0,0),(0,255,0),(0,0,255),(255,255,255)];im.putdata([colors[(y>=30)*2+(x>=20)] for y in range(60) for x in range(40)]);exif=Image.Exif();exif[274]=6;im.save(sys.stdout.buffer,format='JPEG',quality=100,subsampling=0,exif=exif)"],{maxBuffer:64*1024,timeout:10000});}
