# Playback startup clock repair (#136)

## First failure and cause

At source `7e316fb5d71fe8100f840a126fd574b7f144aa17`, [PR Motion CI](https://github.com/twangyal/projects-monorepo/actions/runs/37607029119) passes 237 units and 145 native cases, but snapshot playback remains at frame zero. The first trace records `Render frame must be within the project timeline.` A delivered rAF timestamp can precede the `performance.now()` reading in the play handler. Flooring negative elapsed time produces frame −1; rendering throws before scheduling another callback. The editor uses the same calculation. This is a production clock-ordering defect.

Artifact 11474499786 (`motion-studio-browser-results`) has SHA256 `b29cc1d239ce320de46cc4ef39b5ad2a12c636453ab5745e617b5836cce39bb5`. Raw traces contain ephemeral private-link capabilities and are deliberately excluded; only this sanitized error and artifact provenance are recorded.

## Repair and validation

Both playback paths use nonnegative elapsed time; their existing endpoint and editor loop arithmetic remain unchanged. Removing the clamp makes the unit regression fail with actual −1 versus expected 0. Fresh full `npm run check` passes 239 unit tests, lint, type checking and production build on Node 24.19.0. Independent code review finds no blocking defect.

Two browser regressions deliver a controlled earlier timestamp on the first real native callback, then forward all later native timestamps unchanged. They require visible frame advancement, explicit pause, no page errors and unchanged authored project/library data. This controlled reproduction is not a hardware performance claim or a production clock replacement. Existing PNG/GIF/archive/HTTPS assertions are retained.

## Native and CI acceptance

The initial alternate Chromium 153 runtime crashes before navigation (ANGLE/Vulkan, then font configuration). A single-process attempt passes the two controlled cases but fails the full suite: 80 pass / 68 browser-context closure failures. Those failures are retained as environment limitations, not erased or counted as product acceptance.

Correcting the temporary runtime's fonts and using its normal multiprocess mode with software rendering passes the original HTTPS snapshot case and both controlled regressions (3/3), followed by **all 148 native browser cases** (1.2 minutes). The original regression remains enforced with no widened timeouts or retries. No runtime wrapper or temporary browser library is committed.

Both first published standard CI runs at implementation `64f19f7bbbd63dd8df9f3924d5a1efc9319b5b1a` pass **239 units, lint/type/build and all 148 native cases** (1.7 minutes each): [push 37642917752](https://github.com/twangyal/projects-monorepo/actions/runs/37642917752), job112865954703; [PR 37642938975](https://github.com/twangyal/projects-monorepo/actions/runs/37642938975), job112866052334. The PR checkout is `3905ec8e625ad6b67afc68530edcef64e8e97aa1`; its tree matches implementation tree `d257401045f72bb9f7d24aa72a800027dfee9ea1`. Private-link authority, editable data and independent PNG/GIF/archive assertions all remain covered. Physical devices are not claimed.
