# Melody Studio #99 — direct piano-roll authoring

Frozen contract, 2026-10-04. Issue https://github.com/twangyal/projects-monorepo/issues/99. The current piano roll only selects notes for numeric editing. This milestone adds direct correction and drawing while retaining the existing reference, history, storage and export authorities. No model, service, dependency or schema change. Root owns documentation, package version, builds, ports, Git and GitHub. Shot #90 exact published-head CI proceeds independently.

## User experience

The selected track offers **Piano-roll tool**: Move notes (default) or Draw note. **Snap movement** offers quarter beat (default), eighth beat, or Off. Visible guidance explains that movement/resizing uses increments from the original timing; imported fractional offsets are not quantized merely by selection or dragging a whole increment. Drawing snaps absolute start and duration. Existing numeric fields remain the precise accessible editor.

Drag a note body to move time and pitch. Drag its visible right-edge handle to change duration only. The original note remains committed while a distinct labeled transient overlay previews the candidate. A gesture has a 3-CSS-pixel movement threshold; a normal click selects the note and retains its existing timing. Zero-change candidates preserve redo, references, saved bytes and continuation proposals. A valid release commits one ordinary history edit; invalid release preserves all committed work and explains the failed bound. Never silently clamp a pitch, start, duration or endpoint.

Draw on empty grid space with the explicit Draw note tool. Pointer-down captures the clicked pitch and starting beat. A click adds a one-beat note at velocity0.8; dragging right draws its duration. Dragging left or a too-short/long interval refuses rather than flipping/clamping. New IDs are fresh and stable once proposed. Existing notes remain selectable in Draw mode; the tool does not invisibly replace another note. Notes can overlap as already supported by the model. Resize handles are discoverable without nesting interactive buttons inside buttons.

When a note button is focused, Left/Right moves time by the selected snap increment (Off uses one eighth beat); Up/Down moves one semitone. Shift+Left/Right shortens/lengthens by the same increment. Other modified arrows are ignored. Each deliberate keyboard action is one reversible edit; native inputs retain ordinary editing and text Undo. Enter/Space retain accessible note selection and the numeric editor. Keep the existing Add note button as a keyboard-friendly creation alternative.

Use actual grid geometry, not viewport or rendered-note minimum width, to convert movement. Capture grid rectangle, scroll positions, beat span, top pitch and22px row height at start. Pitch movement rounds row displacement to the nearest semitone, ties away from zero. Move/resize timing uses physical delta divided by captured pixels per beat. Drawing start uses clicked absolute grid X; its row is topPitch-floor(localY/22). Restrict visible pitch bounds to legal36–96 when deriving dynamic rows, or clearly refuse empty out-of-range rows. Existing horizontal/vertical contained scrolling remains usable; no automatic scrolling during a gesture is required. Preserve scroll position and focus where possible across the final committed render.

## Pure proposal module

`src/roll-edit.ts` exports `RollSnap = 0 | 0.25 | 0.125` and:

```ts
type RollEdit =
  | { kind:'move'; noteId:string; deltaBeats:number; deltaPitch:number; snap:RollSnap }
  | { kind:'resize'; noteId:string; deltaBeats:number; snap:RollSnap }
  | { kind:'add'; id:string; pitch:number; start:number; duration:number; velocity:number; snap:RollSnap };
function proposeRollEdit(composition: Composition, trackId: string, edit: RollEdit): Composition;
```

Admit the source with existing `validateComposition`, validate edit shape/options/numbers, locate an actual track/note, produce a detached candidate and admit the complete output. IDs must remain globally unique under the existing model. Unknown IDs, unsupported directions/options, nonfinite numbers and noninteger pitch deltas refuse atomically. Preserve track/note order, unrelated values and velocity. Never quantize untouched notes or rewrite reference metadata.

For nonzero snap q, round delta to `sign(x) * floor(abs(x/q)+0.5) * q`; ties go away from zero symmetrically. Off leaves the represented input unchanged. Move adds the snapped beat delta to the original start and integer pitch delta to pitch. Resize adds the snapped beat delta to original duration. If an effective delta is zero, retain the exact original field rather than performing needless arithmetic. Drawing applies the same nearest-grid rule to absolute start and duration. Positive-zero normalization is permitted for newly computed zero; no epsilon, decimal rounding or boundary widening. Existing model bounds remain authoritative:8 tracks,256 notes each,pitches36–96,duration0.25–16,end≤128,velocity0–1.

The pure module does not create history, fetch data, touch audio, choose pointer geometry or hold publication authority. UI generation/intent/source ownership and existing `ReferenceHistory` complete-project/reference limits protect publication. The normal committed document and immutable reference asset graphs remain the sole durable state.

## Ownership and lifecycle

Before starting a gesture, refuse any unsent note/project/track fields, preserving exact values, native nodes and caret. Tell the user to apply or discard them; do not blur them into an implicit commit. Capture this guard before default pointer focus. A gesture does not discard a continuation just by starting; a successful changed commit invalidates it through the existing commit path. Pending file/capture work is retired through normal explicit editing intent, never allowed to publish over a later gesture.

Capture project generation, editor-intent epoch, selected track and the full source snapshot after any deliberate selection/intent change. Recheck before every preview/publication. A new raw input (including changed then changed back), track/project/history action, storage reload, source replacement or busy capture/render state retires ownership. One active primary pointer only; a second pointer cannot take over. Use pointer capture and the original DOM node until release. Existing generic `actionPointer` handling must bypass roll gestures so it cannot steal capture or redraw them during blur. Suppress the trailing trusted click only for a consumed draw/drag, retaining normal note clicks.

No main-app rebuild per pointermove. Render a transient overlay/status only. External render either retires the gesture or defers unrelated status updates while retaining the original nodes, with explicit generation/intent checking. Geometry invalidates on containing/document scroll, resize, detached grid or changed rectangle. Escape, pointercancel, unexpected lost capture, pagehide or hidden document cancel and release the pointer. Returning to the page cannot resume old publication. Cancellation changes no history/storage/reference state. Exports contain committed notes only, including while an overlay is visible.

Final commit passes the admitted composition through existing `commit`/`withComposition` and `ReferenceHistory`. Preserve all reference PCM, bindings and complete-project caps. A successful changed commit stops ordinary/comparison/continuation playback through current ownership paths; a stale worker or AudioContext resume cannot start old sound afterwards. Failed history-budget or validation admission leaves the current project and original references unchanged. No full asset hashing/cloning per pointer movement is needed.

Stable DOM contract: `#roll-tool`, `#roll-snap`, `#roll-status`; `.roll-grid[data-beats][data-top]`; existing `[data-note]`; a child `[data-roll-resize]`; `.roll-preview[data-kind]` with move/resize/add. Labels/aria descriptions explain keys and unsaved preview. The containing piano roll remains accessible and contained at390px; controlled Chromium touch is software evidence, not physical mobile acceptance.

## Verification and ownership

- Domain owner: `src/roll-edit.ts`, `tests/roll-edit.test.ts`; publish API then implement meaningful boundary/atomicity cases.
- UI owner: `src/main.ts`, `src/style.css`, optional `src/roll-controller.ts`; sole integration authority, typed contract and complete controls. Scoped type/lint allowed; root owns coherent builds/servers.
- Independent scalar owner: `tests/roll-oracle.test.ts`; original fractional/polyphonic values, tie rules, legal exact limits and actual excess, unchanged tracks/velocity/reference PCM and history/redo. Freeze expectations before producer inspection.
- Independent native owner: `tests/roll-edit.spec.ts` and uniquely named fixtures; trusted mouse/touch/keyboard, genuine file imports/downloads, complete Undo/reload, raw/capture/lifecycle races and independently decoded MIDI/WAV. Preserve existing58 native assertions and original media tolerances.
- Integration reviewer: read-only raw-DOM/actionPointer/generation/playback/storage/history review; communicate concrete failures to the owner. Additional pure lifecycle tests only when a meaningful stable API permits them.
- Root: package/version0.5.0, frozen design, README/catalog/evidence, baseline/production builds, ports, final full checks, commit/push/CI/issue. Separate maximum original8-track/2048-note/eight-reference fixture should perform direct correction and retain exact reference bytes through complete browser restart; independently verify output timing/pitch without claiming real vocal accuracy.

Retain meaningful RED evidence where it actually occurs. Do not delay fixing a concrete defect just to collect redundant failures, fit output thresholds or claim tests were red if first run passed. After verification, publish durable progress and continue the autonomous goal.
