# Look — eye detector

A usable first slice of the eye-controlled browser assistant: local webcam gaze
estimation, nine-point calibration, explained target suggestions, and explicit
confirmation inside a small reading workspace. Try simulation without a webcam.

## Run

Requires **Node.js 24+** and npm. Use a recent desktop Chromium
browser for the webcam demo; camera permissions require localhost or HTTPS.

```sh
cd apps/eye-detector
npm ci
npm run dev
```

Open the URL Vite prints, normally `http://localhost:5173`. No accounts, API keys,
backend, or paid services are needed. The model assets are copied from the pinned
MediaPipe npm package before development and production builds; there are no
runtime model downloads from third-party hosts. The assets add about 17 MB to the
static build and are intentionally excluded from Git.

```sh
npm run build
npm run preview
```

Deploy the contents of `dist/` to any static HTTPS host. Camera and voice access
must be permitted by the host/browser. The default build targets the origin root.
For a subdirectory deployment, build with Vite's `--base` option and verify both
the application and `/vision/` asset URLs.

## Try it

1. Choose **Try simulation**. Move your pointer over a workspace control and hold
   for 0.9 seconds. The assistant highlights the target and explains the choice.
2. Press **Enter** or **Space**, or click **Confirm action**. Merely highlighting
   a target never activates it. Open an article, save it, and use the scroll
   controls. Normal mouse and keyboard browsing also work.
3. For actual eye navigation, choose **Start webcam**, allow access, and choose
   **Calibrate gaze**. Sit facing the camera in good light, keep your head still,
   and follow each of the nine dots. Each captures 24 observations after a settling
   period. Recording waits if the face/open eyes are not detected.
4. Look toward a workspace control. Hold until the suggestion is ready, then
   confirm. Optional voice confirmation recognizes exactly **“confirm”** where
   browser speech recognition is supported. Initial camera/calibration/voice
   setup uses the ordinary controls; hands-free operation starts after setup.
5. **Pause** or **Escape** stops the assistant. Changing modes, hiding the tab, or
   leaving the page also stops camera and microphone resources. A viewport resize
   requires a new calibration. After pausing, start and calibrate again.

The simulation pointer is a test input, not an eye detector. If it leaves the
workspace, the last suggestion expires after 1.2 seconds; this short grace period
lets you move to the confirm button. Camera signals expire after 0.6 seconds.
Tracking loss immediately clears the suggestion. Disabled, hidden, offscreen,
occluded, ambiguous, or changed targets are not confirmed. Keyboard shortcuts respect focus
on ordinary buttons, links, and inputs.

On small/mobile screens, confirmation floats within reach while the assistant is
active, and normal reading controls remain usable. A desktop
window is recommended for gaze navigation so the assistant and workspace can be
seen together. Saves and session history are in memory and reset on reload.

## Privacy and limits

- Webcam frames, eye features, and calibration samples stay in browser memory.
  There is no image upload, analytics, server, or persistent recording.
- Optional speech recognition may transmit audio to the browser vendor's service.
  Its disclosure appears before enabling the checkbox. It is off by default and
  may need a network connection or stop when the browser ends a session.
- This is an approximate portfolio prototype. Webcam quality, lighting, glasses,
  posture, and head movement affect accuracy. It is not a validated accessibility
  aid or medical device. A low **training fit error** measures how closely the
  regression fits the calibration samples, not independent real-world accuracy.
- Control is limited to buttons inside the practice workspace. There is no OS
  mouse injection, extension, or control over other browser tabs.
- The decision component is a transparent deterministic baseline, **not an LLM**.
  Jev and an open-source decision model have not yet been integrated or compared.

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/tracker.ts` | Own webcam/model lifecycle; extract refined Face Mesh eye landmarks locally |
| `src/calibration.ts` | Normalize iris positions, fit regularized regression, predict normalized gaze |
| `src/decision.ts` | Rank visible controls by proximity, reject ambiguous choices, require stable dwell |
| `src/actions.ts` | Discover allowed workspace buttons; revalidate before a confirmed click |
| `src/workspace.ts` | Reading, category selection, in-session saves, and article scrolling |
| `src/voice.ts` | Optional explicit voice confirmation and microphone lifecycle |
| `src/main.ts` | Session state, calibration UI, signal freshness, confirmations, and history |

Calibration uses mean/scale-normalized eye and face-position features, an affine
mapping with ridge regularization, and a training-error rejection threshold.
The local decision baseline uses distance to the target bounds, a small center
distance penalty, a 72-pixel proximity limit, and an 18-pixel ambiguity margin.
Gaze prediction is smoothed; input estimation, selection, and control boundaries
are kept separate so future experiments can replace one component at a time.

## Verification

```sh
npm run lint        # ESLint and strict TypeScript
npm test            # calibration and decision unit tests
npm run build       # local assets, type check, production build
npx playwright install chromium
npm run test:e2e    # tests against the production preview
npm run verify      # all of the above checks (browser must already be installed)
```

With an existing system Chromium, skip the browser download:

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run verify
```

The browser suite verifies simulation selection and confirmation, navigation,
saving/scrolling, stale-target rejection, pause/tab-hide behavior, camera-denial
recovery, late-stream cancellation, mobile layout, and **real locally served
MediaPipe initialization/inference** using Chromium's synthetic camera. This
establishes integration, not physical gaze accuracy. Test real gaze quality on a
webcam before making reliability claims.

## Next work

- Collect independent validation points after calibration and measure target
  selection success across users, lighting, head movement, and eyewear.
- Compare Jev and an open-source model against the local target-selection
  baseline on the same replayable tasks, with latency and error measurements.
- Add a browser extension/adapter with a reviewed permission and confirmation
  model to navigate real pages beyond the practice workspace.
- Tune gaze stability and calibration from actual webcam sessions; add recorded
  landmark fixtures without recording identifiable camera frames.

MediaPipe Face Mesh is distributed under Apache-2.0 by its upstream package; its
notice and license are included in `public/mediapipe-NOTICE.txt`. The
dependency and all transitive build/test dependencies are pinned by the lockfile.
