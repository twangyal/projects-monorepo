# Calibration that follows navigation — issue #208

## Gap

In the extension, camera mode restarted on every page load, and WebGazer's
training data was lost with the page. Users had to look at nine dots again
(about 17 s) after every link or back navigation, which made multi-page tasks
on real sites impractical.

## Changes

- `src/web/calibration-store.js` encodes WebGazer ridge-regression training
  samples into JSON-safe data, with each eye patch as base64 RGBA. Malformed
  samples are dropped. Decoding returns `setData()` input only when the version,
  viewport size and age (≤ 2 h) match. Otherwise it gives a reason: `none`,
  `resized`, `expired` or `invalid`.
- The overlay saves a calibration after success and, on camera start, restores
  it through the regression's `setData`. It says so ("Camera on with your
  earlier calibration…"), and it says when a resize forces recalibration.
  Switching to the pointer or stopping the camera deletes the saved
  calibration. A page unload keeps it.
- A deliberate source switch now detaches the running calibration before
  cancelling it. Previously "stop camera" during calibration showed "Calibration
  stopped… say recalibrate", which overwrote "Camera off". The new test found
  this.
- The extension store uses `chrome.storage.session` (memory only, unreachable
  from websites). The practice site has no calibration store, so eye-patch data
  is never written to website session storage.

The format matches WebGazer 3.3.0's bundled code: `RidgeReg.prototype.getData`
returns `dataClicks.data`, and `setData` rebuilds `ImageData` from
`eyes.{left,right}.patch.data`, `width` and `height`.

## Verification (2026-10-12, local)

`npm test` passes 120 tests, including 3 encode/decode tests for round trips,
malformed-sample dropping and the reuse rules. `npm run build` passes (71
files). All 160 native Chromium cases pass at four viewports.

The new extension case runs this sequence:

1. Calibrate. 36 samples are stored in extension session storage, and website
   storage stays empty.
2. Navigate. The fake estimator receives exactly 36 restored samples, and no
   calibration dots appear.
3. Resize the window and navigate again. Recalibration starts with an
   explanation.
4. Say "stop camera". The stored calibration is deleted.

## Not established

Accuracy of a restored calibration under real head movement or after time has
passed, with a physical webcam (#132). The two-hour and same-viewport rules are
conservative defaults, not measured thresholds.
