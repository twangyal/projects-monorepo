# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: complete-native-export.spec.js >> native output omission refuses publication and preserves saved authoring
- Location: tests/browser/complete-native-export.spec.js:5:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('#sequence-status')
Expected substring: "Encoder dropped video frames"
Received string:    "Encoding sequence WebM. Keep this tab visible. This is fresh rendering from editable scenes."
Timeout: 5000ms

Call log:
  - Expect "toContainText" locator('#sequence-status') with timeout 5000ms
  - waiting for locator('#sequence-status')
    14 × locator resolved to <p role="status" aria-live="polite" id="sequence-status">Encoding sequence WebM. Keep this tab visible. Th…</p>
       - unexpected value "Encoding sequence WebM. Keep this tab visible. This is fresh rendering from editable scenes."

```

```yaml
- status: Encoding sequence WebM. Keep this tab visible. This is fresh rendering from editable scenes.
```

# Test source

```ts
  1  | import {test,expect} from '@playwright/test';
  2  | import {sequenceStoredState} from './sequence-storage-fixtures.js';
  3  | 
  4  | // Controlled omission of one real encoded output tests admission, not overload.
  5  | test('native output omission refuses publication and preserves saved authoring',async({page})=>{
  6  |  await page.addInitScript(()=>{
  7  |   const Native=VideoEncoder;window.completeFrameTest={omitted:0,encoders:[]};
  8  |   window.VideoEncoder=class extends Native{
  9  |    constructor(init){
  10 |     super({...init,output:(chunk,metadata)=>{
  11 |      if(chunk.timestamp===33333){window.completeFrameTest.omitted++;return;}
  12 |      init.output(chunk,metadata);
  13 |     }});
  14 |     window.completeFrameTest.encoders.push(this);
  15 |    }
  16 |   };
  17 |  });
  18 |  await page.goto('/');
  19 |  await expect(page.locator('#sequence-save-status')).toHaveText('Sequence saved in this browser');
  20 |  await page.locator('#sequence-add-current').click();await page.locator('#sequence-add-shot').click();
  21 |  await expect(page.locator('#sequence-save-status')).toHaveText('Sequence saved in this browser');
  22 |  const ordinary=await page.evaluate(()=>localStorage.getItem('shot-studio-v1')),sequence=await sequenceStoredState(page);
  23 |  const downloads=[];page.on('download',file=>downloads.push(file.suggestedFilename()));
  24 |  await page.locator('#sequence-export').click();
> 25 |  await expect(page.locator('#sequence-status')).toContainText('Encoder dropped video frames');
     |                                                 ^ Error: expect(locator).toContainText(expected) failed
  26 |  await expect(page.locator('#sequence-export')).toBeEnabled();
  27 |  const native=await page.evaluate(()=>({omitted:completeFrameTest.omitted,states:completeFrameTest.encoders.map(e=>e.state)}));
  28 |  expect(native.omitted).toBe(1);expect(native.states.length).toBeGreaterThan(0);expect(native.states.every(s=>s==='closed')).toBe(true);
  29 |  expect(downloads).toEqual([]);
  30 |  expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe(ordinary);
  31 |  expect(await sequenceStoredState(page)).toEqual(sequence);
  32 | });
  33 | 
```