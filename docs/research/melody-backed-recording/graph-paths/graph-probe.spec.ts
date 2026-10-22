import{test,expect}from'@playwright/test';import{writeFile}from'node:fs/promises';
test('declared direct and MediaStream graph matrix',async({page},info)=>{
 test.setTimeout(120000);await page.goto('/tests/backed-audio-harness.html');await expect(page.locator('#audio-ready')).toHaveText('Real AudioWorklet harness ready');await page.locator('#audio-ready').click();
 const modes=['direct','same-context-stream','separate-context-stream']as const;
 for(let i=-1;i<5;i++)for(const mode of i===-1?['separate-context-stream']as const:Array.from({length:3},(_,j)=>modes[(i+j)%3])){
  const result=await page.evaluate(async({mode,silent})=>(window as unknown as{graphProbe300:(m:string,s:boolean)=>Promise<unknown>}).graphProbe300(mode,silent),{mode,silent:i===-1});await writeFile(info.outputPath(`${i===-1?'silent':i}-${mode}.json`),JSON.stringify(result));
  const r=result as{error:string|null;samples:number[]|null;complete:{startFrame:number;endFrame:number;channels:number};contextsClosed:boolean;tracksEnded:boolean;oscillatorStopped:boolean};expect(r.error).toBeNull();expect(r.samples).toHaveLength(88200);expect(r.complete.endFrame-r.complete.startFrame).toBe(88200);expect(r.complete.channels).toBe(2);expect(r.contextsClosed&&r.tracksEnded&&r.oscillatorStopped).toBe(true);
 }
});
