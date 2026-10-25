# Consecutive native worklet clock readings — #300

This bounded diagnostic continues the [terminal-clock evidence](../terminal-clock/README.md). It adds the missing previous/current process-call metadata, without changing recording admission or shipping any instrumentation. Base: `ec5eed278fa68437680c5e64eff4c40ff5f7d3a1`. Melody remains ACTIVE; #300 remains open; project #8 stays skipped.

## Fixed comparison and actual outcomes

The protocol in PLAN.md was fixed before collection: ten fresh pages in each mode, the original Stop/pagehide flow, one worker, no retries, followed by two instrumented invalid-command controls. The original elapsed >0.2 / five-second predicates, source graph and complete-backup/release checks were preserved. Each elapsed checkpoint additionally records the visible recording state. The first mode uses the original synthetic microphone fixture without the extra observer or worklet patch. It is not a physical-microphone or instrumentation-free fixture. Modes ran sequentially, not randomized; this is not an observer-overhead causal estimate.

| Mode | Planned starts | Actual starts | Original cases passing | Recording at elapsed checkpoints | Native terminals retained |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original fixture, no extra observer | 20 | 19 | 9/10 | 18 | Not instrumented |
| Temporary quantum/terminal observer | 20 | 20 | 10/10 | 19 | 1 |

All 22 receipts are kept. Baseline row0 fails the first elapsed check with -Infinity, schedules no backing source and releases its one requested stream. The notice is the existing discontinuous-frame feedback. No second attempt occurs on that page. Its post-failure backup hash was not collected, so equality is not claimed for that failed row. The nine complete baseline cases and ten complete instrumented cases retain equal before/after complete-project hashes.

The two separate native protocol controls at44100/48000Hz pass. Thus the instrumented browser runner reports12passing tests, while one of its20startup attempts refuses before capture. Passing original assertions is not proof of a successful recording start.

## New discriminator

Instrumented row6's second session refuses during count-in. The metadata ring retains consecutive process invocations37 and38:

| Reading | Call37 | Call38 |
| --- | ---: | ---: |
| currentFrame at entry and immediately before push | 138240 | 138240 |
| currentTime at those two observation sites | 3.1346938775510202 | 3.1346938775510202 |
| Input channels / first-channel length | 2 / 128 | 2 / 128 |
| Ready / armed at entry | true / true | true / true |

Collector previousEnd138368 matches call37 push-frame plus128; incomingStart138240 matches call38 push-frame. The planned start is182654, captured frames0. Arm was observed at call-sequence4, frame134144. The retained eight-row ring shows ordinary128-frame increments before the two equal readings. The entry/push frame observations agree throughout the retained ring; related time/frame residuals are reported rather than rounded into an admission policy.

This instance places the repeated readings upstream of the collector's continuity check, rather than showing a collector cursor disagreement. It establishes two consecutive invocation entries reading the same native frame/time and shape. It does **not** establish identical PCM, a particular browser defect, historical failure identity, source-stream causality or a safe production repair. PCM is neither inspected nor retained by this diagnostic. An invalid-command receipt is still immediately followed by the unchanged original error; healthy model capture adds no diagnostic port message.

The original elapsed oracle still advances after a scheduled backing source's recording owner retires: the instrumented refusal nevertheless reaches its elapsed checkpoint, which records a non-recording state. This independently retains the earlier false-positive mechanism without converting refusal into success. Baseline's pre-source refusal is a separate observed path without quantum metadata; do not assign it the instrumented row's exact boundary.

## Integrity, model and restored-source checks

The new worklet-class controls first yield three missing-quantum-metadata failures and one healthy unchanged pass. After the temporary patch all four pass: repeated frame, related-clock disagreement retention, bounded wrapped ring/command ordering and exact healthy interval. Eight independent Python replay/corruption checks pass. Their initial run hit missing-manifest setup errors, which are retained as a setup limitation, not claimed as a behavioral RED. Native data collection was not retried or expanded after inspecting results.

The manifest pins exact patch, observer, native probe, four model controls, complete native logs, every receipt, verifier/tests and original shipping source hashes. Replay is deterministic and distinguishes planned/actual starts, original assertion outcomes, recording checkpoints and terminal metadata. It is a fixed-cohort integrity tool, not general future-run acceptance. Comparison booleans and clock residuals remain observations; they are not replacement guards.

Shipping files were restored byte-for-byte. Restored478unit tests, lint, types and production build pass. The fresh20case original backed-recording/actual-worklet browser run is **19pass/1fail in51.6s**: the unchanged Stop/pagehide case again times out at elapsed -Infinity. This failure is retained without a retry or relaxed timeout; no all-native or full270-case pass is claimed. The existing failure is part of #300, and this docs-only investigation does not fix it. Detailed restored logs are retained separately.

## Source context and limits

The [W3C Web Audio1.1 Working Draft,22September2026](https://www.w3.org/TR/2026/WD-webaudio-1.1-20260922/#AudioWorkletGlobalScope-attributes), checked25October2026, associates the worklet global with one context/rendering thread and defines frame/time against that context. These are related representations, not independent clocks. This normative context does not prove this binary conforms or identify its implementation failure. An attempted exactChromium143.0.7499.0source fetch was unavailable; current Chromium HEAD was not substituted as evidence about that binary.

Observers and the bounded64-number ring can alter scheduling. The portable Chromium143 synthetic setup does not establish physical microphone quality, incidence, cross-browser behavior, or overhead causation. No samples are padded, dropped, normalized differently, silently retried or rescheduled to manufacture a passing capture. No workflow/dependency/timeout change or production workaround is included.

## Reproduction

In an isolated checkout of the manifest base, with locked Melody dependencies installed, copy probe.spec.ts and observer.ts to the exact names imported by the probe:

```sh
cp docs/research/melody-backed-recording/quantum-clock/probe.spec.ts apps/melody-studio/tests/quantum300-native.spec.ts
cp docs/research/melody-backed-recording/quantum-clock/observer.ts apps/melody-studio/tests/quantum300-observer.ts
QUANTUM300_MODE=baseline CHROMIUM_PATH=/path/to/chromium MELODY_TEST_PORT=4196 npm --prefix apps/melody-studio run test:browser -- quantum300-native.spec.ts --workers=1 --output=/tmp/quantum300-baseline
# Preserve all baseline results, including failures, before applying instrumentation.
git apply docs/research/melody-backed-recording/quantum-clock/observer.patch
cp docs/research/melody-backed-recording/quantum-clock/worklet-model.test.mjs apps/melody-studio/tests/quantum300-worklet.test.mjs
node --experimental-strip-types --test apps/melody-studio/tests/quantum300-worklet.test.mjs
QUANTUM300_MODE=instrumented CHROMIUM_PATH=/path/to/chromium MELODY_TEST_PORT=4196 npm --prefix apps/melody-studio run test:browser -- quantum300-native.spec.ts --workers=1 --output=/tmp/quantum300-instrumented
```

Restore only these owned temporary changes after retaining their receipts. Replay the committed observations without a browser:

```sh
python3 docs/research/melody-backed-recording/quantum-clock/verify_quantum_clock.py
python3 -m unittest discover -s docs/research/melody-backed-recording/quantum-clock -p 'test_*.py'
```

Next discriminator: a reduced native graph/process-call reproduction with a pinned browser implementation or distinct browser binary, preserving strict capture boundaries. This evidence does not justify bypassing count-in discontinuities. Do not repeat route/warmup sweeps or add telemetry to shipping code merely because this cohort passed its original assertions.

## Independent review

Fresh read-only review replays all22receipts, all8Python tests and exact saved replay, checks the ring/collector arithmetic, complete artifact hashes and original source bytes against the base commit/tree, and finds no Critical/Important issue. One Minor is deferred: the test named exact_retained_cohort_replays compares two verifier invocations rather than a fixed replay.json oracle, so it cannot itself catch classification/counting regressions. Two executor byte comparisons and the independent review match the retained replay exactly; the unit-test improvement remains open for a future related edit. No fix pass or rereview. The reviewer inspected retained native/model logs rather than rerunning browsers; restored validation is the executor's observed result. Root cause/identicalPCM/historical identity, missing failed-row backup evidence, physical/cross-browser/overhead behavior, exact implementation conformance, full270case/general future-run/adversarial authenticity and a production repair remain outside established evidence. No broader DAW acceptance is implied.
