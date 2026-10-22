# Melody input-boundary evidence plan

> **For agentic workers:** Use superpowers:executing-plans for this bounded research unit.

**Goal:** Locate reproduced silent gaps relative to incoming AudioWorklet blocks without altering production audio.
**Architecture:** Reuse the validated diagnostic port patch on canonical main, run the silent control followed by exactly thirty original-flow repetitions, then retain outcomes, incoming zero intervals and selected raw captures with an independent verifier. Remove all temporary app edits before integration.
**Tech Stack:** Existing TypeScript/Playwright/Chromium143, Python standard library.
**Spec:** Issue #300 and docs/2026-10-22-melody-native-boundary.md.

## Global constraints

No original assertion, audio/frame/RMS/frequency/deadline tolerance, production protocol or sample changes. Preserve first failures. No physical microphone quality claim. Project8 skipped; deferred projects untouched.

## Review focus

Incoming relative intervals must be converted to absolute graph frames, merged and clipped to the retained capture before comparison. Failed startup may have no capture; absence must remain explicit. A passing frequency window may still contain gaps elsewhere. Raw bytes require bounded decompression, exact hashes and finite float checks. Observer computation can change timing; do not generalize non-reproduction or assign a native engine cause.

### Task 1: Collect and replay the cohort

- [x] Verify existing collector/controller baseline (42 tests).
- [x] Run the actual silent MediaStream control; preserve its full messages.
- [x] Run thirty original selected-track flows with observer and failure-only evidence.
- [x] Retain all statuses and native/PCM summaries; embed complete normalized PCM and native regions for exact/partial failing and passing/long-gap comparisons.
- [x] Independently recompute merged/clipped input intervals, native/PCM zero runs and unchanged original frequency/RMS results; add synthetic interval and tamper regressions before the verifier implementation.
- [x] Review, remove app instrumentation, commit research and roadmap, update #300 with measured outcome and concrete remaining work.
