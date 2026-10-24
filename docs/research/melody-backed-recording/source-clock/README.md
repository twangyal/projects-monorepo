# Source-clock handoff diagnostic — #300

Protocol fixed before collection: five immediate/cold and five warmed getUserMedia handoffs, alternating pair order, one worker, no retries. The warmed synthetic source advances its own AudioContext by at least0.2seconds after resume and before returning its stream; cold returns immediately after resume. Record actual clocks/states/wall time. Keep the original440Hz/.25gain stream, four-track backup, production controller/count-in/worklet,2.4-second finish condition, five normal backing routes, upstream observer and original quality tolerances. Retain all errors and complete available native/normalized samples. No original audio is user microphone data.

Hypothesis: source-clock lifecycle before stream handoff could be associated with gaps/refusal in the original controller path. A passing or gap-free small cohort does not establish causality or a reliable fix, nor identify historical uninstrumented behavior. Warming changes exposure time and stream scheduling; observer overhead remains. Physical microphones and production acceptance remain unverified. Shipping code must be restored after collection; #300 stays open unless original failure is actually explained and fixed.

## Observed result

All ten structural captures completed in the first fixed cohort (1.2minutes); all five real-time AudioBufferSource connections remained normally routed, and stream release plus untouched-track/reference checks passed. All five cold handoffs measured zero source-clock advance. All five warm handoffs advanced0.2002721088435374seconds; observed wall waits were181.6–204.6ms. These are measured clocks, not a calibrated physical latency estimate.

**Nine of ten original quality assertions pass.** Cold pair3 retains441 exact-zero native frames at4353–4794 (10ms), beginning98.707ms into the capture. The complete upstream averaged-input observer clips/merges to that same gap. Normalization retains220 zero samples at2177–2397 (about9.977ms). The original one-second window beginning0.1seconds into audio counts436Hz rather than440Hz; its unchanged absolute-deviation bound of2Hz fails with4Hz. This is the window's zero-crossing estimate, not proof that the underlying tone changed pitch. Native/normalized RMS are0.176003798/0.176002861. The original quality exception is retained separately from successful structural completion.

The other four cold captures and all five warm captures have no exact-zero run of at least8samples in the complete native/normalized signal. This small cohort is consistent with the startup-handoff hypothesis, but does not establish an effect size, causality, a dependable workaround or a production fix. The perturbation changes source age, oscillator phase and browser scheduling before the same controller path; observer scanning/message overhead remains. Historical uninstrumented gaps may have other causes, and the original pre-count-in refusal was not reproduced here. Physical microphones, user latency and recording quality remain unverified. #300 stays OPEN. A next study should predeclare a larger source-handoff cohort and an observer-overhead control before adopting any startup change.

## Durable evidence and reproduction

`manifest.json` pins baseline commit/tree, runtime, exact probe/patch and replay-primitive hashes, fixed row order and each receipt/raw sample hash. Every full native Float32 capture and normalized signed PCM capture is retained; native data is losslessly repacked to XZ, preserving raw bytes. `replay.json` records independently recomputed complete zero intervals and original quality-window metrics. No failed quality capture is excluded. The decoder retains bounded gzip/XZ sizes, memory limits, finite samples, geometry/interval consistency, source-clock exposure checks, scheduling, route and release checks.

In an isolated checkout of manifest.sourceCommit, copy this archive folder into the same path, apply `observer.patch` from repository root and copy `probe.spec.ts` to `apps/melody-studio/tests/clock-probe-300.spec.ts`. Install locked Melody dependencies and Chromium, then run:

```sh
CHROMIUM_PATH=/path/to/chromium MELODY_TEST_PORT=4196 npm --prefix apps/melody-studio run test:browser -- --workers=1 --output=/tmp/source-clock-cohort apps/melody-studio/tests/clock-probe-300.spec.ts
python docs/research/melody-backed-recording/source-clock/collect.py /tmp/source-clock-cohort --chromium /path/to/chromium
python docs/research/melody-backed-recording/source-clock/verify_source_clock.py
python -m unittest discover -s docs/research/melody-backed-recording/source-clock -p 'test_*.py'
```

The probe retains available complete outputs/receipt before its structural assertions, catches and records original quality failures without converting them into passes, and configures no retry. Remove instrumentation and the temporary app test afterward. The shipping app and its original assertions are unchanged. The collector path is a portable wrapper around the original collection/repacking commands; runtime data originate from the pinned probe/patch.

Four replay/guard tests pass, including re-signed source-clock/state/mode corruption and protocol order. Temporarily omitting startup/schedule guards produced six failing assertions/subtests across the four-test cohort; restoring them returns GREEN. The six historical output-route verifier tests also pass without modification. A fresh independent reviewer decoded/hashed all ten complete native/normalized captures and reproduced replay.json exactly; no blocker was found.

After removing instrumentation, all463 Melody units, ESLint, TypeScript/Vite and21 unchanged recording browser cases pass (51.7seconds for that native cohort). This is clean-source validation, not a new full-browser or physical acceptance claim. No shipping workflow, dependency, resource guard, application deadline or quality tolerance changed. Project #8 remains skipped.
