# Motion Studio

A local drawing and animation workspace: make original freehand artwork, create independent held drawings, review geometric in-betweens, combine artwork with layer poses and imported images, and export a GIF. Keep up to eight independently editable projects in your browser and download portable backups. An optional local service publishes immutable private snapshot links for viewing, downloads and explicit local copies. AI assistance and live synchronization remain future work.

## Run

Use Node.js **24+** and npm; CI uses Node 24. From the repository root:

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
7. Download **Save project file**, **Save frame PNG**, **Export animation** (GIF), or **Export PNG frames ZIP**. Animation exports report progress; **Cancel export** discards that export and preserves the editable project.

**Export PNG frames ZIP** saves every committed 640×360 frame in full color,
including held drawings, imported images and pose movement. It is also available
in a private snapshot viewer. The archive contains `manifest.json` and ordered
`frames/frame-0001.png` files. Frame 1 is time 0; each next frame is exactly 1/12
second later. The manifest records an exact 12/1 fps and the captured project title.
PNG images have the project's opaque background; editor overlays and private links
are excluded. Extract the ZIP to use the PNG sequence in another animation tool.
This is rendered artwork, while **Save project file** preserves editable layers.

ZIP entries are stored without compression. Limits are 1 MiB per PNG, 16 KiB for
the manifest and 96 MiB for the complete archive. Rendering runs one frame at a
time in an owned worker with a 30-second deadline. Any encoding/size failure
refuses the complete result. Cancellation and page departure release the worker;
no partial archive downloads. GIF retains its existing 256-color palette and
rounded centisecond timing.

Undo/Redo retain up to 30 project snapshots within a 20 MiB history budget; large projects may retain fewer. Ctrl/⌘ Z and Ctrl/⌘ Shift Z work outside text fields. With the canvas focused, Space toggles playback. History is session-only and is not included in backups.

## Correct an existing stroke

Choose a drawing layer and the desired held drawing, then select **Edit strokes**. Select a path on the canvas or choose **Stroke N** in **Selected drawing strokes**. The list follows paint order and can select artwork that is covered or outside the stage. Canvas selection checks the selected layer's active drawing; overlapping strokes select the last painted path. Imported images remain separate layers.

- Drag the selected stroke to move its whole path. Its shape and the layer's pose keys stay unchanged. A click only selects.
- With the canvas or a stroke button focused, use arrow keys to move one stage pixel, or Shift+Arrow for ten. Held repeated keys are ignored.
- Set **Selected stroke color** and **Selected stroke width**, then choose **Apply stroke appearance**. Width accepts finite values from 1 through 40. **Discard stroke edits** restores those fields from the committed stroke. Ink color and Brush width still control new drawing.
- **Delete selected stroke**, or Delete/Backspace while the canvas or a stroke button has focus, removes that path. Undo restores it. Ordinary text-field editing keeps its normal keyboard behavior.

Each completed drag, keyboard move, appearance application or deletion is one Undo/Redo edit. An unchanged value creates no edit. Corrections affect the active drawing throughout its held interval; detached duplicate cels and generated in-between drawings remain independent. Other strokes, images and pose keys are preserved.

Apply or explicitly discard raw appearance values before changing selection, frame, layer, mode or project. Selection clears on those transitions and on unrelated edits or history navigation. Pointer cancellation, Escape, focus loss, page departure or changed stage geometry discard a drag preview. A move that puts any point outside the supported coordinate range is refused as a whole. Selection outlines and drag previews are temporary: autosaves, project files, PNGs, GIFs and private snapshots contain only committed artwork.

This tool edits complete strokes. It does not reshape individual points, cut paths with an eraser, infer objects or generate artwork. The existing project format, file limits and saved-copy protection continue to apply.

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

Browser data can be cleared or become unavailable. The optional private-link service below stores only snapshots you explicitly publish; it does not synchronize browser edits or provide an account backup.

**Save frame PNG** exports the captured committed frame, including its held drawing and opaque stage background. A later edit, frame change or page departure retires a pending PNG download; it cannot acquire a new filename or frame from newer work. **Export animation** renders every frame through the same renderer as the preview, then encodes an infinitely looping GIF with a **fixed 256-color palette**. Colors and gradients can differ from the full-color PNG/preview; GIF is not a lossless archival format. Individual GIF delays alternate between 80 and 90 ms to approximate 12 fps, with total duration rounded to hundredths of a second. Export is limited to 30 seconds of processing and 32 MiB of encoded output.


## Private snapshot links

The optional service lets an operator publish a captured committed animation and send a private viewing link. Recipients can play it, export PNG/GIF/project files, or explicitly **Save as new local project** and then **Open local studio**. Later edits do not change an existing publication. Local library IDs, history and unfinished editor/tween drafts are excluded. Finish or discard pending drafts before publishing.

Keep using the static site when you do not need sharing. An unavailable service disables publishing only; drawing, local saves, imports and exports remain available.

The service requires Linux, `/proc/self/fd`, `flock` (usually `util-linux`), Node 24 and an existing production build. It uses a separate private data directory. From this project directory:

```sh
npm ci
npm run build
# Create a dedicated private operator configuration directory once:
install -d -m 700 /absolute/private/motion-config
umask 077
openssl rand -hex 32 > /absolute/private/motion-config/setup-token
chmod 600 /absolute/private/motion-config/setup-token
npm run serve -- --data-dir /absolute/private/motion-snapshots --port 8770 \
  --setup-token-file /absolute/private/motion-config/setup-token
```

Open `http://127.0.0.1:8770` on the same computer. Enter the setup key only in **Private snapshot links** when publishing. The key is creation authority; it grants no ability to view or revoke another snapshot. The page clears it when dispatching publication and never saves it in browser storage. Keep it private; distribute viewing links to recipients instead.

For other devices on a trusted private network, use HTTPS with a certificate whose SAN covers the exact chosen address or DNS name, and a CA chain trusted normally by each browser. Configure local DNS and trust outside this application. A DNS origin must resolve to the exact configured private IPv4 address. For example, with an operator-owned certificate and private key:

```sh
chmod 600 /absolute/private/motion-config/server-key.pem
npm run serve -- --data-dir /absolute/private/motion-snapshots --port 8770 \
  --bind 192.168.1.20 --origin https://motion.example.test:8770 \
  --tls-cert /absolute/private/motion-config/server-cert.pem \
  --tls-key /absolute/private/motion-config/server-key.pem \
  --setup-token-file /absolute/private/motion-config/setup-token
```

Supply all four HTTPS options together. Only explicit canonical loopback or RFC1918 IPv4 binds are accepted; wildcard/public/IPv6 addresses, reverse proxies and forwarded origins are unsupported. The exact configured origin is the link origin and required request authority. TLS configuration and the listener are checked before the store is opened. Private key and setup files must be owned by the service user, regular nonsymlink files with mode 0600. No automatic certificate installation or trust bypass is provided.

A publication returns two separate links. The **viewing link** allows the captured project to be read; the **revocation link** allows only explicit revocation. Treat both as private capabilities. The viewer removes their fragment from the address bar before fetching and keeps authority in page memory only; reloading requires the original link. Credentials never enter downloaded project/media files. Revocation stops later authorized reads, including after a service restart, but cannot recall a copy already downloaded or a response already authorized.

Publishing and revocation have an 80-second browser deadline covering the whole exchange; cancel or timeout never replays the command. A lost publication response can mean the snapshot was committed even though its links were not received. Do not automatically retry. The operator can inspect stored publication IDs/titles offline and revoke a chosen ID while the service is stopped; these commands acquire the same store lock and print no capabilities:

```sh
npm run serve -- --data-dir /absolute/private/motion-snapshots --inspect
npm run serve -- --data-dir /absolute/private/motion-snapshots --revoke-id UUID
```

The store holds at most eight active publications, each at most 6,291,624 canonical UTF-8 bytes with every embedded image. Eight maximum payloads total 50,332,992 bytes plus index and temporary staging. Revoke an old publication explicitly to free a slot. Unknown/corrupt stored data refuses startup and remains protected; there is no automatic empty reset. Back up the entire stopped private directory securely if needed. The service never lists publications over HTTP.

Network admission is bounded to 16 connections before TLS work, one publishing body/decode worker, a 5-second TLS handshake, 10-second headers, 15-second body, 30-second decode/response phases and 75-second connection lifetime. Headers are limited to 16 KiB and 64 fields. PNG admission validates complete compressed data and actual pixels before publication; these bounds are capacities, not peak-memory or general speed guarantees. No accounts, collaboration, automatic cloud upload, paid service or deployment is included. Physical two-device trust and browser acceptance require a separate real hardware check.

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

Exact published-head [push CI](https://github.com/twangyal/projects-monorepo/actions/runs/37228372920) and [PR CI](https://github.com/twangyal/projects-monorepo/actions/runs/37228375087) each pass **147 unit tests and the complete 121-case Chromium suite**, plus lint/typecheck/build. The branch checks out `f6b633a349881b30072469e740d25f3cff7de74a`; the PR checks out `8280a3154ff87d97593243221de5c2069a34c9af`, whose tree is identical. CI uses Node 24.21.0 and Chromium 153.0.8010.12; each browser suite reports 1.1 minutes. All thirteen project PR workflows pass. The [CI receipt](docs/2026-10-04-project-library-ci.json) retains exact checkouts, counts, decoded-log hashes and run IDs.

The independent first maximum run imports **eight original 6,291,624-byte projects**, totaling **50,332,992 canonical payload bytes**. Each has eight layers, four genuinely decoded 800×800 PNGs, 27 drawing boundaries, 100 strokes and 10,000 points across 96 frames. A full Chromium process restart preserves all eight IDs/order/active selection and byte-exact backups. Independent checks cover **64 actual PNG exports and all 768 frames of eight actual GIFs**, including held colors/blank intervals, moving artwork, stationary controls and embedded images. Each GIF has exactly 8,000 ms of delays; together they contain 1,451,678 encoded bytes. Rename/Undo/Redo remains isolated to its owner. Full-capacity duplication is disabled at the UI; a ninth real File import is actually attempted and refused without changing existing work.

This Chromium 151.0.7922.173 run took 346.19 seconds, including native timeline navigation and downloads. Desktop and 390px views had no horizontal overflow, page errors or external requests. Large source PNGs contain declared ancillary padding to exercise byte capacity; this is not a claim of complex photographic content, available browser quota, peak RSS or general speed. See [maximum evidence](docs/2026-10-04-project-library-maximum.json) for original/export hashes, timings, screenshot receipts and limits.

To repeat the maximum gate, use a normal production build and fresh output directories. From this project directory:

```sh
npm run build
npm run preview -- --port 4294 --strictPort
# In another terminal, generate independently checked original inputs:
MOTION_LIBRARY_OUTPUT=/tmp/motion-library-fixtures node scripts/smoke_project_library.mjs --fixtures-only
# Then run actual File imports, downloads and a complete Chromium restart:
MOTION_LIBRARY_BASE_URL=http://127.0.0.1:4294 MOTION_LIBRARY_FIXTURES=/tmp/motion-library-fixtures MOTION_LIBRARY_OUTPUT=/tmp/motion-library-acceptance CHROMIUM_PATH=/path/to/chromium node scripts/smoke_project_library.mjs --run-existing
```

Existing fixture/output directories are refused. The runner owns a private browser profile and closes only its own Chromium processes; it never starts a build/server or reads an existing user library. `--fixtures-only` checks original inputs but does not verify the app.

### New-project regression readiness (#106)

A later PR run at `191018e5670fda48430a3da0da8c6f35341d6041` passed all 147
units but exposed one browser-fixture race (120/121): the transformed-drawing
case filled Scale before asynchronous **New project** admission completed.
The retained trace showed Scale remaining at 1 during the disabled transition,
so the later edge drawing was correctly in bounds. The test now waits for the
actual new-project completion status and enabled Scale, then asserts its 0.1
input before applying the key. All original geometry, stroke-count and page-error
assertions remain intact. The affected native case passes against the unchanged
production bundle; the [first-failure receipt](docs/2026-10-04-new-project-readiness-first.json)
and [repair verification](docs/2026-10-04-new-project-readiness-verification.json)
record the evidence. Final published-head CI is recorded separately.

The next head `6ec2f2cf827c16eb591d5721a87ac50813b73b49` passed all 147/121 in
push CI, but PR CI exposed a distinct tween-test reload before Redo had saved
(120/121). Its trace showed **Saving locally…** immediately before reload;
all in-memory artwork comparisons had passed. The test now waits for successful
saving and actual native persisted-row equality before reloading. A focused
audit also strengthens identical-file reimport, ninth-file refusal and SVG
refusal checks so they cannot pass on an earlier message or unchanged old data.
All four affected native cases pass against the unchanged production bundle,
with original artwork/error expectations intact. The [intermediate CI receipt](docs/2026-10-04-new-project-readiness-ci.json)
retains that head’s separate push success and PR failure.

Final [push CI](https://github.com/twangyal/projects-monorepo/actions/runs/37231292424)
and [PR CI](https://github.com/twangyal/projects-monorepo/actions/runs/37231295040)
at `50373f43bb9e401d049018ece8117060b00dbeaa` each pass **147 unit tests and
all 121 browser cases**, plus lint, type checking and build. The PR's actual
synthetic merge has the same source tree; both use Chromium 153.0.8010.12.
All thirteen project PR workflows pass. The [final CI receipt](docs/2026-10-04-new-project-readiness-final-ci.json)
preserves checkouts, log hashes and timings alongside the earlier failures.

## Private-link verification (#110)

The optional service retains the existing model, local-library and rendering suites. Independent producer and oracle checks cover complete PNG color/depth/Adam7 admission, bounded zlib output, actual inherited-FD flock ownership, canonical TLS configuration, role-separated read/revoke capabilities, durable commit/revocation ordering, protected corruption and shutdown lock retention. Actual transport tests measure five-second TLS, ten-second header and five-second shutdown branches; other absolute limits are explicit source bounds, not separate wall-clock measurements. The browser mutation deadline uses controlled-clock tests. See the [integration receipt](docs/2026-10-04-private-links-verification.json) and its linked producer/protocol evidence for exact run scopes and initial failures.

The normal-build native gate exercises real HTTPS publication, separate recipient contexts, actual preview/PNG/GIF/project downloads, explicit local copies, stale/cancelled reads, raw-draft protection, capacity, corrupted local data, revocation and whole-service restart. Its first run found a real static-route error: the service rejected Vite's dotted GIF-worker basename. The repaired route serves the worker while preserving traversal and unlisted/private-file refusal. Test-only readiness/status corrections are retained separately in the [native receipt](docs/2026-10-04-private-links-native.json).

Eight independently authored **6,291,624-byte** projects total **50,332,992 bytes** and pass actual browser publication, embedded-PNG admission and byte-exact downloads before and after a full CLI restart. A ninth publication returns 409. Every original revoke capability still works after restart; all eight revoked links remain refused after another restart. Four PNG boundaries and **all 96 frames** of one representative maximum GIF match independent artwork and timing; that 122,817-byte GIF has exactly 8,000 ms of delays. The other seven projects are byte-retention checks, not additional media-export claims. The passing run took 57.85 seconds in this environment. Small original PNGs carry declared ancillary padding to reach the byte boundary; this does not measure complex photographic decoding or peak RAM.

The first maximum attempt compared literal source property order with the existing validator's canonical order. Retained downloads from the corrected run prove identical parsed artwork/image bytes and unchanged exact byte counts; each viewer file is byte-identical to the actual captured editor backup. Original fixtures, first failure, actual artifacts and process cleanup remain in the [maximum receipt](docs/2026-10-04-private-links-maximum.json). That media gate predates the later HTTP-port-80 and bounded-client-exchange refinements; its exact normal bundles are recorded separately from final native/CI validation.

To repeat the actual maximum gate from this project directory after a normal build:

```sh
npm run build
MOTION_PRIVATE_OUTPUT_DIR=/tmp/motion-private-acceptance \
  CHROMIUM_PATH=/path/to/chromium node scripts/smoke_private_links.mjs
```

The output directory must not exist. The runner creates original inputs, its own ephemeral service/key material and browser contexts, then closes only its own processes. Chromium trusts only the generated fixture SPKI; readiness and independent Node/Python protocol checks use ordinary CA and hostname validation. No production trust bypass is present. A separate [private-interface gate](docs/2026-10-04-private-links-private-interface.json) verifies actual same-host RFC1918 traffic, original capabilities and permanent revocation across two restarts. Physical devices and public hosting remain unverified.

Final local integration passes **204 unit tests and all 130 Chromium cases** in complete invocations, plus ESLint, type checking and the normal production build. The full native run includes all 121 existing editor/storage/media cases and all nine sharing cases, with the final origin/deadline client handling. The first full unit attempt caught an intermediate test-launcher argument correction; no product repair was needed for that failure. Exact published-head CI results follow below.

The first published head passed 203/204 unit tests in both CI events before the browser stage. Its simulated crash-file fixture inherited the process umask: local 0077 created the required 0600 file, while CI 0022 created 0644. The service correctly refused that nonprivate child. The fixture now explicitly creates its intended valid orphan with mode 0600; a focused run under umask 0022 reproduces the failure and then passes. Production permission enforcement and corrupt-file refusal remain unchanged. The first failure is retained in the [initial CI receipt](docs/2026-10-04-private-links-ci-first.json).

Exact corrected-head [push CI](https://github.com/twangyal/projects-monorepo/actions/runs/37238138030) and [PR CI](https://github.com/twangyal/projects-monorepo/actions/runs/37238141120) each pass **204 unit tests and all 130 Chromium cases**, plus lint, type checking and build. The branch checks out `45af03a2bcb00b5c862f153dbc138231cac4e11c`; the PR checks out `628b964c311c5aa5def3171da518d0e146cca585`, with the same verified tree. All thirteen project PR workflows pass. The [final CI receipt](docs/2026-10-04-private-links-ci.json) records exact checkouts, log hashes, timings and the one-line fixture repair; no workflow was rerun. This completes the optional private-snapshot milestone. Physical devices and public hosting remain unverified.


## Retained-stroke acceptance (#122)

Version 0.6 adds whole-stroke selection, movement, appearance changes and deletion without changing the saved format or renderer. Local acceptance passes **225 unit tests and all 141 native browser cases**, plus lint, type checking and production build. The [verification receipt](docs/2026-10-05-stroke-edit-verification.json) preserves original failures and the narrow repairs for unchanged uppercase color values consuming Redo and explicit pose Discard committing on blur. Independent native tests cover transformed geometry, dots/overlaps, raw fields, cancellation, touch/list/keyboard authoring, real PNGs and every frame of an exported GIF. Both first published [push](https://github.com/twangyal/projects-monorepo/actions/runs/37257098966) and [PR](https://github.com/twangyal/projects-monorepo/actions/runs/37257103189) CI runs pass the same 225 unit and 141 native cases at `6dc7571aef7959d8dbb117b03326506976a320bd`. The actual PR merge has the identical source tree; the [CI receipt](docs/2026-10-05-stroke-edit-ci.json) records checkouts, logs and the unrelated Karaoke failure in the wider PR run.

The [maximum run](docs/2026-10-05-stroke-edit-maximum.json) verifies eight layers, four original embedded PNGs, 100 strokes, 10,000 points, a 1,000-point stroke and 24 drawings in the selected layer. An exact **6,291,624-byte** project survives complete Chromium restart; one extra input byte is refused. Separate unpadded artwork permits real edits without artificial numeric-size restrictions. Its **223,074-byte** edited backup survives another restart byte for byte, with exact unrelated artwork, images and pose keys. All **96 GIF frames / 8 seconds** and original/edited PNG checks match independent geometry and color expectations. Capacity PNG padding is declared; these checks do not establish peak memory, physical touch hardware or a combined 192-cel maximum.

## PNG frame archive acceptance (#127)

The [verification receipt](docs/2026-10-05-png-frames-verification.json) records
237 unit cases, lint/type/build and all 146 native browser cases locally and in
both first published push/PR runs at `d076b3e`. The actual PR merge has the same
verified implementation tree. An independent reader checks ZIP headers, CRCs,
manifest and every PNG, including the 96-frame/eight-layer/four-image/100-stroke/
10,000-point maximum. Separate original artwork preserves 1,024 exact colors,
held-cel boundaries and poses. Both editor and HTTPS private viewer release real
workers on cancellation after frame progress and controlled page departure.
Valid ancillary padding admits the exact 96 MiB cap and rejects +1; this byte
capacity check does not establish general latency or peak memory.

## Playback startup clock repair (#136)

Editor and private viewer playback now guard an early first animation callback
against negative elapsed time. The [verification record](docs/2026-10-07-snapshot-playback/verification.md)
retains the original native failure, clock regression, and current validation
limits. Authored frames, endpoint/loop behavior, export formats and HTTPS
authority remain unchanged.
