# Gaze stabilization and nearby-target assist — issue #137

Live navigation previously confirmed only exact hits on raw estimator output, so
webcam jitter across a control's edge restarted the hold. Two separate modules now
sit between estimation and the dwell state machine:

- `src/gaze-filter.js` applies an adaptive One Euro filter (min cutoff 1 Hz,
  beta 0.005, derivative cutoff 1 Hz) to **camera samples only**. It restarts from
  the raw sample after a gap over 250 ms, a clock reversal, invalid input, scroll,
  resize, pause/resume, recalibration and every tracking reset. Pointer simulation
  keeps exact coordinates. Held-out accuracy checks still sample raw predictions,
  so receipts measure the estimator rather than the stabilizer.
- `src/target-assist.js` keeps exact hits first. Otherwise it chooses the uniquely
  closest enabled, visible and unobscured gaze target within 48 px (Standard,
  default) or 96 px (Wide). It abstains when the two closest are within one sixth
  of the radius of each other, and keeps the current target while gaze stays
  within an extra quarter radius and is not clearly closer to another control. A
  direct hit on an ineligible control never falls back to a neighbor.

Safety boundaries: assisted targets need the full hold and show a dashed amber
outline; an ambiguous point shows a dashed cursor and confirms nothing. While
paused, only Resume and Stop are eligible even when another control is closer.
During held-out checks assist is disabled so a measurement dot near the toolbar
cannot cancel the measurement. Settings are gaze-reachable session state; refresh
restores Standard.

Verification on 2026-10-07 (Node.js 22.22.0, Playwright 1.63.0 with the
environment's preinstalled Chromium 141.0.7390.37):

- `npm test`: 79 passing tests. New domain tests cover filter jitter reduction,
  saccade convergence, resets, rectangle distance, radius bounds, ambiguity,
  disabled/hidden/ineligible/covered targets and hysteresis. Four app-level camera
  tests were confirmed to fail when smoothing, assist or paused eligibility is
  removed.
- `npm run lint` / `npm run build`: syntax checks pass.
- Native Chromium: all 84 cases pass at 1280×900, 390×740, 390×480 and 390×651,
  including new assisted-confirmation, Assist-off and ambiguity-abstention flows.
  Existing tests now look away at the visible point farthest from every control,
  because the old fixed corner is within assist range of the narrow toolbar.

Limits: filter constants and radii are reasoned defaults, not tuned on physical
webcam data. Whether they reduce missed or accidental confirmations for real users
remains part of physical verification (#132).
