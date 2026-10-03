# Eye detector implementation plan

**Goal:** Deliver a local webcam and simulation browser navigation demo.
**Architecture:** Pure calibration and decision modules feed a browser controller;
the tracker owns camera/model lifecycle and the workspace owns allowed actions.
**Stack:** TypeScript, Vite, MediaPipe Face Mesh, Vitest, ESLint, Playwright.
**Spec:** `docs/superpowers/specs/2026-10-02-eye-detector-design.md`.
**Execution:** Implement in this session on `feat/eye-detector`, following the
repository's autonomous workflow, and commit/push after verification.

## Constraints and review focus

- Local assets and processing; no credentials or paid APIs.
- No action without explicit confirmation; expired, hidden, and disabled targets
  must be rejected and recommendations cleared on signal loss.
- Reject invalid/degenerate calibration; viewport changes require recalibration.
- Camera denial, stopping during startup, and hidden tabs release resources.
- No camera or microphone requirement for simulation; mobile must remain usable.

## Tasks

1. Establish isolated development/build/lint/test commands. Write failing tests
   for `fitCalibration`, `predictGaze`, `eyeFeatures`, `chooseTarget`, and
   `DwellSelector`; verify missing implementations fail. Implement finite input
   validation, regularized fitting, proximity/ambiguity rejection, dwell/expiry,
   and run the unit suite.
2. Write browser acceptance tests before the UI. Build the demo workspace,
   controller, local camera tracker, nine-point calibration, explicit confirmation,
   keyboard and optional voice controls, status and action log. Verify simulation
   selects without acting, confirms once, scrolls, pauses, and camera denial recovers.
3. Run lint, unit tests, build, and Chromium acceptance tests. Inspect desktop and
   mobile screenshots and locally bundled model requests. Review the complete diff
   and fix material problems. Document setup, architecture, limitations, and
   next work. Set backlog path and status to ACTIVE; add the root app index.
4. Commit the complete verified slice with a clear message, push the feature
   branch, and verify that the remote commit matches the local commit.

## Implementation record

The initial slice is implemented. Independent code review identified mobile
confirmation reachability and loss of reading position when saving; both have
regression coverage and are fixed. Occluded targets are also rejected before
confirmation. The local model initializes and processes synthetic camera frames.

`CHROMIUM_PATH=/usr/bin/chromium npm run verify` passed: lint/strict types,
11 unit tests, production build, and 10 Chromium acceptance tests.
`npm audit` reported zero vulnerabilities. Desktop/mobile screenshots showed
no runtime errors or horizontal overflow. Physical-camera gaze accuracy is
unverified, and the decision component remains a local deterministic baseline.
