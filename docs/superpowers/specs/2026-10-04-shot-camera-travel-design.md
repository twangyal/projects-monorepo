# Shot Studio camera travel

Issue [#58](https://github.com/twangyal/projects-monorepo/issues/58). Author a static camera or a linear camera move within each shot, inspect its endpoints, scrub/rehearse the cut, and export the same motion in a real WebM. Keep the existing original courtyard, two block performers, fixed lighting controls and dependency-free WebGL renderer. This completes a useful desktop directing flow; physical WebXR verification remains a separate hardware gate in #21.

## Scope and unchanged bounds

Preserve 1–20 shots, 1–15 seconds per shot, 60 seconds total, 64 KiB JSON backups, two performers, existing name/position/color/action/light constraints and 30 previous valid history states. Eye/target components stay within [-15, 15], each endpoint eye/target Y is at least 0.3, FOV stays within [25, 80] degrees. Linear interpolation is inside these convex bounds. No easing, camera roll, FOV animation, spline, inter-shot transition, physical collision detection, audio or imported assets. A mathematically valid camera can still pass through a performer or courtyard geometry; say so rather than imply obstacle-aware travel.

Runtime remains native JavaScript/WebGL served by Python's local HTTP server. Node 22+ runs tests; existing Playwright Chromium and FFmpeg/FFprobe verify real video. No runtime npm install, service, model, external media or paid API is added.

## Canonical schema and migration

`src/model.js` owns schema validation, migration and camera evaluation. Export `SCHEMA_VERSION = 2`; `MAX_BYTES = 65536` and existing exports remain. `createProject()` returns canonical schema 2 with the existing two static cameras/image composition. Existing `eye` and `target` are always the Start camera. FOV belongs to the entire shot.

```js
// Project: exact keys schemaVersion, title, light, actors, shots
// Actor: exact existing keys name, x, z, color, action
// Static shot:
{
  name, duration, eye: [x,y,z], target: [x,y,z], fov,
  cameraMode: 'static'
}
// Traveling shot:
{
  name, duration, eye: [x,y,z], target: [x,y,z], fov,
  cameraMode: 'linear', endEye: [x,y,z], endTarget: [x,y,z]
}
```

No optional hidden End on a static shot, redundant nested camera object or implicit mode. Reject missing/unknown modes, missing endpoints, extra endpoint fields on static shots, unknown keys and invalid arrays/numbers. Return detached canonical objects/arrays without mutating inputs. Preserve existing text-length semantics rather than introducing an unrelated Unicode migration. Strings cannot be blank or contain the existing forbidden control characters. Reject array holes, coercible strings, nonfinite components and unknown schema versions.

`validateProject(input)` accepts versions 1 and 2 only and always returns schema 2. Genuine prior schema-1 exported films have exact original project/actor keys and shot keys `name,duration,eye,target,fov`; validate those original static limits first, then add `cameraMode:'static'`. A v1 shot containing `cameraMode`, `endEye`, `endTarget` or any future/extra field rejects; it cannot be silently stripped into a static film. This deliberately guarantees migration of original exported static films, not arbitrary undocumented extensions previously ignored by a permissive reader. Schema 2 causes an old reader to reject instead of discard motion. Backups/save/draft writes always contain canonical schema 2; no downgrade/export-as-v1 command is offered.

Keep `DRAFT_KEY = 'shot-studio-v1'` and the recovery envelope `kind:'unreadable-shot-studio-draft'` unchanged. A valid v1 draft loads/migrates only in memory, with zero startup writes; the next successful real edit/save or explicit replacement writes v2. Unsupported/motion-bearing/corrupt drafts remain blocked and preserve exact raw text. Failed replacement/write cannot clear protection or rewrite the last durable record. `importProject(text)` retains its 64 KiB UTF-8 admission and actionable backup-error behavior. Project history stores only canonical v2 detached snapshots; import, undo/redo and reordering carry complete motion fields.

## Whole-path validation and frozen evaluation API

For linear eye E(u) and target T(u), u in [0,1], define relative direction r(u) = r0 + u*d, where r0 = eye - target and d = (endEye - endTarget) - r0. For any chosen dimensions, squared length is convex. If dot(d,d) is zero, use u=0; otherwise minimize at clamp(-dot(r0,d)/dot(d,d), 0, 1). Evaluate the norm of r at that minimizer. Run this calculation independently in XYZ and XZ; their minimizing times can differ.

Require minimum XYZ norm >= 0.3 and minimum XZ norm >= 0.1 over the whole path, including endpoints. This matches the existing separation and world-up lookAt limits and rejects coincident/vertical intermediate cameras even when both endpoints are valid. Static shots use the same endpoint limits. Use finite bounded IEEE754 arithmetic and direct inclusive comparisons, without an arbitrary epsilon that widens accepted limits. Document that boundary decisions use JavaScript's represented numbers; test exact representable/ordinary boundary fixtures and clearly below/above cases. Do not replace the analytic test with sampled frames. Validation of both endpoint vectors/Y/FOV occurs before minimization.

Public signatures:

```js
// Existing: validateProject(input) -> canonical schema-2 Project
// Existing: importProject(text) -> canonical schema-2 Project
// Existing: totalDuration(project) -> number
// Existing: shotAt(project, filmSeconds) -> {shot, index, local}
export function cameraAt(shot, localSeconds) { /* -> {eye, target, fov} */ }
export function frameAt(project, filmSeconds) { /* -> {shot, index, local, camera} */ }
```

`cameraAt` validates one canonical v2 shot including its entire path; it does not accept a naked legacy shot or infer a mode. It returns fresh `eye`/`target` arrays and fixed FOV. For static mode ignore local progress after validating the time argument. For linear mode clamp localSeconds to [0,duration], set u=localSeconds/duration and interpolate eye and target componentwise. At clamped u=0/1 return exact detached authored endpoints rather than arithmetic approximations. Intermediate values are `(1-u)*start + u*end` in each component. No validation, evaluation or actor helper reads the clock.

All three time-taking APIs reject non-number, NaN and infinite arguments; finite negative/overshoot arguments clamp to their valid interval. Preserve `shotAt`'s existing output shape and cut semantics: an exact internal cut belongs to the next shot with local=0; totalDuration and overshoot belong to the last shot at local=duration. Use comparisons against cumulative prefix boundaries, not repeated duration subtraction or an epsilon: for durations 1.1, 1.2, 1.3, time `1.1 + 1.2` must select index 2/local 0 rather than the previous shot's almost-End. At total duration return the last authored duration exactly. `shotAt` remains the selector for an already validated project; it retains the existing shot-reference behavior. `frameAt` validates/canonicalizes the complete project, then calls `shotAt` and `cameraAt`; its shot and camera are detached from caller input. Actor performance always receives clamped global film time, never shot-local camera time. Callers can derive that clamped global time as the sum of durations before frame.index plus frame.local; ordinary playhead/export inputs are already bounded. Do not pass a raw negative/overshooting public test input directly to `actorPose` after evaluating its clamped camera.

`StageRenderer.draw(project, globalFilmTime, camera)` keeps its existing three-argument callable shape: the third argument supplies only evaluated `eye,target,fov`. It does not interpolate. Normal scrubbing, rehearsal and `exportFilm`'s draw callback all use `frameAt(project,time)` and the same camera result. The export callback renders its detached locked project snapshot with global film time; cancellation/visibility/context-loss cleanup stays unchanged. Endpoint preview also calls `cameraAt`, without a second interpolation formula.

`cameraFromPose(matrix)` retains its existing `{eye,target}` API, normalized three-unit forward target, level world-up interpretation and original standalone pose limits. Applying a pose to a linear shot additionally validates its full candidate path. No new XR capability is claimed.

## Usable endpoint and preview flow

Keep existing accessible camera numeric labels and IDs `eyeX/eyeY/eyeZ`, `targetX/targetY/targetZ`, `fov`, shot name/duration and all history/import/export labels. Add a **Camera motion** select (`#cameraMode`) with **Static** / **Linear travel** options, values `static` / `linear`, and an **Editing endpoint** select (`#cameraEndpoint`) with **Start** / **End**, values `start` / `end`. End is unavailable for static shots. Start is the default on selecting/importing/undo-restoring a shot. A visible `#endpointLabel` identifies selected editing shot and endpoint; `#shotLabel` continues identifying what is actually rendered.

- Static -> linear copies the current Start into both Start and End, preserving the image, lens and metadata. Identical endpoints are allowed; motion is authored when an endpoint changes.
- Linear -> static keeps **Start**, removes End fields, and commits once. If End differs, native confirmation explicitly says End/travel will be discarded and Undo can restore it. Cancellation leaves project/mode/fields/history unchanged. Do not choose a retention endpoint implicitly from the current playhead.
- Existing numeric eye/target controls edit the chosen endpoint. FOV always edits the whole shot. A preset applies its eye/target to that endpoint and its lens to the whole shot; label that consequence. Both endpoints/path must validate before committing.
- `#copyEndpoint`, **Copy other endpoint**, copies the other endpoint's eye/target into the selected endpoint; it does not copy FOV/name/duration. Available only for linear shots. The nearby label states the direction, such as “Start -> End.” This single valid commit is reversible.
- `#previewEndpoint`, **Preview endpoint**, stops rehearsal and explicitly displays the selected endpoint. Switching the editing selector alone changes fields, not the film position or rendered camera. Users can inspect Start/End without accidentally jumping to another cut.
- `#usePreview`, **Use current preview**, copies the currently evaluated camera's eye/target to the selected editing endpoint. It preserves mode, other endpoint, FOV, name and duration and validates the entire candidate. It is available only when the rendered shot is the selected editing shot; otherwise explain/select that shot rather than silently capturing another shot. Snapshot the camera before committing so render changes cannot alter the intended pose.

Two nonpersisted presentation modes make exact End preview honest. **Film** mode uses `frameAt` at the global playhead, with normal hard-cut semantics. **Endpoint** mode renders `cameraAt(selectedShot, 0 or duration)` and performs actors at selectedShotStart + local; label it explicitly “START/END endpoint preview — not the film cut at this position.” At a nonfinal shot's exact End, this intentionally shows that shot's End rather than the next camera. The Film position range can show the equivalent global time but moving it always returns to Film mode. Selected editing shot/endpoint are independent of the active Film camera and are both visible.

Rehearse from Endpoint mode starts at the selected shot's Start and switches to Film mode, continuing through subsequent hard cuts. In ordinary Film mode, retain existing resume/reset-at-film-end behavior. Stop returns to Film mode at 0. Selection/import/history restore defaults to Start editing and Film preview at selected shot start. Duration edits in Endpoint mode recalculate its equivalent global time; they do not move the authored End. Reordering keeps complete shot content and updates the selected index/start offset. Added shots clone all travel arrays independently; removed shots leave a valid selected index. Presentation state is not saved or placed in history; film state is.

## Raw edits, asynchronous imports and lifecycle

Preserve #57's input-intent guard on every settings input, not only change/blur. Block starting a file import while unsent edits already exist; users correct or explicitly discard them first. The intent counter alone cannot protect drafts that predate the read. A late native File read must compare import epoch, committed revision, editor intent, absence of unsent edits and busy state before publication. Endpoint/mode/shot-selection/copy/use-preview changes also invalidate pending replacement intent. A superseded read must not clear a newer file selection or overwrite newer status. No import/render work writes incoming data before a complete successful candidate commit.

Numeric camera edits must parse nonempty finite numbers; `Number('')` must not silently turn an unfinished coordinate into zero. Validate represented values against the model bounds, not HTML `stepMismatch`: the existing raw `6.250` edit remains valid and commits as 6.25 even with step 0.1. Invalid whole-path candidates leave the committed film, history, playhead/preview and durable draft unchanged, preserve raw typed fields/focus and show guidance about the rejected path. Do not call a blanket field-resetting refresh on that failure. Track unsent editable form fields until their complete candidate is accepted. Rehearsal updates canvas/time labels, never the focused form.

Actions that would discard or encode these unsent edits—changing performer/shot/endpoint/mode/preset, copy/use-preview, undo/redo/reordering/add/remove, file import, rehearsal/export/VR—must require correcting them or using `#discardEdits`, **Discard unsent edits**, with native confirmation. This includes the existing actor selector, whose refresh otherwise replaces the whole form. Successful validation commits the complete candidate and clears its corresponding raw edit state. Film scrub may remain usable with an explicit committed-preview label; it never applies drafts. **Save project** and raw recovery download remain usable, explicitly saying normal backups contain the committed film, not unsent fields. Add a beforeunload guard for unsent edits and pending import; it does not promise automatic recovery of unsent numeric drafts. Presentation-only controls never write a draft or consume history.

Retain existing export/XR/pending-XR locking, history limits, no-op/invalid-edit redo preservation, pagehide/pageshow scheduling, graphics-loss protection and unavailable-encoder guidance. No action may report a failed capture as successful: make `apply(candidate)` return a success result or propagate validation failure, and show the success message only after the commit/persist attempt is identified correctly. A valid in-memory commit with failed localStorage is still usable, but must retain the explicit backup/storage warning rather than claim it was saved.

## XR compatibility

Entering XR freezes the selected editing shot/endpoint. Squeeze edits that endpoint (Start for static; chosen Start/End for linear) while preserving the other endpoint/lens/metadata. Validate the complete candidate; invalid intermediate paths preserve film/history and show an actionable error. Floor placement still edits the selected performer. Desktop controls, endpoint selection and history remain locked during pending/active XR and export. Native tracked stereo views still use the headset matrices rather than the authored travel; capture does not automatically rehearse travel inside the headset. After exit, show the selected authored endpoint through the desktop evaluator so a valid captured End is inspectable.

Controlled pose/event/lifecycle tests establish only this data flow and rejection behavior. Physical headset compatibility, comfort and tracking/controller accuracy remain unverified and issue #21 stays blocked pending hardware. No XR video export, roll capture or headset lens reproduction is added.

## Ownership and verification contracts

1. Engine owner: `src/model.js`, `src/history.js`, `src/draft.js`; `tests/model.test.js`, `camera.test.js`, `history.test.js`, `draft.test.js`, plus a new `tests/travel.test.js` if useful. Publish schema constant/signatures first. No new dependency. Keep all model validation/evaluation in one place; history/draft consume it rather than stripping motion fields.
2. UI owner: `src/app.js`, `index.html`, `style.css`; `src/renderer.js` only if naming/explicit evaluated-camera integration needs it, `src/xr.js` only for documented callback/lifecycle integration. Coordinate changes to XR with engine/lifecycle owners. Do not put interpolation/path validation into DOM or renderer code. Existing `exportFilm` recording machinery remains unchanged unless a reproduced defect requires a narrow root-approved fix.
3. Independent mathematical owner: new `tests/camera-oracle.test.js`, reading existing math and frozen contracts but not producer travel implementation to derive expected results. Hand-worked or independently computed positions/minima/cut assignments and projected landmarks remain independent.
4. Independent production browser/video owner: new `tests/browser/travel.spec.js`, plus narrowly coordinated existing browser/lifecycle fixture compatibility edits. Tests import authored JSON through the real UI and decode actual downloaded WebM; no test-only app state hooks or fake encoder substitutes for acceptance.
5. Root: README/measured evidence/catalog/issue/Git/config/check command and shared server scheduling, plus independent manual artifact review. A separate read-only reviewer checks the spec and final lifecycle/geometry changes. No worker Git/issues/config edits.

Domain coverage includes valid static/translation/pan/truck/dolly paths; constant relative separation; XYZ collision in the middle; vertical XZ failure with safe XYZ; different XYZ/XZ minimizing times; endpoint-only/off-center minima; exact/below/above bounds; malformed/holey arrays/time inputs; fixed FOV; exact endpoints/midpoints/cuts/final clamp; detached arrays; original v1 migration without startup writes; v1 motion/unknown-schema/raw-recovery rejection; complete motion serialization/history/reordering/no-op redo; full-path XR pose rejection.

Browser coverage includes authoring both endpoints through original controls; presets/copy/use-preview/static conversion cancellation/undo; selected vs active camera clarity; exact End preview vs next-cut Film preview; invalid raw input/path retained; blur-independent late native import safety; JSON download/import/reload retaining all motion; blocked recovery preserving raw v1/future/corrupt bytes until explicit successful replacement; export cancellation and locked controls; real mobile keyboard operation; no page errors/external requests.

The independent export fixture uses **idle actors and fixed light**, one 3–4 second linear shot and an original isolated high-contrast performer/courtyard landmark visible throughout. Decode timestamps/frames through FFmpeg/FFprobe. Independently derive expected image coordinates using separately implemented pinhole projection/basis math, not `cameraAt`, `frameAt`, renderer matrices or mere frame hashes. Detect a landmark with an independently defined color/region mask, compare decoded centroid/bounds near multiple early/middle/late timestamps to expected direction and substantial displacement, and bound positional error with a declared codec/antialiasing tolerance. Choose a path with clear nonzero motion and separated landmarks; do not widen tolerance after observing an incorrect renderer. Static/identical-travel controls must not show comparable displacement. Account for actual decoded PTS and browser real-time sampling; requested 30 fps is not a frame-perfect promise. Verify real WebM size/dimensions/duration plus JSON state and report actual observed timings/counts.

This design is implementation-ready after root's release; it changes only the explicit desktop camera-travel feature, leaving hardware/model gates and excluded projects untouched.
