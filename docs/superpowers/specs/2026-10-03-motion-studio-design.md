# Motion Studio: drawing-to-animation milestone

Issue #16; path `apps/motion-studio`. The user authorizes autonomous product choices and execution on Astra. Idea #11's first intended flow is drawing/upload → motion keyframes → preview → animation export. Local deterministic tools can complete this flow without a hosted account, physical device, or trained model. AI assistance and private online links are later extensions; no such capability will be implied.

## Architecture and choices

Use an independent TypeScript/Vite app with Canvas 2D, browser IndexedDB, and a GIF export worker. Vector strokes plus normalized raster layers are preferable to whole-canvas frame painting because users can adjust poses after drawing and keep small editable projects. GIF is chosen over real-time recording for deterministic offline frame timing, broad playback and inspectable downloaded frames. Fixed 256-color quantization is an explicit export limitation. A browser-only service avoids deployment/accounts and keeps artwork local.

Project coordinates are a fixed 640×360 stage, 12 fps, 12–96 total frames (1–8 seconds), frames indexed 0 through frameCount−1. Default blank project has 48 frames and one drawing layer; default demo is original mathematical artwork with visible motion. At most 8 layers, 24 keys/layer, 100 strokes total, 1,000 points/stroke, 10,000 points total; bounded values below. JSON limit 6 MiB. Images accept only PNG/JPEG/static WebP up to 4 MiB and 16 megapixels, normalize to PNG with longest dimension at most 800, bound each normalized data URL to 1.5 MiB and image count to 4. Imports validate actual header dimensions, decode result and format; project restore validates/decodes every image before publication. Reject SVG, external URLs, animated WebP, malformed media and invalid model values. Imported assets are embedded; no fetch to an external service.

## Shared model contract (`src/model.ts`)

Export constants WIDTH=640, HEIGHT=360, FPS=12, MAX_FRAMES=96. Exact types:

- `Point = {x:number;y:number}`; artwork-local points each axis in [−1280,1280].
- `Stroke = {color:string;width:number;points:Point[]}`; lowercase/uppercase #RRGGBB accepted, width 1–40, points 1–1000.
- `Pose = {x:number;y:number;scale:number;rotation:number;opacity:number}`; x [−640,1280], y [−360,720], scale .1–4, rotation −720..720 degrees (linear interpolation, allowing a spin), opacity 0–1.
- `Easing = 'linear'|'hold'|'ease'`; `Keyframe = Pose & {frame:number;easing:Easing}`. First key always frame 0; unique strictly increasing integer frames < frameCount. Easing belongs to the segment's starting key, ease = smoothstep `t*t*(3-2*t)`.
- `DrawingLayer = {id:string;name:string;kind:'drawing';strokes:Stroke[];keys:Keyframe[]}`.
- `ImageLayer = {id:string;name:string;kind:'image';image:{dataUrl:string;width:number;height:number};keys:Keyframe[]}`. Image width/height are normalized asset pixel dimensions; renderer fits artwork to max 320×240 initially with no upscale (this is the untransformed local image geometry).
- `Layer = DrawingLayer|ImageLayer`.
- `Project = {schemaVersion:1;title:string;background:string;frameCount:number;layers:Layer[]}`. Title 1–80 characters; layer name 1–40 characters. IDs are generated local UUIDs, validated with regex `[a-zA-Z0-9_-]{1,64}`, and unique. The background is opaque hex RGB. Layers are ordered bottom to top.

Pure functions throw human-readable Error on invalid edits: `validateProject(value:unknown):Project` reconstructs safe known fields without mutating; `createProject():Project`, `createDemo():Project`, `createDrawingLayer(name?:string):DrawingLayer`, `evaluatePose(layer:Layer,frame:number):Pose`, `upsertKeyframe(layer:Layer,frame:number,pose:Pose,easing?:Easing):Layer` (replaces the same frame, keeps keys sorted, enforces caps), `removeKeyframe(layer:Layer,frame:number):Layer` (frame 0 cannot be deleted), `resizeTimeline(project:Project,frameCount:number):Project` (shortening preserves the evaluated new endpoint, then drops keys beyond it; cannot silently exceed the key cap). `localPoint(point:Point,pose:Pose):Point` inverts translation, rotation, and scale.

`src/history.ts`: `History` is constructed with a Project and exposes the `current` getter and `canUndo/canRedo`. `commit(project):boolean` ignores identical states; `undo():Project`, `redo():Project`, and `reset(project):void` manage history. Bound history to 30 states and 20 MiB serialized total, retaining the current project (it remains bounded by the 6 MiB project limit). Consumers treat values immutably (clone getters if needed).

## Rendering and image contract

`src/render.ts`: `type Assets = Map<string,ImageBitmap>` is keyed by layer ID. `loadAssets(project:Project):Promise<Assets>` decodes all images before replacement and closes assets on partial failure; `closeAssets(assets):void` releases them. `renderFrame(ctx:CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D,project:Project,frame:number,assets:Assets):void` fills the background and draws ordered layers with shared `evaluatePose`, round stroke ends, and transformed image geometry. No editor selection overlays appear in exports. `layerBounds(layer):{width:number;height:number}` returns drawing bounding-box dimensions (minimum 1) or fitted image geometry if needed.

`src/images.ts`: `importImage(file:File):Promise<ImageLayer>` performs all bounds checks, validation, and normalization. `validateProjectImages(project):Promise<void>` verifies all decoded assets against their declared normalized dimensions; restore stays atomic. Do not trust image extensions.

## GIF worker contract

`src/export.ts`: `exportGif(project:Project,onProgress:(fraction:number)=>void,signal?:AbortSignal):Promise<Blob>` snapshots the validated project. Use a module Worker per job; terminate on abort, completion, or error; reject unsupported APIs; enforce a 30-second timeout and 32 MiB encoded-output limit. The worker uses a 640×360 OffscreenCanvas and the same `renderFrame/loadAssets`, with a fixed 3/3/2-bit palette, emitting all `frameCount` frames. GIF hundredths timing distributes rounded timestamps so total duration matches `frameCount/12` within 0.01 seconds; loop infinitely. Close ImageBitmap and worker resources. PNG stills use the visible `canvas.toBlob` without selection overlays; UI downloads use managed object URLs.

## Browser editor behavior

Use a light, legible workspace with drawing tools/layers on the left, stage and transport in the center, selected-layer pose and keyframe controls on the right, and a responsive stacked mobile layout. Start with a clearly labeled demo; New project uses explicit reset confirmation when replacing work. Draw and Move modes convert pointer positions to the selected drawing's local coordinates at the current frame. Each gesture creates one history entry; pointer cancellation aborts it. A Move gesture edits the selected layer's pose at the current frame and commits its key only when the gesture finishes. Numeric X/Y/scale/rotation/opacity fields provide an accessible alternative: committing a field change automatically creates or replaces a key at the current frame. Changing easing also sets a key; Set keyframe remains available explicitly. Remove key excludes frame 0; visible frame buttons and the timeline list allow seeking. Drawing appends artwork across all frames; this is layer transform animation, not frame-by-frame morphing. Support layer reorder, deletion, and addition. Undo/redo keyboard shortcuts apply outside text editing; the explicit deletion button affects only the selected layer. Playback through requestAnimationFrame stops at the end or follows the Loop checkbox. No edits occur during export.

Debounce IndexedDB autosave. Guarded restore must not replace edits or gestures started before loading completes. Save errors leave work editable and JSON download available. JSON imports of at most 6 MiB stage the validated model and decoded images before replacement; the latest operation wins. Restore, export cancellation, and pagehide release resources. Imports do not partially replace work. Show local save state and bounded errors. Backup JSON round-trips the exact valid state; support PNG and animated GIF downloads. Cancellation preserves the project and previous downloads.

## Ownership and verification

- git_reader: model.ts/history.ts and pure tests. Prove interpolation endpoints, gaps, hold/ease/spin, transform inversion, bounds, immutability, key insertion/deletion/resize, and bounded history.
- audio_engine: render.ts/images.ts and image unit/browser helpers/tests as appropriate; check actual images, consistently rendered poses, and resource cleanup.
- git_runner: export.ts/gif.worker.ts/gifenc.d.ts and export tests; decode actual GIF frames/timing and test cancellation.
- root: package/config, main.ts/style.css, storage.ts, browser workflow tests, docs/catalog/CI/integration.
- fresh reviewer: security, stale operations/work loss, preview/export agreement, output validity, and accessibility.

A meaningful browser flow draws an original stroke, creates another pose/key, scrubs to observe changed pixels, persists/reloads, and downloads independently decoded GIF plus PNG and JSON. Include image import, preservation after invalid restore, undo/reorder/delete, cancellation, blocked storage, and mobile layout without external requests. Use an independent GIF decoder for frame count, delays, and pixel movement; inspect actual desktop/mobile views and decoded frames. CI tests the production build. All changes stay outside excluded projects.
