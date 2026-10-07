# Playback startup clock repair (#136)

## First failure and cause

At source `7e316fb5d71fe8100f840a126fd574b7f144aa17`, [PR Motion CI](https://github.com/twangyal/projects-monorepo/actions/runs/37607029119) passes 237 units and 145 native cases, but snapshot playback remains at frame zero. The first trace records `Render frame must be within the project timeline.` A delivered rAF timestamp can precede the `performance.now()` reading in the play handler. Flooring negative elapsed time produces frame −1; rendering throws before scheduling another callback. The editor uses the same calculation. This is a production clock-ordering defect.

Artifact 11474499786 (`motion-studio-browser-results`) has SHA256 `b29cc1d239ce320de46cc4ef39b5ad2a12c636453ab5745e617b5836cce39bb5`. Raw traces contain ephemeral private-link capabilities and are deliberately excluded; only this sanitized error and artifact provenance are recorded.

## Repair and validation

Both playback paths use nonnegative elapsed time; their existing endpoint and editor loop arithmetic remain unchanged. Removing the clamp makes the unit regression fail with actual −1 versus expected 0. Fresh full `npm run check` passes 239 unit tests, lint, type checking and production build on Node 24.19.0. Independent code review finds no blocking defect.

Two browser regressions deliver a controlled earlier timestamp on the first real native callback, then forward all later native timestamps unchanged. They require visible frame advancement, explicit pause, no page errors and unchanged authored project/library data. This controlled reproduction is not a hardware performance claim or a production clock replacement. Existing PNG/GIF/archive/HTTPS assertions are retained.

Local alternate Chromium 153 initially crashes before navigation (ANGLE/Vulkan; subsequently font configuration). Native acceptance and published CI remain pending at this checkpoint; unit/build results do not establish browser acceptance. No runtime wrapper or temporary browser library is committed.
