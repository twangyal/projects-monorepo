import {test,expect} from './helpers/expanded-workspace.ts';
import {writeFile} from 'node:fs/promises';import{createHash}from'node:crypto';
import{microphone,open,backup,awaitElapsed,released,probe}from'./backed-recording-fixtures.ts';
import{installTerminalObserver}from'./terminal300-observer.ts';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
for(let row=0;row<10;row++)test(`original startup stop and pagehide ${row}`,async({page},info)=>{
 test.setTimeout(45000);await microphone(page);await page.addInitScript(installTerminalObserver);
 let stage='open',error:string|null=null,beforeHash:string|null=null,afterHash:string|null=null;
 const begin=async()=>{const requests=(await probe(page)).requests;page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Record with backing',exact:true}).click();await expect.poll(async()=>(await probe(page)).requests).toBe(requests+1);};
 try{await open(page);beforeHash=digest(await backup(page));stage='begin-stop';await begin();stage='elapsed-stop';await awaitElapsed(page,.2);stage='stop';await page.getByRole('button',{name:'Stop playback',exact:true}).click();await released(page);stage='backup-stop';expect(digest(await backup(page))).toBe(beforeHash);
 stage='begin-pagehide';await begin();stage='elapsed-pagehide';await awaitElapsed(page,.2);stage='pagehide';await page.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});await released(page);await expect(page.getByRole('button',{name:'Record with backing',exact:true})).toBeEnabled();afterHash=digest(await backup(page));expect(afterHash).toBe(beforeHash);stage='complete';
 }catch(e){error=String(e);}
 const captured=await page.evaluate(()=>({...(window as unknown as{terminal300:Record<string,unknown>}).terminal300,notice:document.querySelector('#notice')?.textContent,captureState:document.querySelector('#capture-state')?.textContent}));
 const observed=await probe(page);await writeFile(info.outputPath('receipt.json'),JSON.stringify({row,stage,error,beforeHash,afterHash,captured,observed:{...observed,elapsed:Number.isFinite(observed.elapsed)?observed.elapsed:String(observed.elapsed),sources:observed.sources.map(({samples,...source})=>({...source,samples:{frames:samples.length}}))}},null,2));expect(error).toBeNull();expect(stage).toBe('complete');expect(observed.stopped).toBe(2);expect(observed.released).toBe(true);
});
for(const rate of[44100,48000])test(`native terminal protocol control ${rate}`,async({page},info)=>{
 await page.goto('/tests/backed-audio-harness.html');await expect(page.locator('#audio-ready')).toContainText('ready');
 await page.evaluate(rate=>(window as unknown as{backedAudioHarness:{configure(o:unknown):void}}).backedAudioHarness.configure({rate,mode:'invalid-command'}),rate);
 await page.locator('#run-audio').click();await page.evaluate(()=>(window as unknown as{backedAudioHarness:{settled():Promise<void>}}).backedAudioHarness.settled());
 const result=await page.evaluate(()=>(window as unknown as{backedAudioHarness:{state():{failure:string|null;result:{messages:Record<string,unknown>[];samples:unknown;closed:boolean}}}}).backedAudioHarness.state());await writeFile(info.outputPath('control.json'),JSON.stringify({rate,...result},null,2));expect(result.failure).toBeNull();expect(result.result.closed).toBe(true);expect(result.result.samples).toBeNull();const messages=result.result.messages;const at=messages.findIndex(m=>m.type==='terminal-clock-research300');expect(at).toBeGreaterThan(-1);expect(messages[at]).toMatchObject({reason:'invalid-command',ready:true,armed:true,sampleRate:rate,receipt:null});expect(messages[at+1]).toEqual({type:'error',reason:'invalid-command'});
});
