# Shot Studio performer blocking

Issue: https://github.com/twangyal/projects-monorepo/issues/63. Physical XR acceptance remains https://github.com/twangyal/projects-monorepo/issues/21.

## Outcome and scope

Author arrival → hold → wave → departure for either of the two existing block performers on one global film timeline. Preview, rehearse, save/reload, Undo/Redo and export the actual silent WebM with the same evaluated performance. Preserve camera travel, exact cuts/endpoint previews, legacy looping performances, draft recovery and raw-input/import protection. No new runtime dependency, assets, skeletal rig, collision avoidance, turning, dialogue, audio, easing, take library or physical-headset claim. Existing limits remain: two actors,1–20 shots,1–15 seconds each,60 seconds total,64 KiB backup,30 prior history states.

## Schema3 and strict migration

Project keeps exact root keys `{schemaVersion,title,light,actors,shots}`; schemaVersion becomes3. Camera schema/validation is unchanged from version2. Actor records are a strict discriminated union:

```js
// Legacy looping performance: exact keys below.
{name,color,performanceMode:'loop',x,z,action}
// Authored blocking: exact keys below; no redundant root x/z/action.
{name,color,performanceMode:'blocking',cues:[{time,x,z,action,visible},...]}
```

Names/colors and existing action enum `idle|wave|walk` retain their current limits. Each blocking actor has1–32 dense cues, first time EXACTLY0, strictly increasing finite times, all within0..totalDuration(project) inclusive. Coordinates remain finite±4; visible is boolean. No numeric/string coercion, sparse/accessor arrays, extra keys or implicit sorting during validation. Values use JavaScript represented numbers without a new quantization/tolerance rule. Camera and actor data remain detached on validation.

Version1 accepts ONLY original exact root/actor/static-shot keys and migrates static cameras exactly as today. Version2 accepts ONLY its original exact root/actor/static-or-linear-shot keys; actor root movement/actions and complete camera travel are preserved. Both migrate actors to explicit loop mode in schema3. Reject future versions, malformed legacy records and any legacy record containing new performer fields: do not reinterpret them or silently drop motion. Loading a valid legacy draft migrates in memory without writing storage. Keep `shot-studio-v1` storage key and protected exact raw recovery; the next committed edit/explicit draft replacement writes3. Older readers reject3. Starter film remains visually identical in loop mode.

## Frozen schema/cue-operation API — model.js

Retain existing exports and signatures, including createProject/validateProject/importProject/cameraAt/frameAt/shotAt/actorPose. Add:

```js
export const MAX_PERFORMER_CUES=32;
export function performerAt(project,actorIndex,filmSeconds);
export function setPerformanceMode(project,actorIndex,mode);
export function insertCue(project,actorIndex,cue);       // -> {project,cueIndex}
export function updateCue(project,actorIndex,cueIndex,cue); // -> {project,cueIndex}
export function removeCue(project,actorIndex,cueIndex); // -> {project,cueIndex}
```

All edit helpers validate current input, clone, apply exactly one operation and validate the whole candidate before returning; never mutate input/history/storage. Invalid indices/modes/duplicates/limits throw fixed actionable errors. `setPerformanceMode` returns a Project; other helpers return detached `{project,cueIndex}`. They accept canonical mode strings `loop|blocking`; cue objects have the exact five keys above. No silent clipping/retiming when shots change. Shortening/removing a shot that places any cue beyond the new film end rejects the whole edit; users move/delete cues first. Reordering shots preserves global cue times rather than attaching them to camera shots.

Loop→blocking creates one visible cue at0 with the loop actor's BASE x/z/action, preserving costume/name. The original sinusoidal root pace does not continue in blocking mode; UI explains this conversion. Blocking→loop retains the FIRST cue's x/z/action and discards other cues/visibility; UI requires confirmation if this loses scheduled state, and Undo restores the committed blocking state. Pure helpers do not ask for consent. Same-mode conversion is an identical edit. `insertCue` inserts by unique time and returns its sorted index. `updateCue` can reorder by time and returns its new index; duplicate time rejects. All three cue operations reject a loop actor with guidance to switch to Authored blocking first. The first cue cannot be removed or retimed away from0; a later cue cannot replace it at0. Remove returns `Math.min(removedIndex,newLength-1)`, selecting the following slot or final previous slot, never guessing temporal distance. At least one cue remains.

## Frozen evaluator API — new performer.js + renderer.js

```js
// Pure, detached output; model.js performs full project validation.
export function performerPose(actor,filmSeconds,filmDuration);
// Result: {x,z,arm,leg,visible,action}
```

model.js imports performerPose; performer.js must NOT import model.js (no circular ownership/dependency). `performerAt` validates project/index/finite time, then delegates with total duration. Standalone performerPose validates finite time, finite filmDuration>0 and<=60, canonical actor exact mode keys/name/color/actions/coordinates, and the full dense bounded cue ordering/first0/times<=duration before evaluating. Invalid direct inputs throw fixed errors without mutation. It accepts canonical schema3 actor records, not arbitrary partially shaped actors. `actorPose(actor,time)` remains compatible for genuine original-key legacy loop actors and explicit canonical loop actors, returning its existing `{x,z,arm,leg}` shape/math; its adapter can add the explicit loop discriminant and call performerPose with60, but rejects blocking actors with guidance to use performerAt (duration is otherwise missing). No camera change. The renderer obtains every actor pose through performerAt, skips invisible performers, and draws the same original blocks/limbs. No producer-specific expected values in tests.

Loop mode retains exact current global-time sine formulas, including continuous XR motion beyond film end. Blocking mode clamps finite global time into[0,filmDuration]. At a cue boundary select that cue (not the previous interval); between adjacent cues interpolate x/z linearly. Equal positions create a hold. Action and visibility are LEFT-cue step values until the next cue, so visibility never interpolates. After the last cue hold position/action/visibility until film end; outside the film evaluate the corresponding clamped endpoint. Nonfinite time/duration throws before evaluation. A finite loop time whose multiplication produces a nonfinite limb result also fails closed; ordinary legacy formulas and unbounded representable loop phases are unchanged. Wave arm uses `.8+.5*sin(phase*6)`; walk arm `.5*sin(phase*5)` and leg `.35*sin(phase*5)`; idle limbs0. Phase is clamped global time minus selected cue.time, resetting on each cue. Walk animates limbs only: there is NO additional sinusoidal root displacement. Performers face the existing fixed direction; movement need not turn them naturally.

Desktop ordinary film/endpoint previews and export already pass global film time into renderer; preserve it. An explicit camera End preview uses the selected shot's exact global end, even at a cut. XR uses its existing continuously increasing global clock; blocking performers clamp to authored film end while loop performers continue. This is stage preview, not a newly claimed immersive film export or hardware verification.

## Complete UI contract — app.js/index.html/style.css

Preserve original loop controls, camera labels/logic and native tests. Add `#performanceMode`, label **Performer motion**, options **Looping performance** (`loop`) and **Authored blocking** (`blocking`). Existing performer name/costume remain actor-wide. Blocking editor includes stable `#performerCues` buttons/list with selected state and time, `#cueTime` **Cue time (seconds)**, existing actorX/actorZ labels, existing action selector, and `#cueVisible` **Performer visible**. Label `#cueLabel` identifies **Editing performer N — cue at X seconds** independently from displayed film time.

Buttons: `#addCue` **Add cue at preview**, `#removeCue` **Remove cue**, `#previewCue` **Preview cue**. Numeric/action/visibility edits use existing change-to-commit form behavior; no new mandatory Save layer. Add captures the selected performer's actual evaluated POSITION/action/visibility at the committed current GLOBAL preview time, bounded to the film. A cue stores no limb angle/animation phase: creating a cue restarts its action phase, so it does not promise to preserve a mid-wave arm angle. This restart is disclosed beside Add/action controls. Duplicate time/max count rejects, not overwrite. Preview cue stops rehearsal, returns to ordinary film preview and seeks exact cue time; it may display the next camera at a hard cut and labels this clearly. Selecting an editing cue alone does not move playhead. The first cue time stays0 and cannot be removed. Existing raw numeric spelling is not quantized by HTML stepMismatch.

All new authoring inputs participate in editIntent/unsent tracking BEFORE change. All destructive selection, mode conversion, add/remove/preview cue, history/import/export/XR actions obey existing unsent guards; preserve rejected numeric fields/focus/redo. Mode/cue selector failure restores selector only, never resets raw inputs. Existing explicit Discard unsent edits remains the only intentional raw-draft reset. Scrub previews committed film without committing or erasing input. Save project downloads committed schema3 film and discloses unsent fields. Pending native File completion checks import epoch, revision, ALL input intent/unsent fields and busy state; no later read can overwrite a newer cue draft. Playback must not redraw/reset active forms. New operations commit once after complete validation and clear drafts only on success; identical/invalid candidates preserve redo.

Close-up camera presets use the selected editing cue coordinates for blocking actors (the loop base coordinates remain unchanged behavior). Explicitly label this target to avoid taking another preview/cue's position silently. Preview performer poses and cue editor positions are different concepts. Mode conversion to loop requires native confirmation explaining First retained/cues+visibility discarded and committed-only Undo; cancellation preserves film, selection and raw input. No optional extra cinematic controls are added.

## XR placement compatibility

Freeze selected actor and selected editing cue's exact TIME when entering XR, along with existing selected shot/camera endpoint. Desktop/history/import and cue-list editing stay locked during pending/active sessions. Resolve the captured unique time on each placement, never a current playhead/nearest cue/new selection; a missing target rejects without modification. Loop placement updates root x/z exactly as before. Blocking placement updates ONLY that captured cue's x/z; time/action/visibility/other cues remain unchanged. Full candidate validation and apply success are checked before success status. Multiple placements keep targeting the same captured cue while the XR scene evaluates current timeline time; label this distinction before entry. Camera squeeze capture remains entirely unchanged. Missing floor hits/rejected placement preserve film/history. Controlled lifecycle coverage is software evidence only; #21 remains outstanding.

## Ownership and independent acceptance

1. Schema/cue owner: model.js plus new tests/blocking-model.test.js. Own schema3 and helpers/performerAt adapter. Coordinate existing-test fixture compatibility through root, not overlapping edits.
2. Evaluation/render owner: new performer.js, renderer.js, new tests/performer.test.js. Publish a callable frozen evaluator early; no UI/model schema edits. Math.js and existing camera/export machinery need no changes.
3. UI/XR integration owner: app.js,index.html,style.css; minimal xr.js only if necessary for callback success/lifecycle. Existing history.js/draft.js behavior requires no production rewrite.
4. Independent oracle owner: new tests/performer-oracle.test.js; hand-authored temporal/position/action/visibility/migration expectations before producer source reads.
5. Native browser/media owner: new tests/browser/blocking.spec.js and fixture helpers. Root may split browser/media test ownership disjointly. No app globals or producer expected-pose calls.
6. Root owns docs/config/Git/issues/CI and shared server/build coordination; spec author final independent read-only integration review.

Existing-test compatibility owner is ROOT (or an explicitly assigned separate owner): tests/model.test.js, travel.test.js, camera-oracle.test.js, history.test.js, draft.test.js, and existing browser/studio.spec.js/travel.spec.js ONLY where schema/version/fixture expectations require it. Genuine literal original-key schema1 and schema2 fixtures remain intact; never call createProject(schema3) then merely relabel it2. Update canonical migrated outputs to3 with explicit loop actors; unknown-future rejection now uses4. Preserve original camera/geometry math, raw-draft/lifecycle scenarios and numerical pixel/video thresholds. New producer/browser owners do not edit these files concurrently. Existing tests need minimal version-aware updates; they are not promised byte-for-byte unchanged.

Freeze independent export criteria BEFORE observing artifacts. Use an original4–8second fixture with fixed camera/light, one saturated-costume performer moving linearly between known marks, an idle hold and visibility departure, and a stationary differently colored control. Decode real downloaded WebM with FFprobe/FFmpeg; use actual decoded PTS, a separate pinhole projection and costume/body bounds or centroids to verify root movement, hold stability, visible/hidden intervals and static-control stability. Compare representative samples safely inside intervals rather than encoding-boundary frames. Wave is verified separately through literal limb-angle oracle plus actual WebGL pose pixels; do not accept video hashes alone or claim exact frame rate/encoder timing. Freeze numeric tolerances/fixture geometry in independent tests, deriving them from projection and codec limits, not widening after output.

Acceptance covers native authoring arrival→hold→wave→depart, exact cue boundaries/interpolation, negative/after-end clamps, shot-cut/time-order independence, mode conversion/cancel, raw invalid cue/import races, Undo/Redo, genuine JSON download/reopen/reload, protected legacy/raw drafts, export cancellation/locks and controlled XR selected-cue placement. Run the existing65 unit/syntax and29 browser scenarios with only necessary version-aware fixture/assertion changes plus new tests; preserve physical verification limitations.
