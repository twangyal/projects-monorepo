# Shot Studio — source-range sequence trimming

Approved by root after independent numeric/migration review, 2026-10-04. Implementation is released under the disjoint ownership below. Tracker: [#114](https://github.com/twangyal/projects-monorepo/issues/114). This extends closed [#90](https://github.com/twangyal/projects-monorepo/issues/90); root owns tracker updates. The issue was created before implementation.

## User outcome and alternatives

Select a sequence clip, choose an In and Out within its original authored shot, preview those endpoints, and apply the range as one reversible edit. Reorder/repeat these excerpts, save/reopen the complete editable sequence and export a newly rendered silent WebM. A source film remains a detached complete snapshot with its original camera, performers, cues, light and duration.

Per-clip source ranges are the recommended approach. Editing a copied shot's duration would renormalize its camera travel and may invalidate later performer cues; slicing retained video would introduce media splicing and lose editable-source evaluation. Neither is part of this milestone. There is no speed change, transition, audio, arbitrary frame selection, timeline drag editor or linked source update.

## Existing invariants

Ordinary film schema3 permits shot durations from 1 through 15 seconds and films up to 60 seconds. Current sequence schema2 contains complete films and whole-shot clip references. Its source prefixes use chronological represented-number addition; its public duration/quota uses a sorted Neumaier compensated sum. At the canonical final duration it explicitly evaluates the final clip endpoint. Scene history, saved takes, source films, camera validation and performer evaluation remain unchanged.

Keep 4 sources, 20 clips, 60 output seconds, 64 KiB per source film, 256 KiB total source films and 320 KiB complete sequence input/output. Keep the separate sequence draft key `shot-studio-sequence-v1`, existing protected compare-before-write recovery and 30-edit history. Export remains 960×540, requested 30 fps, silent WebM, at most 32 MiB and real-time duration plus the existing 10-second deadline allowance.

## Canonical schema3 and migration

The exact root remains `{schemaVersion,kind,title,sources,clips}`, with `schemaVersion:3` and `kind:'shot-studio-sequence'`. Sources remain exactly `{id,label,film}` with canonical complete film schema3. Clips become exactly:

```js
{id, sourceId, shotIndex, label, inTime, outTime}
```

`inTime` and `outTime` are finite numbers in original-shot-local seconds. Admit `0 <= inTime < outTime <= originalShot.duration` and `outTime - inTime >= 0.1`. Export `MIN_SEQUENCE_CLIP_SECONDS=0.1`. Canonicalize numeric negative zero to positive zero in these range fields, matching canonical shotIndex handling; do not quantize, round, clamp or modify any nonzero authored value. Source film validation/canonicalization retains the existing policies, including its legacy string and geometry semantics.

The minimum protects this desktop authoring slice from effectively invisible cuts and preserves all legal earlier clips, whose full shots are at least one second. It is a minimum represented span, not a frame-count guarantee. Strict IEEE arithmetic matters: a pair whose represented subtraction is just below 0.1 is refused even if rounded labels would display 0.10. Show the full computed duration in validation feedback and explain that Out must exceed In by at least 0.1 seconds. Never use an epsilon to hide this distinction. UI numeric controls use `step='any'`; HTML stepMismatch must not narrow the model.

Schema2 exact rich clips migrate to `inTime:0,outTime:sourceShot.duration`. Both genuine schema1 forms retain their current exact admission:

- Name-form sources `{id,name,film}` and clips `{sourceId,shotIndex}` use the existing deterministic clip IDs and generated labels; invalid derived display text uses `Shot N`, without changing the source film.
- Earlier rich-form sources/clips retain their IDs and labels.

All old clips become full-range schema3 clips. Reject range-bearing fields in versions1/2 rather than silently honoring or dropping them. Reject future versions, mixed legacy forms and unsupported fields. Preserve original 300 KiB raw admission for identifiable name-form v1; rich v1/v2/v3 remain bounded at 320 KiB. Canonical output including newly added range fields must fit 320 KiB; refuse an over-cap result atomically rather than dropping sources or ranges. Empty documents remain editable but cannot play/export.

Loading an old browser draft migrates only in memory. It never rewrites saved bytes until a deliberate normal edit/save or explicit protected replacement succeeds. Portable ordinary scene and take archive formats are untouched.

## Pure model API (`src/sequence.js`)

Existing exported function signatures remain unchanged, returning detached canonical schema3 candidates. `createSequence()` now creates schema3. `validateSequence` handles strict versions1/2/3 migration above. `addSequenceClip` accepts the exact new clip shape; the UI supplies full source-shot endpoints for a new clip. Repeat copies the committed range under a fresh ID. Rename/move/remove preserve range values and all source data.

Add:

```js
setSequenceClipRange(sequence, clipId, inTime, outTime) // canonical detached document
resetSequenceClipRange(sequence, clipId)             // full referenced source shot
```

Both validate the entire current document, resolve the existing clip/reference, validate the complete candidate and quota/byte limits, then return it. They never mutate inputs. Invalid and identical candidates retain history/redo; actual commit remains SequenceHistory's responsibility. Reset is a deliberate one-edit operation and requires the same raw-field guards as any replacement action.

`SEQUENCE_LIMITS` retains its existing names/values. Consumers use the separate minimum constant. `sequenceDuration` uses compensated sums of each represented `outTime-inTime`; no authored-duration rounding and no tolerance widening. Reordering unchanged spans cannot create or hide a quota excess.

## Prepared evaluator and exact endpoint policy

`prepareSequence` still captures and deeply freezes one detached canonical document; animation/export cannot reread live forms or mutable source objects. Its returned object remains `{document,duration,clips,frameAt,clipFrame}`.

Prepared clip metadata retains all existing fields and adds `inTime,outTime,sourceDuration`. `sourceStart` remains the original source-shot prefix (not the trimmed start). `sourceDuration` is the untouched original shot duration. `duration` becomes represented `outTime-inTime`. `sequenceStart` is chronological ordered addition of trimmed spans. Preserve the explicit compensated-final-duration override rather than using an epsilon or repeated subtraction.

`clipFrame(index,localTime)` validates finite time and clamps it into the selected trimmed span. For exact local0 use `shotLocal=inTime`; for exact local duration use `shotLocal=outTime`; otherwise use `inTime+local`. These endpoint branches prevent subtraction/addition from changing a specified endpoint by one ULP.

The frame result retains `clipIndex,clipId,clipLocal,sequenceTime,sourceId,sourceGlobal,shotIndex,sourceFilm,camera` and adds `shotLocal`. `clipLocal` is elapsed time within the excerpt, not original-shot-local time. Evaluate:

```js
sourceGlobal = originalSourceShotPrefix + shotLocal
camera = cameraAt(originalSourceShot, shotLocal)
```

Render with `StageRenderer.draw(sourceFilm,sourceGlobal,camera)`. Do not call ordinary film frameAt to choose the camera at a trimmed selected End; it may select the next source shot. Do not stretch camera travel, shift performer cues, restart limb/loop phase at the trim, modify original film duration, or remove unseen source data. Repeating an excerpt repeats its original source clock. Blocking still receives the original complete film duration.

Ordinary `frameAt` uses trimmed chronological prefixes: exact internal sequence cuts select the next clip at elapsed0/In. Exact canonical final duration selects the last clip at its explicit Out. Preserve current final-prefix handling when the ordered final sum differs by an ULP from the compensated total. Explicit selected End preview always uses `clipFrame`, independent of the following clip. Out is the selected endpoint for preview/final frame; ordinary nonfinal playback intervals remain half-open at cuts.

## UI and lifecycle (`src/sequence-ui.js`, `index.html`, `style.css`)

Add stable native number inputs `#sequence-clip-in` and `#sequence-clip-out`, labeled **Clip In (source-shot seconds)** and **Clip Out (source-shot seconds)**, `step='any'`. Add `#sequence-range-apply` (**Apply clip range**) and `#sequence-range-reset` (**Use whole shot**). Show `#sequence-range-info` with original shot bounds, committed In/Out, excerpt duration and original source-film start/end. No new canvas or renderer is needed.

Typing either number records intent immediately, retires pending imports/rehearsal and preserves exact raw text, node identity, focus and selection. Blank/nonfinite values are refused explicitly; never use Number('') as zero. Apply parses both fields as one full candidate and commits once only after whole-document validation. Failure retains both strings, focus, committed preview/document, history and redo. Identical valid Apply can resolve the raw-field marker without making a new history state.

Both fields join the existing raw sequence guard. Clip/source selection, Repeat, move/remove, Reset, Undo/Redo, source/sequence import, New and protected replacement cannot silently replace them. Require correction or explicit existing **Discard sequence edits** consent before replacing raw content. A changed-back input still invalidates an old async owner; do not compare only committed generation. Successful edit refreshes field values deliberately; status/progress must not rebuild the input nodes.

Preview/rehearsal and backups continue to describe committed settings. Apply-free raw typing does not alter a camera or exported file. Existing source-copy hooks and ordinary scene/take forms remain separate. Show both clip-relative and original shot/source-film time, so trimmed camera and performer phase are understandable. Preview Start/End now uses committed In/Out. Repeat retains the range. Reorder never resets it.

Preserve the existing sequence operation epoch, pagehide/hidden cancellation, sceneBusy/export locks and captured prepared export snapshot. Range edits during an export are blocked, not deferred into the captured result. Late import/export completion cannot select or overwrite a newer clip/range. Failed storage preserves complete memory work and old bytes/protection; no automatic rewrite or overwrite. No changes to localStorage's non-atomic cross-tab guarantee.

## Verification and acceptance

Independent pure fixtures must be authored before reading the new producer kernel:

1. A 4-second linear camera eye X -2→2 trimmed1→3 has exact endpoint X -1/+1 and midpoint0, while its full shot and source bytes remain unchanged. A nonzero earlier source prefix proves camera local and performer global clocks differ.
2. Original blocking visibility/action cues before, inside and after an excerpt; limb phase at trimmed In uses the original cue's phase. A looping actor retains source-global phase. Repetition repeats identical source times/poses, not destination time.
3. Original fractional source prefixes1.1+1.2, trimmed destination prefixes and exact internal cuts; explicit nonfinal End versus next-clip Start. Final Out is exact even when `inTime+(outTime-inTime)` differs by rounding. Include compensated60-second permutations and a represented actual excess refusal.
4. Both literal v1 forms and literal canonical2 migrate full range, preserve full source data and reject range-bearing old shapes. v3 strict fields, dense arrays, ID/reference/text/byte limits remain. Invalid zero/reversed/nonfinite/over-source/below-minimum ranges, 21 clips and >60 seconds refuse atomically. Exact0.1 and immediately below are distinct represented-number fixtures.
5. Detached inputs, immutable prepared snapshot, repeated range copies, no-op history/redo and raw protected draft bytes. Malformed/corrupt/foreign storage retains recovery rules and old fixture coverage.

Native public UI acceptance:

- Numeric and keyboard range edits, Start/End preview, Repeat/reorder/reset, Undo/Redo, raw blank/Unicode neighboring labels and changed-back intent; 390 px labels/buttons/overflow and focus retention.
- Real JSON File imports, complete backup bytes, old-format startup with no rewrite, deliberate edit persistence and full browser-process restart. Failed/stale File reads and imports cannot replace raw trim strings or history.
- Actual WebGL landmarks/performer silhouettes at independently derived source times; then download and independently decode a real WebM with multiple different sources, trimmed travel and blocking, repeats and boundary gaps. Compare decoded PTS against expected source intervals with explicit real-time frame-grid tolerance; never use hashes alone as visual proof.
- Separate maximum20-clip/60-second export retains all source films/ranges and stays within32 MiB. Exercise cancellation after actual rendering progress and page lifecycle. Do not claim that every topology/byte maximum coexists, or that requested30 fps guarantees every0.1-second clip contains a particular frame count.

No new inference, model download, backend, dependency or physical headset acceptance is needed. Existing scene/camera/blocking/take/sequence tests remain meaningful; only schema/version expectations and genuine legacy fixtures receive minimal compatibility updates under a separate owner.

## Suggested ownership after review

- Model/evaluator: `src/sequence.js`, new producer trimming tests. One owner for schema, span totals and prepared clocks avoids competing edits in the same file.
- UI: `src/sequence-ui.js`, `index.html`, `style.css`, new UI-focused tests if needed. No ordinary scene/take rewrite.
- Independent scalar oracle: new `tests/sequence-trim-oracle.test.js`, including literals and migration/ULP endpoints.
- Native/media: new `tests/browser/sequence-trim.spec.js` and a reproducible uniquely named actual WebM/max probe.
- Root: tracker/spec/plan/release, minimal existing compatibility assertions, README/version/evidence/CI/Git. A separate final read-only reviewer checks model/UI seams once coherent.
