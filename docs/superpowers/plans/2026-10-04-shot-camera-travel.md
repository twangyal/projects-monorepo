# Shot Studio Camera Travel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Author, inspect, rehearse, save/reopen and export validated linear camera travel within the existing local Shot Studio cut.

**Architecture:** Canonical schema-2 shots carry explicit static/linear camera modes. One pure camera evaluator and analytic path validator feed film/endpoint preview and a locked real-time export. Existing history/draft recovery migrates only genuine v1 static films; DOM presentation state remains separate from the saved film.

**Tech Stack:** Native JavaScript/WebGL, Python local HTTP server, Node 22+, existing Playwright Chromium and FFmpeg/FFprobe. No new runtime dependencies.

**Spec:** [Camera travel design](../specs/2026-10-04-shot-camera-travel-design.md); issue [#58](https://github.com/twangyal/projects-monorepo/issues/58).

## Global Constraints

- Preserve 20 shots / 60 seconds / 64 KiB, existing geometry/text/scene limits and 30 previous valid history states. Fixed FOV, linear eye/target, hard cuts, continuous global actor time. No easing/roll/assets/audio/physical collision inference.
- Schema 2 only on output. Genuine original-key v1 static films migrate; motion-bearing v1/future schemas reject. Storage key/recovery envelope unchanged; loading never rewrites raw bytes.
- Independently minimize XYZ and XZ relative direction over the whole [0,1] path. Direct inclusive .3/.1 bounds; no epsilon widening or sampled-only validation.
- One `cameraAt` formula; film paths share `frameAt`. Exact cuts select next Start; exact selected-End preview is a separately labeled presentation mode.
- Preserve focused invalid raw edits; all settings input invalidates older imports before blur. No silent motion/draft loss on switching modes/endpoints/history or encoding.
- Export and pending/active XR lock editing; controlled XR tests do not establish physical acceptance. No model/network/dependency installation or excluded-project work.
- Root owns Git/issues/docs/config and shared server scheduling; do not reuse root's frozen Lens server. Shot production configuration currently serves 4173; coordinate a free isolated server for acceptance before any browser run.

## Review Focus

- Separate XZ and XYZ minima can occur at different u; a safe full-distance minimum does not prove horizontal clearance.
- An exact selected-shot End is normally the next film cut; endpoint preview must not be mislabeled as that film frame.
- Static conversion retains Start explicitly and confirms meaningful End loss; v1 permissive extra-key stripping cannot erase travel.
- A late import or blanket refresh must not erase focused invalid End fields; a swallowed `apply` error cannot produce a camera-captured success message.
- Video frame hashes with walking actors do not establish camera travel. Idle actors/fixed light and independently projected decoded landmarks are required.

---

## Task 1: Versioned model, whole-path gate and deterministic evaluation

**Files:** `apps/shot-studio/src/model.js`; existing `tests/model.test.js`, `camera.test.js`; optional new `tests/travel.test.js`.

**Interfaces:** Export `SCHEMA_VERSION=2`, canonical static/linear shots, `cameraAt(shot,localSeconds)->{eye,target,fov}` and `frameAt(project,filmSeconds)->{shot,index,local,camera}` exactly as the spec. Preserve existing `MAX_BYTES`, create/import/validate/duration/shotAt/actorPose/cameraFromPose APIs; documented nonfinite-time rejection is explicit. Publish callable signatures for peers before implementation.

- [x] Write meaningful RED for v1 static migration, rejection of motion-bearing v1/unknown keys, missing/holey endpoints, valid endpoint-but-singular midpoint, distinct XYZ/XZ minimizing times, exact static/linear positions and nonfinite time. Observe failures with `node --test tests/model.test.js tests/camera.test.js tests/travel.test.js` (omit the optional file if unused).
- [x] Implement exact-key versioned validation and detached schema-2 normalization. Validate original v1 limits before static migration; preserve all existing original exported films.
- [x] Implement constant-relative-delta and independently minimized XYZ/XZ whole-path bounds. Implement exact endpoint returns and one componentwise interior formula in `cameraAt`; preserve `shotAt` cut shape/reference semantics with cumulative boundary comparison, including durations 1.1/1.2/1.3 exact prefix 2.3 selecting the next Start. Use it in detached `frameAt`.
- [x] Run focused engine tests and independently supplied Task 3 oracle. Report exact RED/GREEN; never modify oracle expectations to match implementation. Notify UI/schema peers when callable.

## Task 2: History, native drafts and XR candidate compatibility

**Files:** Engine owner `src/history.js`, `src/draft.js`, `tests/history.test.js`, `tests/draft.test.js`, model camera tests. UI owner coordinates relevant `src/app.js` XR callback and existing lifecycle/browser fixtures. `src/xr.js` changes only if needed for narrow callback behavior; owner coordinates before editing.

**Interfaces:** Existing `ProjectHistory` / `moveShot` and `DraftStore` names/shape remain. `DRAFT_KEY='shot-studio-v1'`. `cameraFromPose(matrix)->{eye,target}` unchanged; UI applies the pose only to the frozen selected endpoint and validates full candidate.

- [x] Add integration fixtures for raw v1 startup zero writes, canonical v2 save/reopen, motion preserved through history/order/cloning, unknown-schema/motion-bearing-v1 protected recovery and failed explicit replacement retaining raw bytes.
- [x] Preserve canonical full snapshots without stripping endpoint fields. No-op/invalid updates keep redo and original history cursor; reordering is one reversible whole-film edit.
- [x] Add controlled tracked-camera tests for updating Start/End with lens/other endpoint untouched and rejecting intermediate-path singularity. Make success/error reporting follow actual commit result; do not announce captured/saved after failure.
- [x] Run `node --test tests/history.test.js tests/draft.test.js tests/camera.test.js tests/lifecycle.test.js`; preserve existing cleanup/unavailable-encoder/XR checks. No physical headset claim.

## Task 3: Independent math and projection oracle

**Files:** New `apps/shot-studio/tests/camera-oracle.test.js`; separate fixture helper only if truly shared with browser owner after coordination.

**Interfaces:** Import public model functions only as the system under test. Expected geometry comes from hand-worked paths or separately implemented math, not producer travel code. Fixed lens endpoints, [0,duration] clamping and exact cut contract are frozen in spec.

- [x] Before reading new producer implementation, author explicit expected endpoints/midpoints/off-center minima, zero relative delta, independent XYZ/XZ minima, invalid collision/vertical middle and direct threshold boundaries.
- [x] Observe RED against old/stub model. Implement checks for detached arrays, invalid/nonfinite time, static migration, global actor-time expectations and last-frame/internal-cut behavior.
- [x] Independently derive pinhole-projected landmark coordinates for the real export fixture, with idle actors/fixed light, substantial predictable displacement and visibility throughout. Share fixture/projection expectations with Task 5 without using renderer matrices or production camera evaluation.
- [x] Run `node --test tests/camera-oracle.test.js`; send exact gate evidence and any concrete defect to root/engine owner.

## Task 4: Complete desktop endpoint authoring and lifecycle

**Files:** `apps/shot-studio/src/app.js`, `index.html`, `style.css`; `renderer.js` only for explicit evaluated-camera integration; XR callback file by coordination. No alternate camera math in these files.

**Interfaces:** Consume `cameraAt`/`frameAt`, canonical schema-2 project/history/draft. Keep original camera numeric IDs and all existing labels. Add selectors/labels exactly frozen in spec: `#cameraMode`, `#cameraEndpoint`, `#endpointLabel`, `#copyEndpoint`, `#previewEndpoint`, `#usePreview`, `#discardEdits`.

- [x] Coordinate meaningful RED browser cases with Task 5: currently no travel authoring/export; focused End/path rejection and late import safety; endpoint-End vs next-cut confusion; static conversion/history.
- [x] Implement mode/endpoint editing, explicit copy-other/preview/use-current actions, Start-retaining static conversion confirmation and distinct editing/active-camera labels. Use actual selected-shot current frame only; snapshot before applying.
- [x] Route film scrub/rehearsal/export through `frameAt`, endpoint preview through `cameraAt`, and actor performances through global time. Rehearse from endpoint mode starts selected shot; ordinary film resume behavior remains.
- [x] Preserve invalid nonempty/finite coordinate parsing and focused raw fields without using HTML `stepMismatch` as an extra gate (`6.250` remains valid). Confirmed Discard unsent edits restores committed controls without consuming history. Block destructive/encoding actions until drafts resolve; keep committed JSON/raw recovery exports available with explicit draft disclosure.
- [x] Preserve every-input import guard plus new selector/action intent; block performer selection and starting import with preexisting unsent drafts, and check no drafts remain before read publication. Keep new-read/status protection, export/XR locks, visibility/context-loss/page restoration and exact storage failure messages. Apply returns an explicit successful commit result; captured End is previewable after XR exit.
- [x] Run `npm run check` and source syntax checks for any newly touched model file omitted by the old command. Publish coherent UI readiness and selector confirmation; no competing shared server/build.

## Task 5: Native browser, real decoded video and final acceptance

**Files:** New `apps/shot-studio/tests/browser/travel.spec.js`; narrow existing `studio.spec.js` / lifecycle fixture compatibility edits. Root owns README, measured evidence, catalog, issue/Git/config and server scheduling.

**Interfaces:** Real UI controls, native files/localStorage and downloaded JSON/WebM. No private state hooks; controlled native read/encoder/XR fixtures can test race/cleanup boundaries but do not replace real export acceptance.

- [x] Author production flows for linear start/end editing, exact endpoint vs film preview, copy/use-current, explicit static conversion cancel/undo, valid v1 migration without startup overwrite, motion roundtrip/native reload/history/order, invalid raw/path rejection, delayed native import retaining focused drafts, protected recovery and mobile operation.
- [x] Freeze the independent decoded-video fixture/projection/tolerance before acceptance: idle actors/fixed light, one 3–4 second valid path, separated original landmark visible throughout. Assert real codec/container dimensions/duration; decode actual PTS and early/middle/late frames; compare landmark centroid/bounds to independent expected displacement/coordinates. Static or identical-endpoint control must lack that motion. Do not substitute hashes or widen tolerances after failure.
- [x] Run focused `npm run test:browser -- tests/browser/travel.spec.js --output=/tmp/shot-travel-focused` only with root's server slot; inspect actual downloads/pixels and record RED/GREEN. Preserve existing pending-import #57 and draft-recovery acceptance.
- [x] Run all `npm test`, `npm run check`, and full `npm run test:browser -- --output=/tmp/shot-travel-full`, with fresh free production server and real Chromium/FFprobe. Exact returned counts/evidence replace old README counts only after verification.
- [x] Independent review checks analytic bounds, schema/motion retention, raw drafts/async intent, active vs editing preview and XR success reporting. Root documents physical/timing/collision limits and measured artifacts, reviews desktop/mobile screenshots, commits/pushes normally and closes #58 only after exact-source CI passes.

The reviewed contract was released by root and completed in #58. The observed RED-to-GREEN gates were 13 producer travel cases and 18 independent math cases; history/draft/XR integration fixtures were added after the model implementation. Root ran unit/syntax checks and independently inspected native artifacts; the browser owner ran the final combined suite once. Implementation is 1859702; native acceptance is afb52c9. All 65 unit tests, syntax checks and 29 Chromium cases pass locally and in CI run 37181949482. See apps/shot-studio/docs/2026-10-04-camera-travel-verification.json for measured evidence and limitations. Existing autonomous authorization governed execution.
