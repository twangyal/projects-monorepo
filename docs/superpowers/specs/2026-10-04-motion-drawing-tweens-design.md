# Motion Studio #88 — reviewed geometric drawing in-betweens

Frozen implementation contract, 2026-10-04. Tracker: https://github.com/twangyal/projects-monorepo/issues/88. Implementation is authorized by the autonomous goal; no new runtime dependency is needed.

## Purpose and scope

Create intermediate vector drawings between two deliberately paired endpoint cels, preview their actual held-frame animation, and Apply the complete result as one reversible edit. This adds artwork changes to Motion's existing independent pose animation. It is geometric interpolation, not AI, motion learning, semantic correspondence, raster synthesis or guaranteed artist-quality in-betweening. Original drawings remain exact. Self-intersections, corner smoothing and unintended stroke crossings are possible and must be reviewed.

Current source: schema 2 drawing layers contain ordered `{frame,strokes}` cels; `drawingCelIndex` selects the nearest boundary <= frame; `createFrameRenderer` prepares a detached admitted graph once and draws it through unchanged pose keys. Current `History` retains at most 30 states/20 MiB by trimming oldest states. No schema, existing renderer, storage format or GIF encoder change is needed.

Rejected alternatives: pixel crossfades introduce ghosted images rather than editable strokes; implicit stroke-order matching hides correspondence; learned generation lacks a frozen training/evaluation gate. The chosen flow requires explicit exhaustive pairing and stores ordinary bounded cels.

## User flow and eligibility

1. Select a drawing layer and choose **Make drawing in-betweens** in its Drawings panel. Pause ordinary playback. Opening requires committed pose/name fields, no active pointer gesture/import/export/history transition and completed startup restoration. Image layers explain that this tool needs vector drawings.
2. Choose **Starting drawing** from that layer's existing boundaries. **Ending drawing** is the next boundary, visibly named with its frame. Only adjacent cels are eligible, preventing silent overwrite of intervening artwork. Both must have the same nonzero number of strokes, 1–8, and at least one interior integer frame. A blank endpoint or unmatched count is refused; the tool does not add/remove/unpaired-fade strokes.
3. Display each starting stroke in its existing paint order, with index, color, width, start/end direction markers and a small drawing thumbnail. Choose its ending stroke from labeled ending thumbnails and **Reverse ending stroke** if necessary. Ending indices must form a complete permutation. Initial choices are empty: stroke-order identity is offered only as an explicit **Pair in drawing order** action, never silently assumed. Reversal defaults false. Pairing is geometric, not a recognition result.
4. Choose **Number of new drawings**: an integer from 1 to `min(end-start-1,24-currentLayerCelCount)`. Show the exact generated frame numbers. Default 1; retain empty/invalid count text and explain it, rather than clamping. Existing point/stroke/byte budgets can further refuse the candidate; do not silently lower the requested count.
5. **Review in-betweens** computes and admits the complete candidate. Show exact inserted frames, original/candidate cel/stroke/point/UTF-8 byte usage, sampling/geometry warning and a dedicated preview canvas. **Tween preview frame** and **Play tween preview** inspect the candidate over `[startFrame,endFrame]` without changing the main timeline, project or history. Preview holds generated drawings normally; it is not a continuous morph between stored frames.
6. **Apply in-betweens** applies the admitted candidate once, selects its first new drawing on the main timeline and schedules normal autosave. **Discard in-betweens** closes scratch review with no source changes. Applied cels can be drawn on, removed, undone/redone, saved/reopened and exported normally. Existing PNG/GIF/project downloads always use committed work; they never export an unaccepted proposal.

The new panel must not rebuild existing pose/title/ink inputs during preview or status changes. At 390 px, stack the two endpoint thumbnails/controls and keep the preview contained. Keyboard users can identify strokes, select ending indices/reversal, choose the count, review, inspect frames and apply/discard without a pointer.

## Exact pure API (new `src/tween.ts`)

```ts
export const TWEEN_SAMPLES = 64;
export const MAX_TWEEN_PAIRS = 8;
export interface TweenSelection {
  layerId: string; startFrame: number; endFrame: number;
}
export interface TweenPair {
  startStroke: number; endStroke: number; reverseEnd: boolean;
}
export interface TweenChoices { pairs: TweenPair[]; frames: number[] }
export interface TweenUsage {
  layerCels: number; projectStrokes: number; projectPoints: number; projectBytes: number;
}
export interface TweenProposal {
  selection: TweenSelection; choices: TweenChoices;
  generated: DrawingCel[]; before: TweenUsage; after: TweenUsage;
}
export function planTweenFrames(startFrame:number,endFrame:number,count:number):number[];
export function resampleStrokePoints(points:readonly Point[],reverse?:boolean):Point[];
export function buildDrawingTween(project:Project,selection:TweenSelection,
                                  choices:TweenChoices):TweenProposal;
export function previewDrawingTween(current:Project,proposal:TweenProposal):Project;
export function applyDrawingTween(current:Project,proposal:TweenProposal):Project;
```

Import `Point`, `DrawingCel`, `Project` from the existing model. Direct entry points defensively admit plain exact records/dense own-data arrays, finite bounded coordinates and primitives; reject sparse/accessor/custom-prototype or unknown-key input without invoking accessors. `resampleStrokePoints` admits 1–1000 points with exact x/y coordinates in the existing -1280..1280 range; optional `reverse` must be boolean. All arrays/points/results are detached. Proposal errors are bounded actionable Errors without echoing source image data.

`buildDrawingTween` calls existing complete `validateProject`, selects one existing drawing layer, requires exact adjacent authored frames, and admits choices: exactly N pairs sorted `startStroke=0..N-1`, endStroke a permutation `0..N-1`, boolean reversal. Frames are 1–22 distinct increasing integer targets strictly inside the selected pair and within timeline; no existing boundary may be replaced. The public API accepts an explicit frame list; the UI derives its list through `planTweenFrames` so exact numerical fixtures can also test irregular spacing.

`planTweenFrames` admits integer start/end in 0..95 with end>start, count1..22 and count<=end-start-1. For j=1..count, target = `start + floor(j*(end-start)/(count+1))`. This yields distinct interior integer frames. UI frame labels add 1; stored/API frames remain zero-based. It does not assess a particular project's cel/point budget.

Use a module-private WeakMap receipt keyed by the actual returned proposal. Receipt pins the admitted canonical source-project JSON and the exact full public proposal JSON. `previewDrawingTween`/`applyDrawingTween` reject unknown/JSON-cloned proposals, any changed public fields, or any changed canonical current project. Revalidate all public proposal shapes/bounds before serializing them for receipt comparison. A checksum is not an authority receipt. Returning a canonicalized lookalike must not hide a public-field mutation. The source JSON includes all layers, pose keys, title/background, image bytes and cels, so Apply cannot combine stale artwork with a new project.

Build computes and validates the complete candidate *before* registering/publishing the receipt; never publish a proposal that already exceeds a quota. Keep only the source JSON and compact public proposal in the private receipt, not another full candidate/image graph. Preview and Apply share one candidate-construction helper and return new detached admitted projects. Apply does not mutate history/storage itself. Unchanged endpoints, pose keys, layer order, image assets and unrelated drawings must remain value-identical. No new persistent trusted provenance/model fields are introduced.

## Frozen numerical kernel

Each input polyline is ordered as stored. If reversing the ending stroke, reverse its point sequence before sampling; do not infer a reversal. All geometry is in the layer's existing local coordinates. Existing pose interpolation remains separate and is applied by the renderer at each authored frame.

Compute segment length with `Math.hypot(dx,dy)` and cumulative arc length in ordinary IEEE-754 double arithmetic. Zero-length segments contribute zero. For total length zero, return 64 independent copies of the original first point. Otherwise sample distances `s[k]=total*k/63` for k=0..63. Copy the first and last point exactly for k0/k63. For interior distances select the first positive-length segment whose cumulative end is >=s; zero segments are skipped. Use segment fraction `(s-cumulativeStart)/segmentLength` and weighted coordinates `(1-q)*a+q*b`. Do not smooth, close, reorder or simplify paths. A coincident knot chooses the preceding positive segment's endpoint; there is no division by zero.

Resample each selected starting/ending stroke once. At generated frame f, let `t=(f-startFrame)/(endFrame-startFrame)`. Each generated stroke retains its starting paint-order position. For k0..63, interpolate sampled x/y as `(1-t)*start[k]+t*end[k]`. Width uses the same weighted formula. Colors parse existing six-digit hex to encoded RGB bytes and interpolate each channel with `Math.round((1-t)*a+t*b)`; output lowercase `#rrggbb`. No linear-light/perceptual color claim. For exactly equal scalar endpoints, retain that scalar exactly rather than reweighting it: ordinary weighted arithmetic was independently observed to produce 1280.0000000000002 from a legal constant 1280 axis, and 40.00000000000001 from constant width 40. This preserves a mathematical identity without clamping or widening model limits. Normalize numerical -0 to +0; never round coordinates/width to a display increment. Every generated stroke has exactly 64 independent point records, even a zero-length path. It remains visible as a round-cap dot in the current renderer; native acceptance must verify that degeneracy.

Generated paint order follows the starting drawing even when ending indices are permuted; the original ending drawing retains its own stored paint order. Thus a final-boundary occlusion/order jump is possible and must be reviewed. The source/end strokes are NEVER resampled in the persistent candidate: their original point counts, coordinates, widths, color spelling and order remain exact. Therefore sampling can visibly change corners at the first new boundary; disclose this rather than claiming endpoint pixel-perfect continuity. New strokes/cels share no mutable arrays with source/endpoints or other generated cels. There is no random seed, training state, clamping, automatic identity matching or implicit fallback.

## Candidate budgets and history

Keep all existing limits: stage640×360,12fps,12–96 frames, <=8 layers, <=24 cels per drawing layer, <=4 image layers, <=100 strokes and <=10,000 points across ALL retained cels, <=1000 points per stored stroke, JSON <=6 MiB+168 bytes (6,291,624). Files/storage/raw recovery retain the same bound/schema 2. Count originals, existing other cels and generated cels before publication; a copied/resampled/generated point is not free because it resembles another.

`projectBytes` is exact UTF-8 length of `JSON.stringify(validateProject(candidate))`, not JS string length or a pretty-export estimate. Existing imported file/storage code applies its own complete byte admission too. Fail atomically at limits with no dropped original/other cel, no reduced target list and no partial insertion. No imported-image decode is needed for geometric build; previews reuse already admitted active assets, and source/import validation remains authoritative.

Existing History policy is unchanged: commit appends one candidate, drops redo, then trims oldest snapshots to its30-state/20MiB budget. This corrects the preliminary assessment's overly strict history wording: History does not reject an edit merely because earlier snapshots are pruned. Immediate Undo is guaranteed for this operation because the source and candidate are each <=6,291,624 bytes, together <20MiB. Show the existing session-history limitation; do not pretend older edits are permanently retained.

Build cost is bounded by current10,000 points, at most16 resampled endpoint paths,22 generated cels and candidate serialization. Use monotonic segment scanning, not one full path search per sample. No new inference/decode worker is necessary for this small synchronous pure kernel. Measure legal-maximum build/Apply timing separately; do not encode a flaky wall-speed assertion into unit tests. Native preview prepares the candidate only once, not per frame.

## Preview and lifetime seam (new `src/tween-preview.ts`)

```ts
export interface TweenPreview {
  readonly frame:number;
  showFrame(frame:number):void; play():void; stop():void; dispose():void;
}
export function createTweenPreview(canvas:HTMLCanvasElement,candidate:Project,assets:Assets,
  startFrame:number,endFrame:number,onFrame:(frame:number)=>void):TweenPreview;
```

Admit candidate and endpoint bounds before touching the canvas. Capture `createFrameRenderer(candidate,assets)` once. Assets are borrowed from the active editor; this owner never closes them. UI must dispose preview before replacing/closing editor assets. Frame selection is integer in inclusive start..end; invalid input refuses without changing current frame. Initial frame=start. Playback uses rAF elapsed time at12fps, clamps to end and stops there without looping. `play` from end restarts at start; `stop` leaves the current preview frame. Only one rAF callback is owned; dispose cancels it, clears callback references/zeros the dedicated canvas and makes later callbacks harmless. Every render uses the prepared common kernel, with no scene overlays or separate stroke interpolation.

The preview does not export PNG/GIF or mutate the main timeline. Dedicated preview-frame/control interaction is the *only* permitted scratch-inspection exception to retirement below; it never becomes an editor generation change.

UI retains explicit `tweenIntent`, captured committed `generation`, selected layer/frame, raw-field intent and operation owner. Any new endpoint/pair/reversal/count input invalidates the reviewed proposal immediately, even changed-back input. Preserve those new raw controls, then require Review again. Committed edits, pointer-gesture start, main-frame/layer/drawing selection, ordinary Play, duration, undo/redo, new/demo/import/recovery replacement, retry initiation, export initiation, confirmed departure/pagehide all stop/dispose and retire proposal ownership. Retirement disables Apply, releases the receipt/candidate preview and stops playback, but retains pairing/count raw fields while the same workspace/layer still exists. Changing layer or replacing the workspace uses explicit discard consent when those controls or a review are unsaved; canceled consent keeps their nodes/values. A later failed/canceled import preserves those raw controls but cannot resurrect the retired proposal; Review is required again. Confirmed successful replacement may close the old panel. Discarding a proposal does not erase existing pose/title drafts.

Main title/background and pose raw input similarly retire the proposal before any deferred work can complete. Old pose drafts must be applied/discarded before opening or reviewing this operation; it never commits/discards unrelated raw fields. Failed Review keeps the pairing/count fields and existing artwork, displays no partially admitted canvas, and disables Apply. Explicitly closing/discarding and reopening chooses fresh source endpoints; no persistent tween scratch is introduced. Beforeunload warns for unaccepted pairing/count/review state alongside existing unsent drafts.

Apply synchronously checks captured operation/generation/selected owner and no pending existing raw drafts/gesture, calls `applyDrawingTween`, then performs one existing commit/history publication. Do not invalidate the receipt before capturing the admitted candidate; successful commit may then retire the proposal. If commit/admission fails, keep the complete scratch controls and artwork. Existing async PNG/GIF/import/history receipt guards remain; do not weaken them. Ordinary exports after Apply contain only the complete committed candidate, including every newly generated cel.

## Stable product selectors

Use existing selectors unchanged. New IDs/accessible names:

- `#make-tween`: **Make drawing in-betweens**; `#tween-panel`: region **Drawing in-betweens**.
- `#tween-start`: **Starting drawing**; `#tween-end-label`: visible **Ending drawing** (fixed next boundary).
- `#tween-pairs`: ordered rows `[data-tween-stroke="0"]`; select **Ending stroke for starting stroke 1**, checkbox **Reverse ending stroke for starting stroke 1**; add one-based labels for later rows. Thumbnail canvases have equivalent textual index/color/width/direction descriptions.
- `#tween-pair-order`: **Pair in drawing order**; `#tween-count`: **Number of new drawings** (text/inputmode numeric, retains invalid input).
- `#tween-review`: **Review in-betweens**; `#tween-status`: live bounded errors/status; `#tween-usage`: exact frames and before/after budgets.
- `#tween-preview`: canvas640×360, **Reviewed in-between animation**; `#tween-preview-frame`: **Tween preview frame**; `#tween-preview-play`: **Play tween preview** / **Stop tween preview**.
- `#tween-apply`: **Apply in-betweens**; `#tween-discard`: **Discard in-betweens**. Apply enabled only for the current exact receipt. Keep focused controls/nodes through status/preview updates.

## Independent acceptance and maximum fixtures

Producer tests should demonstrate meaningful failure where practical before verification of the implementation. Do not delay a concrete repair solely to accumulate redundant failure runs. Independent scalar fixtures are authored before producer inspection: two-point line; unequal-length right-angle path; repeated/zero segments; one-point/zero-length; explicit reversal; nonidentity pairing/paint order; odd frame gap/floor planning; half-byte RGB rounding; width interpolation; negative-zero; exact endpoints unchanged; detached arrays; original pose motion composed separately; malformed keys/arrays/indices/times; edited/forged/JSON-cloned receipts; all cumulative quotas at and +1 boundaries.

Native production: draw or import original schema2 endpoint strokes, explicitly pair, review visibly distinct intermediates, verify no autosave before Apply, one Undo/Redo, edited generated cel independence, default committed downloads while scratch exists, invalid pose/count fields/focus retained, retirement at pointer/layer/frame/history/import/pagehide/export, recovery protection, narrow layout and keyboard path. Independently decode exported PNG/GIF applied frames with original raw scalar expectations, not producer `resampleStrokePoints` or proposal output. Check original first/end cels, interior positions/colors and unchanged simultaneous pose motion. PNG tolerance handles native antialias boundaries explicitly; use broad core pixels/exact flat colors, not fitted offsets. GIF checks its existing declared3/3/2 palette/delay rules.

Maximum topology fixture: one selected drawing layer with endpoint frames0/95, four paired strokes/endpoint,46 points per original stroke; insert22 drawings (target `floor(j*95/23)`). Other drawing layers retain four1000-point strokes total. Final totals: selected24 cels,100 project strokes,10,000 points exactly (`8*46 +22*4*64 +4*1000`). Use up to four actual bounded image assets to approach the unchanged byte ceiling; admit exact size and decoded content independently. Original endpoint paths can be collinear analytically generated so scalar samples remain independently predictable. Source inputs/PNG assets are original synthetic fixtures, never producer/exporter-generated expectations.

A separate maximum-pair fixture has eight paired55-point endpoints and10 generated drawings plus four1000-point unrelated strokes:100 strokes/10,000 points exactly (`16*55 +10*8*64 +4000`). It exercises8-pair admission separately from the24-cel maximum; do not falsely claim both occur simultaneously. Measure build/review/Apply/96-frame real GIF, actual File import, saved status and complete persistent-browser process restart with byte-identical committed JSON. Existing63 unit/61 native cases remain baseline; rerun final combined gates and exact-commit CI without loosening old assertions.

## Six disjoint implementation owners

1. **Geometry/domain producer:** new `src/tween.ts`, `tests/tween.test.ts`; exact public interfaces first, pure kernel/admission/private receipts/candidate Apply. No model/history/storage/renderer edits.
2. **Workspace producer:** `src/main.ts`, `src/style.css`, optional new `src/tween-view.ts`; complete controls, raw draft/generation integration, correspondence thumbnails, one commit/Undo and existing selector compatibility. Sole owner of main/style.
3. **Preview producer:** new `src/tween-preview.ts`, `tests/tween-preview.test.ts`, optional uniquely named preview harness; prepared existing renderer/rAF lifecycle only. Interface above consumed by UI; no main/render/GIF worker changes.
4. **Independent scalar oracle:** new `tests/tween-oracle.test.ts` and uniquely owned pure fixtures; derive literal math/receipt/budget expectations before reading producer implementation. No production edits.
5. **Independent native workflow:** new `tests/browser/tween.spec.ts`, `tests/browser/tween-fixtures.ts`; genuine production UI/canvas/PNG/GIF/download/recovery/races. Root controls builds/ports; no producer helper used as expected oracle.
6. **Maximum acceptance and read-only review:** new `scripts/smoke_drawing_tweens.mjs` only, independent original maximum fixtures/decoders/persistent profile/artifacts plus source review. No shared source edits/builds; root schedules expensive exports and owns reviewed fixes through original owners.

Root owns final spec/plan/package/version/docs/CI/Git, shared builds and release; no new runtime dependency or backend. Review the concise API and arithmetic above before implementation. This design does not claim a native run, performance measurement, artistic evaluation or learned-artwork milestone.

## Root integration decisions

Friendly Challenges #87 implementation and all local gates are complete while exact-head CI is running. This is the next substantial unblocked authoring milestone. Existing schema2, history pruning and renderer semantics remain authoritative. A complete admitted proposal and actual resulting artwork must be reviewable before Apply; no procedural output is labeled learned animation. Source and original endpoint arrays remain exact. Root coordinates builds, native exports and publication.


## Numerical evaluation correction from independent boundary checks

The exact-equality guard is insufficient for valid unequal endpoints one floating-point step apart. An original fixture with width40 to39.99999999999999 and x-1280 to-1279.9999999999998 at frame2/95 reproduced a weighted-sum value outside the unchanged model bounds. Sampling and geometric/width interpolation now evaluate the same affine expression from the nearer endpoint: `a+(b-a)*t` for `t<=0.5`, otherwise `b+(a-b)*(1-t)`. This is an arithmetic evaluation correction, without clamping, widened bounds or display rounding. Encoded RGB retains the authored rounded weighted formula; original endpoint records remain exact. Independent unit fixtures and the complete native media/workspace suite verify the result.
