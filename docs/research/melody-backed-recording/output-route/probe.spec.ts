// Temporary fixed original-app diagnostic, never an alternative acceptance gate.
import {test,expect} from './helpers/expanded-workspace.ts';
import {writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {microphone,open,backup,awaitElapsed,released,probe,assertMicrophone} from './backed-recording-fixtures.ts';
for(let pair=0;pair<10;pair++)for(const route of pair%2?['disconnected','normal']:['normal','disconnected'])test(`pair ${pair} ${route}`,async({page},info)=>{
 test.setTimeout(45000);await microphone(page);await page.addInitScript(({route})=>{
  const state:{inputs:unknown[];messages:unknown[];bytes:number[]|null;complete:Record<string,unknown>|null;routes:string[]}={inputs:[],messages:[],bytes:null,complete:null,routes:[]};Object.defineProperty(window,'route300',{value:state});
  const connect=AudioBufferSourceNode.prototype.connect;
  AudioBufferSourceNode.prototype.connect=function(this:AudioBufferSourceNode,...args:Parameters<AudioNode['connect']>){if(!(this.context instanceof AudioContext))return Reflect.apply(connect,this,args);state.routes.push(args[0].constructor.name);if(route==='normal')return Reflect.apply(connect,this,args);return args[0];} as typeof connect;
  const Native=AudioWorkletNode;window.AudioWorkletNode=class extends Native{constructor(context:BaseAudioContext,name:string,options?:AudioWorkletNodeOptions){super(context,name,options);this.port.addEventListener('message',(event:MessageEvent)=>{const d=event.data;if(d?.type==='zero-input-route300'){state.inputs.push(d);event.stopImmediatePropagation();return;}if(d?.type==='complete'&&d.samples instanceof Float32Array){state.bytes=Array.from(new Uint8Array(d.samples.buffer,d.samples.byteOffset,d.samples.byteLength));state.complete={...d,samples:{frames:d.samples.length}};}else state.messages.push(d);});this.port.start();}};
 },{route});
 let error:string|null=null,qualityError:string|null=null,normalized:Record<string,unknown>|null=null,pcm:Buffer|null=null;
 try{await open(page);const before=await backup(page);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Record with backing',exact:true}).click();await awaitElapsed(page,2.4);await page.getByRole('button',{name:'Finish recording',exact:true}).click();await released(page);await expect(page.locator('#notice')).toContainText('Detected',{timeout:20000});
 const after=await backup(page);expect(after.document.composition.tracks.slice(1)).toEqual(before.document.composition.tracks.slice(1));for(const binding of before.document.references.filter(x=>x.trackId!=='target'))expect(after.assets.find(x=>x.id===binding.assetId)).toEqual(before.assets.find(x=>x.id===binding.assetId));const binding=after.document.references.find(x=>x.trackId==='target')!,asset=after.assets.find(x=>x.id===binding.assetId)!;pcm=Buffer.from(asset.pcmBase64,'base64');normalized={...asset,pcmBase64:undefined};try{assertMicrophone(asset);}catch(e){qualityError=String(e);}
 }catch(e){error=String(e);}
 const captured=await page.evaluate(()=>{const s=(window as unknown as {route300:{inputs:unknown[];messages:unknown[];bytes:number[]|null;complete:Record<string,unknown>|null;routes:string[]}}).route300;return{...s,notice:document.querySelector('#notice')?.textContent,capture:document.querySelector('#capture-state')?.textContent};});
 const observed=await probe(page);if(captured.bytes)await writeFile(info.outputPath('native.f32le.gz'),gzipSync(Buffer.from(captured.bytes)));if(pcm)await writeFile(info.outputPath('normalized.s16le.gz'),gzipSync(pcm));
 await writeFile(info.outputPath('receipt.json'),JSON.stringify({pair,route,error,qualityError,normalized,...captured,bytes:captured.bytes?{length:captured.bytes.length}:null,observed:{...observed,sources:observed.sources.map(x=>({...x,samples:{frames:x.samples.length}}))}},null,2));expect(error).toBeNull();expect(captured.routes).toHaveLength(5);expect(observed.stopped).toBe(1);expect(observed.released).toBe(true);
});
