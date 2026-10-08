import { test, expect, type Page } from '@playwright/test';
type Result = { rate:number;sourceFrame:number;startFrame:number;requestedEnd:number;messages:Record<string,unknown>[];samples:number[]|null;maximumOutput:number;closed:boolean;sourceStops:number;initialReadyCount:number };
type Harness = { configure(options:{rate:number;mode:string;channels?:number}):void;state():{running:boolean;result:Result|null;failure:string|null};settled():Promise<void>|null };
async function capture(page:Page,mode:string,rate=44100,channels=2):Promise<Result>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/tests/backed-audio-harness.html');
  await expect(page.locator('#audio-ready')).toHaveText('Real AudioWorklet harness ready');
  await page.evaluate(options=>(window as unknown as {backedAudioHarness:Harness}).backedAudioHarness.configure(options),{mode,rate,channels});
  await page.locator('#run-audio').click();
  await page.evaluate(()=>(window as unknown as {backedAudioHarness:Harness}).backedAudioHarness.settled());
  const state=await page.evaluate(()=>(window as unknown as {backedAudioHarness:Harness}).backedAudioHarness.state());
  expect(state.failure).toBeNull();expect(state.running).toBe(false);expect(errors).toEqual([]);expect(state.result).not.toBeNull();
  const result=state.result!;expect(result.closed).toBe(true);expect(result.sourceStops).toBeGreaterThan(0);return result;
}
function exactSamples(result:Result,channels=2){
  const first=result.startFrame-result.sourceFrame;
  const expected=Array.from({length:result.requestedEnd-result.startFrame},(_,j)=>{
    const x=(((first+j)%29)-14)/32,y=(((first+j)%31)-15)/64;
    return channels===1?x:(x+y)/2;
  });
  expect(result.samples).toEqual(expected);
  const complete=result.messages.filter(m=>m.type==='complete');expect(complete).toHaveLength(1);
  expect(complete[0]).toMatchObject({startFrame:result.startFrame,endFrame:result.requestedEnd,sampleRate:result.rate,channels});
  expect(result.messages.filter(m=>m.type==='error')).toEqual([]);
  expect(result.maximumOutput).toBe(0);
}
for(const rate of [44100,48000])test(`actual ${rate} Hz worklet keeps exact graph-frame stereo interval and excludes count-in`,async({page})=>{
  const result=await capture(page,'exact',rate);exactSamples(result);expect(result.samples).toHaveLength(1003);
});
test('real worklet delayed Finish trims to requested end without message-delivery tail',async({page})=>{exactSamples(await capture(page,'finish'));});
test('real worklet waits for initial input, then retains exact mono frames',async({page})=>{const result=await capture(page,'initially-missing',48000,1);expect(result.initialReadyCount).toBe(0);exactSamples(result,1);});
for(const mode of ['missing','topology','duplicate-arm'])test(`real worklet refuses ${mode} without returning a partial take`,async({page})=>{
  const result=await capture(page,mode);expect(result.samples).toBeNull();expect(result.messages.filter(m=>m.type==='error')).toHaveLength(1);expect(result.messages.filter(m=>m.type==='complete')).toHaveLength(0);
});
test('real worklet Cancel during count-in produces no captured samples',async({page})=>{
  const result=await capture(page,'cancel');expect(result.samples).toBeNull();expect(result.messages.filter(m=>m.type==='complete')).toHaveLength(0);expect(result.maximumOutput).toBe(0);
});
test('real worklet progress is bounded numeric telemetry with no audio chunks',async({page})=>{
  const result=await capture(page,'progress');exactSamples(result);
  const progress=result.messages.filter(m=>m.type==='progress');expect(progress.length).toBeGreaterThan(0);
  // Four137BPM beats plus1.25seconds; allow initial/final boundary notices.
  expect(progress.length).toBeLessThanOrEqual(33);
  let captured=-1;
  for(const entry of progress){expect(Object.keys(entry).sort()).toEqual(['framesCaptured','phase','type']);expect(['counting-in','recording']).toContain(entry.phase);expect(Number.isSafeInteger(entry.framesCaptured)).toBe(true);expect(Number(entry.framesCaptured)).toBeGreaterThanOrEqual(captured);expect(Number(entry.framesCaptured)).toBeLessThanOrEqual(result.requestedEnd-result.startFrame);captured=Number(entry.framesCaptured);}
});
