// Temporary observational probe, not a product-quality gate. Removed after collection.
import {test,expect} from './helpers/expanded-workspace.ts';
import {writeFile} from 'node:fs/promises';
import {microphone,open,backup,awaitElapsed,released} from './backed-recording-fixtures.ts';
test('observe native Float32 gaps before normalized PCM conversion',async({page},info)=>{
 await microphone(page);
 await page.addInitScript(()=>{
  const Native=AudioWorkletNode;
  window.AudioWorkletNode=class extends Native{
   constructor(context:BaseAudioContext,name:string,options?:AudioWorkletNodeOptions){super(context,name,options);
    this.port.addEventListener('message',({data}:MessageEvent)=>{
     if(data?.type!=='complete'||!(data.samples instanceof Float32Array))return;
     const runs=[];let i=0;while(i<data.samples.length){if(data.samples[i]!==0){i++;continue;}let j=i+1;while(j<data.samples.length&&data.samples[j]===0)j++;if(j-i>=8)runs.push({start:i,endExclusive:j,frames:j-i});i=j;}
     Object.defineProperty(window,'raw300',{configurable:true,value:{sampleRate:data.sampleRate,frames:data.samples.length,startFrame:data.startFrame,endFrame:data.endFrame,exactZeroRunsAtLeast8Frames:runs}});
    });this.port.start();
   }
  };
 });
 await open(page);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Record with backing',exact:true}).click();await awaitElapsed(page,2.4);await page.getByRole('button',{name:'Finish recording',exact:true}).click();await released(page);await expect(page.locator('#notice')).toContainText('Detected',{timeout:20000});
 const raw=await page.evaluate(()=>(window as unknown as{raw300:unknown}).raw300);const after=await backup(page);const binding=after.document.references.find(r=>r.trackId==='target')!,asset=after.assets.find(a=>a.id===binding.assetId)!;const pcm=Buffer.from(asset.pcmBase64,'base64');const runs=[];let i=0;while(i<asset.frameCount){if(pcm.readInt16LE(i*2)!==0){i++;continue;}let j=i+1;while(j<asset.frameCount&&pcm.readInt16LE(j*2)===0)j++;if(j-i>=8)runs.push({start:i,endExclusive:j,frames:j-i});i=j;}
 let crossings=0;for(let i=2206;i<24255;i++)if(pcm.readInt16LE((i-1)*2)<=0&&pcm.readInt16LE(i*2)>0)crossings++;
 await writeFile(info.outputPath('native-vs-pcm.json'),JSON.stringify({raw,normalized:{sampleRate:22050,frames:asset.frameCount,sha256:asset.sha256,originalWindowCrossingHz:crossings,exactZeroRunsAtLeast8Frames:runs},qualityGateClaimed:false},null,2));
});
