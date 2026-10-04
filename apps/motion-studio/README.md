# Motion Studio

A local drawing and animation workspace: make original freehand artwork, create independent held drawings, combine them with layer poses and imported images, preview the animation, and export a GIF. Projects stay in your browser or downloaded backup files. AI assistance and online saving/private sharing links are future work.

## Run

Use Node.js **22.18+** and npm; CI uses Node 24. From the repository root:

```sh
cd apps/motion-studio
npm ci
npm run dev
```

Open the localhost URL printed by Vite. No account, backend, API key, paid service, or model download is needed. `npm run build` creates a static site in `dist/`; `npm run preview` serves that build locally.

## Draw, pose, and animate

1. Explore **Try the orbit demo**, which uses original parametric artwork, or choose **New project** for a blank drawing layer. Both reset actions ask before replacing the current project.
2. Select **Draw**, choose **Ink color** and **Brush width**, then draw on the selected drawing layer. Add another **Drawing layer** or **Import image**. Use **Raise**, **Lower**, and **Delete layer** to arrange the artwork; Undo can recover a deleted layer.
3. Move the **Timeline frame** slider. **Drawings** names the active drawing and the frames where it is held. Choose **Blank drawing at this frame** or **Duplicate held drawing at this frame** to start independent artwork at a new boundary; then draw. A duplicate starts with copied strokes. Drawing between boundaries edits the active held drawing throughout its displayed interval.
4. Select a drawing button to revisit its boundary. **Delete active drawing** removes a later drawing and extends the preceding hold; the first drawing remains. Undo restores deleted artwork. Blank/duplicate refuse occupied boundaries. In **Move** mode, drag the selected layer to place a pose at the current frame. Releasing a gesture records one history entry; cancellation discards its preview.
5. Adjust **Position X**, **Position Y**, **Scale**, **Rotation (degrees)**, or **Opacity**. Committing a numeric change creates or replaces a keyframe at the current frame. Changing **Motion to next pose** does the same; **Set keyframe** also records the current values explicitly. The first keyframe always remains; later keys can be removed with **Remove this keyframe**.
6. Select a keyframe diamond to revisit its pose. Press **Play animation**, optionally enable **Loop**, and scrub to inspect the in-between frames. Choose **Duration** to change the timeline length.
7. Download **Save project file**, **Save frame PNG**, or **Export animation**. GIF export reports progress; **Cancel export** discards that export and preserves the editable project.

Undo/Redo retain up to 30 project snapshots within a 20 MiB history budget; large projects may retain fewer. Ctrl/⌘ Z and Ctrl/⌘ Shift Z work outside text fields. With the canvas focused, Space toggles playback. History is session-only and is not included in backups.

## Drawings and pose keyframes

Drawing boundaries (cels) and pose keyframes are independent. Each drawing layer starts at frame 1 and holds its current strokes until the next drawing boundary. Blank drawings create visible empty intervals; duplicates are detached copies, so later edits do not change the original. Drawings switch exactly at their boundaries; strokes are not interpolated or morphed. Imported image layers keep fixed artwork.

Each layer separately has position, uniform scale, rotation, opacity and pose keys. Held drawings can move through these poses, giving frame-by-frame artwork changes and continuous layer motion in the same animation. There is no AI-generated artwork or automatic in-between drawing.

Between two keys, the starting key's **Motion to next pose** controls interpolation:

- **Steady / linear** interpolates pose values evenly.
- **Ease in & out** uses smoothstep easing.
- **Hold this pose** keeps the starting pose until the next key.

Rotation interpolates the entered degrees directly, allowing complete spins; it does not automatically choose the shortest turn. After the last key, the layer retains that pose. Shortening a timeline first lists the exact later drawings and pose keys that would be removed and asks for confirmation. Cancel preserves everything. Accepted shortening preserves the evaluated endpoint pose and held drawing; one Undo restores the previous timeline. If retaining the endpoint would exceed the 24-key limit, shortening refuses before asking for consent. Extending holds the final artwork/pose without adding boundaries.

The interface numbers frames from **1**. Project JSON stores frames from **0**: displayed frame 1 is `frame: 0`. Position values use the fixed 640×360 stage coordinates. Imported images initially fit within 320×240 without enlarging small images; pose scale then transforms that geometry.

Unapplied pose/name text remains visible, including empty or invalid values. Apply valid values or use **Discard pose edits** before changing layers, drawings, frames or projects. Values need not align to a suggested increment. JSON downloads remain available for committed work and explicitly exclude raw drafts. Pointer cancellation, Escape, focus/visibility loss or changed canvas geometry discard an active gesture without a partial save.

## Bounds and image import

- Stage: **640×360**, **12 fps**, **12–96 frames** (1–8 seconds). Blank projects start with 48 frames.
- At most **8 layers**, **24 drawing boundaries per drawing layer**, **24 pose keys per layer**, and **4 image layers**.
- At most **100 strokes**, **1,000 points per stroke**, and **10,000 points** across all stored drawings in the project; brush width 1–40 stage pixels. A held drawing is counted once; an explicit duplicate consumes its full copied stroke/point budget.
- Pose position: X −640 to 1280, Y −360 to 720; scale 0.1–4; rotation −720° to 720°; opacity 0–1.
- Project title: 1–80 characters; layer names: 1–40 characters; project JSON: **6 MiB + 168 bytes** maximum (6,291,624 bytes).
- Image input: actual **static PNG, JPEG, or static WebP**, at most **4 MiB** and **16 megapixels**. SVG, animated PNG/WebP, remote image URLs, and unsupported formats are rejected.

Image headers and decoded dimensions are checked before publication. Imported images become embedded PNG assets with their longest side at most 800 pixels and each data URL at most 1.5 MiB; further downsizing may be needed to meet that limit. Backups include those normalized images rather than links to the originals. Invalid project imports or image decode failures preserve the current project.

## Save and export

Edits autosave one current project in **IndexedDB**, after a short debounce. The initial demo is saved after your first edit only after startup restoration succeeds or confirms there is no saved record. Editor mutations wait until startup model/image restoration completes. A failed read, invalid record or undecodable saved image keeps the original IndexedDB record protected while you work in memory. Edits, undo/redo, imports and new-project actions cannot overwrite it. Download your current project before reload; **Replace saved project** asks for explicit confirmation and enables autosave only after its write completes. Cancelled or failed replacement leaves protection active. If an earlier replacement finishes after newer edits, those edits remain visibly unsaved and protected; the preserved-record download reflects the last completed write. A later failed queued replacement cannot erase that successful receipt. **Saved draft recovery** remains visible while saving is protected. **Download preserved record** exports the exact read record as JSON (including unknown fields), separately from your current project backup. Cycles, undefined, nonfinite or negative-zero numbers, dates, typed values, sparse arrays and other lossy shapes cannot be exported; neither can JSON over 6 MiB + 168 bytes or nesting beyond 512 levels. Shared records are checked against the expanded byte budget before serialization. Failed reads have unknown contents until retry succeeds. **Retry saved draft** rereads and validates the saved model and images, asks before replacing edited memory work, and keeps newer edits if a read or decode finishes late. Cancel or failure retains the current work, history and saved record. No automatic deletion is provided. Browser data belongs to the current profile and site address and can be cleared or become unavailable. Watch the save status and regularly download **Save project file** (`.motion.json`) to keep an editable backup. **Open project file** validates the model and every embedded image before replacing the current project. There is no account backup or online synchronization. Schema-2 backups contain every drawing boundary. Genuine schema-1 projects migrate into one first drawing per drawing layer while retaining their existing appearance and poses; loading alone does not rewrite the saved record. The 168-byte compatibility allowance covers the maximum eight legacy drawing wrappers. Older app versions reject schema 2 instead of silently losing later artwork.

**Save frame PNG** exports the captured committed frame, including its held drawing and opaque stage background. A later edit, frame change or page departure retires a pending PNG download; it cannot acquire a new filename or frame from newer work. **Export animation** renders every frame through the same renderer as the preview, then encodes an infinitely looping GIF with a **fixed 256-color palette**. Colors and gradients can differ from the full-color PNG/preview; GIF is not a lossless archival format. Individual GIF delays alternate between 80 and 90 ms to approximate 12 fps, with total duration rounded to hundredths of a second. Export is limited to 30 seconds of processing and 32 MiB of encoded output.

## Browser requirements

Canvas 2D and pointer events support editing; image import needs `createImageBitmap`; local autosave needs IndexedDB. GIF export additionally requires module Web Workers and OffscreenCanvas. Use localhost or HTTPS for browser APIs such as UUID creation. Unsupported image/export APIs report an error while leaving the project editable; blocked storage still permits a JSON backup.

Chromium is the verification target. Other browsers and physical touch devices require separate evaluation; a narrow Chromium viewport is not proof of mobile browser compatibility. No external artwork or network service is required during editing or export.

## Verify

```sh
npm run check
npm run typecheck
npx playwright install chromium
npm run test:browser
```

`npm run check` runs Node tests, ESLint, and the production build; the build also checks TypeScript. Individual commands are `npm run test`, `npm run lint`, and `npm run build`. For an existing Chromium executable:

```sh
CHROMIUM_PATH=/path/to/chromium npm run test:browser
```

Playwright builds the production app with `MOTION_TEST_HARNESS=1` and serves it on port 4210. The flag adds isolated renderer/export test pages; ordinary production builds omit them. Tests use the real canvas and GIF worker, with independent GIF decoding to inspect frame order, delays, duration, and moving pixels. Unit coverage checks model bounds, interpolation, coordinate inversion, history, image containers, and export lifecycle; browser coverage exercises storage and actual encoded output. CI installs only npm dependencies and Chromium—no ML runtime, model, or backend service.

Startup recovery was verified on 2026-10-04 in [run 37172863274](https://github.com/twangyal/projects-monorepo/actions/runs/37172863274) on `bf6b93155acf6fe1559ef7b4d5eaa2d675f1bf82`: 38 unit tests, lint/typecheck/build and 28 production Chromium cases passed. The edit-after-corruption regression failed before the fix. See [verification evidence](docs/2026-10-04-startup-recovery-verification.json) and issue [#46](https://github.com/twangyal/projects-monorepo/issues/46).


Raw-record recovery and retry (#48) were verified on 2026-10-04 at `b15b5db0ab5439505c16ed85ecaa38d17236f235` in [run 37197554658](https://github.com/twangyal/projects-monorepo/actions/runs/37197554658): 43 unit tests, lint/typecheck/build and all 44 production Chromium cases passed. The protected-baseline test-only run measured 12 failed recovery cases before implementation. Independent review also produced a shared-graph expansion regression, fixed with an early exact byte budget. See [raw recovery evidence](docs/2026-10-04-raw-recovery-verification.json).

The separate maximum-size cel acceptance runner uses original generated fixtures and an independent PNG/GIF decoder. Build normally, start a preview in another terminal, then run:

```sh
npm run build
npm run preview -- --port 4294 --strictPort
# In another terminal, from this project directory:
MOTION_CELS_BASE_URL=http://127.0.0.1:4294 CHROMIUM_PATH=/path/to/chromium node scripts/smoke_drawing_cels.mjs
```

The runner creates a fresh temporary directory for actual downloads, screenshots, verification metadata and a private browser profile. `MOTION_CELS_OUTPUT` can instead name a new directory; existing directories are refused. It tests legacy migration, the exact canonical byte cap, a complete Chromium process restart, held-frame PNG/GIF pixels, cancellation after rendering begins, aggregate artwork/history limits, and a separate eight-layer/192-drawing fixture. `--fixtures-only` generates and independently checks the inputs without launching Chromium. File sizes do not measure peak memory; the 192-drawing case has no image layers.


Drawing-cel authoring (#84) passes **63 unit tests and all 61 production Chromium cases**, plus lint/typecheck/build, at exact published commit `3ea4707d80fa8c3fee8ae163273d6152b99700b5` in [push run 37206790092](https://github.com/twangyal/projects-monorepo/actions/runs/37206790092). The corresponding PR merge passes the same complete suite. Native tests first reproduced and then verified fixes for late history decoding, a stale explicit recovery write and a queued replacement abort.

The independent normal-build acceptance imports a genuine 6,291,456-byte schema-1 project and migrates it to 6,291,540 bytes. An exact **6,291,624-byte schema-2 project** with eight layers, four images, 27 drawings, 100 strokes and 10,000 points survives a complete Chromium process restart with byte-identical backups and embedded artwork. All seven boundary PNGs and **96 actual GIF frames** independently match held red/blue/blank/red artwork alongside moving and stationary controls. The 126,667-byte GIF has exactly 8,000 ms of delays; encode plus download took 861.88 ms and independent decoding 501.74 ms in this runtime. Cancellation after 5/96 rendered frames terminates its real worker without a partial download. A separate eight-drawing-layer fixture admits all 192 boundaries; the maximum graph retains three history states within 20 MiB.

The first maximum run missed a brief real progress interval with adaptive polling; a diagnostic measured 95 partial progress values over 228.5 ms. Animation-frame polling fixed the acceptance runner, with no production change or artificial worker delay. See [complete local evidence](docs/2026-10-04-drawing-cels-verification.json) and [CI receipt](docs/2026-10-04-drawing-cels-ci.json) for exact hashes, failed attempts and limits. These are bounded fixture/runtime results, not memory, device-compatibility or general latency guarantees.
