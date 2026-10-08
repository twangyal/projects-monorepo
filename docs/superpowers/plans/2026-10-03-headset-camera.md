# Headset Camera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Capture the headset view into the selected shot with a controller squeeze.

**Architecture:** A pure validated pose conversion produces camera eye/target coordinates. WebXR squeeze events invoke an optional callback, and the DOM owner applies the result through scene history and persistence.

**Tech Stack:** Native JavaScript, WebGL/WebXR, Node tests, Playwright Chromium.

**Spec:** GitHub issue #26 in twangyal/projects-monorepo.

## Global Constraints

- Retain shot name, duration and lens; use existing coordinate/target limits.
- No services/dependencies, physical-device claim, Gaze Nav or idea #8 edits.
- Session lifecycle and cancellation remain unchanged.

## Review Focus

- Missing tracking preserves the scene and reports guidance.
- Vertical or out-of-bounds views reject without changing drafts/history.
- Captures preserve lens/duration/name and support undo after desktop return.
- Ended sessions ignore subsequent controller events.
- Headset roll is unsupported and disclosed; fixed world-up cameras remain valid.

### Task 1: Pose capture vertical slice

**Files:** src/model.js, src/xr.js, src/app.js; tests/camera.test.js, tests/lifecycle.test.js and tests/browser/studio.spec.js under apps/shot-studio.

**Interfaces:** cameraFromPose(matrix) returns validated {eye,target}; enterXR options add onCamera(camera) and onCameraError(message).

- [x] Write failing native tests for identity/rotated/pitched poses, invalid bounds/tracking, squeeze callback and ignored ended events. Browser fixture captures second camera, exits, saves and undoes.
- [x] Run npm test and confirm failures before implementation.
- [x] Implement conversion with normalized negative Z direction and a three-unit target; validate through the existing project validator. Wire squeeze with error reporting and ended guard; apply through history in app.js.
- [x] Run npm test, npm run check and exact-source CI; expect all native and Chromium tests passing.
- [x] Review changes, document gesture/limitations, update catalog and #21 hardware checklist, commit coherent implementation referencing #26 and close only after verification.

Review fix: event-frame getViewerPose is forbidden by WebXR. A failing native regression now enforces this; squeeze uses getPose(viewerSpace, localFloorSpace), with cancellation checks after acquiring viewer space. Full native suite: 24/24 pass. Browser integration failed before app callback wiring; corrected exact-source CI passed 24 native tests, syntax checks and seven Chromium checks in run 37157090209 at ffab5e5. Independent review found no additional important issues. Issue #26 closed; physical headset checklist remains in #21.
