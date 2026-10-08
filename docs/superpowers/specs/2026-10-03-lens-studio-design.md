# Lens Studio — focal field of view and authored depth

Idea #16, issue #31; path `apps/lens-studio`, branch Astra. This document defines the queued architecture.
Friendly Challenges and Karaoke milestones are durable; root controls release of Lens implementation after written-contract review.
The user authorizes autonomous product decisions; this task edits only the spec, with no Lens code, dependencies, catalog or Git changes.

## Purpose and scope

Turn one existing photo into a useful, inspectable lens simulation: import → declare focal lengths → compare → export → reopen.
Fixed-position mode changes field of view through real crop/resampling under a same-sensor, rectilinear projection assumption.
Experimental perspective mode changes focal length and virtual camera distance together using three user-authored depth planes.
Every source pixel belongs to exactly one plane. Preserve original transparency; missing field and disocclusion also remain transparent. Preview shows a checkerboard.
No estimated depth, generated fill, recovered hidden scene, lens distortion, optical blur, or real-camera calibration is claimed.
Source focal length is a user declaration, initially 50mm; do not infer it from appearance or silently trust camera metadata.
Use the same focal-length basis for source and target: the same physical sensor/crop or consistently supplied equivalent values.
Resized, cropped, distorted and unknown-camera photos can only support the declared projection approximation.
Manual depth models three flat, camera-parallel planes with relative distances; it does not establish actual scene geometry.
If perspective fails the independent synthetic gate below, ship the complete fixed-position flow and clearly defer perspective.
Catalog/README must then describe the delivered subset; do not claim both original modes complete.

## Architecture and bounds

Use an independent TypeScript/Vite DOM app, browser Canvas, module render workers and IndexedDB. No backend or runtime network calls.
Share one deterministic pixel kernel between preview and PNG export; Canvas presents pixels and a pure lossless RGBA encoder writes export PNG.
Keep image handling, model/history, render/export, storage and editor modules separate. No cross-app mutable imports.
Lessons from Style/Motion may inform independent implementations, including all eight orientations, atomic restore and cancellation.
Require current desktop Chromium with createImageBitmap, OffscreenCanvas, Canvas 2D and workers; unsupported APIs produce actionable errors.
Development port 4260; production browser tests reserve 4261. Test-only harnesses use separate ports/output directories.
Source photo: PNG/JPEG/static WebP only, 1 byte–8 MiB, dimensions 1–8192 per side, at most 16,000,000 pixels before decode.
Reject SVG, GIF, APNG, animated WebP, malformed/truncated headers, conflicting metadata, external URLs and MIME/magic disagreement.
Normalize once to orientation-correct PNG, no upscale, longest side at most 1280; each dimension remains at least 1.
Normalized PNG bytes at most 7 MiB. JSON backup at most 12 MiB UTF-8, including one embedded photo and one depth mask.
Source dimensions/aspect become the fixed output dimensions/aspect. No independent output sizing or aspect changes in this milestone.
Focal lengths: finite numbers 10–300mm, to at most two decimal places; ratio target/source in [0.25,4]. Default source/target 50.
Framing shift X/Y: finite normalized output fractions [-0.5,0.5], to at most four decimals; default 0,0.
Relative near depth [0.1,0.95], subject depth exactly 1, far depth [1.05,10], to at most three decimals; defaults 0.6,1,2.
For d decimal places accept `abs(v*10^d-round(v*10^d)) <= 1e-7`, then reconstruct as `round(v*10^d)/10^d`.
Perspective additionally requires `near + ratio - 1 >= 0.05`; reject the settings before render if the camera would cross a plane.
This condition applies even to an unused near plane, so later painting cannot silently make valid settings unsafe.
Depth mask: exactly width×height bytes with values 0=near, 1=subject, 2=far; canonical base64 in persisted JSON.
Default mask is all subject. Explain that perspective stays unchanged until near/far pixels are assigned, apart from framing shift.
Brush radius is an integer 1–100 source pixels; require 1–2048 finite points and at most 8192 source-pixel total polyline length per gesture. One completed gesture is one history edit.
History: at most 30 edit states and 32 MiB compact UTF-8 edit-state bytes, retaining current state; photo is held once outside edit history.
Render/export jobs: one active job module-wide across both APIs, 30-second deadline, PNG output at most 7 MiB; cancellation terminates its worker.
Titles: trimmed 1–80 Unicode characters. IDs: generated crypto.randomUUID, canonical lowercase UUID pattern.
All objects have exact known keys; numbers finite, dimensions/counts integers, actual booleans where applicable.
Reject duplicate decoded JSON keys, unsupported schema, controls except LF/CR/tab, invalid Unicode, excessive nesting (>24), and unsafe numbers.
Bounds apply at direct public module entry points as well as editor controls. Errors never include user source text or complete data URLs.

## Exact shared types — `src/types.ts`

```ts
export type Mode = 'fixed' | 'perspective';
export type Plane = 0 | 1 | 2;
export interface Point { x:number; y:number }
export interface PhotoAsset {
  id:string; dataUrl:string; width:number; height:number;
}
export interface Settings {
  mode:Mode; sourceFocal:number; targetFocal:number;
  shiftX:number; shiftY:number; near:number; far:number;
}
export interface DepthMask { width:number; height:number; labels:string }
export interface Project {
  schemaVersion:1; id:string; title:string;
  photo:PhotoAsset; settings:Settings; depth:DepthMask;
}
export interface EditState { title:string; settings:Settings; depth:DepthMask }
export interface Raster { width:number; height:number; rgba:Uint8ClampedArray }
export interface Rendered extends Raster {
  missingFraction:number;
}
export interface PhotoHeader {
  format:'png'|'jpeg'|'webp'; width:number; height:number; orientation:1|2|3|4|5|6|7|8;
}
```

Export `LIMITS` with the exact limits above. Embedded photo prefix is exactly `data:image/png;base64,`.
Base64 must use canonical padding/alphabet and round-trip identically; decoded byte limits apply before allocating/decode.
Photo and mask dimensions must match. Normalized photo headers must declare its dimensions, no animation and no orientation metadata.
Pure structural validation cannot prove pixels decode; async decoded-image validation is required before publication/restore.
`Rendered.missingFraction` is the mean geometric uncovered fraction defined below, not a count of dark/transparent photo colors.

## Pure model and history contracts

`src/model.ts` exports `validateProject(value:unknown):Project`, reconstructing detached safe fields without mutation.
Export `createProject(photo:PhotoAsset):Project`: title "Lens study", fixed mode, default settings and all-subject mask.
Export `updateSettings(project:Project,patch:Partial<Settings>):Project`; reject unknown patch keys and invalid resulting configuration.
Export `decodeMask(mask:DepthMask):Uint8Array` and `encodeMask(labels:Uint8Array,width:number,height:number):DepthMask`.
These validate dimensions, exact byte count and every label. Returned arrays are detached.
Export `paintMask(project:Project,plane:Plane,radius:number,points:Point[]):Project` with source-edge coordinates x∈[0,W], y∈[0,H].
Rasterize circular stamps at pixel centers with squared distance <=radius². For total polyline length L, stamp at cumulative distances 0,radius/2,2*radius/2,... <=L, plus L if not already included.
Interpolate each stamp on its containing segment; skip zero-length segments, with a zero-length gesture producing one stamp. Clip to source bounds; reject excessive length atomically with shorter-stroke guidance. Do not paint in projected result coordinates.
Export `fillMask(project:Project,plane:Plane):Project` and `resetProjection(project:Project):Project`.
Reset projection sets target equal source and shifts to zero, retaining mode, source focal, depths and painted mask.
All these helpers validate their input, return detached values and preserve the original on error.
`serializeProject(project):string` emits compact validated JSON within 12 MiB; `parseProject(text:string):Project` enforces strict JSON rules.
`src/history.ts`: `History(project)` exposes `current:Project`, `canUndo:boolean`, `canRedo:boolean`.
Methods `commit(project):boolean`, `undo():Project`, `redo():Project`, `reset(project):void` return isolated state.
Commit ignores identical state, discards redo after branching, and requires the same project ID and exactly equal photo fields; imports use reset.
History stores the fixed validated photo/id once and accounts serialized EditState bytes, trimming oldest states to both limits.
Do not retain intermediate pointer moves. Pointercancel discards the gesture; Undo/Redo operates only on finished edits.

## Geometry and deterministic pixel rules — `src/render.ts`

Export `planeScale(settings:Settings,plane:Plane):number` and `projectPoint(point:Point,settings:Settings,plane:Plane,width:number,height:number):Point`.
Let r=targetFocal/sourceFocal, C=(W/2,H/2), T=(shiftX×W,shiftY×H), and Z∈{near,1,far}.
Fixed mode: s=r for every plane and depth labels have no effect.
Perspective: move the camera backwards by Δ=r−1 in source-subject-distance units; new focal length is r times the original.
Then s=rZ/(Z+Δ). This describes axial camera translation under a centered pinhole model; return s=1 explicitly for the subject plane to preserve exact anchoring despite floating-point arithmetic.
Map source-edge point p to `C + s*(p-C) + T`; T is a 2D framing offset on the output plane, not a recovered camera rotation.
Do not add another crop, fit, camera pan or implicit zoom after this transform.
Fixed 50→100mm: central W/2×H/2 source field fills output. Fixed 50→25mm: source occupies W/2×H/2 in output.
At zero shift, the latter supplies 25% of the continuous output field; the remaining field stays unknown.
The sampled statistic below is not continuous area coverage: tiny/odd pixel grids and bilinear boundaries can differ, including a centered 1×1 sample reporting no missing coverage at r=0.5.
With r=0.8, near=0.6, far=2: plane scales are 1.2,1,8/9. With r=1.7: scales are 51/65,1,34/27.
These analytical examples are assertions for independent tests, not renderer-produced reference values.
Export `renderPixels(source:Raster,project:Project):Rendered`, validating byte counts/dimensions/settings/mask before allocating output.
Output is exactly W×H. Source is unpremultiplied RGBA8; never alter the source array or stored labels.
Use inverse mapping at each destination center d=(x+0.5,y+0.5), independently for each plane.
For a plane, source edge coordinate q=`C+(d-C-T)/s`; convert to sample-index coordinate q−(0.5,0.5).
Bilinear weights use floor index and fractional part. Out-of-bounds samples contribute transparent zero; no edge clamping or reflection.
Fixed mode samples all labels together once. Perspective samples only neighbors whose stored label equals the current plane.
For each valid neighbor, normalized alpha a=sourceAlpha/255; accumulate premultiplied RGB and alpha using its bilinear weight.
Also accumulate geometric coverage using the same weights/plane predicate but alpha=1, regardless of original source alpha.
Composite planes far→subject→near with premultiplied source-over: Pout=Pfront+Pback*(1-Afront), Aout=Afront+Aback*(1-Afront).
Composite geometric coverage separately using the same source-over formula; keep both quantities in [0,1].
This makes near pixels occlude farther planes while genuine alpha remains transparent; no duplicated source pixel belongs to two planes.
After all planes, if A>0 unpremultiply RGB; round each RGBA channel to nearest integer and clamp 0–255. When the final rounded alpha byte is 0, set all RGB bytes to 0, including fractional A that rounded to zero.
`missingFraction = sum(1-geometricCoverage)/(W*H)` computed before byte rounding. Photo transparency is not mislabeled as missing scene.
At r=1 and shift=0, every mask yields the exact source RGBA bytes, except undefined RGB under alpha=0 is canonically zeroed.
No morphology, feathering, hole fill, edge stretching or extra color manipulation. Bilinear filtering is resampling, not optical depth of field.
Uncovered boundaries may be fractional due to filtering; checkerboard is a presentation background and never baked into the pixel output.
Export `presentFrame(ctx:CanvasRenderingContext2D,frame:Raster):void`: putImageData at native dimensions; CSS may scale the presentation.
Selection, paint labels, source-depth overlays and checkerboard never enter exported result pixels.
Canvas presentation/readback can quantize straight RGB at low alpha; keep original kernel bytes separately and do not use Canvas readback as a byte-exact export source or oracle.

## Image, worker and export contracts

`src/photo-header.ts`: `inspectPhotoHeader(bytes:Uint8Array):PhotoHeader` performs bounded signature/chunk/marker/dimension checks before decode.
Parse bounded TIFF orientation in JPEG EXIF, PNG eXIf and WebP EXIF; reject malformed/duplicate orientation metadata and animation.
Export `validatePhotoAsset(value:unknown):PhotoAsset` for exact normalized asset fields, canonical base64/byte bounds, PNG dimensions and forbidden orientation/text metadata; it remains pure and does not decode pixels.
`src/images.ts`: `normalizePhoto(file:File,signal?:AbortSignal):Promise<PhotoAsset>` validates magic, size and actual native decode.
Apply orientation exactly once, including mirrors and square images. For WebP strip orientation metadata before decode and apply the parsed transform explicitly.
JPEG/PNG native from-image decoding is allowed only with actual orientation/pixel regressions proving once-only behavior.
Normalized PNG is metadata-free, with preserved alpha; use default sRGB conversion, reject mismatched decoded dimensions and oversized output.
Resize by k=min(1,1280/max(orientedW,orientedH)); canonical dimensions max(1,round(orientedDimension×k)).
Browser color conversion/resampling is part of normalization; geometric oracle comparisons use the resulting canonical raster, not original encoded colors.
Export `decodePhoto(photo:PhotoAsset,signal?:AbortSignal):Promise<Raster>` and `validateProjectImages(project:Project,signal?:AbortSignal):Promise<void>`.
Actual decoding must match declared normalized dimensions. Close every bitmap on success/failure/stale operation, including late decode completion after abort.
Reject input without replacing existing project, masks, history or saved record. Metadata is not copied into output/project notes.
`src/jobs.ts`: `renderProject(project:Project,signal?:AbortSignal):Promise<Rendered>` and `exportPng(project:Project,signal?:AbortSignal):Promise<Blob>`.
Before canceling an existing job, validate/reconstruct the new project including photo headers/mask and reject a pre-aborted signal; neither rejection disturbs the existing job.
The latest valid request to either API supersedes the previous module-wide job, rejecting it with AbortError. Each new job captures an immutable snapshot; worker performs actual image decode and shared renderPixels.
Preview returns transferred kernel RGBA bytes/statistic. Export passes those exact bytes to encodePng and wraps the resulting bytes in an image/png Blob; never use Canvas PNG encoding for export.
Use a module Worker per job; terminate and detach listeners on completion/error/abort/timeout, releasing temporary arrays and bitmaps.
Cancellation rejects AbortError and preserves the editor/previous result. No worker or export error becomes a success/empty PNG.
Input photo and mask remain retained only by the project; job buffers are disposable. Do not transfer away editor-owned arrays.
Debounce preview, abort superseded jobs, and publish only results matching project generation and request identity.
Export disables edits/import/navigation until completion or cancellation, then restores controls; download URLs are revoked after use.

`src/png.ts`: `encodePng(raster:Raster):Uint8Array` is pure, validates positive integer dimensions <=1280 and exact RGBA8 byte count, and never changes input.
Emit signature bytes [137,80,78,71,13,10,26,10], one IHDR (8-bit color type 6, compression/filter method 0, noninterlaced), one IDAT, and IEND; no ancillary metadata or runtime dependency.
Each scanline begins with filter byte 0 followed by exact straight RGBA bytes. IDAT contains zlib header 0x78,0x01 and byte-aligned stored DEFLATE blocks of at most 65535 bytes.
Each block has BTYPE=00, correct BFINAL, little-endian LEN and one's-complement NLEN. Append big-endian Adler-32 over all filtered scanline bytes, modulo 65521.
PNG chunk lengths/checksums are big-endian; CRC-32 uses polynomial 0xEDB88320 over chunk type+payload, initial/final XOR 0xFFFFFFFF. Reject output >7 MiB; a 1280×1280 raster with these fixed chunks/blocks occupies 6,555,448 bytes, below the 7,340,032-byte cap.
Return detached bytes. Independent decoder tests must prove exact RGBA round-trip, low-alpha RGB preservation, block boundaries, checksums, dimensions and unchanged input.

## Storage and editor behavior

`src/storage.ts`: `loadProject():Promise<Project|null>`, `saveProject(project:Project):Promise<void>`, `clearProject():Promise<void>`.
IndexedDB database `lens-studio.v1`, version 1, store `projects`, single key `current`; transaction completion defines save success.
Restore validates model and actual decoded photo before publication. Corruption/storage failure is visible; never overwrite a bad record with defaults.
Debounced serialized saves must not publish an older generation after newer work; failed saves retain the editor and JSON export route.
Load/import/decode requests capture generation; latest request wins, while intervening edits prevent stale restore from replacing work.
Start with an empty import panel and explicit Try authored demo action; no automatic demo persistence on page load.
New photo/demo/import explicitly confirms replacing current work and resets history after successful staging.
JSON import reads at most 12 MiB, validates model and decoded pixels, and atomically replaces only when all checks pass.
Main labels: Import photo, Source focal length, Target focal length, Fixed camera, Manual perspective, Paint near, Paint subject, Paint far,
Brush size, Near distance, Far distance, Shift X, Shift Y, Undo, Redo, Reset projection, Export PNG, Download project, Import project.
Keep original/source-paint view and result side by side at matched scale; mobile stacks them without hiding labels or controls.
Display mode/declared focal values, ratio, relative-depth legend, sampled missing coverage percentage and local save state near the result.
Show "Original transparency is retained; uncovered regions stay transparent. No content was generated" and "Manual depth is your assignment, not inferred scene depth".
Default to fixed mode. Choosing perspective requires acknowledging its manual-plane approximation; no claim of a recovered photo or optical lens change.
Typed invalid numeric drafts remain visible with errors; do not clamp silently or commit invalid model values. Polling/network consent concepts do not apply.
Brush operates on source view with pointer capture, cancel rollback and accessible Fill plane alternative; depth overlay is toggleable.
Support keyboard Undo/Redo outside text inputs. Each numeric commit/mask fill/finished gesture creates one history state.
Include an original procedural three-plane demo, labeled as authored geometry, with embedded locally generated pixels and known masks.

## Independent acceptance gates and proposed ownership

Issue #31 queues this scope; root creates the implementation plan after reviewing the final written contract. Owner names here are recommendations.
Model/history owner: types.ts/model.ts/history.ts and pure tests for exact bounds, detached masks, painting, reset, branching and byte caps.
Media owner: photo-header.ts/images.ts and real browser fixtures for PNG/JPEG/WebP, animation/invalid input, all 8 orientations and stale cleanup.
Renderer/jobs owner: render.ts/png.ts/jobs.ts/render.worker.ts and kernel/worker/export tests; owns no editor or storage files.
Root/editor owner: config/main.ts/style.css/storage.ts, documentation/catalog/CI and production browser integration.
Independent reviewer: numerical oracle, holes/alpha/occlusion, stale restore/export cancellation, storage loss and preview/export agreement.
Pure tests must independently derive inverse coordinates/expected samples; do not generate expected outputs by calling the production geometry helper.
Production Chromium gate: import real image → focal change/shift → compare → paint depths → Undo/Redo → JSON/PNG → decode → reload.
Use an independent PNG decoder in tests. Verify PNG dimensions, alpha holes and exact raw decoded-export agreement with retained kernel frame bytes, including low-alpha colors.
Compare visible preview/export through the same Canvas presentation path; do not require raw Canvas readback to equal straight RGBA bytes. Kernel-versus-independent-oracle tolerance remains <=1.
Fixed gate: identity, centered 2× crop, 0.5× wider field, off-frame shift, aspect/orientation preservation, source alpha and meaningful bounds.
Perspective gate before exposing the mode: independently authored three-plane scene and scalar reference renderer with original known texture/masks.
Check both closer/wider and farther/longer configurations, exact subject-plane anchoring, depth-dependent scales, near occlusion and exposed holes.
At r=1 test arbitrary painted labels against canonical source bytes; at other ratios assert premultiplied interpolation without dark color fringes.
Record numerical max error (RGBA tolerance <=1 for rounding), missing-fraction error <=1e-9, and decoded native PNG observations.
Inspect the synthetic outputs visually at edges/holes as well as numerically; an attractive image alone is insufficient evidence.
Measure a maximum-size render/export on the available machine; retain duration/source dimensions and cancellation/resource behavior, not invented performance claims.
Failure tests preserve current work on malformed photo/JSON, late decode, cancelled worker, blocked storage, timeout and corrupt restore; invalid/pre-aborted requests preserve the existing job, while a valid render/export request supersedes it.
No ordinary editor flow makes external requests. Verify production desktop/mobile layout, focus, accessible names and truthful limitation text.
Deferred gates: learned-depth checkpoint/license/availability and real-image quality; generated disocclusion provenance/quality; calibrated real-camera comparisons.
None is required for the fixed-position milestone, and none is implied by passing the manual synthetic gate.
