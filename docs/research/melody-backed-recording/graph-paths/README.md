# Bounded graph-path comparison (#300)

On 2026-10-22, a fixed matrix compared a stereo Web Audio oscillator connected directly to the production recording worklet, through a same-context MediaStream loopback, and through a separate-context MediaStream loopback. Each path ran five times, rotating path order each round. One separate-context silent control ran first. All captures requested 44,100 Hz and 88,200 frames. The authored tone was 440 Hz at gain 0.25, identical on both channels. One Chromium worker ran the matrix in 48.3 seconds including build.

None of the 15 tone captures contained an exact-zero run of at least eight frames. Each measured 440 positive crossings in the fixed one-second window beginning 0.1 seconds into the capture. The silent control contained 88,200 zero frames. For all 16 captures, the input observer's clipped and merged zero runs agree with the retained numerical samples. Completion receipts report the exact requested frame interval, two channels and 44,100 Hz. The probe reports closed contexts, ended tracks and a stopped oscillator after each case.

**This is a non-reproduction in a smaller graph.** It does not explain or clear the six upstream-input gaps from the earlier selected-track browser flow, establish which transport caused those gaps, or reproduce/resolve the original startup refusal. It bypasses the product controller, backing playback, editing, normalization, WAV and history. No production audio fix or acceptance-threshold change follows from this experiment. Issue #300 remains open.

## Retained evidence

`manifest.json` records the source commit and Melody subtree, runtime versions, per-capture protocol/input-observer receipts, cleanup results and hashes. Each `.f32le.gz` contains the complete native numerical capture, serialized through JSON numbers and re-encoded as little-endian float32. Numeric sample values are preserved; original float-buffer byte identity (including signed zero) was not independently retained. The original JSON receipt hashes identify the observed receipts; those original JSON byte streams are not included. Input blocks are emitted only when they contain zero samples, including short fragments. The replay merges fragments across block boundaries before applying the eight-frame reporting threshold.

Run independently with Python's standard library:

```sh
python3 -m unittest discover -s docs/research/melody-backed-recording/graph-paths -p 'test_*.py'
python3 docs/research/melody-backed-recording/graph-paths/verify_graph_paths.py
```

The verifier checks full decompressed sample hashes, bounded single-member gzip streams, finite float values, input/capture zero-run agreement, completion intervals and cleanup receipts. It reports tone metrics without making absence of gaps or a 440 Hz estimate a product acceptance gate. Four verifier tests cover cross-block short fragments, clipping, invalid/duplicate observer blocks, corrupted/oversized/trailing compressed data, nonfinite samples and silence.

## Reproduce the experiment

Use the exact source commit in the manifest in an isolated checkout. Apply `graph-paths.patch`, then copy `graph-probe.spec.ts` to `apps/melody-studio/tests/graph-probe-300.spec.ts`. With the app's locked dependencies installed and Chromium available:

```sh
CHROMIUM_PATH=/path/to/chromium MELODY_TEST_PORT=4190 npm --prefix apps/melody-studio run test:browser -- --workers=1 tests/graph-probe-300.spec.ts
```

This creates diagnostic `graph300-*.json` receipts in the browser test output. The test persists every capture before its assertions; there is no retry-until-pass loop. The patch includes the averaged-input observer immediately before `BackedFrames.push`, plus the three graph paths and bounded cleanup. Remove the patch and temporary spec afterward. The checked-in app contains neither.

After removal, the unchanged original native-worklet browser suite passed **10/10** in **19.0 seconds**. The baseline collector/controller model suites passed **42/42**. These checks cover existing behavior; they do not supersede the unresolved selected-track diagnostic.
