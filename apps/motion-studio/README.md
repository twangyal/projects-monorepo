# Motion Studio

A local drawing and animation workspace: make original freehand artwork, create independent held drawings, review geometric in-betweens, combine artwork with layer poses and imported images, and export a GIF. Keep up to eight independently editable projects in your browser and download portable backups. AI assistance and online saving/private sharing links are future work.

## Run

Use Node.js **22.18+** and npm; CI uses Node 24. From the repository root:

```sh
cd apps/motion-studio
npm ci
npm run dev
```

Open the localhost URL printed by Vite. No account, backend, API key, paid service, or model download is needed. `npm run build` creates a static site in `dist/`; `npm run preview` serves that build locally.

## Draw, pose, and animate

1. Explore **Try the orbit demo**, which uses original parametric artwork, or choose **New project** for a blank drawing layer. Each creates a separate saved project; existing projects remain in the Projects list.
2. Select **Draw**, choose **Ink color** and **Brush width**, then draw on the selected drawing layer. Add another **Drawing layer** or **Import image**. Use **Raise**, **Lower**, and **Delete layer** to arrange the artwork; Undo can recover a deleted layer.
3. Move the **Timeline frame** slider. **Drawings** names the active drawing and the frames where it is held. Choose **Blank drawing at this frame** or **Duplicate held drawing at this frame** to start independent artwork at a new boundary; then draw. A duplicate starts with copied strokes. Drawing between boundaries edits the active held drawing throughout its displayed interval.
4. Select a drawing button to revisit its boundary. **Delete active drawing** removes a later drawing and extends the preceding hold; the first drawing remains. Undo restores deleted artwork. Blank/duplicate refuse occupied boundaries. In **Move** mode, drag the selected layer to place a pose at the current frame. Releasing a gesture records one history entry; cancellation discards its preview.
5. Adjust **Position X**, **Position Y**, **Scale**, **Rotation (degrees)**, or **Opacity**. Committing a numeric change creates or replaces a keyframe at the current frame. Changing **Motion to next pose** does the same; **Set keyframe** also records the current values explicitly. The first keyframe always remains; later keys can be removed with **Remove this keyframe**.
6. Select a keyframe diamond to revisit its pose. Press **Play animation**, optionally enable **Loop**, and scrub to inspect the in-between frames. Choose **Duration** to change the timeline length.
7. Download **Save project file**, **Save frame PNG**, or **Export animation**. GIF export reports progress; **Cancel export** discards that export and preserves the editable project.

Undo/Redo retain up to 30 project snapshots within a 20 MiB history budget; large projects may retain fewer. Ctrl/⌘ Z and Ctrl/⌘ Shift Z work outside text fields. With the canvas focused, Space toggles playback. History is session-only and is not included in backups.

## Drawings and pose keyframes

Drawing boundaries (cels) and pose keyframes are independent. Each drawing layer starts at frame 1 and holds its current strokes until the next drawing boundary. Blank drawings create visible empty intervals; duplicates are detached copies, so later edits do not change the original. Drawings switch exactly at their boundaries. The reviewed in-between tool can create additional editable drawings between two authored boundaries. Imported image layers keep fixed artwork.

Each layer separately has position, uniform scale, rotation, opacity and pose keys. Held drawings can move through these poses, giving frame-by-frame artwork changes and continuous layer motion in the same animation. The in-between tool uses explicit geometric stroke correspondence; it does not train a model or infer semantic motion.

Between two keys, the starting key's **Motion to next pose** controls interpolation:

- **Steady / linear** interpolates pose values evenly.
- **Ease in & out** uses smoothstep easing.
- **Hold this pose** keeps the starting pose until the next key.

Rotation interpolates the entered degrees directly, allowing complete spins; it does not automatically choose the shortest turn. After the last key, the layer retains that pose. Shortening a timeline first lists the exact later drawings and pose keys that would be removed and asks for confirmation. Cancel preserves everything. Accepted shortening preserves the evaluated endpoint pose and held drawing; one Undo restores the previous timeline. If retaining the endpoint would exceed the 24-key limit, shortening refuses before asking for consent. Extending holds the final artwork/pose without adding boundaries.

The interface numbers frames from **1**. Project JSON stores frames from **0**: displayed frame 1 is `frame: 0`. Position values use the fixed 640×360 stage coordinates. Imported images initially fit within 320×240 without enlarging small images; pose scale then transforms that geometry.

Unapplied pose/name text remains visible, including empty or invalid values. Apply valid values or use **Discard pose edits** before changing layers, drawings, frames or projects. Values need not align to a suggested increment. JSON downloads remain available for committed work and explicitly exclude raw drafts. Pointer cancellation, Escape, focus/visibility loss or changed canvas geometry discard an active gesture without a partial save.

## Review drawing in-betweens

1. Select a drawing layer with two adjacent nonempty drawings and at least one free frame between them. Finish or discard existing pose/name drafts, then choose **Make drawing in-betweens**. Both endpoints must contain the same number of strokes, from one through eight.
2. Choose **Starting drawing**; its next boundary is the ending drawing. For each starting stroke, explicitly choose a different ending stroke. Thumbnails, paint-order numbers, color, width and direction markers help identify them. **Pair in drawing order** is an explicit shortcut. Use **Reverse ending stroke** when its path was drawn in the opposite direction.
3. Choose **Number of new drawings** and inspect the exact proposed frame numbers. **Review in-betweens** creates a temporary candidate and reports its complete cel, stroke, point and file usage. The separate preview frame/play controls inspect the candidate without changing the main timeline or saving it.
4. Choose **Apply in-betweens** for one history edit, or **Discard in-betweens** to keep the existing project. Apply selects the first new drawing. Undo returns to both original endpoints and the previous timeline; Redo restores the full result. New cels remain independently editable and are included in normal backups and PNG/GIF exports.

Each paired path is sampled at 64 equally spaced arc-length positions. Intermediate coordinates, brush width and encoded RGB channels follow the authored frame fraction. Original endpoint strokes, pose keys and other artwork remain unchanged. The new drawings hold between their boundaries just like other cels, while existing pose movement continues. Generated paint order follows the starting drawing; an explicitly paired ending can have a different order. Review that final transition as well as the interior frames.

Exactly equal coordinates and widths retain their value during sampling and interpolation, including legal boundary values. Other scalar interpolation uses ordinary double arithmetic, and color channels round to integer encoded RGB values. This is not a perceptual color model.

Sampling can soften corners, produce crossings or create self-intersections. A zero-length path remains a dot; unmatched or blank endpoints are unavailable. This deterministic geometric tool does not recognize a character, infer intended movement or guarantee artistic quality. Inspect the actual preview before applying.

All retained originals and generated points count toward the existing global budgets. A request is refused as a whole if the complete project would exceed any cel, stroke, point or file limit; requested output is never silently reduced. Up to 22 interior cels fit between a two-cel source and the 24-cel layer limit, but the other budgets can be tighter. Existing history pruning still applies; this operation preserves an immediate Undo even for maximum-sized source and result projects.

Changing correspondence, reversal, count or editor input retires the reviewed proposal, including a value changed and then changed back. The new raw fields remain visible for another Review. Main frame/layer changes, edits, import/history/recovery work and page departure also retire the old preview. Deliberately leaving a pairing draft requires confirmation. Failed or cancelled work cannot resurrect an old proposal or overwrite newer artwork. Normal downloads always contain committed work; review scratch is neither autosaved nor included in project backups.

## Bounds and image import

- Stage: **640×360**, **12 fps**, **12–96 frames** (1–8 seconds). Blank projects start with 48 frames.
- At most **8 layers**, **24 drawing boundaries per drawing layer**, **24 pose keys per layer**, and **4 image layers**.
- At most **100 strokes**, **1,000 points per stroke**, and **10,000 points** across all stored drawings in the project; brush width 1–40 stage pixels. A held drawing is counted once; an explicit duplicate consumes its full copied stroke/point budget.
- Pose position: X −640 to 1280, Y −360 to 720; scale 0.1–4; rotation −720° to 720°; opacity 0–1.
- Project title: 1–80 characters; layer names: 1–40 characters; project JSON: **6 MiB + 168 bytes** maximum (6,291,624 bytes).
- Image input: actual **static PNG, JPEG, or static WebP**, at most **4 MiB** and **16 megapixels**. SVG, animated PNG/WebP, remote image URLs, and unsupported formats are rejected.

Image headers and decoded dimensions are checked before publication. Imported images become embedded PNG assets with their longest side at most 800 pixels and each data URL at most 1.5 MiB; further downsizing may be needed to meet that limit. Backups include those normalized images rather than links to the originals. Invalid project imports or image decode failures preserve the current project.

## Save and export

The **Projects** list keeps up to **eight** named, independently editable animations in this browser profile and site address. **New project**, **Try the orbit demo**, and **Open project file** create entries. **Open** switches to a saved project; the existing **Project title** field renames it. **Duplicate current project** copies its complete committed artwork into a separate entry. The library never silently evicts a project. Explicit **Delete** names the project and asks for confirmation; deletion is outside Undo, so download a backup first. Deleting the last project leaves an empty library rather than resurrecting an earlier legacy draft.

Edits autosave the opened project in **IndexedDB**, after a short debounce. Switching waits for the current save; opening another project starts a fresh session Undo history. Finish or explicitly discard raw editor values and reviewed in-between scratch before switching. Only the selected project's images are decoded. Eight maximum-size schema-2 payloads total **50,332,992 bytes**, plus bounded library metadata; this is a serialized capacity limit, not a guarantee of browser quota or memory use. A quota error keeps current work available for download.

Each save compares the actual saved project before writing. Another tab's newer edit or deletion causes protected recovery instead of an overwrite or recreated deleted row. Independent edits to different entries can save safely, and saving does not change a project another tab selected. **Refresh projects** updates the list without replacing editor fields or raw drafts. Current unsaved memory remains visible; download it, explicitly reload a saved copy, or use **Save memory as new project** when a valid library has room. Leaving protected unsaved work requires explicit confirmation.

The original single-project record is preserved during the library upgrade; **Download original legacy draft** exports that retained source separately from current project backups. Reading alone never rewrites it. After actual model/image admission, the first successful edited save promotes the legacy project; creating another project retains the admitted legacy project alongside it. A present empty or invalid library never falls back to that old record. Malformed data, failed reads, undecodable images and uncertain transaction completion protect writes while allowing memory edits and downloads. An invalid individual entry does not prevent opening other valid projects. An invalid library cannot be silently reconstructed or cleared.

**Saved draft recovery** separates the saved native record from current editable work. **Download preserved record** exports the exact read native value, including unknown fields and a library row wrapper when present. Unsafe or lossy JSON shapes—including cycles, undefined, nonfinite/negative-zero numbers, dates, typed values and sparse arrays—are refused. Nesting is limited to 512 levels, and shared structures are charged for their expanded JSON size before serialization. The plain project cap is 6,291,624 bytes; a library row allows an additional 256 bytes for its bounded wrapper. Failed reads have unknown contents until a retry succeeds. **Retry saved draft** rereads the saved copy and validates its images; cancellation or a later edit preserves current memory, history and raw values.

**Replace saved project** reviews the actual saved value afresh and asks for explicit confirmation. A successful transaction enables ordinary saving only for the captured current editor state. Cancelled, failed, stale or late replacement does not mark newer work saved. Unsafe values with no bounded comparable identity and malformed library metadata remain protected. Storage operations have a ten-second deadline; timeout is not proof of rollback and never permits an unchecked overwrite.

Regularly download **Save project file** (`.motion.json`) for an editable backup outside browser storage. It remains plain schema-2 Project JSON with every drawing boundary and embedded image; library IDs and wrappers are not added to portable files. **Open project file** validates the model and every image before adding a new entry. Select **Replace current project** to explicitly replace editable work while retaining its library identity; in protected recovery this changes memory only until deliberate saved-copy replacement succeeds. Genuine schema-1 projects migrate into one first drawing per drawing layer with their original appearance and poses. The 168-byte compatibility allowance covers the maximum eight legacy drawing wrappers. Older app versions reject schema 2 and the upgraded database instead of silently losing artwork.

Browser data can be cleared or become unavailable. There is no account backup, online synchronization or private hosted link.

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

Playwright builds the production app with `MOTION_TEST_HARNESS=1` and serves it on port 4210. The flag adds isolated renderer/export and native library-storage test pages; ordinary production builds omit them. Tests use the real canvas and GIF worker, with independent GIF decoding to inspect frame order, delays, duration, and moving pixels. Unit coverage checks model bounds, interpolation, coordinate inversion, history, image containers, and export lifecycle; browser coverage exercises storage and actual encoded output. CI installs only npm dependencies and Chromium—no ML runtime, model, or backend service.

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

The drawing in-between acceptance runner uses separate original fixtures and closed-form geometric expectations. With a normal build already served locally, run:

```sh
MOTION_TWEENS_BASE_URL=http://127.0.0.1:4294 CHROMIUM_PATH=/path/to/chromium node scripts/smoke_drawing_tweens.mjs
```

It creates a fresh temporary directory, or a new directory named by `MOTION_TWEENS_OUTPUT`; `--fixtures-only` prepares and independently checks the original inputs without a browser. One fixture reaches 24 selected cels, 100 project strokes and 10,000 points with four genuinely decoded PNGs containing declared ancillary capacity padding. A separate eight-pair fixture reaches the same global stroke/point limits. The runner checks scratch isolation, exact endpoints, one Undo/Redo, real PNGs and all 96 GIF frames against independent geometry, plus a complete Chromium process restart. The image fixture is near the JSON ceiling; it does not claim the exact byte maximum or photographic complexity. File sizes do not measure memory use.

Drawing in-betweens (#88) pass **132 unit tests and all 80 Chromium cases** in the reconciled local implementation, plus lint/typecheck/build. The browser suite includes the 61 original cases, 15 complete authoring workflows and four additional module/media cases. Independent regressions verified endpoint-control refresh, Undo discard consent, and exact legal scalar bounds. Geometric interpolation evaluates from the nearer endpoint to avoid overflow for equal or unequal near-boundary inputs; encoded RGB rounding and model limits are unchanged.

Chromium 153 CI exposed disappearing strokes whose sampled points all coincide. Preview/PNG/GIF and thumbnails now paint those paths as explicit filled circles; even tiny nonzero segments remain strokes. The original failure and its unchanged pixel assertions are preserved in [first CI evidence](docs/2026-10-04-drawing-tweens-ci-first.json). Concurrent [PR #89](https://github.com/twangyal/projects-monorepo/pull/89) contributed the unequal-boundary correction and additional media coverage, verified with 130 units and 80 browser cases in [run 37216786569](https://github.com/twangyal/projects-monorepo/actions/runs/37216786569). Its [follow-up evidence](docs/2026-10-04-tween-followup-verification.json) retains exact checkout provenance and finite-check limits.

The final combined maximum acceptance retains the original independent fixtures and tolerances: 24 selected cels, 100 strokes, 10,000 points and four decoded PNGs produce a **5,758,324-byte** project that survives a complete Chromium process restart byte-for-byte. A separate eight-pair fixture reaches the same global artwork limits with 12 cels and 378,378 bytes. All ten PNGs and 192 actual GIF frames match held artwork, independent pose motion and round-dot expectations; the 191,999-byte and 246,571-byte GIFs each have exactly 8,000 ms of delays. Numerical spelling changes explain the different JSON sizes from the earlier weighted formula.

See [reconciled verification](docs/2026-10-04-drawing-tweens-reconciled-verification.json), [initial local acceptance](docs/2026-10-04-drawing-tweens-verification.json), and [dot repair acceptance](docs/2026-10-04-drawing-tweens-dot-repair.json) for source/artifact hashes, timings, first attempts and limitations. `node --experimental-strip-types scripts/check_tween_limits.mjs` repeats two additional pure maximum-geometry checks; it does not measure raster output, persistence or memory. Exact combined-head push and PR CI at `f9e0a28457c3f04647b4a8d3bdbc0dfa1f0d57ff` pass all **132 unit and 80 browser tests**, lint/typecheck/build on Chromium153. All thirteen project PR workflows pass. The [CI receipt](docs/2026-10-04-drawing-tweens-ci.json) retains actual branch and synthetic-merge checkouts, logs and timings.


## Project library acceptance (#104)

The local library gate passes **147 unit tests**, ESLint, type checking and the production build. Staged production Chromium verification covers **121 distinct cases**: 22 native storage cases, 19 new library UI cases, and the 80 existing drawing/recovery/tween/export cases. The [implementation receipt](docs/2026-10-04-project-library-verification.json) and linked native receipts retain initial failures, fixture corrections, exact run scopes and hashes. This count combines documented passing runs; it is not a claim of one final local full-suite invocation.

The first editor gate exposed redundant writes during unchanged navigation. Removing those writes preserves exact native rows during cancelled imports, decode failure and full-capacity rejection, and prevents false cross-tab conflicts. Existing regressions also exposed duplicate tween-leave prompts and lost knowledge of already-read unsafe legacy records. Recovery now carries a non-authorizing exact read snapshot independently from replacement permission. Original artwork, raw-data, history and ownership assertions remain in place.

Maximum eight-project acceptance and exact published-head CI are recorded separately when complete.
