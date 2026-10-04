# Shot Studio performer-blocking implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Author, rehearse and export two bounded performer timelines without losing existing camera/loop/draft behavior.

**Architecture:** Strict schema3/cue helpers in model; pure pose evaluator in performer.js; renderer delegates all views to shared performerAt; stable cue UI and existing history/persistence/XR adapters; independent semantic and real-video acceptance.

**Tech Stack:** Existing dependency-free JavaScript/WebGL and Node tests; Playwright Chromium plus FFprobe/FFmpeg for native media verification.

**Spec:** [Design](../specs/2026-10-04-shot-performer-blocking-design.md), [Issue63](https://github.com/twangyal/projects-monorepo/issues/63). Physical headset acceptance remains [Issue21](https://github.com/twangyal/projects-monorepo/issues/21).

## Constraints and release

- Root review/release precedes production implementation. Exclusive file ownership; no Git or issue edits by implementers.
- Keep two actors,60second film,20shots,64KiB backup,existing camera schema/math and history/draft recovery.
- First publish schema/API and evaluator stubs so peers can integrate exact interfaces; observe meaningful RED→GREEN independently.
- No silently clipped cues, implicit legacy motion loss, form-reset loss, new assets/dependencies or hardware claims.
- Root coordinates production server/ports/full suites; source owners do not compete with acceptance runs.

## Task1 — Schema3, migration and atomic cue helpers

Owner: src/model.js; new tests/blocking-model.test.js. Root owns minimal existing-test compatibility edits; do not edit those files concurrently.

- [x] Publish schema3/MAX_PERFORMER_CUES and exact helper/performerAt adapter signatures.
- [x] Write RED originalv1/static andv2/travel migrations, future/new-field legacy rejection, loop-image compatibility and no-startup-write checks.
- [x] Implement strict actor discriminant/cue shape, dense1–32 lists, first0/increasing global times/film end limits and detached snapshots.
- [x] Write RED mode conversion, loop-mode cue-operation rejection, sorted insert/retime return indices, deterministic following-slot removal selection, first-cue removal/retime rejection, duplicate/max limits and no-input mutation.
- [x] Implement atomic helpers and reject shot-shortening loss; preserve shot order/global cue timing and old camera behavior.
- [x] Run focused tests/syntax checks, communicate exact callable readiness to evaluator/UI/oracle owners.

## Task2 — Pure poses and shared renderer

Owner: new src/performer.js, src/renderer.js, new tests/performer.test.js.

- [x] Publish performerPose(actor,time,duration) callable API; no import of model from performer.js.
- [x] Write RED full standalone actor/duration/ordering admission, linear positions/holds, exact stepped visibility/actions, cue-relative limb phases, end clamps, nonfinite times and legacy sinusoidal loop compatibility.
- [x] Implement detached deterministic output and root movement without extra pace displacement in blocking mode.
- [x] Renderer uses model.performerAt and skips invisible actors; existing blocks/camera/light remain unchanged. XR and desktop/export must share this path.
- [x] Verify focused producer tests/syntax and report readiness; do not calculate independent oracle expectations.

## Task3 — Complete cue authoring and XR targeting

Owner: src/app.js,index.html,style.css; minimal src/xr.js only if required.

- [x] Add frozen labels/selectors, explicit editing cue versus film preview and mode conversion explanation/confirmation.
- [x] Implement cue selection/Add at preview/Remove/Preview and change-to-commit numeric/action/visibility editing through atomic model helpers.
- [x] Add all controls to unsent/editIntent and busy locks; preserve invalid raw values/focus/history redo, native import intent guards, committed-only backups and explicit discard.
- [x] Integrate history/reload and successful-only selector resets; closing/updating shot durations must surface cue-limit rejection without clipping.
- [x] Target close-up presets to editing cue and XR floor placement to captured actor/unique cue TIME, rejecting absent targets rather than substituting current/nearest cue. Preserve camera End/squeeze behavior and require apply success for status.
- [x] Freeze UI after focused syntax verification and communicate readiness to browser owner/root; no competing acceptance server.

## Task4 — Independent temporal and migration oracle

Owner: new tests/performer-oracle.test.js.

- [x] Author literal expectations before reading future evaluator/helper implementation: exact points/midpoints/cuts, phase resets, hidden steps, holds, clamping and no double root motion.
- [x] Verify legacyv1/v2 original actions/cameras retain exact behavior, schema3 incompatibility and no mutation/history-loss on rejected edits.
- [x] Execute first actual suite honestly; distinguish implementation RED from missing-module/over-specified test errors.
- [x] Report real findings to exclusive owners; never edit producer code or weaken frozen expectations to pass.

## Task5 — Native browser and actual media

Owner: new tests/browser/blocking.spec.js and optional disjoint fixture helpers.

- [x] Freeze original projection/visibility fixture and numerical bounds BEFORE exports; fixed camera/light and stationary control isolate performer movement.
- [x] Drive native controls through arrival/hold/wave/departure, preview/cut boundaries, editing versus shown time, mode cancel, Undo/Redo and real JSON download/reopen/reload.
- [x] Delay actual File delivery and prove new raw cue edits prevent replacement; preserve invalid field/focus/redo and protected draft recovery.
- [x] Verify XR controlled floor hit targets captured cue and leaves other cues/cameras unchanged, with no hardware support claim.
- [x] Export actual WebM; decode PTS/frame pixels with independent projection, movement/hold/control/visibility checks. Verify wave pose through literal math and native pixels. Keep encoder timing caveats truthful.
- [x] Run existing29 browser cases plus new suite on root-coordinated fresh server; report artifacts and exact measured results.

## Task6 — Root integration and release

- [x] Root (or a separate explicitly assigned compatibility-test owner) minimally updates existing model/travel/camera-oracle/history/draft and browser fixtures/assertions for canonical3, explicit loop actors and future4. Keep genuine original-key legacy1/2 inputs, old camera/oracle math and frozen pixel thresholds; never relabel createProject3 as legacy2.
- [x] Independent read-only seam review: migration, shared pose time, raw draft ownership, exact cue index returns, XR target and actual export evidence.
- [x] Root runs complete Node tests/syntax and fresh production Chromium suites; route demonstrated defects to owners.
- [x] Root updates README/evidence/catalog, preserving ACTIVE VR hardware limitation; reviews/commits/pushes and verifies CI before closing63.

## Remaining review decisions

Architecture/API choices above were reviewed and released before production implementation. Independent media owner must publish exact fixture geometry, timestamps and pixel tolerances before recording; these numerical test choices intentionally remain that owner's independent work, not producer-designed expected outputs. No other product/schema decision is deferred.


## Completion evidence — 2026-10-04

Implementation `3624f7ebbf8d8e5211a742428d3fedd016ff612b` is pushed with107 unit and43 native browser cases passing plus syntax checks. All12 project workflows passed that exact commit; Shot CI independently passed107/43. Independent semantic expectations first ran GREEN14, not an invented RED. Producer model/evaluator/renderer cases observed meaningful RED; initial native UI lacked its new control. Firstfullbrowser40/3 exposed only remaining canonical-version expectations, thenaffected3 andfull43 passed. Existing literallegacyinputs/camera thresholds were preserved.

Actual168645-byte VP9 contains173decodedframes/5.946secondPTSspan. Fresh independent FFmpeg/Pillow inspection matches retained color metrics exactly and confirms2.640px maximum projection error, zero hold drift, .0202px control drift,49.142/32.674px movement and zero hidden redpixels. Literalwave silhouettes differ24px. Permanent [verification](../../../apps/shot-studio/docs/2026-10-04-performer-blocking-verification.json) records original artifacts/hashes, frozen thresholds, observations and timing limits. Physical issue21 remains open/catalog7 ACTIVE. Software issue63 is ready to close after final evidence push.
