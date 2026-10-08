# 512-beat song timeline — 2026-10-08

Issue: [#142](https://github.com/twangyal/projects-monorepo/issues/142). Parent implementation: `37dec8a3ae0884dfe25af0ce3f1d59cd508a6c04`. Branch: `Astra`.

## User outcome

The former 128-beat ceiling allowed only 64 seconds at 120 BPM. A shared 512-beat limit now supports a 4 minute 16 second arrangement at 120 BPM and 12 minutes 48 seconds at 40 BPM, before release tail. Model validation, numeric/piano-roll editing, track/section repetition, continuation, MIDI source review, section rendering and reference-solo comparison agree on the limit. Exact timing and existing project formats remain unchanged.

The application still admits eight tracks, 256 notes per track, 0.25–16 beat notes and 20-second captures/reference takes. It remains ACTIVE toward the full DAW vision: audio clips, richer instruments/sound design, mixing/routing/effects and relevant musician evaluation are substantial future work.

## Allocation and timing evidence

A complete 512-beat composition at 40 BPM and 22,050 Hz renders exactly **16,936,164 frames**, including the 0.08-second release tail. The ending contains audible synthesized samples and the leading rest remains silent. The independent public renderer refuses allocations above **40,000,000 Float32 frames** before constructing the synthesis buffer. The 512-beat/40 BPM/192,000 Hz request refuses; no clipping or silent sample-rate change occurs. This preserves previously admitted 128-beat songs at every supported public rate and all supported browser songs at 22,050 Hz. The cap bounds one synthesis buffer, not total browser memory.

Independent MIDI parsing retains the late note at internal beat 511 with duration 1. Full-window MIDI review accepts 512 beats and refuses 513. A separate 300-beat continuation seed verifies the 2,048 quarter-tick ceiling while retaining the 16-beat local extension depth. Whole-section duplication after beat 300 and a section ending at exact internal beat 512 succeed.

The native browser test opens a reference-backed 512-beat song, edits its final note to start 511.5/duration 0.5, verifies exact Undo/Redo and unchanged reference bytes, plays its ending section, downloads actual MIDI and WAV, decodes their final timing/audibility, reloads exact complete state, auditions edited notes at the original capture tempo and reviews the full exported MIDI source without applying it. The 120 BPM WAV contains exactly **5,646,564 frames**. Reference comparison renders the longer solo and crops the unchanged short reference window.

## Verification history

- Before implementation, all four new unit cases failed against the old 128-beat ceiling. The native long-song test also failed because the old application refused the fixture and kept an untitled project.
- After implementation, all four new unit cases passed. The first complete unit run exposed ten assertions targeting the old refusal boundary; these were moved to the new boundary. Earlier accepted 128-beat fixtures and MIDI protocol byte constants were preserved. A second run exposed one remaining old beyond-end fixture, which was corrected to 511.9 + 0.25.
- Final `npm --prefix apps/melody-studio run check`: **329 units passed**, lint, TypeScript and production build passed.
- Targeted native Chromium 153 test: **1 passed**. Complete serial native suite: **149 passed (3.0 minutes)**, with no failures. Command: `CHROMIUM_PATH=/tmp/melody-chromium-wrapper npm --prefix apps/melody-studio run test:browser -- --workers=1`.
- Fresh read-only GPT-6 Astra review against the parent found no Critical/Important defects. It inspected exact endpoint/overflow, pre-allocation refusal, continuation ticks, shared editor/import/render paths and unchanged capture/reference/schema/protocol limits. The reviewer ran no builds or tests.

Checks run serially to keep production/harness builds and test-results isolated. Local Node 24.19 and restored native Chromium 153/software WebGL were used; temporary browser dependencies are not committed. Successful automated checks establish these bounded flows, not real microphone accuracy, subjective musical quality or broad device performance.
