import {test,expect} from './helpers/expanded-workspace.ts';
import {microphone,open,awaitElapsed,released} from './backed-recording-fixtures.ts';
import {writeFile} from 'node:fs/promises';
test('diagnostic protocol sees actual silent worklet input without reaching controller',async({page},info)=>{await microphone(page,false,true); await page.addInitScript(()=>{
  const inputBlocks:unknown[]=[];Object.defineProperty(window,'nativeInput300',{value:inputBlocks});
  const Native=AudioWorkletNode;
  window.AudioWorkletNode=class extends Native{
   constructor(context:BaseAudioContext,name:string,options?:AudioWorkletNodeOptions){super(context,name,options);
    this.port.addEventListener('message',(event:MessageEvent)=>{const {data}=event;if(data?.type==='diagnostic-input300'){inputBlocks.push(data);event.stopImmediatePropagation();return;}
     if(data?.type==='error')Object.defineProperty(window,'error300',{configurable:true,value:data});
     if(data?.type!=='complete'||!(data.samples instanceof Float32Array))return;
     const runs=[];let i=0;while(i<data.samples.length){if(data.samples[i]!==0){i++;continue;}let j=i+1;while(j<data.samples.length&&data.samples[j]===0)j++;if(j-i>=8)runs.push({start:i,endExclusive:j,frames:j-i});i=j;}
     Object.defineProperty(window,'nativeSamples300',{configurable:true,value:new Float32Array(data.samples)});
     Object.defineProperty(window,'raw300',{configurable:true,value:{sampleRate:data.sampleRate,frames:data.samples.length,startFrame:data.startFrame,endFrame:data.endFrame,exactZeroRunsAtLeast8Frames:runs}});
    });this.port.start();
   }
  };
 });await open(page);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Record with backing',exact:true}).click();await awaitElapsed(page,1.2);await page.getByRole('button',{name:'Finish recording',exact:true}).click();await released(page);await expect(page.locator('#notice')).toContainText('No clear notes');const blocks=await page.evaluate(()=>(window as unknown as{nativeInput300:unknown[]}).nativeInput300);expect(blocks.length).toBeGreaterThan(0);await writeFile(info.outputPath('silent-input-control.json'),JSON.stringify(blocks,null,2));});
