# Gaze binary ARIA state integration — #291

The extension now supports explicit check/tick/uncheck/untick for custom binary ARIA checkbox and switch widgets. One website-owned click changes state, and an already-satisfied request sends no events. Feedback observes the state after click microtasks drain; missing/mixed state and locked/incompatible controls refuse. Arbitrarily delayed network/timer-driven updates are not promised.

Reviewed implementation b2c0e1e27d85c46785e66415e4d1b20a48a6bc3e passed both [source run39158439804](https://github.com/twangyal/projects-monorepo/actions/runs/39158439804) and [canonical main run39158887364](https://github.com/twangyal/projects-monorepo/actions/runs/39158887364):195 units on each of three shards, syntax/extension build, and436 Chrome for Testing153.0.8010.12 browser cases (151+141+144). Browser cases include the real injected extension, site-owned updates/events, no-op repeats, focus/lock races, confirmation/cancellation, shadow/frame boundaries and stale-result retirement. Subsequent Clothing integration1725955 preserves the exact Gaze source.

Local Node195 tests and extension build pass. Local portable Chromium143.0.7499.0 passes60 focused native/custom DOM cases across four viewports. A local portable-runtime extraction error was worked around by manually decompressing the installed browser archive; local injected-extension acceptance is not claimed. Hosted tests provide the extension evidence.

Independent review found two material acknowledgement bugs before publication. Failing regressions demonstrated assisted matching losing final state/cancellation and nested website microtasks reversing state before success feedback. Controller promise flattening and a single event-loop-turn observation fix both. Follow-up review independently passes23 controller tests and the real DOM reversal reproduction, with no further important findings. Original failing logs are retained in `apps/gaze-navigator/docs/evidence/aria-check-291/`.

Issue291 is closed. Gaze remains ACTIVE: physical microphone/webcam reliability, intended-user task completion and broad website/framework acceptance remain separate. Project8 remains skipped.
