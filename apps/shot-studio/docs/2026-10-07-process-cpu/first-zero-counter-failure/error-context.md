# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: browser-cpu-diagnostics.spec.js >> native process CPU receipt brackets a real complete export without claiming codec-only usage
- Location: tests/browser/browser-cpu-diagnostics.spec.js:5:1

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - banner [ref=e2]:
    - link "SHOT / STUDIO" [ref=e3] [cursor=pointer]:
      - /url: "#main"
    - generic [ref=e4]: A small set. Your point of view.
    - generic [ref=e5]: LOCAL FILMMAKING
  - main [ref=e6]:
    - generic [ref=e7]:
      - generic [ref=e8]:
        - paragraph [ref=e9]: 01 — THE COURTYARD
        - heading "Make a scene." [level=1] [ref=e10]
        - paragraph [ref=e11]: Stage two performers, find your angles, and cut a little film.
      - generic [ref=e12]:
        - button "Undo scene" [disabled] [ref=e13]
        - button "Redo scene" [disabled] [ref=e14]
        - button "Save project" [ref=e15] [cursor=pointer]
        - generic [ref=e16] [cursor=pointer]:
          - text: Open project
          - button "Open project" [ref=e17]
    - status [ref=e18]: Ready. Rehearse the starter film or arrange your own scene.
    - generic [ref=e19]:
      - region "Stage and rehearsal" [ref=e20]:
        - generic [ref=e21]:
          - generic "3D courtyard film preview" [ref=e22]
          - generic [ref=e23]: CAMERA 01 · Establishing · Film
        - generic [ref=e24]:
          - button "Rehearse" [ref=e25] [cursor=pointer]
          - button "Stop" [ref=e26] [cursor=pointer]
          - status [ref=e27]: 0.00 / 8.00s
          - button "Export WebM" [ref=e28] [cursor=pointer]
        - generic [ref=e29]:
          - text: Film position
          - slider "Film position" [ref=e30]: "0"
        - generic [ref=e31]:
          - heading "Shot list" [level=2] [ref=e32]
          - generic [ref=e33]:
            - button "Move earlier" [disabled] [ref=e34]
            - button "Move later" [ref=e35] [cursor=pointer]
            - button "Add shot" [ref=e36] [cursor=pointer]
            - button "Remove shot" [ref=e37] [cursor=pointer]
        - generic [ref=e38]:
          - button "01 · Establishing / 4s" [pressed] [ref=e39] [cursor=pointer]
          - button "02 · Two-shot / 4s" [ref=e40] [cursor=pointer]
        - paragraph [ref=e41]: Cuts follow the shot list. Characters perform continuously across cuts. Exports are silent, recorded in real time at 960 × 540.
        - region "Saved takes" [ref=e42]:
          - heading "Saved takes" [level=2] [ref=e43]
          - paragraph [ref=e44]: Keep up to four actual recordings with their captured editable films. The take notebook is separate from your current scene. Imported film/video associations and timestamps are supplied, unverified declarations.
          - generic [ref=e45]:
            - generic [ref=e46]:
              - text: Take name
              - textbox "Take name" [ref=e47]: Take 1
            - button "Record take" [ref=e48] [cursor=pointer]
            - generic [ref=e49] [cursor=pointer]:
              - text: Import take backup
              - button "Import take backup" [ref=e50]
          - status [ref=e51]: Take library read successfully.
          - paragraph [ref=e52]: 0 of 4 saved takes
          - paragraph [ref=e53]: No saved takes yet. Finish scene edits and record a committed film.
          - list
          - paragraph [ref=e54]: Recordings are silent WebM, at most 32 MiB each. Playback uses the actual retained bytes; your current stage and raw scene fields stay unchanged. Complete take backups include one recording and its immutable captured film. Hashes verify bytes, not the truth of an imported pairing.
      - complementary [ref=e55]:
        - group "Direct the scene" [ref=e57]:
          - generic [ref=e59]:
            - text: Film title
            - textbox "Film title" [ref=e60]: The arrival
          - generic [ref=e61]:
            - heading "Performers" [level=2] [ref=e62]
            - combobox "Selected performer" [ref=e63]:
              - option "Mika" [selected]
              - option "Noor"
          - generic [ref=e64]:
            - text: Performer motion
            - combobox "Performer motion" [ref=e65]:
              - option "Looping performance" [selected]
              - option "Authored blocking"
          - paragraph [ref=e66]: Authored blocking replaces the looping pace with timed marks on the whole film. Name and costume apply to every cue.
          - generic [ref=e67]:
            - text: Name
            - textbox "Name" [ref=e68]: Mika
          - generic [ref=e69]:
            - generic [ref=e70]:
              - text: X position
              - spinbutton "Performer X" [ref=e71]: "-1.2"
            - generic [ref=e72]:
              - text: Z position
              - spinbutton "Performer Z" [ref=e73]: "0"
          - generic [ref=e74]:
            - generic [ref=e75]:
              - text: Costume
              - textbox "Costume" [ref=e76]: "#db825c"
            - generic [ref=e77]:
              - text: Performance
              - combobox "Performance" [ref=e78]:
                - option "Still"
                - option "Wave" [selected]
                - option "Pace"
          - generic [ref=e79]:
            - text: Light intensity
            - slider "Light intensity" [ref=e80]: "1"
          - heading "Camera & shot" [level=2] [ref=e81]
          - paragraph [ref=e82]: Editing shot 1 — Establishing — Start
          - generic [ref=e83]:
            - text: Camera motion
            - combobox "Camera motion" [ref=e84]:
              - option "Static" [selected]
              - option "Linear travel"
          - generic [ref=e85]:
            - text: Editing endpoint
            - combobox "Editing endpoint" [disabled] [ref=e86]:
              - option "Start" [selected]
              - option "End" [disabled]
          - generic [ref=e87]:
            - text: Shot name
            - textbox "Shot name" [ref=e88]: Establishing
          - generic [ref=e89]:
            - generic [ref=e90]:
              - text: Duration (seconds)
              - spinbutton "Shot duration" [ref=e91]: "4"
            - generic [ref=e92]:
              - text: Field of view
              - spinbutton "Field of view" [ref=e93]: "45"
          - paragraph [ref=e94]: Performer close-up targets the selected performer’s base position.
          - paragraph [ref=e95]: Presets change this endpoint and the whole shot’s field of view.
          - generic [ref=e96]:
            - text: Camera preset
            - combobox "Camera preset" [ref=e97]:
              - option "Custom angle" [selected]
              - option "Wide courtyard"
              - option "Two-shot"
              - option "Performer close-up"
          - generic [ref=e98]:
            - generic [ref=e99]:
              - text: Camera X
              - spinbutton "Camera X" [ref=e100]: "5"
            - generic [ref=e101]:
              - text: Camera Y
              - spinbutton "Camera Y" [ref=e102]: "3"
            - generic [ref=e103]:
              - text: Camera Z
              - spinbutton "Camera Z" [ref=e104]: "7"
          - generic [ref=e105]:
            - generic [ref=e106]:
              - text: Look at X
              - spinbutton "Look at X" [ref=e107]: "0"
            - generic [ref=e108]:
              - text: Look at Y
              - spinbutton "Look at Y" [ref=e109]: "1"
            - generic [ref=e110]:
              - text: Look at Z
              - spinbutton "Look at Z" [ref=e111]: "0"
          - generic [ref=e112]:
            - button "Copy other endpoint" [disabled] [ref=e113]
            - generic [ref=e114]: End → Start
            - button "Preview endpoint" [ref=e115] [cursor=pointer]
            - button "Use current preview" [ref=e116] [cursor=pointer]
          - paragraph [ref=e117]: Use current preview is available when this editing shot is on screen. Travel moves the camera in a straight line; it does not avoid performers or scenery.
        - generic [ref=e118]:
          - heading "Step onto the set" [level=2] [ref=e119]
          - paragraph [ref=e120]: In a compatible headset, look around the courtyard. Aim a controller at the floor and select to place the chosen performer. Squeeze to capture your headset view into the selected editing endpoint; its lens stays unchanged. The other endpoint is preserved and the complete travel path must remain valid. Return to desktop to undo. Camera roll is not captured.
          - paragraph [ref=e121]: VR placement will edit performer 1’s looping base position.
          - button "Enter VR" [ref=e122] [cursor=pointer]
          - paragraph [ref=e123]: WebXR support is experimental. Physical headset comfort and controller behavior await device testing.
    - region "Scene sequence" [ref=e124]:
      - generic [ref=e125]:
        - generic [ref=e126]:
          - paragraph [ref=e127]: 02 — THE SEQUENCE
          - heading "Scene sequence" [level=2] [ref=e128]
        - status [ref=e129]: Sequence saved in this browser
      - paragraph [ref=e130]: Copy complete editable scenes, then arrange whole shots. Sources are detached snapshots, not linked edits or spliced recordings. Each clip keeps its original source clock, performers, camera and light.
      - generic [ref=e131]:
        - button "Undo sequence" [disabled] [ref=e132]
        - button "Redo sequence" [disabled] [ref=e133]
        - button "Save sequence" [ref=e134] [cursor=pointer]
        - generic [ref=e135] [cursor=pointer]:
          - text: Open sequence
          - button "Open sequence" [ref=e136]
        - button "New sequence" [ref=e137] [cursor=pointer]
        - button "Clear sequence Undo" [disabled] [ref=e138]
      - status [ref=e139]: Sequence storage ready. Add a copied scene source, then choose shots to make a sequence.
      - generic [ref=e140]:
        - generic [ref=e141]:
          - text: Sequence title
          - textbox "Sequence title" [ref=e142]: Scene sequence
        - button "Apply sequence title" [ref=e143] [cursor=pointer]
      - generic [ref=e144]:
        - generic [ref=e145]:
          - paragraph [ref=e146]: Add a scene source and choose a shot to see your sequence here.
          - generic [ref=e148]:
            - button "Rehearse sequence" [disabled] [ref=e149]
            - button "Stop sequence" [disabled] [ref=e150]
            - button "Preview clip start" [disabled] [ref=e151]
            - button "Preview clip end" [disabled] [ref=e152]
          - generic [ref=e153]:
            - text: Sequence position
            - slider "Sequence position" [disabled] [ref=e154]: "0"
          - paragraph [ref=e155]: Sequence 0.00 / 0.00s
          - paragraph [ref=e156]: No clip selected.
          - button "Export sequence WebM" [disabled] [ref=e158]
          - progressbar "Sequence export progress" [ref=e159]
          - paragraph [ref=e160]: 960 × 540 WebM with the committed soundtrack when attached, encoded with authored 30 fps timestamps up to 32 MiB. Unsupported audio encoders are refused. Keep this tab visible. Sequence downloads do not add a saved take.
        - generic [ref=e161]:
          - region [ref=e162]:
            - heading "Sequence soundtrack" [level=3] [ref=e163]
            - paragraph [ref=e164]: One original PCM16 WAV, mono or stereo at 44.1 or 48 kHz, 1–60 seconds and at most 12 MiB. Audio follows sequence time across clip cuts. Seeking and clip endpoints are silent.
            - generic [ref=e165]:
              - generic [ref=e166] [cursor=pointer]:
                - text: Choose soundtrack WAV
                - button "Choose soundtrack WAV" [ref=e167]
              - button "Import soundtrack" [disabled] [ref=e168]
            - generic [ref=e169]:
              - text: Soundtrack label
              - textbox "Soundtrack label" [disabled] [ref=e170]
            - generic [ref=e171]:
              - generic [ref=e172]:
                - text: Soundtrack In (source seconds)
                - spinbutton "Soundtrack In (source seconds)" [disabled] [ref=e173]
              - generic [ref=e174]:
                - text: Soundtrack Out (exclusive source seconds)
                - spinbutton "Soundtrack Out (exclusive source seconds)" [disabled] [ref=e175]
              - generic [ref=e176]:
                - text: Soundtrack start (sequence seconds)
                - spinbutton "Soundtrack start (sequence seconds)" [disabled] [ref=e177]: "0"
              - generic [ref=e178]:
                - text: Soundtrack gain (0–1)
                - spinbutton "Soundtrack gain (0–1)" [disabled] [ref=e179]: "1"
            - paragraph [ref=e180]: Source seconds round once to the nearest sample frame. Apply all five fields explicitly; unfinished fields are never exported.
            - generic [ref=e181]:
              - button "Apply soundtrack settings" [disabled] [ref=e182]
              - button "Remove soundtrack" [disabled] [ref=e183]
            - paragraph [ref=e184]: No soundtrack. Choose a PCM16 WAV, then explicitly import it. Original bytes are retained; endpoint previews and scrubbing are silent.
          - heading "Copied sources" [level=3] [ref=e185]
          - generic [ref=e186]:
            - button "Add current scene" [ref=e187] [cursor=pointer]
            - generic [ref=e188] [cursor=pointer]:
              - text: Import scene source
              - button "Import scene source" [ref=e189]
          - list "Sequence sources"
          - generic [ref=e190]:
            - generic [ref=e191]:
              - text: Source label
              - textbox "Source label" [disabled] [ref=e192]
            - button "Rename source" [disabled] [ref=e193]
            - button "Remove source" [disabled] [ref=e194]
          - generic "Source shots"
          - button "Add shot to sequence" [disabled] [ref=e195]
          - heading "Ordered clips" [level=3] [ref=e196]
          - list "Sequence clips"
          - generic [ref=e197]:
            - generic [ref=e198]:
              - text: Clip label
              - textbox "Clip label" [disabled] [ref=e199]
            - button "Rename clip" [disabled] [ref=e200]
          - generic [ref=e201]:
            - generic [ref=e202]:
              - text: Clip In (source-shot seconds)
              - spinbutton "Clip In (source-shot seconds)" [disabled] [ref=e203]
            - generic [ref=e204]:
              - text: Clip Out (source-shot seconds)
              - spinbutton "Clip Out (source-shot seconds)" [disabled] [ref=e205]
          - paragraph [ref=e206]: Select a sequence clip to choose its source range.
          - generic [ref=e207]:
            - button "Apply clip range" [disabled] [ref=e208]
            - button "Use whole shot" [disabled] [ref=e209]
          - generic [ref=e210]:
            - button "Move clip earlier" [disabled] [ref=e211]
            - button "Move clip later" [disabled] [ref=e212]
            - button "Repeat clip" [disabled] [ref=e213]
            - button "Remove clip" [disabled] [ref=e214]
          - paragraph [ref=e215]: 0/4 copied sources · 0/20 clips · 0/60 seconds
          - paragraph [ref=e216]: Up to four complete sources, 20 clips and 60 seconds. Undo sequence keeps at most 30 prior snapshots plus current/future; unique retained soundtrack assets also have a 64 MiB budget. Clear sequence Undo deliberately if that budget refuses a new edit.
    - generic [ref=e217]: One set · two performers · up to 20 shots / 60 seconds · your projects stay in this browser.
```

# Test source

```ts
  1  | import {test,expect} from '@playwright/test';
  2  | import {writeFile} from 'node:fs/promises';
  3  | import {startBrowserCpu} from '../../scripts/browser-cpu-diagnostics.mjs';
  4  | 
  5  | test('native process CPU receipt brackets a real complete export without claiming codec-only usage',async({page,browser},info)=>{
  6  |  await page.goto('/');
  7  |  const observer=await startBrowserCpu(browser);let result;
  8  |  try{
  9  |   result=await page.evaluate(async()=>{
  10 |    const {exportTimestampedFilm}=await import('/src/export.js');
  11 |    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const c=canvas.getContext('2d');let draws=0;
  12 |    const blob=await exportTimestampedFilm(canvas,()=>{draws++;c.fillStyle='#ff8000';c.fillRect(0,0,64,64);},1);
  13 |    return{draws,bytes:blob.size};
  14 |   });
  15 |  }finally{
  16 |   const receipt=await observer.finish();
> 17 |   expect(receipt.status).toBe('measured');expect(receipt.matchedCpuMs).toBeGreaterThan(0);expect(receipt.wallMs).toBeGreaterThan(0);
     |                                                                        ^ Error: expect(received).toBeGreaterThan(expected)
  18 |   expect(receipt.matchedProcesses).toBeGreaterThan(0);expect(receipt.complete).toBe(receipt.newProcesses+receipt.missingProcesses+receipt.invalidPairs===0);
  19 |   expect(Object.values(receipt.byType).reduce((sum,row)=>sum+row.cpuMs,0)).toBeCloseTo(receipt.matchedCpuMs,6);
  20 |   expect(JSON.stringify(receipt)).not.toMatch(/commandLine|deviceId|"id":/);
  21 |   expect(await observer.finish()).toEqual(receipt);
  22 |   await writeFile(info.outputPath('native-process-cpu-receipt.json'),JSON.stringify(receipt,null,2));
  23 |  }
  24 |  expect(result.draws).toBe(30);expect(result.bytes).toBeGreaterThan(0);
  25 | });
  26 | 
```