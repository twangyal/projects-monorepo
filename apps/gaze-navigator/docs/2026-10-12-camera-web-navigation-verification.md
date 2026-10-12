# Camera gaze for spoken web navigation — issue #204

## Intended outcome and gap

The product is driven by gaze, but the spoken runtime from #203 followed only the
pointer. The existing dwell prototype's calibration also requires a trusted
mouse click on every dot, which the intended users may not be able to do.

## What changed

- `src/web/camera-gaze.js` owns one WebGazer session. It keeps estimator data
  session-only, hides the prediction overlay and turns off mouse training. It
  forwards only finite predictions while ready and reports lost tracking. Stop is
  safe during loading or `begin()`, and a stream that arrives late is released
  through the existing retirement module. A restart after a started estimator
  requests a fresh instance.
- `src/web/calibration.js` is no-click calibration. Each of nine dots gets a
  0.9 s settle period, then four samples 250 ms apart. A sample counts only when
  the estimator's training data actually grows, meaning eye features were
  present. A dot needs two accepted samples and is retried once. Calibration
  fails with guidance if fewer than seven dots are learned. Cancel rejects the
  pending wait immediately.
- `src/camera-calibration.js` exposes `recordCalibrationSample`. The click
  calibration in the dwell prototype now uses the same acceptance check.
- The overlay adds Pointer/Camera/Recalibrate controls and the spoken commands
  "use camera", "stop camera", "use pointer" and "recalibrate". These stay
  available while paused, because turning the camera off is a privacy action.
  While calibrating, the circle and outlines are hidden and instructions cannot
  target page elements. Spoken or button cancel/pause stops calibration. Camera
  samples use the One Euro filter, and gaze on the panel freezes the page
  context. Camera mode continues after navigation and recalibrates on the new
  page. `pagehide` releases the camera.

## Verification (2026-10-12, local)

Node.js 22.22.0, Playwright 1.63.0, preinstalled Chromium 141.0.7390.37.

- `npm test`: 117 passing. The new camera suite covers configuration, gaze
  forwarding, late callbacks, cancel during load and `begin()`, late-stream
  release, fresh-instance requests and startup failure. Calibration is checked
  for settle timing, sample positions, retries, failure thresholds and
  cancellation, using a manual clock. Interpreter and controller cover tracking
  commands while paused.
- `npm run lint`: 65 files.
- Native Chromium: all 136 cases pass at four viewports. The 12 new cases run a
  fake WebGazer and a paused page clock. They cover no-click calibration with no
  samples during settling, the real pointer being ignored in camera mode, gaze
  selecting a dropdown that is then set by instruction, camera mode recalibrating
  after navigation, "stop camera" releasing the estimator, hidden-face retries and
  failure, and cancelling a rerun.

Defects found by these tests and fixed: the cancellation promise resolved with
itself; the generic calibration message overwrote the first dot instruction; and
the retry explanation was immediately replaced by the next attempt's instruction.

## Not established

Real webcam tracking with WebGazer's face models. tfhub.dev is blocked by this
environment's network policy, so camera accuracy, calibration success rates,
the effort of recalibrating each page, and real permission prompts remain
physical checks (#132).
