# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: bluetooth.spec.ts >> five actual spaced packets drive a real keyboard escape and private source-labeled JSON without changing simulated best
- Location: tests/browser/bluetooth.spec.ts:20:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: null
Received: "{\"schemaVersion\":1,\"baseline\":70,\"scares\":false,\"reducedMotion\":false,\"muted\":true,\"bestSeconds\":null}"
```

# Page snapshot

```yaml
- main [ref=e3]:
  - generic [ref=e4]:
    - paragraph [ref=e5]: A SMALL OBSERVATORY / A LONG NIGHT
    - heading "Composure." [level=1] [ref=e6]
    - paragraph [ref=e7]: Restore the lights. Find the key. Keep your hands steady long enough to open the exit. The watcher listens when you hurry.
    - generic [ref=e8]: SIMULATOR AVAILABLE · OPTIONAL BLUETOOTH INPUT
  - generic [ref=e9]:
    - generic [ref=e10]:
      - region "Observatory escape game" [ref=e11]:
        - generic [ref=e12]:
          - heading "The sealed corridor" [level=2] [ref=e13]
          - generic [ref=e14]: Escaped
        - generic "Escape corridor. Use WASD or arrows to move, E to interact, Shift to steady. Pointer aiming is optional." [ref=e16]
        - generic [ref=e17]:
          - generic [ref=e18]:
            - generic [ref=e19]: Active time remaining
            - strong [ref=e20]: 165 s
          - generic [ref=e21]:
            - generic [ref=e22]: Received Bluetooth heart rate
            - strong [ref=e23]: stale sample · neutral fallback
          - generic [ref=e24]:
            - generic [ref=e25]: Game tension
            - strong [ref=e26]: 0%
            - meter "Game tension" [ref=e27]
          - generic [ref=e28]:
            - generic [ref=e29]: Noise / watcher attention
            - strong [ref=e30]: 1 / 100
            - meter "Watcher attention" [ref=e31]
          - generic [ref=e32]:
            - generic [ref=e33]: Lock progress
            - strong [ref=e34]: 100%
            - progressbar "Exit lock progress" [ref=e35]
          - generic [ref=e36]:
            - generic [ref=e37]: Position / nearby object
            - strong [ref=e38]: 1163, 162
            - generic [ref=e39]: Exit · aim error 0.0 / 18
        - paragraph [ref=e40]: "Current run source: Bluetooth heart-rate notifications (hardware unverified)"
        - generic [ref=e41]:
          - button "Start Bluetooth run" [disabled] [ref=e42]
          - button "Pause" [disabled] [ref=e43]
          - button "Restart" [ref=e44] [cursor=pointer]
          - button "Download run report" [active] [ref=e45] [cursor=pointer]
        - generic [ref=e46]:
          - button "Hold to interact" [disabled] [ref=e47]
          - 'button "Steady: off" [disabled] [ref=e48]'
          - button "Keyboard aim" [pressed] [ref=e49] [cursor=pointer]
        - generic "Movement controls" [ref=e50]:
          - button "Move up" [ref=e51] [cursor=pointer]: ↑
          - button "Move left" [ref=e52] [cursor=pointer]: ←
          - button "Move down" [ref=e53] [cursor=pointer]: ↓
          - button "Move right" [ref=e54] [cursor=pointer]: →
        - status [ref=e55]: You escaped the observatory.
      - paragraph [ref=e56]: "WASD / arrows: move · E: hold to interact · Shift: steady and move quietly. Stand near an object; hold the lock for four steady seconds. Click the corridor to use pointer aim, or choose Keyboard aim. Touch players can use the arrows and interaction button."
    - complementary [ref=e57]:
      - generic [ref=e58]:
        - heading "Choose your input" [level=2] [ref=e59]
        - generic [ref=e60]:
          - text: Next run source
          - combobox "Next run source" [ref=e61]:
            - option "Simulator"
            - option "Bluetooth heart-rate sensor" [selected]
        - paragraph [ref=e62]: The current run keeps its original source. Changing this choice prepares another run.
        - generic [ref=e63]:
          - button "Connect heart-rate sensor" [disabled] [ref=e64]
          - button "Cancel connection" [disabled] [ref=e65]
          - button "Disconnect sensor" [ref=e66] [cursor=pointer]
          - button "Collect baseline" [ref=e67] [cursor=pointer]
        - paragraph [ref=e68]: Receiving standard heart-rate notifications. Device compatibility and accuracy are unverified.
        - paragraph [ref=e69]: "Baseline used: 80 BPM from 5/5 received readings. Collect a new baseline to start another Bluetooth run."
        - paragraph [ref=e70]: Requires a secure context and a compatible browser and standard Heart Rate sensor. Firefox, Safari/iOS and Android WebView are unsupported; Linux Chromium may need platform setup. The browser chooser requires your consent. Cancel retires this request but may leave the native chooser open.
        - paragraph [ref=e71]: Device compatibility and reading accuracy are unverified. Energy and RR data are ignored. This game does not infer emotion or health.
      - generic [ref=e72]:
        - heading "Simulated signal" [level=2] [ref=e73]
        - group "Simulator inputs" [ref=e74]:
          - generic [ref=e76]:
            - text: Resting baseline
            - spinbutton "Resting baseline BPM" [disabled] [ref=e77]: "70"
            - text: BPM
          - generic [ref=e78]:
            - text: Current reading
            - slider "Current reading" [disabled] [ref=e79]: "70"
          - status [ref=e80]: 70 BPM (simulated)
          - generic [ref=e81]:
            - checkbox "Send simulated reading each active second" [checked] [disabled] [ref=e82]
            - text: Send simulated reading each active second
          - button "Send one simulated sample" [disabled] [ref=e83]
        - paragraph [ref=e84]: Calibration uses five declared simulated baseline values. It does not measure a person. Old or missing samples smoothly return the game to neutral after ten active seconds.
      - generic [ref=e85]:
        - heading "Your route" [level=2] [ref=e86]
        - list [ref=e87]:
          - listitem [ref=e88]: Take the fuse from the upper shelf (250, 110).
          - listitem [ref=e89]: Restore the lower power panel (520, 230).
          - listitem [ref=e90]: Take the key from the upper shelf (740, 110).
          - listitem [ref=e91]: Steady the exit lock (1030, 160), then reach the exit (1160, 160).
        - paragraph [ref=e92]: Higher admitted readings slow movement, increase noise and shake aim. Steady reduces jitter and movement noise. Noise at 100 or 180 active seconds ends a run.
      - generic [ref=e93]:
        - heading "Comfort & preferences" [level=2] [ref=e94]
        - generic [ref=e95]:
          - checkbox "One authored window scare" [ref=e96]
          - text: One authored window scare
        - generic [ref=e97]:
          - checkbox "Reduced visual motion" [ref=e98]
          - text: Reduced visual motion
        - generic [ref=e99]:
          - checkbox "Mute optional sound" [checked] [ref=e100]
          - text: Mute optional sound
        - button "Save preferences" [ref=e101] [cursor=pointer]
        - paragraph [ref=e102]: No completed best time.
        - status [ref=e103]: Preferences saved locally. No simulated sample log was stored.
        - paragraph [ref=e104]: Only simulator preferences and simulated best completion time save locally. All run samples/events stay in memory until you choose to download a report.
  - generic [ref=e105]: "Original local prototype for project #17 · Simulator values are declared; Bluetooth values come from received standard heart-rate notifications. Neither establishes emotions or health. The browser connection flow is available; physical-device compatibility, measurement accuracy and watch verification remain unverified."
```

# Test source

```ts
  1   | import {test,expect,chromium,type Page} from '@playwright/test';
  2   | import {PRIVATE_IDENTITY,installBle,setup,connect,calibrate,startBle,emit,stats,releaseStage,holdStage,connectionEvent,report,move,interact,position,type Stage} from './bluetooth-fixtures.ts';
  3   | 
  4   | const errors=new WeakMap<Page,string[]>();
  5   | test.beforeEach(({page})=>{const collected:string[]=[];errors.set(page,collected);page.on('pageerror',error=>collected.push(error.message));});
  6   | test.afterEach(({page})=>{expect(errors.get(page)).toEqual([]);});
  7   | 
  8   | test('Bluetooth source requires explicit native connection and received calibration',async({page})=>{
  9   |   await setup(page);await expect(page.getByRole('combobox',{name:'Next run source',exact:true})).toBeVisible({timeout:2000});
  10  |   await expect(page.getByRole('button',{name:'Connect heart-rate sensor',exact:true})).toBeEnabled();
  11  |   await expect(page.getByRole('button',{name:'Start Bluetooth run',exact:true})).toBeDisabled();
  12  |   await connect(page);expect((await stats(page)).options).toEqual([{filters:[{services:['heart_rate']}]}]);
  13  |   await page.locator('#ble-calibrate').click();await expect(page.locator('#ble-calibration')).toContainText(/0\s*\/\s*5/);
  14  |   // The characteristic begins with cached value [0x02,70]; it must not count.
  15  |   await page.clock.runFor(1000);await expect(page.locator('#start')).toBeDisabled();
  16  |   await emit(page,[2,70]);await expect(page.locator('#ble-calibration')).toContainText(/1\s*\/\s*5/);
  17  |   expect((await stats(page)).identityReads).toBe(0);
  18  | });
  19  | 
  20  | test('five actual spaced packets drive a real keyboard escape and private source-labeled JSON without changing simulated best',async({page},testInfo)=>{
  21  |   await setup(page);await page.locator('#save').click();const before=await page.evaluate(()=>localStorage.getItem('composure-settings-v1'));
  22  |   await startBle(page);await expect(page.locator('#run-source')).toContainText(/bluetooth/i);await expect(page.locator('#baseline')).toHaveValue('70');
  23  |   expect((await report(page)).value.samples).toEqual([]);await page.clock.runFor(1);await emit(page,[2,80]);
  24  |   await page.screenshot({path:testInfo.outputPath('desktop-bluetooth-run.png'),fullPage:true});
  25  |   await page.locator('canvas').focus();await move(page,250,110);await interact(page);await expect(page.locator('#goal-fuse')).toHaveClass('done');
  26  |   await move(page,520,230);await interact(page);await expect(page.locator('#goal-power')).toHaveClass('done');
  27  |   await move(page,740,110);await interact(page);await expect(page.locator('#goal-key')).toHaveClass('done');
  28  |   await move(page,1030,160);await page.locator('#steady').click();await interact(page,4200);await expect(page.locator('#lock')).toHaveText('100%');
  29  |   await page.locator('#steady').click();await page.locator('canvas').focus();await move(page,1160,160);await interact(page);await expect(page.locator('#phase')).toHaveText('Escaped');
  30  |   const result=await report(page);expect(result.filename).toMatch(/bluetooth/);expect(result.value).toMatchObject({schemaVersion:2,source:'bluetooth-hr',baselineBpm:80,outcome:'won'});
  31  |   expect(result.value.calibration?.samples.map(sample=>sample.bpm)).toEqual([78,80,82,80,80]);expect(result.value.calibration?.spanSeconds).toBe(4);
  32  |   expect(result.value.calibration?.samples.map(sample=>sample.receivedSeconds)).toEqual([0,1,2,3,4]);expect(result.value.samples).toHaveLength(1);expect(result.value.samples[0].bpm).toBe(80);
  33  |   for(const key of ['connectionId','receivedAtMs','deviceId','energy','rrCount'])expect(result.text).not.toContain(`"${key}"`);
> 34  |   expect(result.text).not.toContain(PRIVATE_IDENTITY);expect(await page.evaluate(()=>localStorage.getItem('composure-settings-v1'))).toBe(before);
      |                                                                                                                                      ^ Error: expect(received).toBe(expected) // Object.is equality
  35  |   expect((await stats(page)).identityReads).toBe(0);await page.reload();await expect(page.locator('#input-source')).toHaveValue('simulated');await expect(page.locator('#phase')).toHaveText('Ready to calibrate');
  36  |   expect((await stats(page)).calls).toEqual([]);expect(await page.evaluate(()=>localStorage.getItem('composure-settings-v1'))).not.toContain('samples');
  37  | });
  38  | 
  39  | test('calibration ignores bursts and malformed offset packets and contact loss invalidates ready data before BPM filtering',async({page})=>{
  40  |   await setup(page);await connect(page);await page.locator('#ble-calibrate').click();
  41  |   for(const packet of [[32,80],[1,80],[16,80,1],[8,80,0],[0,80,1],[1,255,255],[2,39],[2,121],Array(513).fill(0)])await emit(page,packet);
  42  |   await expect(page.locator('#ble-calibration')).toContainText(/0\s*\/\s*5/);
  43  |   await emit(page,[2,80]);for(let i=0;i<7;i++)await emit(page,[2,81]);await expect(page.locator('#ble-calibration')).toContainText(/1\s*\/\s*5/);
  44  |   for(let i=0;i<4;i++){await page.clock.runFor(1000);await emit(page,[27,80,0,12,0,0,4,128,3]);}
  45  |   await expect(page.locator('#start')).toBeEnabled();await emit(page,[4,0]);await expect(page.locator('#start')).toBeDisabled();
  46  |   await emit(page,[6,80]);await expect(page.locator('#start')).toBeDisabled();
  47  |   await expect(page.locator('#ble-calibrate')).toBeEnabled();await calibrate(page);await expect(page.locator('#start')).toBeEnabled();
  48  | });
  49  | 
  50  | test('collection timeout and ready expiry require deliberate fresh collection',async({page})=>{
  51  |   await setup(page);await connect(page);await page.locator('#ble-calibrate').click();await emit(page,[2,80]);await page.clock.runFor(30001);
  52  |   await expect(page.locator('#start')).toBeDisabled();await emit(page,[2,80]);await expect(page.locator('#start')).toBeDisabled();
  53  |   await calibrate(page);await page.clock.runFor(10001);await emit(page,[2,80]);await expect(page.locator('#start')).toBeDisabled();
  54  |   await calibrate(page);await expect(page.locator('#start')).toBeEnabled();
  55  | });
  56  | 
  57  | test('Bluetooth pause drops notifications and resume requires new packets while wall freshness returns tension to neutral',async({page})=>{
  58  |   await setup(page);await startBle(page);await page.clock.runFor(1);await emit(page,[6,160]);await page.clock.runFor(3000);await expect(page.locator('#tension')).not.toHaveText('0%');
  59  |   const before=(await report(page)).value;await page.locator('#pause').click();const positionBefore=await position(page);await page.clock.runFor(30000);await emit(page,[2,100]);
  60  |   expect((await report(page)).value.samples).toEqual(before.samples);expect(await position(page)).toEqual(positionBefore);
  61  |   await page.locator('#pause').click();await page.clock.runFor(16000);await expect(page.locator('#tension')).toHaveText('0%');
  62  |   expect((await report(page)).value.samples).toEqual(before.samples);await emit(page,[2,90]);await page.clock.runFor(20);
  63  |   const after=(await report(page)).value;expect(after.samples).toHaveLength(2);expect(after.samples[1].bpm).toBe(90);expect(after.samples[1].receivedSeconds!-after.samples[0].receivedSeconds!).toBeGreaterThan(40);
  64  |   expect((await stats(page)).options).toHaveLength(1);
  65  | });
  66  | 
  67  | test('simulator controls cannot contaminate a pinned Bluetooth run and source changes preserve its report until confirmed replacement',async({page})=>{
  68  |   await setup(page);await startBle(page);await page.clock.runFor(1);await emit(page,[2,80]);const before=(await report(page)).value;
  69  |   await page.locator('#reading').evaluate(node=>{const input=node as HTMLInputElement;input.value='220';input.dispatchEvent(new Event('input',{bubbles:true}));});
  70  |   await page.locator('#send').evaluate(node=>(node as HTMLButtonElement).click());await page.clock.runFor(2500);expect((await report(page)).value.samples).toEqual(before.samples);
  71  |   await page.locator('#input-source').selectOption('simulated');await expect(page.locator('#run-source')).toContainText(/bluetooth/i);
  72  |   page.once('dialog',dialog=>dialog.dismiss());await page.locator('#start').click();expect((await report(page)).value.source).toBe('bluetooth-hr');
  73  |   page.once('dialog',dialog=>dialog.accept());await page.locator('#start').click();const simulated=await report(page);expect(simulated.value.schemaVersion).toBe(1);expect(simulated.value.source).toBe('simulated');expect(simulated.value).not.toHaveProperty('calibration');
  74  |   expect((await stats(page)).disconnects).toBeGreaterThan(0);
  75  | });
  76  | 
  77  | for(const stage of ['chooser','connect','service','characteristic','start'] as Stage[]){
  78  |   test(`cancel during ${stage} drains one native operation and cannot publish a late connection`,async({page})=>{
  79  |     await setup(page,[stage]);await page.locator('#ble-connect').click();await expect.poll(async()=>(await stats(page)).pending).toContain(stage);
  80  |     if(stage==='start'){await emit(page,[2,80]);await expect(page.locator('#start')).toBeDisabled();}
  81  |     await page.locator('#ble-cancel').click();await expect(page.locator('#ble-status')).toContainText(/wait|drain|pending|cleanup/i);await expect(page.locator('#ble-connect')).toBeDisabled();
  82  |     if(stage!=='chooser')expect((await stats(page)).disconnects).toBeGreaterThan(0);
  83  |     await page.locator('#ble-connect').evaluate(node=>(node as HTMLButtonElement).click());expect((await stats(page)).options).toHaveLength(1);
  84  |     await releaseStage(page,stage);await expect(page.locator('#ble-connect')).toBeEnabled();await expect(page.locator('#ble-calibrate')).toBeDisabled();
  85  |     expect((await stats(page)).listeners).toBe(0);expect((await stats(page)).maxConcurrent).toBe(1);
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
```