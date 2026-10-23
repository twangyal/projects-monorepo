# Original controller output-route comparison (#300)

On October22,2026 (America/New_York), a fixed original-app cohort compared10 normally routed backing sessions with10 sessions whose five real-time backing/click AudioBufferSource connections were omitted. Mode order alternated by pair. One Chromium143 worker used the same original synthetic440Hz/0.25gain microphone fixture, imported four-track backup, selected destination, production controller/count-in/worklet,2.4-second Finish condition and existing normalization. All20 captures completed and released the microphone. Scheduled buffers/count-in intervals, other track/reference bytes and the five-route audit passed. This is a diagnostic comparison, not an alternative release gate.

One **disconnected-output** capture (pair0) contains a441-frame exact-zero run at native frames2148–2589 of a44,100Hz capture: **10ms**, beginning48.707ms after capture start. Complete upstream averaged-input observer fragments clip/merge to that same interval. The normalized22,050Hz capture contains221zero frames at1074–1295. All other19 native captures have no exact-zero run of at least8frames.

Every capture passes the original one-second frequency/RMS assertion, measuring440Hz in the window starting0.1seconds into normalized audio. The observed gap precedes that window. A passing frequency window therefore does not establish whole-capture quality.

## Interpretation and limits

Concurrent routed backing output is **not required for this reproduced synthetic-input gap**. Disconnecting those nodes did not prevent every gap. This does not identify the source/transport cause, quantify a route effect, explain the older larger gaps or reproduce the original pre-count-in refusal. A ten-per-mode cohort on one runtime is too small for a dependable incidence estimate. Disconnected nodes may skip browser graph processing; the comparison changes graph reachability, not merely audible amplitude. Source/controller startup, clock scheduling and the synthetic MediaStream path remain possible differences from the smaller graph study. The observer adds per-block scanning/allocation and zero-block message traffic, which may perturb timing. This establishes a gap in the instrumented disconnected graph; it does not prove historical uninstrumented gaps share its cause. Physical microphone behavior is unverified. Issue#300 stays OPEN; no production fix or acceptance threshold follows from these observations.

## Retained evidence and reproduction

`manifest.json` pins the baseline commit and Melody subtree, runtime, fixed row order, exact probe/observer hashes and all receipt/native/normalized hashes. Native `.f32le.xz` stores the actual Float32Array bytes before transfer/detachment; normalized `.s16le.gz` stores complete original signed PCM bytes. Raw samples are synthetic fixtures, never user microphone recordings. All20 full capture pairs and original JSON receipts are retained. Recollection writes gzip; native captures are losslessly repacked to XZ for storage, preserving the manifest raw-byte hashes. `verify_output_route.py` independently checks bounded gzip/XZ decoding, hashes/finite samples, intervals, observer agreement, native/normalized metadata, original frequency/RMS outcomes, scheduling and cleanup. Five tests include re-signed semantic corruption of interval, routing, quality, scheduling and release evidence.

```sh
python3 -m unittest discover -s docs/research/melody-backed-recording/output-route -p 'test_*.py'
python3 docs/research/melody-backed-recording/output-route/verify_output_route.py
```

To recollect in an isolated checkout of `manifest.sourceCommit`, apply `observer.patch` at repository root and copy `probe.spec.ts` to `apps/melody-studio/tests/route-probe-300.spec.ts`. Install locked dependencies and Chromium, then:

```sh
CHROMIUM_PATH=/path/to/chromium MELODY_TEST_PORT=4190 npm --prefix apps/melody-studio run test:browser -- --workers=1 --output=/tmp/output-route-cohort tests/route-probe-300.spec.ts
```

Every case saves its receipt and available complete samples before the diagnostic structural assertions. Quality assertion exceptions are retained separately, never hidden by retries or substituted for original acceptance. No retries were configured. Remove instrumentation and the temporary app test afterward. The checked-in shipping app is unchanged.

## Harness failures preserved

The first startup failed TypeScript checks before collection (`this` annotation and unsupported gzip option); no audio was collected. After those corrections, the initial global connection wrapper also intercepted an OfflineAudioContext normalization source. Its final five-route assertion observed six, so the pilot was stopped after11complete receipts. `pilot.json` retains case identities, route audit, error state and original receipt hashes; full pilot audio/JSON byte streams are not retained, and these hashes identify observations rather than reproducible complete pilot files. Those data are excluded from the comparison. The corrected wrapper first admits native real-time AudioContext ownership and leaves offline normalization unchanged. Its fresh fixed20-case cohort passes in2.4minutes.

The verifier's analytic zero-phase sine fixture initially lost a crossing at an exact window endpoint through floating-point sign rounding; using a declared0.2-radian phase avoids that ambiguous endpoint. Original product frequency/RMS bounds and recordings were unchanged. Final five verifier tests and full replay pass. Fresh independent review and clean-source validation are recorded in the integration receipt.
