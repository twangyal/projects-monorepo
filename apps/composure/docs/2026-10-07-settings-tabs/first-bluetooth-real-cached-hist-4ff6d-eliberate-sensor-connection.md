# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: bluetooth.spec.ts >> real cached history return retains the heap and allows deliberate sensor connection
- Location: tests/browser/bluetooth.spec.ts:171:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: undefined

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Test source

```ts
  86  |     if(stage==='chooser')expect((await stats(page)).disconnects).toBe(0);
  87  |     await holdStage(page,stage,false);await connect(page);await calibrate(page);await expect(page.locator('#start')).toBeEnabled();
  88  |   });
  89  | }
  90  | 
  91  | test('pending notification start disconnects synchronously and serialized rejected cleanup cannot affect the next connection',async({page})=>{
  92  |   await setup(page,['start','stop']);await page.locator('#ble-connect').click();await expect.poll(async()=>(await stats(page)).pending).toEqual(['start']);
  93  |   await page.locator('#ble-cancel').click();expect((await stats(page)).disconnects).toBeGreaterThan(0);expect((await stats(page)).calls).not.toContain('stop');
  94  |   await releaseStage(page,'start');await expect.poll(async()=>(await stats(page)).pending).toEqual(['stop']);await expect(page.locator('#ble-connect')).toBeDisabled();
  95  |   await releaseStage(page,'stop',true);await expect(page.locator('#ble-connect')).toBeEnabled();expect((await stats(page)).maxConcurrent).toBe(1);
  96  |   await holdStage(page,'start',false);await holdStage(page,'stop',false);await connect(page);await calibrate(page);await page.locator('#start').click();expect((await report(page)).value.samples).toEqual([]);
  97  | });
  98  | 
  99  | test('one aggregate startup deadline retires a late connect with immediate physical cleanup and no automatic retry',async({page})=>{
  100 |   await setup(page,['connect']);await page.locator('#ble-connect').click();await expect.poll(async()=>(await stats(page)).pending).toEqual(['connect']);
  101 |   await page.clock.runFor(15000);await expect(page.locator('#ble-status')).toContainText(/time|wait|drain/i);expect((await stats(page)).disconnects).toBeGreaterThan(0);
  102 |   await expect(page.locator('#ble-connect')).toBeDisabled();await releaseStage(page,'connect');await expect(page.locator('#ble-connect')).toBeEnabled();
  103 |   await expect(page.locator('#ble-calibrate')).toBeDisabled();expect((await stats(page)).options).toHaveLength(1);expect((await stats(page)).maxConcurrent).toBe(1);
  104 | });
  105 | 
  106 | test('native chooser is not cancelled by blur, queued connected disconnect events are ignored, actual disconnection invalidates readiness',async({page})=>{
  107 |   await setup(page,['chooser']);await page.locator('#ble-connect').click();await expect.poll(async()=>(await stats(page)).pending).toEqual(['chooser']);
  108 |   await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await releaseStage(page,'chooser');await expect(page.locator('#ble-calibrate')).toBeEnabled();
  109 |   await calibrate(page);await connectionEvent(page,true);await expect(page.locator('#start')).toBeEnabled();
  110 |   await connectionEvent(page,false);await expect(page.locator('#start')).toBeDisabled();await expect(page.locator('#ble-connect')).toBeEnabled();
  111 |   await page.clock.runFor(30000);expect((await stats(page)).options).toHaveLength(1);await emit(page,[2,80]);await expect(page.locator('#start')).toBeDisabled();
  112 | });
  113 | 
  114 | test('changing next-source intent retires pending work and genuine pagehide disconnects without retaining identity',async({page})=>{
  115 |   await setup(page,['chooser']);await page.locator('#ble-connect').click();await expect.poll(async()=>(await stats(page)).pending).toEqual(['chooser']);
  116 |   await page.locator('#input-source').selectOption('simulated');await releaseStage(page,'chooser');await expect(page.getByRole('button',{name:'Calibrate & start',exact:true})).toBeEnabled();
  117 |   await page.locator('#input-source').selectOption('bluetooth-hr');await holdStage(page,'chooser',false);await connect(page);
  118 |   const before=await page.evaluate(()=>Number(sessionStorage.getItem('ble-fixture-disconnect-count')??0));
  119 |   await page.goto('/?after-native-pagehide');
  120 |   expect(await page.evaluate(()=>Number(sessionStorage.getItem('ble-fixture-disconnect-count')??0))).toBeGreaterThan(before);
  121 |   expect((await stats(page)).calls).toEqual([]);
  122 | });
  123 | 
  124 | test('fixed native failure messages and mobile keyboard connection never expose device identity or provider errors',async({page},testInfo)=>{
  125 |   await page.setViewportSize({width:390,height:844});await setup(page,[],['service']);await page.locator('#ble-connect').focus();await page.keyboard.press('Enter');
  126 |   await expect(page.locator('#ble-connect')).toBeEnabled();await expect(page.locator('#ble-calibrate')).toBeDisabled();
  127 |   expect(await page.locator('body').innerText()).not.toContain(PRIVATE_IDENTITY);expect(await page.locator('body').innerText()).not.toContain('RAW NATIVE');
  128 |   expect((await stats(page)).calls).toContain('service');expect((await stats(page)).identityReads).toBe(0);expect((await stats(page)).disconnects).toBeGreaterThan(0);
  129 |   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  130 |   await page.screenshot({path:testInfo.outputPath('mobile-bluetooth-failure.png'),fullPage:true});
  131 |   await page.locator('#input-source').selectOption('simulated');await page.locator('#start').click();await expect(page.locator('#phase')).toHaveText('In the corridor');
  132 | });
  133 | 
  134 | test('missing Bluetooth provider leaves the genuine simulator available with clear unsupported guidance',async({page})=>{
  135 |   await page.addInitScript(()=>Object.defineProperty(navigator,'bluetooth',{configurable:true,value:undefined}));await page.goto('/');await page.locator('#input-source').selectOption('bluetooth-hr');
  136 |   await expect(page.locator('#ble-connect')).toBeDisabled();await expect(page.locator('#ble-status')).toContainText(/unavailable|support|secure/i);
  137 |   await page.locator('#input-source').selectOption('simulated');await page.locator('#start').click();await expect(page.locator('#phase')).toHaveText('In the corridor');
  138 | });
  139 | 
  140 | for(const pending of [false,true]){
  141 |   test(`cached page suspension preserves the run and ${pending?'draining connection ownership':'explicit reconnection'}`,async({page})=>{
  142 |     await setup(page,pending?['connect']:[]);
  143 |     if(pending){
  144 |       await page.locator('#input-source').selectOption('simulated');await page.locator('#start').click();
  145 |       await page.locator('#input-source').selectOption('bluetooth-hr');await page.locator('#ble-connect').click();
  146 |       await expect.poll(async()=>(await stats(page)).pending).toContain('connect');
  147 |     }else{await startBle(page);await page.clock.runFor(1);await emit(page,[2,80]);}
  148 |     const before=(await report(page)).value;
  149 |     await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  150 |     await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  151 |     await expect(page.locator('#phase')).toHaveText('Paused');
  152 |     expect((await report(page)).value.samples).toEqual(before.samples);
  153 |     expect((await report(page)).value.source).toBe(before.source);
  154 |     if(pending){
  155 |       await expect(page.locator('#ble-connect')).toBeDisabled();
  156 |       await page.locator('#ble-connect').evaluate(node=>(node as HTMLButtonElement).click());
  157 |       expect((await stats(page)).options).toHaveLength(1);
  158 |       await holdStage(page,'connect',false);await releaseStage(page,'connect');
  159 |     }
  160 |     await expect(page.locator('#ble-connect')).toBeEnabled();
  161 |     await expect(page.locator('#start')).toBeDisabled();
  162 |     expect((await stats(page)).options).toHaveLength(1);
  163 |     expect((await stats(page)).listeners).toBe(0);
  164 |     await connect(page);await expect(page.locator('#start')).toBeDisabled();
  165 |     expect((await stats(page)).options).toHaveLength(2);
  166 |     expect((await stats(page)).maxConcurrent).toBe(1);
  167 |     expect((await stats(page)).identityReads).toBe(0);
  168 |   });
  169 | }
  170 | 
  171 | test('real cached history return retains the heap and allows deliberate sensor connection',async({baseURL})=>{
  172 |   const browser=await chromium.launch({channel:'chromium',ignoreDefaultArgs:['--disable-back-forward-cache'],...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  173 |   try{
  174 |     const context=await browser.newContext({baseURL});const page=await context.newPage();const pageErrors:string[]=[];
  175 |     page.on('pageerror',error=>pageErrors.push(error.message));
  176 |     // No native Bluetooth device is used: this tests Chromium page lifecycle,
  177 |     // then the existing controlled provider's explicit chooser boundary.
  178 |     await installBle(page);await page.goto('/');
  179 |     await page.locator('#input-source').selectOption('bluetooth-hr');await page.evaluate(()=>{
  180 |       const state={shown:false};Object.defineProperty(window,'cachedVisit',{value:state});
  181 |       window.addEventListener('pageshow',event=>{if(event.persisted)state.shown=true;});
  182 |     });
  183 |     await page.goto('/?away');
  184 |     // Cached restoration does not fire a new document load event.
  185 |     await page.goBack({waitUntil:'commit',timeout:10000});
> 186 |     await expect.poll(()=>page.evaluate(()=>(window as Window&{cachedVisit?:{shown:boolean}}).cachedVisit?.shown),{timeout:10000}).toBe(true);
      |                                                                                                                                    ^ Error: expect(received).toBe(expected) // Object.is equality
  187 |     await expect(page.locator('#input-source')).toHaveValue('bluetooth-hr');
  188 |     expect((await stats(page)).options).toHaveLength(0);
  189 |     await expect(page.locator('#ble-connect')).toBeEnabled();await connect(page);
  190 |     expect((await stats(page)).options).toHaveLength(1);expect((await stats(page)).identityReads).toBe(0);
  191 |     expect(pageErrors).toEqual([]);
  192 |   }finally{await browser.close();}
  193 | });
  194 | 
```