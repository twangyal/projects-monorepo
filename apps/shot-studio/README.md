# Shot Studio

A local 3D filmmaking sketchbook for idea #7. Stage two block characters in a
courtyard, choose idle/wave/pace performances, adjust lighting, compose a bounded
shot list, rehearse or scrub, and export a silent WebM film. Native browser
JavaScript/WebGL: no accounts, external assets, services or paid APIs.

## Run

Requirements: Python 3 and a modern WebGL-capable browser. From this directory:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open http://127.0.0.1:4173. No npm install is needed to run. Drafts are scoped to
the browser origin/port; **Save project** downloads a JSON backup. Invalid backups
preserve the scene; failed storage reports an error. Reloading preserves the
film, not the current playhead or selected camera/performer.

## Workflow and limits

Select a performer, edit position/costume/action, adjust lighting. Compose a shot
with a preset or numeric camera/target controls. Name/time it, add/select/remove
shots, then rehearse or scrub the cut. Export WebM in real time while keeping the
tab visible. Cancel stops the encoder and capture tracks. Unsupported encoders
give guidance to save a project instead.

One courtyard, two block performers, 1–20 shots, 1–15 seconds each, **60 seconds
total**. Backups are limited to **64 KiB** with bounded names, positions, angles
and enum values. Imports never execute code or fetch media. Hard cuts; performances
use continuous film time. WebM is silent at 960 × 540, requested 30 fps, with a
browser-selected VP9/VP8 encoder. Exact timing/dropped frames depend on hardware.
No audio, skeletal assets, dialogue, generative animation, camera travel between
cuts, separate take library or immersive video export yet.

## Experimental VR

**Enter VR** requests an `immersive-vr` WebXR session with a `local-floor` reference
space and renders tracked stereo headset views of the actual 3D stage. Select the
floor marker with a tracked controller to place the desktop-selected performer.
Authored performances animate while viewing the set. Exit via
the headset/browser session control; desktop editing is available afterwards.

Requires supported hardware/browser and a secure context (HTTPS or trusted local
development); a LAN HTTP address is insufficient. No camera permission is requested.
Rejected/unavailable sessions retain desktop access; setup failures end accepted
sessions. Controlled tests **do not** establish device compatibility, comfort,
tracking quality or controller accuracy. Physical headset verification is outstanding;
desktop CI does not complete the intended VR directing experience. Reference:
[WebXR startup/shutdown](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Startup_and_shutdown).

## Verify

Node 22+. Domain/math and controlled lifecycle checks need no dependencies:

```sh
npm test
npm run check
```

Browser verification requires Chromium and FFprobe (FFmpeg):

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:browser
```

CI checks real WebGL pixels, desktop/mobile controls, persistence, invalid imports,
unavailable VR and an actual WebM export decoded by FFprobe. Controlled unit checks
cover encoder failure/cancellation and XR unavailability/setup failure. Actual VR
requires a device. Current evidence: 13 local unit tests and syntax checks pass; four Chromium browser checks passed
on the desktop lifecycle fix, including independently decoded video timestamps
and changing frames. The workflow repeats these checks for subsequent edits.
CI screenshots were reviewed at desktop and mobile sizes. Page restoration is
covered using controlled page lifecycle events; physical headset tests remain outstanding.

`model.js` validates snapshots/cuts/performances; `math.js` owns column-major camera
transforms; `renderer.js` draws native WebGL; `xr.js` manages immersive views and
controller floor hits; `export.js` owns recording/cleanup; `app.js` manages DOM
state, local drafts and imports.
