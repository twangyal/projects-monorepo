# Motion Studio

A local drawing and animation workspace: make original freehand artwork or import an image, set layer poses on a timeline, preview the motion, and export an animated GIF. Projects stay in your browser or downloaded backup files. AI assistance and online saving/private sharing links are future work.

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
3. Move the **Timeline frame** slider. In **Move** mode, drag the selected layer to place a pose at that frame. Releasing a gesture records one history entry; a cancelled gesture discards its preview.
4. Adjust **Position X**, **Position Y**, **Scale**, **Rotation (degrees)**, or **Opacity**. Committing a numeric change creates or replaces a keyframe at the current frame. Changing **Motion to next pose** does the same; **Set keyframe** also records the current values explicitly. The first keyframe always remains; later keys can be removed with **Remove this keyframe**.
5. Select a keyframe diamond to revisit its pose. Press **Play animation**, optionally enable **Loop**, and scrub to inspect the in-between frames. Choose **Duration** to change the timeline length.
6. Download **Save project file**, **Save frame PNG**, or **Export animation**. GIF export reports progress; **Cancel export** discards that export and preserves the editable project.

Undo/Redo retain up to 30 project snapshots within a 20 MiB history budget; large projects may retain fewer. Ctrl/⌘ Z and Ctrl/⌘ Shift Z work outside text fields. With the canvas focused, Space toggles playback. History is session-only and is not included in backups.

## What keyframes change

Each layer has its own position, uniform scale, rotation, opacity, and keyframes. Artwork itself is shared across the timeline: drawing another stroke changes that layer in every frame. This is **layer transform animation**, not frame-by-frame painting, shape morphing, or AI-generated in-between artwork.

Between two keys, the starting key's **Motion to next pose** controls interpolation:

- **Steady / linear** interpolates pose values evenly.
- **Ease in & out** uses smoothstep easing.
- **Hold this pose** keeps the starting pose until the next key.

Rotation interpolates the entered degrees directly, allowing complete spins; it does not automatically choose the shortest turn. After the last key, the layer retains that pose. Shortening a timeline preserves the evaluated pose at its new endpoint and removes later keys; Undo restores the previous timeline.

The interface numbers frames from **1**. Project JSON stores frames from **0**: displayed frame 1 is `frame: 0`. Position values use the fixed 640×360 stage coordinates. Imported images initially fit within 320×240 without enlarging small images; pose scale then transforms that geometry.

## Bounds and image import

- Stage: **640×360**, **12 fps**, **12–96 frames** (1–8 seconds). Blank projects start with 48 frames.
- At most **8 layers**, **24 keys per layer**, and **4 image layers**.
- At most **100 strokes**, **1,000 points per stroke**, and **10,000 points** across the project; brush width 1–40 stage pixels.
- Pose position: X −640 to 1280, Y −360 to 720; scale 0.1–4; rotation −720° to 720°; opacity 0–1.
- Project title: 1–80 characters; layer names: 1–40 characters; project JSON: **6 MiB** maximum.
- Image input: actual **static PNG, JPEG, or static WebP**, at most **4 MiB** and **16 megapixels**. SVG, animated PNG/WebP, remote image URLs, and unsupported formats are rejected.

Image headers and decoded dimensions are checked before publication. Imported images become embedded PNG assets with their longest side at most 800 pixels and each data URL at most 1.5 MiB; further downsizing may be needed to meet that limit. Backups include those normalized images rather than links to the originals. Invalid project imports or image decode failures preserve the current project.

## Save and export

Edits autosave one current project in **IndexedDB**, after a short debounce. The initial demo is saved after your first edit only after startup restoration succeeds or confirms there is no saved record. Editor mutations wait until startup model/image restoration completes. A failed read, invalid record or undecodable saved image keeps the original IndexedDB record protected while you work in memory. Edits, undo/redo, imports and new-project actions cannot overwrite it. Download your current project before reload; **Replace saved project** asks for explicit confirmation and enables autosave only after its write completes. Cancelled or failed replacement leaves protection active. **Saved draft recovery** remains visible while saving is protected. **Download preserved record** exports the exact read record as JSON (including unknown fields), separately from your current project backup. Cycles, undefined, nonfinite or negative-zero numbers, dates, typed values, sparse arrays and other lossy shapes cannot be exported; neither can JSON over 6 MiB or nesting beyond 512 levels. Shared records are checked against the expanded byte budget before serialization. Failed reads have unknown contents until retry succeeds. **Retry saved draft** rereads and validates the saved model and images, asks before replacing edited memory work, and keeps newer edits if a read or decode finishes late. Cancel or failure retains the current work, history and saved record. No automatic deletion is provided. Browser data belongs to the current profile and site address and can be cleared or become unavailable. Watch the save status and regularly download **Save project file** (`.motion.json`) to keep an editable backup. **Open project file** validates the model and every embedded image before replacing the current project. There is no account backup or online synchronization.

**Save frame PNG** exports the selected frame, including the opaque stage background. **Export animation** renders every frame through the same renderer as the preview, then encodes an infinitely looping GIF with a **fixed 256-color palette**. Colors and gradients can differ from the full-color PNG/preview; GIF is not a lossless archival format. Individual GIF delays alternate between 80 and 90 ms to approximate 12 fps, with total duration rounded to hundredths of a second. Export is limited to 30 seconds of processing and 32 MiB of encoded output.

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
