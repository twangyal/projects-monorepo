# Motion Studio #84 — held drawing cels

Reviewed implementation contract, frozen before product edits on 2026-10-04. Based on current model, editor, recovery and export behavior. Issue #84 tracks acceptance; no existing hardware or model claim changes.

## Intended outcome and scope

An artist draws independent artwork states on one drawing layer, holds each until its next authored boundary, combines those holds with the existing transform-key timeline, and exports the exact evaluated composition through preview, frame PNG and GIF. This adds frame-by-frame drawing authoring to the existing layer-transform animator. It adds no generated in-betweens, stroke morphing, image cels, audio, accounts or model assistance.

Recommend a single canonical cel array rather than parallel static/animated drawing variants. A second drawing-mode union retains two paint/render paths indefinitely; a shared mutable stroke table saves duplicate bytes but weakens independent duplicate editing and obscures aggregate limits. Canonical held arrays give one evaluator and explicit costs.

## Schema and migration

Keep existing canvas640×360, FPS12, frameCount12..96, layer/order/pose/image/brush bounds. Types remain exported from model.ts, matching the current app structure.

```ts
export const SCHEMA_VERSION = 2;
export const MAX_DRAWING_CELS = 24;
export type DrawingCel = { frame: number; strokes: Stroke[] };
export type DrawingLayer = {
  id: string; name: string; kind: 'drawing';
  cels: DrawingCel[]; keys: Keyframe[];
};
export type ImageLayer = /* existing image/keys shape, unchanged */;
export type Layer = DrawingLayer | ImageLayer;
export type Project = {
  schemaVersion: 2; title: string; background: string;
  frameCount: number; layers: Layer[];
};
```

Every drawing layer has1..24 dense cels. Cel frame is an integer0..frameCount-1; first frame is exactly0; frames strictly increase. Each cel has exactly frame/strokes. A blank first cel is valid and never removable. Images have neither cels nor strokes. Schema2 drawing layers have cels, never a competing strokes field. Preserve existing transform keys independently:1..24/layer, first0, existing easing and numerical bounds.

Count every stored stroke and point across every retained cel and layer: project≤100strokes/10,000points; stroke1..1,000points. A held cel is not charged again per output frame. An explicit duplicate is a separate stored copy and is charged again; object aliases do not receive a discount. Blank cels count toward the24-boundary cap but consume no stroke/point allowance. Validate lengths/counters before copying large arrays; refuse sparse arrays. Exact plain data shapes avoid ambiguous mixed schema payloads; no arbitrary accessor execution needed.

Genuine schema1 has drawing strokes+keys, no cels; migrate each drawing to cels:[{frame:0,strokes:<detached original>}]. Images, layer order/IDs, title/background, numerical coordinates/colors/keys and frameCount are unchanged. Existing accepted text/color semantics remain: migration must not trim, recase or silently reject previously valid engine UTF-16 strings. No schema tag relabeling of a cels-shaped layer as legacy. Successful validation returns detached canonical2. Existing stored raw1 is read without a write; the first actual edit may save2. Failed migration remains protected, with existing exact raw recovery/export available.

**Approved compatibility allowance:** canonical schema-1 drawing migration adds exactly 21 UTF-8 bytes per drawing layer, at most 168 bytes. Use `MAX_JSON_BYTES = 6 * 1024 * 1024 + 168` consistently across whole-file import, canonical output, storage and raw-recovery export. Genuine legacy canonical input remains bounded by its former 6 MiB limit before conversion. Never resize or drop artwork to fit. History stays at 20 MiB and 30 states. The extra 168 bytes preserve all previously admitted canonical legacy projects.

**Legacy field compatibility:** schema 1 keeps the existing known-field reconstruction of harmless unknown fields; do not newly reject those inputs. Explicit mixed-version shapes (legacy drawing carrying cels, or image carrying drawing fields) are rejected rather than silently discarding authored drawing data. Schema 2 uses the declared strict cel/drawing shapes, with no competing legacy strokes property. Exact preserved-record recovery remains separate and retains the original raw fields.

## Frozen candidate model API for the UI

Existing validateProject/createProject/createDemo/createDrawingLayer return canonical2; new drawings start cels:[{frame:0,strokes:[]}]. Existing pose/localPoint/key operations retain their behavior and support canonical2 layers. createDemo wraps each existing original drawing in its single frame0cel, preserving legacy demo pixels.

```ts
export function evaluateDrawingCel(
  input: DrawingLayer, frame: number,
): DrawingCel;
export function addBlankDrawingCel(
  input: Project, layerId: string, frame: number,
): Project;
export function duplicateDrawingCel(
  input: Project, layerId: string, frame: number,
): Project;
export function replaceDrawingCelStrokes(
  input: Project, layerId: string, celFrame: number, strokes: Stroke[],
): Project;
export function removeDrawingCel(
  input: Project, layerId: string, celFrame: number,
): Project;
export type TimelineResizeLoss = {
  removedCels: { layerId: string; frame: number }[];
  removedKeys: { layerId: string; frame: number }[];
};
export function timelineResizeLoss(
  input: Project, frameCount: number,
): TimelineResizeLoss;
export function resizeTimeline(
  input: Project, frameCount: number,
  options?: { discardLater?: boolean },
): Project;
```

Project-level helpers validate the entire admitted input first; layerId must identify an existing drawing for cel operations. No permissive first-match ID ambiguity, implicit image conversion or automatic insertion. Frame arguments for editing are integers within that project's current timeline. All returned graphs are detached from input and nested stroke/point arguments. Invalid arguments/aggregate overflow leave caller/history unchanged.

- evaluateDrawingCel admits a canonical drawing layer using the existing standalone layer96-frame ceiling, rejects nonfinite frame, and returns the last cel whose frame≤frame. Before0 use first; after last use last. Fractional frames are held:11.999 uses earlier cel; exact12 uses cel12. Return a fully detached cel, including its authored frame identity. This evaluator never interpolates strokes or changes transform easing.
- Add blank inserts a NEW [] boundary. Duplicate copies the held cel at the requested cursor frame into a NEW boundary. Both reject any existing boundary, including0; no implicit replacement. Duplicate may fail when its full copied strokes/points would exceed aggregate limits. That error must explain copying consumes the budget.
- Replace strokes targets an EXACT existing celFrame, including0, and admits the complete replacement/project. Replacing with[] clears that cel only; it does not remove its boundary. This is the operation painting uses after a captured gesture; it does not create a new cel at every pointerdown.
- Remove targets an EXACT existing nonzero celFrame and deletes the entire boundary; the preceding cel then holds until the next remaining boundary. No silent transfer/merge of deleted artwork. UI names the removed authored frame and exposes Undo. Missing boundary and frame0 reject.
- Loss helper returns removed cel/key identities in project-layer order, each frame increasing. Extending/equal duration returns empty arrays. Shortening identifies entries with frame≥newFrameCount; even blank cels count as authored data.
- Resize default refuses any nonempty loss. Explicit discardLater:true admits the same original snapshot and permits exactly those later entries to be removed. No other artwork removal. Before shortening, evaluate each layer's transform at newFrameCount-1; preserve that pose through existing endpoint-key behavior. If insertion would exceed24keys, reject even after consent; never discard an earlier key to fit. Cel holds already preserve the endpoint artwork, so do not add an unnecessary endpoint cel. Extending preserves all authored entries exactly.

## Editor contract with the UI owner

The timeline cursor is the displayed frame; active drawing identity is the held cel's authored frame. Show both: "Editing drawing from frame N, held through frame M" (UI1-based, JSON0-based). Selecting a cel boundary seeks its first frame. Selecting layer/frame can change held content but must not synthesize a cel or mutate history.

Buttons at current frame: Add blank drawing and Duplicate held drawing. Disable occupied boundaries; an operation remains defensively rejected by model. Remove current drawing operates on the named active boundary, except first0. A dedicated clear action, if offered, replaces the active strokes with[]; no destructive action is implied by Add.

A stroke captures project generation, selected layer, active celFrame and transform pose at pointerdown. Pause play; lock selection/timeline/pose/cel/duration controls during a gesture. All points use the existing inverse transform for that frame. The preview applies changes to the captured cel only. Pointerup commits one validated complete project; pointercancel/lost capture/error discards the whole preview and leaves existing cells intact. Aggregate counting traverses all retained cels, not just the active one. Move gestures continue to affect transform keys, not drawing-cel coordinates.

A duplicate is independent: future paint on either original/copy changes only that held interval, until its own next cel. Explain that drawing on an in-between frame edits the entire active held drawing; explicit duplicate creates a new drawing first. No onion skinning is required in this milestone.

Duration shortening is precomputed using the complete current snapshot and full endpoint/cap admission BEFORE prompting. Show both removal counts/frames and that Undo is session-only. After confirmation, recheck generation, raw input intent and any live gesture/selection ownership; commit candidate once only if the exact reviewed base still owns the action. Cancel/refusal restores duration control but preserves project/history/raw fields. Do not auto-trim future cels when an input is typed, scrubbed or played.

## Common rendering and export architecture

Keep public renderFrame(ctx,project,frame,assets), loadAssets/closeAssets and exportGif APIs. renderFrame validates canonical project and bounds finite frame0..frameCount-1; same kernel handles DOM and OffscreenCanvas. At each frame: opaque background; layer order; existing evaluatePose transform; for drawing use active held cel strokes; for image use the existing fitted fixed bitmap. Round stroke caps/dots, opacity, rotation and caller-context save/restore are unchanged. Image dimensions/asset matching and full admission occur before drawing.

Add frame-aware layerBounds(layer,frame=0): active cel geometry only (stroke radii included; blank size1×1), image bounds unchanged. Default0 preserves a useful existing geometry API, but consumers seeking current content pass the actual frame. Do not union every future cel into active selection geometry.

Avoid clone/stringify of the entire6MiB project96times in the GIF loop. Recommend renderer-owned createFrameRenderer(project,assets):{readonly frameCount:number;render(ctx,frame):void} which validates and captures one detached immutable internal snapshot, validates the fixed asset bindings, and exposes no mutable project/points. Public renderFrame delegates to the same internal draw kernel; worker prepares once and iterates integer frames. The closure uses trusted internal selection without returning another copied active cel on every draw. Do not implement a second cel evaluator with divergent cut logic; public evaluator and trusted draw selector share the same bounded index rule.

Worker validates the message/project and loads each image once, then prepares renderer. GIF retains fixed3/3/2palette, full opaque frames, infinite loop and exact existing rounded cumulative centisecond delays. Parent30-second deadline includes loading/render/encoding; Cancel/pagehide terminates worker and rejects partial output. Keep32MiB GIF output cap and existing cleanup. No cels or data URL buffers detach from app/history. The worker owns decoded assets until final close.

PNG export needs a captured project/frame/generation/operation, not mutable live canvas and live filename in a later toBlob callback. Render the admitted snapshot through the same draw kernel into a private canvas and recheck owning generation/raw intent before Blob click. Cel edits, seek/layer change, Undo/Redo/new import/pagehide invalidate old publication. Preserve original behavior of opaque background and full-color PNG; no new raw RGBA encoder is required. GIF likewise downloads under its captured title, only while that export owns the result.

## Bounds, runtime and verification plan

Cel cap adds at most8×24=192boundary records. The cumulative100strokes/10kpoints means simultaneous rendered geometry never exceeds the existing worst case. Worst-case96×10k≈960k path segments plus22,118,400raster pixels, existing palette loop and outputencoding; no unbounded per-frame/cel tensor. Duplicating100strokes/10kpoints fails predictably unless other content is removed first. Four decoded800²images occupy about10.24MB rawRGBA plus bitmaps; image bounds do not change. Full-snapshot history remains serialized20MiB/30states; duplication can shorten available Undo depth, shown honestly.

Producer tests first: genuine legacy migration exact fields/detachment/fixed rendering; schema2 mixed payload/dense ordered first0/24vs25 rejection; aggregate counts across held copies; exact duplicate and blank insertion, independent mutation, protected remove0 and removed hold extension; fractional cut/before/end evaluation; default shortening refusal and explicit full loss; endpoint key cap refusal; inputs/history unchanged on every error.

Independent scalar oracle should hand-author three unlike cels and transform keys with different boundaries, pin expected selected contents at0/5.999/6/11.5/12/23/afterlast, and validate geometry/frame snapshots without producer-built fixtures. Native export oracle uses at least a blank interval and differing red/blue shapes at fixed pose, independently decoded all GIF frames and PNGs before/on/after boundaries; confirm96frame timing remains8seconds and legacy schema1 render pixels remain identical.

Native production flow: draw first; duplicate; draw second independently; blank later; scrub held intervals; move pose; Undo/Redo; refuse/confirm shortening; editable JSON download; native IndexedDB browser-process restart; exported frame PNG/GIF actual decoded content. Delay real PNG toBlob and GIF delivery across a cel edit/new selection to prove stale output cannot download. Keep existing startup/protected raw recovery tests unchanged except intentional canonical version migration assertions.

Maximum smoke separately measures actual prepared GIF96frames, all cumulative10kpoints/100strokes, 24cel layer and8layers as compatible, maximum admitted image/project JSON, cancellation under load and retained history cap. Assert cap values, exact decoded frame/cel intervals, finite timing/memory measurements; do not use a flaky hard microbenchmark unit test. Root coordinates only one production build/browser server; producers never mutate shared build output independently.

## Suggested exclusive implementation seams after root release

1. Model producer: schema/types/migration, aggregate admission, cel helpers/evaluator, resize-loss admission; new unit tests.
2. Render/export producer: shared prepared renderer/frame-aware bounds, worker reuse, captured PNG/GIF completion ownership; new actual media tests.
3. UI producer: held-cel controls/status/timeline, captured stroke ownership and confirmed duration loss; retain existing save/recovery architecture.
4. Independent owner: literal scalar selection/migration/limits oracle; native decoding/restart/stale-export acceptance independent of producer expectations.
5. Root: final docs/package/version/Git, existing-test canonical shape updates only where intentional, one build/CI/max evidence.

Root approved implementation after independent review of the model/render contract and the companion UI/acceptance plan. The compatibility allowance and legacy known-field policy above settle the two review findings. Optional onion skin is deferred; no implementation may claim frame morphing or generated artwork.
