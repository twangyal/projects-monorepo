# Composure Bluetooth heart-rate implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement a real standard BLE HR notification input flow without mixing simulator readings or claiming verified physical watch support.

**Architecture:** Pure bounded protocol/calibration, narrow injected Web Bluetooth transport, immutable model origin with separate wall-clock freshness, stable existing UI, independent native protocol/browser acceptance.

**Tech Stack:** Existing TypeScript, Vite, Canvas, Node tests and Playwright Chromium. No new runtime dependencies/backend.

**Spec:** [Reviewed design](../specs/2026-10-04-composure-bluetooth-design.md). [Issue61](https://github.com/twangyal/projects-monorepo/issues/61); physical verification [Issue62](https://github.com/twangyal/projects-monorepo/issues/62).

## Global constraints

- Root releases implementation only after design review; this document does not authorize producer edits before that release.
- File ownership is exclusive. Root coordinates shared production builds/port4281 and owns Git/issues/docs/tooling. No arbitrary extra features or new dependencies.
- Never read/render/store device name/id or inject invented BLE readings. Software fixtures never establish physical watch compatibility or accuracy.
- Preserve simulator Settings schema1, storage key, labels, active-time freshness, best time and all existing tests. BLE reports are schema2; simulated reports stay schema1.
- Native cancellation is logical only. At most one outstanding operation/attempt; wait in draining state before another Connect. No automatic reconnect.
- Every async completion/listener checks ownership; cleanup is caught and cannot affect a newer connection. Baseline/run source is detached and immutable. Source change never rewrites an existing run.
- Retirement removes owned handlers and synchronously disconnects owned GATT immediately; it never waits behind a pending native promise. Deferred asynchronous stop cleanup does not overlap another native operation.
- Current-connection supported contact loss immediately invalidates collecting or ready calibration; explicit recollection is required.

## Task1 — Pure protocol and calibration

Owner files: apps/composure/src/heart-rate.ts, tests/heart-rate.test.ts.

- [x] Publish exact spec interfaces/constants so transport/model/UI owners can import stable signatures.
- [x] Write RED hand-authored packet cases: contact0x02,8/16-bit LE, offset DataView, energy/RR, exact optional tails, RFU/truncation and512-byte bound.
- [x] Implement bounded structural parser, separating valid protocol BPM from gameplay eligibility.
- [x] Write RED clock/sequence/connection/calibration cases: five spaced samples,4000ms span,30000ms inclusive window, spread<=12, bursts, wrong connection, expiry, shared observe/snapshot watermark, sparse arrays and output detachment. Wrong connection/duplicate precede clock admission; eligible new sequences advance observation watermarks even if not counted.
- [x] Implement collector snapshot/invalidate state transitions, exact inclusive time boundaries, contact-loss invalidation even when ready, and explicit failure/recollection. Ready age is completedAtMs, not last unrelated reading.
- [x] Run focused Node tests and scoped lint/typecheck; send actual evidence/API readiness to peers.

## Task2 — Native browser transport

Owner files: apps/composure/src/bluetooth.ts, tests/bluetooth.test.ts.

- [x] Publish exact structural types/class; invoke chooser synchronously from connect with only heart_rate filter.
- [x] Write RED deferred native EventTarget fixtures for every await, cancellation/timeout/disposal, listener order and subscribe failure. Public connect resolves false promptly while the unresolved native operation stays draining; late successful connect gets a repeated owned synchronous disconnect before final cleanup.
- [x] Implement bounded attempt generation, post-chooser15000ms deadline with synchronous checks after every awaited stage/final subscribe, one-operation draining admission, immediate owned synchronous disconnect, deferred nonoverlapping asynchronous cleanup and eventual late-result handling. Pin never-settling start/stop cases: physical disconnect occurs promptly even while admission remains draining.
- [x] Validate/copy notification values synchronously, stamp performance-clock receipt/sequence, parse all frames before forwarding, suppress early events and never read an initial cached sample.
- [x] Write/verify retired listener/cleanup, reused resource after drain, connected=true queued disconnect, fixed error copy, ignored raw identity and delayed stop rejection tests.
- [x] Verify no unhandled rejections/timer/listener accumulation; report focused tests/lint/typecheck.

## Task3 — Source-safe game model and reports

Owner files: apps/composure/src/model.ts, new tests/bluetooth-model.test.ts. Preserve tests/model.test.ts and already released tests/calibration-validation.test.ts unchanged.

- [x] Verify the already released sparse-array calibration prerequisite; write RED BLE source refusal/mixing, zero initial reading, origin detachment/freeze and post-start notification cases in the new owned test file.
- [x] Add exact optional newRun origin and private separate BLE gate, preserving simulated calls and editable game state.
- [x] Write RED wall-clock freshness, nonfinite/decreasing time before any mutation, sub-step advance, contact loss before BPM/spacing checks, sequence watermark initialized from calibration, pause/resume cutoff, history retention and reconnection rejection.
- [x] Implement sampleBluetooth/invalidateBluetooth plus optional BLE clock parameters on advance/resume. Ticks must not derive BLE freshness from historical active-time samples.
- [x] Write RED actual detached BLE report shape/relative times and unchanged schema1 simulator report assertions; implement bounded report output.
- [x] Run focused model tests plus simulator baseline tests/lint/typecheck; send model readiness to UI/oracle owners.

## Task4 — Complete stable UI flow

Owner files: apps/composure/src/main.ts, apps/composure/src/style.css.

- [x] Add exact Next run source/current run source/status/calibration/connect/cancel/disconnect/Collect controls, preserving existing simulator labels and stable game DOM.
- [x] Route notifications into explicit calibration OR matching run. Display received progress, errors and honest unavailable/draining help without device identity.
- [x] Build candidate Start only after fresh calibration; obtain replacement confirmation and recheck age/current connection afterward. Begin BLE gameplay empty until a new actual notification.
- [x] Guard all three simulated sample paths by immutable run.source, preserve simulated preferences baseline/best and add source-specific report filename.
- [x] Implement pause/resume/blur versus hidden/pagehide distinctions, source intent invalidation, explicit new-baseline Restart and safe old-report retention.
- [x] Add accessible source-select focus styling/mobile controls and bounded status updates; no extra service/model logic in UI.
- [x] Run scoped lint/typecheck. Freeze source and coordinate root/browser owner before shared build.

## Task5 — Independent protocol/model and native browser acceptance

Owner files: apps/composure/tests/heart-rate-oracle.test.ts, tests/browser/bluetooth.spec.ts, optional tests/browser/bluetooth-fixtures.ts. Root may split oracle/browser owners without overlap.

- [x] Independently derive hand packet expectations and calibration/model edge expectations without calling producers to calculate expected outputs.
- [x] Inject only navigator.bluetooth structural fixture using actual EventTarget/DataView/deferred promises. No production module/game-state injection or fake initial BPM.
- [x] Observe RED before producer behavior where available, then verify genuine connect→five spaced notifications→start→keyboard game completion→real report download→preferences/reload.
- [x] Exercise contact flags/optional packets, insufficient/expired calibration, hidden/pause/fresh receipt, source/best isolation and every delayed native stage plus safe draining retry.
- [x] Assert identity-free UI/report/storage, no auto reconnect, cached-reading reuse or unhandled delayed cleanup errors. Include chooser blur survival.
- [x] Run old six browser cases unchanged alongside new native cases on root's coordinated production build; explicitly label software fixtures and hardware unverified.

## Task6 — Root integration and release

- [x] Read-only independent source review across protocol/transport/model/UI seams, particularly wall-clock freshness, owned cleanup and new-run publication after consent.
- [x] Root runs npm test, npm run lint, npm run typecheck, npm run build and full production browser suite with configured Chromium. Fix only demonstrated defects through owners.
- [x] Root records exact test/runtime evidence, updates README/catalog truth and issue61; keep idea17 ACTIVE and physical issue62 blocked rather than claiming a verified watch MVP.
- [x] Root reviews diff, commits/pushes and checks path-scoped CI. No source owner Git mutation.

## Review focus

Cancellation cannot abort native chooser/GATT promises; one outstanding native operation prevents concurrent reused-resource ambiguity and unbounded pending work. Event generations reject retired callbacks but cannot authenticate physical session attribution on reused EventTargets. Source/calibration/sample history remain truthful and unmixed. Calibration or paused readings cannot be replayed into gameplay. Contact0x02 is valid unknown. Monotonic receipt age, not active game time, controls BLE freshness. Every real-device claim remains withheld pending issue62.


## Completion evidence — 2026-10-04

Software implementation is pushed in `a73f866a475f775cce4644af49674f7db0c97373`, with 97 unit and 23 browser cases, lint/typecheck/build and all twelve project CI workflows passing. Independent source review findings were reproduced and fixed. The permanent [verification record](../../../apps/composure/docs/2026-10-04-bluetooth-verification.json) preserves actual RED/GREEN history and harness corrections rather than claiming every independent test first failed.

The tracked portable smoke script separately verifies the unmodified unavailable state and controlled-provider native desktop escape/mobile start, real report downloads, exact simulator preferences and genuine navigation cleanup. Its actual rerun passed in 11.939634756 wall seconds. Controlled clock/provider behavior does not establish actual hidden-document behavior, device timing, hardware compatibility or accuracy. Those acceptance limits are explicit; physical issue #62 remains open and catalog17 ACTIVE. Software issue #61 closed completed at 08:51:32 UTC after final evidence commit `c758070` was pushed.
