# Composure implementation plan

Spec: `docs/superpowers/specs/2026-10-04-composure-design.md`. Execute inline under the standing autonomous request; issue #39 tracks progress. Branch: `codex/composure-mvp`.

1. `src/model.ts`: export `calibrate(readings)`, `newRun(baseline, scares)`, `sample(run,bpm)`, `advance(run, elapsed, controls)`, `pause(run)`, `resume(run)`, `runReport(run)` with bounded deterministic state. Write `tests/model.test.ts` first and observe the missing API failure. Implement and run the complete Node suite.
2. `src/main.ts` / `style.css`: responsive canvas corridor, explicit simulated calibration/reading controls, keyboard/touch movement, interact/steady controls, progress/aim/noise/timer and accessible objectives. Add settings/versioned backup support; write validation/storage tests before implementation. Add production browser tests for a full win, failed prerequisites, samples/pause/reset, keyboard focus, download and mobile.
3. `README.md`, workflow and roadmap: install/run/controls, limits and truthful simulated-vs-hardware scope. Verify `npm run check`, production Chromium and exact exports. Dispatch the final independent review under executing-plans, fix important findings with failing tests, and integrate only verified progress into Astra.

Interfaces: controls carry x/y axis, interaction/steady booleans and optional world-space pointer aim. Browser uses model elapsed active time for sample timestamps. Model events/samples feed reports; reports are bounded at 256 entries per stream and disclose truncation. Settings store only simulated baseline, scares, reduced-motion, mute and best completion seconds.

Review focus: missing sensor data must not punish the player; paused time must not age samples; pointer cancellation must release holds; keyboard settings edits must not move; corrupt local data must not get silently overwritten; downloaded reports must not imply measured physiology.
