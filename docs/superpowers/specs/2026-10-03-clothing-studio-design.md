# Clothing Studio local MVP

Issue #14, idea #5. Build `apps/clothing-studio` as a self-contained TypeScript/Vite app with no runtime libraries or services. The user authorizes independent product choices. Melody Studio and Git History core portfolio flows are in maintenance; iPhone focus remains externally blocked. Gaze Nav and idea #8 are excluded.

## Product

Create a front-view T-shirt concept, sketch directly on the garment, place it over a local photo (or sample silhouette), save/restore the complete project, and export garment/preview PNGs. Show “Approximate photo overlay” beside the preview: no body measurement, fit, drape, occlusion or realistic virtual try-on claims. Fabric choices are procedural visual textures. Concept description is a user note, not a generation prompt.

Three workspace panels: garment controls, sketch canvas, photo preview. Calm cream/ink/terracotta styling, visible labels, direct pointer placement plus keyboard/numeric controls, responsive stacked layout. Every relevant interaction updates the actual preview. Undo/redo supports edits and placement; sketch strokes commit once per gesture. Editing field focus is preserved. New/reset/clear operations are reversible. No external fonts/assets, telemetry or photo uploads.

## Shared contracts

`src/model.ts` exports:

```ts
interface Point { x: number; y: number } // normalized 0..1 in 400×440 garment coordinates
interface Stroke { id: string; color: string; width: number; points: Point[] } // width 1..20 px
interface Garment { bodyWidth: number; bodyLength: number; sleeveLength: number; neckline: 'round'|'v'; color: string; pattern: 'plain'|'stripe'|'weave'; patternColor: string }
interface Placement { x: number; y: number; width: number; height: number; rotation: number; opacity: number }
interface Photo { dataUrl: string; width: number; height: number; name: string }
interface Project { schemaVersion: 1; title: string; note: string; garment: Garment; strokes: Stroke[]; placement: Placement; photo: Photo|null }
```

- Garment: bodyWidth 160..260, bodyLength 180..300, sleeveLength 25..65. Centerline x=200, shoulder y=80; geometry remains within 400×440. Colors exactly six-digit hex.
- Placement center x/y 0..1, width/height .1..1.5 as fractions of preview dimensions, rotation -180..180 degrees, opacity .1..1. Defaults fit sample silhouette. Preview stage follows normalized photo dimensions or 600×800 for sample.
- `createProject(): Project`, `validateProject(value: unknown): Project` (throw actionable Error, no silent coercion), `parseProject(text: string): Project`, `serializeProject(project: Project): string`; serialized max6MiB, title80/note2000 chars, max100 strokes/1000points each/12000total. Photo is normalized JPEG data URI max3MiB text, width/height integer1..1200, name120chars; model validates structure, media validates encoded image. Reject unknown unsafe values/prototype input; clone safe known fields.
- `ProjectHistory` constructor(initial), getter `current`, getters `canUndo/canRedo`, `commit(next):boolean`, `undo():Project`, `redo():Project`, `reset(project):void`; max40 past edits, validated snapshots, new edit clears redo, no-op edits omitted. Export relevant limit constants.

`src/graphics.ts` exports `garmentPath(garment):string`, `garmentSvg(project):string` (400×440, clipped strokes), `previewSize(project):{width,height}`, `previewSvg(project):string`, `exportPng(project, kind:'garment'|'preview'):Promise<Blob>`. Shared SVG content ensures image exports match views. User strings escaped; data URI photo allowed only after validation; no arbitrary imported markup. Default sample silhouette is inline authored vector geometry. Garment-only export is transparent; preview includes a neutral background/photo. PNG output max2048px on either axis. Pattern IDs and clipping IDs must remain correct when garment and preview SVGs coexist. All geometry/numbers are finite and validated.

`src/media.ts` exports `importPhoto(file: File): Promise<Photo>` and `validatePhoto(photo:Photo|null):Promise<void>`. Accept only PNG/JPEG/WebP magic+MIME, max10MiB, max16million decoded pixels and max8000px edge before decode (parse bounded headers), resize to <=1200px and normalize JPEG; reject corrupt/truncated files. Verify encoded backup photo metadata/dimensions match and bound resources before decoding. No external image URLs. UI uses a generation counter/cancel action to prevent obsolete async results changing current work.

`src/storage.ts` exports async `loadProject():Promise<Project|null>`, `saveProject(project):Promise<void>`, `clearProject():Promise<void>`. IndexedDB single local project, validated on both paths; reject failures clearly rather than swallowing them. UI owns serialized save ordering/debouncing and reports unsaved state. Startup restore must not overwrite edits made while loading. Explicit backup/export remains available on failure.

## Ownership and verification

Model implementer owns model + domain tests. Graphics implementer owns graphics + geometry tests. Media implementer owns media/storage + their tests (browser tests can target these modules independently if coordinated). Root owns UI, setup, browser flow tests, docs/catalog and CI. Test first where meaningful, preserve API contracts, no overlapping files.

Unit tests: validation bounds, immutable history, serialization round-trip, geometry and escaping, image header dimensions/resource limits. Production Chromium: customize/sketch, overlay move/keyboard, image upload/corruption, cancel/race, persistence/reload and save failure, backup round-trip/failure preservation, PNG dimensions/transparency and narrow layout. Run lint/typecheck/build, independent review and regression fixes, then commit/push and update issue/PR/catalog. Core local workflow can move to maintenance once fully verified; generated concepts/realistic try-on remain future work.
