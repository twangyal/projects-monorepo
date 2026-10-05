# Motion retained-stroke editing — approved bounded contract (#122)

Approved by root on 2026-10-05 for issue #122 after source/issue assessment. Implementation and independent verification proceed in disjoint ownership below; no runtime result is implied by this design.

## Why this is useful and how it fits

Motion currently exposes Draw and Move (`src/main.ts:24`): Draw appends a path to the active held cel (`main.ts:378–434`); Move changes the entire layer pose. Users can delete a layer or later cel, but cannot select/correct/delete an older individual path. Session-only Undo cannot correct one old stray stroke after reopening a saved animation (`README.md:20–27`). In-between results are promised to remain editable, but presently that means adding more strokes or changing whole-layer poses.

GitHub connector searches for Motion Studio issues found #16, #46, #48, #84, #88, #104, #106 and #110, with no matching retained-stroke editor milestone. Searches also confirmed the concurrent Karaoke #121; no overlap is proposed. `gh` REST/GraphQL were forbidden; connector searches succeeded. This is a bounded title/topic search, not a claim about every historical comment.

## Existing facts to preserve

- Project schema 2, fixed 640×360 stage, 12 fps, 12–96 frames. No format bump or new persisted selection fields.
- `Stroke = {color,width,points}`, no ID. Width finite 1–40; 1–1,000 points per stroke, each coordinate finite in [-1280,1280]. Globally at most 100 strokes and 10,000 points; 8 layers, 24 cels/layer, 4 images, 6,291,624-byte canonical project (`src/model.ts:1–21,97–137`).
- Each cel has an exact frame boundary and detached ordered strokes. The active cel holds until the next boundary; drawing edits affect its complete exposure, not just the current preview frame. Blank first cels are legal. Duplication and generated in-betweens are detached copies.
- Layer poses are independently interpolated translation, uniform scale 0.1–4, rotation and opacity. `localPoint` already supplies inverse translation/rotation/scale (`model.ts:273`). No stroke edit creates or changes a pose key.
- Rendering is ordered round-cap/round-join polylines. One-point and repeated-coincident paths are explicit circles; hit testing must include both (`src/render.ts:89–110`). Do not regress the Chromium-dependent degenerate-path repair.
- `replaceDrawingCelStrokes` validates a detached complete candidate (`model.ts:334`). History preserves 30 snapshots within 20 MiB and rejects canonical no-ops before trimming Redo (`src/history.ts`). Existing commit/autosave/library conflict paths remain the only durable edit path.

## First usable slice

Add a third mode **Edit strokes**, leaving existing Draw and Move behavior intact. It is available only for a selected drawing layer. The editor contains:

1. A bounded accessible list of the active cel's strokes in paint order, each a native button named `Stroke N`, with color/width/point count, selected state and optional small path thumbnail. This permits choosing obscured, offstage and zero-opacity artwork without a precision pointer.
2. Canvas hit selection and whole-stroke pointer translation in Edit strokes mode.
3. Separate **Selected stroke color** and **Selected stroke width** fields, explicit **Apply stroke appearance**, **Discard stroke edits**, and **Delete selected stroke**. Existing Ink/Brush controls remain future-drawing settings and must not silently edit selection.
4. Keyboard translation and deletion when the canvas or a stroke-list button owns focus. Arrow keys move by one stage unit; Shift+Arrow by ten. Delete/Backspace deletes the selected stroke only in that narrow focus/mode context. Enter on a list button selects; ordinary native keyboard semantics remain. Text fields retain their normal arrows, deletion and Undo.

Do not add point editing, path smoothing, arbitrary eraser cuts, multi-selection, stroke IDs, object grouping, free rotation/scaling of strokes, reordering or AI. A whole-stroke correction tool is a complete first milestone.

## Selection and raw fields

Transient target is `{layerId, celFrame, strokeIndex, generation}`. Never use index alone across a replacement. Canvas/list selection causes no history entry, save or project mutation. Editing intent does retire older asynchronous import/restore/PNG/tween publication through the established operation/generation boundary.

Use a deliberately simple validity rule: frame changes (even within the same hold), layer/cel/project changes, Undo/Redo, imports and unrelated committed edits clear stroke selection. A successful own appearance/translation edit may deliberately rebind the same index to the resulting generation. Delete clears selection. There is no automatic selection of a different path at the removed index. Explain the active held range in the panel.

Selected width is a text field with decimal input mode, parsed only by Apply: exact empty/partial spelling remains until valid Apply or explicit Discard. Color/width scratch joins the existing editor-draft guards, before-unload and private-publication protections. Selection/mode/frame/layer/workspace/history transitions refuse unapplied raw values or use the existing explicit discard route. Never silently blur-commit another pose/title field to make a stroke action admissible. Primary pointer admission must inspect/prevent blur before a native `change` handler can commit an unrelated field.

A metadata/save callback must not rebuild selected raw controls or move focus/caret. Discard resets only the new appearance scratch to the committed selected stroke. New stroke scratch retires reviewed tween/export/import owners even when changed and changed back. Selection itself is not a durable draft.

## Hit and translation math

Selection is restricted to the active held cel of the selected drawing layer. It does not automatically select a different layer or image. Search strokes in reverse paint order and return the first hit; this is topmost *within the selected layer*, not a promise of visible composited-pixel picking through higher layers. List selection remains available for occluded and opacity-zero paths. Canvas picking may refuse opacity-zero layers with that guidance.

For each nonzero-length segment, compute the clamped nearest point using the scalar dot-product formula. A repeated segment is a point. A path consisting entirely of coincident points remains a circular target. Hit is inclusive distance <= half stroke width plus padding, using inverse-transformed pointer coordinates. Freeze padding at 6 CSS pixels converted through the captured canvas CSS-to-stage scale and the selected layer's uniform scale. Canvas is currently fixed 16:9 (`style.css:67`); measure its actual content rectangle. Avoid using devicePixelRatio as a second scaling factor. Define any unexpected nonuniform layout handling explicitly (safe refusal is sufficient) before implementation.

Pointerdown on a hit selects it and captures the immutable base graph, exact cel boundary/index, evaluated pose, pointer ID, generation/operation and canvas/viewport/DPR geometry. A click selects without mutation. Translation starts only after >=3 CSS pixels from initial pointer position. Each preview is base points plus the current inverse-transformed displacement: `localPoint(current, capturedPose) - localPoint(start, capturedPose)`. Never incrementally add event deltas or derive from an already translated preview.

Preserve color, width, point count, point order, repeated points and all unselected values. Do not normalize/resample paths. Refuse a translation if ANY resulting point is nonfinite or outside [-1280,1280]; do not clamp individual points or distort the stroke. Invalid pointer movement cancels the whole gesture, restores original pixels and creates no history/save; a later pointerup cannot publish a formerly valid prefix. No silent nearest-valid-boundary snapping.

Keyboard displacement is expressed in stage axes, inverse-rotated/scaled into local displacement with the same captured evaluated pose. One accepted keydown is one edit; repeated keys may be explicitly ignored for bounded, predictable Undo. The shape stays rigid in local coordinates; later frames render the edited cel through their own unchanged poses.

## Gesture and persistence lifetime

Reuse the existing `Gesture`/`ownsGesture` and history commit boundaries (`main.ts:74,365–437`). Own pointer ID, exact frame/cel, generation, operation, selected layer and geometry throughout. Second pointers cannot steal the session. Pointercancel, lost capture, Escape, blur, hidden/pagehide, resize/scroll or geometry change, mode/frame/layer changes and any newer raw intent cancel without publication. Pointerup must use/check its own final coordinates, not blindly commit the last move event.

Appearance Apply/delete/keyboard/pointer completion validates the complete candidate first, then enters the existing `commit` exactly once. True no-op changes keep Redo and do not autosave. Empty remaining cel is legal, including first cel. Exports/private publications contain only committed graph, never selection handles or preview. Draw the selection overlay separately from `renderFrame`; avoid modifying shared PNG/GIF rendering. New controls/status must not shift canvas geometry during a drag (the prior Melody mobile status-wrap failure is relevant).

In protected saved-copy recovery, valid edits may remain in memory through the existing policy; they cannot establish new storage authority. Stale library writes, late asset loads, import supersession, native transaction completion, history-byte pruning and explicit save recovery remain unchanged. No new storage schema or custom save queue.

## Suggested exact source ownership boundaries

- Pure kernel: new `src/stroke-edit.ts` and `tests/stroke-edit.test.ts`. Import current model validation/types; do not independently weaken them. Suggested pure operations: bounded `hitStroke(strokes,localPoint,padding)`, `translateStroke(project,layerId,celFrame,index,delta)`, `setStrokeAppearance(...)`, `deleteStroke(...)`, all edits returning detached Project. Exact public signatures/error policy to freeze before release.
- UI/controller: `src/main.ts`, `src/style.css`, optional new `src/stroke-editor.ts` and focused new controller tests. Preserve existing renderer/storage/history APIs; root owns any necessary existing-test compatibility.
- Independent scalar/graph oracle: new tests with literal original paths, poses and expected coordinates, without importing producer hit/transform code to calculate expectations.
- Independent native editor/media: new browser test and original fixture helper; existing image decoder/PNG/GIF decoders may decode actual artifacts, but expected coordinates/colors must be independent. Root coordinates all builds/services/leases and broad gates.

Candidate selectors: `#edit-strokes-mode`; region `#stroke-editor` (Selected drawing strokes); `#stroke-list button[data-stroke-index]`; `#stroke-status`; `#stroke-color`; `#stroke-width`; `#stroke-apply`; `#stroke-discard`; `#stroke-delete`. Confirm exact names with UI/native owners before they author tests. A separate overlay canvas is optional, but must share geometry and never intercept pointer ownership accidentally.

## Independent expectations before producer execution

- Literal two-cel/two-drawing-layer project plus an original embedded image. In active cel: red horizontal path, overlapping blue later path, a green one-point dot, and repeated-point dot. A second cel contains detached identical-looking paths; both it and the other layer/image must remain byte-identical.
- Pose example `(x=200,y=100,scale=2,rotation=90°)`: local point `(10,5)` is stage `(190,120)`; a stage drag `(20,-10)` means local delta `(-5,-10)`. Assert every full JSON point, unrelated key and cel unchanged; do not calculate expectations with production `localPoint`.
- Hit tests: segment middle, beyond endpoint round-cap, exact boundary/+epsilon, repeated segments/dots, reverse paint overlap choice, scale0.1/4, rotated pose and clear no-hit. CSS390px actual canvas tests observe the declared6px padding without changing model units.
- Native click/list select creates no Undo/save. Translation/appearance/delete each exactly one Undo/Redo; cancellation and same-value Apply retain Redo. Delete last stroke produces blank cel without deleting its first boundary. Selection is retired rather than retargeted after unrelated topology/history.
- Original points at +/-1280: exact boundary translation accepted where valid; +epsilon refused atomically, not clipped.100 strokes/10k points remain under unchanged quotas; translation/color do not magically reduce or increase counts. Canonical-size overflow from changed numeric spelling is rejected before commit.
- Actual PNG and decoded GIF sample original and edited colored interiors at frames before/inside/after the held exposure; independent pose animation remains visible and correct. Selection outline must not appear in exports. Save/complete browser restart preserves exact full backup, image bytes and stroke arrays.
- Real raw pose/width spelling and caret, changed-back input with held native File/bitmap work, stale-tab save conflict, pagehide/canceled gesture, 390px trusted touch, list+keyboard-only correction. Keep deliberate controlled lifecycle gates distinct from real browser navigation claims.

No pretrained models, new media source, network API or hardware is needed. No runtime behavior was claimed from this source-only assessment.


## Frozen producer API and execution ownership

Use a new `src/stroke-edit.ts` with these exports:

```ts
export type StrokeTarget = { layerId: string; celFrame: number; strokeIndex: number };
export function hitStroke(strokes: readonly Stroke[], point: Point, padding: number): number | null;
export function translateStroke(project: Project, target: StrokeTarget, delta: Point): Project;
export function setStrokeAppearance(project: Project, target: StrokeTarget, appearance: { color: string; width: number }): Project;
export function deleteStroke(project: Project, target: StrokeTarget): Project;
```

The target cel frame must identify an exact existing boundary, not implicitly another held cel. Reject malformed target/index/delta/appearance with an Error; never mutate arguments. Operations validate complete candidate graphs and canonical byte bounds using existing model APIs. Pure helper no-ops may return a detached equivalent graph; the existing commit/history no-op check governs saves and Redo. `hitStroke` rejects nonfinite points/padding or negative padding; it is a geometric query over valid retained strokes. Inclusive round-segment geometry and reversed paint order are required. UI must clear canvas picks for opacity-zero layers and direct the user to the list. Unexpected nonuniform canvas aspect geometry refuses pointer admission safely; no silent coordinate distortion. Keyboard repeated keydown events are ignored. UI arrow moves are stage-axis displacements inverse transformed through the current evaluated pose.

The selectors in the proposal above are frozen. Name the mode button **Edit strokes**, the list region **Selected drawing strokes**, and list buttons **Stroke N** (accessible name exactly that, descriptive color/width in adjacent content or description). The layer/cel graph remains unchanged except the intended selected stroke action. Selection/status controls must not alter stage geometry during dragging.

Root owns Git, GitHub, README/catalog/version/package/config changes, all builds/live browser services/full gates and final integration. The kernel owner owns only the new pure helper and its producer unit tests/receipt. UI owner owns main.ts/style.css and optional stroke-editor.ts/controller tests/receipt. Independent oracle owners do not read producer code before freezing original expectations; expected values cannot call producer transformations. Root may run actual baseline feature-absence probes after their freeze, without inventing a behavioral RED if unavailable UI makes that a capability absence. Test authors preserve first failures; fixture corrections require root review of concrete evidence.

No tests of repetitive accessors or scaffold-only milestones. Product checks must prove complete graph/artwork preservation, actual interactions, cancellation and durability. Existing working checks remain unchanged unless the feature requires a narrow reviewed compatibility update. Do not modify storage, render, tween, private-links or history implementation without evidence and root coordination.
