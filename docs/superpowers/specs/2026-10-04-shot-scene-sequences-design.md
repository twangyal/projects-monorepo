# Shot Studio #90 — editable multi-source scene sequences

Frozen implementation contract, 2026-10-04. Tracker: https://github.com/twangyal/projects-monorepo/issues/90. Authorized by the continuous autonomous goal. Root assessment: `/workspace/after-motion88-shot-assembly-assessment.md`. Motion #88 is already implemented and pushed; its exact-head CI can finish independently. No new runtime dependency, model, service or hardware is required.

## Outcome and scope

Copy complete committed editable films into a separate sequence, select whole authored shots, reorder/repeat/remove clips, rehearse/scrub distinct scenes, Undo/Redo, save/reopen and restore a browser draft, then export a newly rendered silent WebM. Each copied film retains its performers, costumes, full original blocking/looping clock, camera paths and light. This is fresh rendering from editable scenes, not splicing retained recordings. No trimming, retiming, transitions, soundtrack, linked source updates, arbitrary media, immersive sequence export or take-format migration.

Use a dedicated sequence panel and canvas. Ordinary scene fields and their renderer/history/draft remain separate. This avoids previewing a source film through forms that still edit another film. A source is an immutable copy; revise it in the ordinary scene editor and deliberately add a new copy to use changed artwork. Sequence videos are direct downloads and do not enter the schema-3 film take notebook.

## Strict sequence model and pure API (`src/sequence.js`)

```js
{
  schemaVersion: 2,
  kind: 'shot-studio-sequence',
  title: 'The cut',
  sources: [{ id, label, film }],
  clips: [{ id, sourceId, shotIndex, label }]
}
```

Exact own enumerable data records and dense plain arrays only; no accessors, symbols, sparse arrays, unknown fields or custom prototypes. New IDs match `[A-Za-z0-9_-]{1,64}`, unique within sources/clips respectively. New title and source labels are nonblank, well-formed Unicode, <=80 UTF-16 code units; clip labels <=40. Reject C0/DEL controls. Do not trim/normalize accepted text. `shotIndex` is a nonnegative integer into the referenced source. Empty sources/clips are legal editable documents; an empty sequence cannot play or export. Referenced sources cannot be removed silently. Unused sources remain until explicitly removed.

Compatibility amendment: another authorized branch publisher shipped a genuine schema-1 checkpoint with `{id,name,film}` sources and `{sourceId,shotIndex}` clips while this richer implementation was being verified. New documents use schema2. Import both that exact legacy shape and the in-session schema1 `{label}`/stable-clip-ID shape, keeping complete films and source names/labels unchanged. Generate deterministic `legacy-clip-N` identities for the earlier shape and use its original shot name as a display label when valid; otherwise use `Shot N` while preserving the original film string exactly. The identifiable earlier name-form input retains its300 KiB raw-file ceiling; rich schema1/schema2 inputs permit320 KiB. Empty schema1 is indistinguishable and uses the rich320 KiB ceiling. Reject mixed/unknown shapes. Reading/migrating a saved legacy draft never writes it; a later deliberate valid edit or replacement writes schema2. Ordinary scene3/take1 formats remain independent.

Bounds: 0–4 sources, 0–20 clips, total sequence duration <=60 seconds. Each whole clip inherits its source shot's existing 1–15-second duration. Preserve each complete canonical schema-3 film, including unselected shots and later cues. Embedded sources require schema 3; standalone source-file import uses existing `importProject` to migrate genuine schema1/2. Call existing strict `validateProject`, then enforce canonical UTF-8 JSON <=65,536 bytes per source and <=262,144 combined source-film bytes. Complete canonical sequence and input sequence file <=327,680 bytes (320 KiB). File admission counts actual UTF-8 bytes before parse; canonical admission occurs after shape validation. No count truncation, implicit source coalescing, cue clipping or metadata enrichment. Association with a copied imported take is supplied, unverified information, not new authenticated provenance.

Export these exact functions/constants:

```js
export const SEQUENCE_LIMITS = Object.freeze({ sources:4, clips:20, seconds:60,
  sourceBytes:65536, sourceTotalBytes:262144, bytes:327680 });
export function createSequence();
export function validateSequence(value);
export function importSequence(text);
export function sequenceDuration(sequence);
export function addSequenceSource(sequence, source); // exact {id,label,film}
export function removeSequenceSource(sequence, sourceId);
export function renameSequenceSource(sequence, sourceId, label);
export function addSequenceClip(sequence, clip); // exact {id,sourceId,shotIndex,label}
export function removeSequenceClip(sequence, clipId);
export function renameSequenceClip(sequence, clipId, label);
export function moveSequenceClip(sequence, clipId, direction); // -1 or +1
export function prepareSequence(sequence);
```

Each edit admits the full input, creates a detached candidate, validates all resulting quotas, then returns it without mutating inputs. Invalid IDs/references/operations refuse atomically. UI title edits can clone and `validateSequence`; repeat explicitly calls `addSequenceClip` with a fresh clip ID. `sequenceDuration` defensively admits its input; prepared evaluation avoids admitting/cloning the full sequence on every frame.

`prepareSequence` captures and deeply freezes a detached canonical document once. Return `{ document, duration, clips, frameAt(time), clipFrame(index, localTime) }`. `clips` is a frozen list of `{id,label,sourceId,sourceLabel,shotIndex,shotName,sequenceStart,sourceStart,duration}`. Both evaluator methods reject nonfinite times; `clipFrame` also rejects invalid integer indices. Empty frame evaluation throws an actionable error. Finite sequence times clamp to `[0,duration]`; selected local times clamp to `[0,clip.duration]`. Results are immutable detached metadata/camera and a frozen prepared `sourceFilm` reference:

```js
{ clipIndex, clipId, clipLocal, sequenceTime, sourceId, sourceGlobal,
  shotIndex, sourceFilm, camera }
```

Quota amendment: use a canonical sorted Neumaier compensated total for admission, public duration and prepared duration. Reordering the same clip durations cannot create or conceal a quota excess; no epsilon or authored-duration rounding. Preserve the chronological represented prefixes below. At the exact public final duration, return the final selected shot at its full local endpoint even when the chronological prefix total differs by floating-point rounding.

Compute sequence and original source prefixes by ordered represented-number addition, not repeated subtraction. Exact internal sequence boundaries select the next clip at local0; exact final duration selects the last clip at its full duration. For a selected clip, `sourceGlobal=originalSourcePrefix+clipLocal`, and `camera=cameraAt(originalSourceShot,clipLocal)`. Do not use `frameAt(sourceFilm,sourceGlobal)` for a selected clip's terminal endpoint: it can choose the following original shot. Do not shift cues, reset looping phases to clip-local time, use destination actor/light state, or replace the original source-film duration. Repeating a clip deliberately repeats its original source clock. Existing `StageRenderer.draw(sourceFilm,sourceGlobal,camera)` and `exportFilm(canvas,draw,duration,{signal})` remain rendering/encoder authorities.

## Separate history and protected draft (`src/sequence-store.js`)

Export `SEQUENCE_DRAFT_KEY='shot-studio-sequence-v1'`, `SequenceHistory`, and `SequenceDraftStore`. History mirrors the existing shape: constructor(document); detached `current`; `canUndo`, `canRedo`; `commit`, `undo`, `redo`. Validate before publication; invalid/identical commits retain redo. Keep at most30 prior snapshots plus current/future, pruning oldest only on a new commit. Every document <=320 KiB means at most31 retained states fit below10 MiB canonical JSON; explain this as a retained snapshot bound, not JS heap/RAM measurement. An immediate Undo always fits.

Draft constructor accepts `getStorage=()=>globalThis.localStorage`; expose `sequence`, `blocked`, `raw`. Start empty if absent, restore strict valid sequence if present. A failed read, malformed/overbound stored text or invalid source protects the existing record; never automatically rewrite it. Successful load alone does not write. `save(sequence)` refuses when blocked; `replace(sequence)` validates and writes first, and only successful synchronous `setItem` clears protection/raw. A failed save leaves its actual record intact and reports unsaved memory work. The ordinary `shot-studio-v1` draft and take IndexedDB are never accessed by this store.

Concurrent-tab amendment: before ordinary save or explicit replacement, reread the actual storage key and compare with the last successfully observed raw string or proven absence. A mismatch refuses that write, captures the exact newer raw text for recovery, and protects the saved record while preserving working memory. Only a new deliberate replacement after reviewing that record can retry, and it compares again. Failed reads invalidate the observation rather than inventing absence; failed validation/writes never publish a new saved receipt. This is optimistic compare-before-write protection, not atomic cross-tab CAS: localStorage getItem/setItem are separate operations.

Provide `recoveryJson()` returning an exact JSON envelope `{kind:'shot-studio-sequence-recovery',raw}` only when original raw text is known. It is a recovery envelope, not a playable sequence. Bound raw UTF-8 to1 MiB and the encoded envelope to2 MiB; reject larger/control-heavy data without changing protection. A failed read has no downloadable raw record. Do not add automatic destructive reset or eviction. Reload is a separate deliberate retry; explicit replacement requires UI confirmation. In-memory work and complete sequence backups remain usable while storage is protected.

## Product UI and integration owner (`src/sequence-ui.js`, `src/app.js`, `src/take-ui.js`, `index.html`, `style.css`)

Use a distinct **Scene sequence** region following the current workspace with its own960×540 canvas/`StageRenderer`, own save status and controls. Initial empty canvas has clear Add source guidance. Draw on a sequence edit/seek and during its owned playback/export; do not clone the sequence or refresh native form nodes per RAF. Both ordinary scene and sequence fields remain visible and independently owned; ordinary scene controls never show the copied source as their edit target. Dedicated renderer avoids shared canvas publication races. Preserve all existing selectors/tests.

Required complete operations:

1. **Add current scene** copies the committed scene only after the existing raw scene guard passes. It is one reversible sequence edit. Clearly say sources are detached complete films. **Import scene source** reads an actual <=64 KiB File, uses existing `importProject`, and copies it atomically under a fresh ID; reject on newer sequence intent or page departure. Existing sequence/raw fields remain on failure.
2. Existing saved take details gain **Copy editable scene to sequence**. The take owner synchronously captures the selected saved record's film/name and invokes an optional supplied integration hook; do not expose WebM bytes or scan/reload the library. Disable for unsaved/working/unreadable records. The receiving UI applies ordinary sequence raw/busy guards, clones/admit/copies the film, then adds one source. Later take rename/delete or live scene edit cannot alter it. No trusted provenance field is added. This copy is an explicit action and needs no second confirmation merely to add a reversible source.
3. Source buttons/list identify label, film title, performer names/colors/light and complete shot count. Selected source shows its authored shots with original source start/end and duration. Choose a source shot and **Add shot to sequence**. Keep unused sources; **Remove source** refuses if referenced and explains the count. Source label can be renamed without altering its film.
4. Ordered sequence clip controls support selection, **Move clip earlier**, **Move clip later**, **Repeat clip**, **Remove clip**, and label editing. Display source label/original shot and sequence duration. Total count/time/source caps refuse atomically. Source/clip/title raw fields are text, preserving exact invalid and changed-back input and native node identity; explicit apply/discard is acceptable and preferred. Selection that would replace their contents requires correction or explicit discard consent. No silent reset/clamp. Undo/Redo sequence is separate from Undo scene.
5. **Rehearse sequence**, **Stop sequence**, range **Sequence position**, plus selected **Preview clip start/end** use prepared evaluation. Display sequence time separately from source time/clip identity; explicit endpoint preview must not be mislabeled as the next cut. Rehearse from a selected endpoint starts at that clip's sequence start. At sequence end, rehearsal restarts from0. User seeking stops playback. All raw editing/export/lifecycle guards remain.
6. **Save sequence** downloads canonical committed `.shot-sequence.json`, explicitly excluding raw fields. **Open sequence** uses actual File<=320 KiB and strict import then an explicit whole-document replacement confirmation, preserving other scene/take state. Capture/recheck raw intent and operation around reads/dialogs; later changed-back input cancels a pending publication. **New sequence** confirms replacement, and is one reversible edit. Export/history/selection never commit or erase raw fields implicitly.
7. **Export sequence WebM** captures one fully admitted prepared nonempty committed document, finishes/explicitly discards raw sequence drafts, and uses its dedicated canvas and existing encoder with32 MiB actual chunk cap. Never retain the result as an ordinary schema3 take. Show real-time/keep-tab-visible instructions, progress/status and **Cancel sequence export**. Download only if operation owner still current; abort on pagehide/context loss/tab hidden, dispose capture through the existing encoder. Exact frame timing remains native recorder-dependent.
8. Protected startup shows **Download unreadable sequence** if available, **Replace saved sequence** with explicit consent, and the independent status. Work/Undo/import/export cannot silently release protection. A failed explicit save stays protected. Beforeunload warns for raw sequence edits, pending import/export or unsaved committed changes.

Coordinate through small hooks rather than teaching existing renderer/model about sequences. Suggested interface `createSequenceUI({captureFilm,sceneBusy,exportingChanged,download})` returns `{controls,copySource(film,label),suspend,hasPendingWork}`; UI owner may refine hook names but must notify root/native owner before freezing them. App's normal busy includes sequence recording; sequence sceneBusy excludes its own recording to avoid self-deadlock. During sequence export stop ordinary rehearsal and skip ordinary renderer RAF work; disable scene/XR/take recording. Ordinary recording/XR locks sequence mutation/transport/export. Dedicated canvases permit ordinary scene and sequence documents to remain independent. Take video playback can stay separate, but must not write/clear sequence canvas or publication tokens. Never globally rebuild raw fields when another panel updates status.

Retire pending sequence imports on every new raw/source/clip/title intent including changed-back values, selection/history/replacement and page departure. Store/generation/import/export tokens are UI ownership, not persistent provenance. A suspended operation cannot publish after pageshow. Stop RAF on pagehide/visibility loss; pageshow remains stopped and allows deliberate rehearsal again. Context loss protects current data, cancels sequence recording and disables graphics actions with backup guidance. A failed sequence renderer must not break the ordinary scene. Use native safe textContent for imported labels and no arbitrary URLs or HTML.

## Stable selectors and accessibility

Use these IDs with the displayed labels above:
`sequence-panel`, `sequence-stage`, `sequence-status`, `sequence-save-status`, `sequence-title`, `sequence-title-apply`, `sequence-discard-edits`, `sequence-add-current`, `sequence-import-source`, `sequence-sources`, `sequence-source-label`, `sequence-source-rename`, `sequence-source-remove`, `sequence-source-shots`, `sequence-add-shot`, `sequence-clips`, `sequence-clip-label`, `sequence-clip-rename`, `sequence-earlier`, `sequence-later`, `sequence-repeat`, `sequence-remove`, `sequence-undo`, `sequence-redo`, `sequence-play`, `sequence-stop`, `sequence-scrub`, `sequence-time`, `sequence-source-time`, `sequence-preview-start`, `sequence-preview-end`, `sequence-save`, `sequence-open`, `sequence-new`, `sequence-export`, `sequence-cancel`, `sequence-recovery-download`, `sequence-replace-saved`, `sequence-add-take` (in take details).

Source rows have `data-sequence-source-id`, clip rows `data-sequence-clip-id`, shot buttons `data-source-shot-index`; selected buttons expose aria-pressed. Native text inputs have explicit accessible labels. Reconcile rows preserving focused controls where their identities survive. At390px stack controls and keep canvases contained; no horizontal document overflow. Root/native owner can agree minor selector additions without changing acceptance semantics.

## Verification and disjoint owners

Independent fixtures must be authored before producer inspection, with literal source clock and pinhole/pixel expectations. No implementation imports may generate the expected clocks, camera projections or output pixels. Use two visually distinct original sources: different light/costumes, selected shot starting at nonzero source time, travel, blocking cue/action/visibility switches and looping phase. Freeze tolerances before reading video output; inspect actual presentation timestamps and stable cut neighborhoods rather than assuming exact30fps. Genuine before/after regression evidence is useful, but do not delay a concrete repair only to accumulate redundant failing runs.

1. **Domain owner:** `src/sequence.js`, `tests/sequence.test.js`; full strict model/edit/quota/prepared evaluator. Publish callable API early. No other production files.
2. **Persistence owner:** `src/sequence-store.js`, `tests/sequence-store.test.js`; independent history/draft/recovery; consume exact domain contract. No app/ordinary stores.
3. **Workspace owner:** `src/sequence-ui.js`, `src/app.js`, `src/take-ui.js`, `index.html`, `style.css`; sole integration owner, complete usable flow. No domain/store changes without owner coordination.
4. **Independent scalar owner:** `tests/sequence-oracle.test.js`, own literal fixtures; source-prefix/repeat/reorder/fractional-cut/endpoints/original duration, immutability, exact quota and malformed shape/origin checks. No producer edits.
5. **Independent native owner:** new `tests/browser/sequence.spec.js` and uniquely named fixtures; full real UI, current/file/saved-take source routes, generated recording, exact JSON/portable restart, raw/lifecycle/storage races, independent WebGL/video oracle and390pxkeyboard. Preserve existing53native assertions. Root coordinates static ports/media runs.
6. **Maximum/read-only review owner:** new `scripts/smoke_scene_sequences.mjs` with independently authored4sources at source shot/cue/name topology,20clips/exact60sec, genuine full-minute WebM, portable complete persistent-process restart and decoded frames; review current domain/store/UI after implementation. Do not claim all per-source/document byte ceilings attainable canonically; measure original maximum topology and separately test legal whitespace file ceiling/+1. Root schedules expensive media.

Root owns package/version0.5.0/check commands, README/catalog/spec, final evidence, builds/ports/Git/GitHub/CI. Preserve existing146unit/53native gates, then run final combined checks and exact published-head CI. No physicalVR/subjectivecinematography/codecseekability/peakRAM claim follows from these tests. Document actual artifacts, original fixtures, failed runs and limits. Commit/push complete durable progress before continuing.
