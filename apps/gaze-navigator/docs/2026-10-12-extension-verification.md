# Spoken gaze navigation on real websites — issue #205

## Intended outcome and gap

The direction's success measure is useful tasks on real websites. After #203
and #204 the spoken gaze runtime ran only on the bundled practice site.

## What changed

- `extension/`: an MV3 manifest, a background worker, a content toggle and a
  toolbar popup. `scripts/build-extension.js` assembles `dist/extension` from
  the same `src/web` and shared camera modules the practice site uses.
- WebGazer 3.3.0 is fetched with `npm pack` (registry integrity), pinned again by
  SHA-256 `fdf7ed07…89e3`, cached under `dist/.cache`, and bundled because MV3
  forbids remote code. It was not added as an npm dependency: that would have
  pulled ~1,000 lockfile lines of TensorFlow tooling and audit warnings for a
  single prebuilt file.
- Least privilege by default: `activeTab`, `scripting`, `storage`.
  `<all_urls>` is optional and requested from the popup only when the user
  chooses to stay on across navigations or start everywhere. Without that
  access, a navigation marks the badge `OFF` instead of failing silently.
- The overlay now takes a settings `store`, and the extension uses
  `chrome.storage.session`, so nothing is written to website storage. Styles
  use constructable stylesheets so strict page CSPs cannot remove them. The
  estimator loads into the isolated world through the background worker.
- Stopping removes the overlay and spacer, releases the camera and stops
  speech recognition.

## Verification (2026-10-12, local)

Node.js 22.22.0, Playwright 1.63.0, preinstalled Chromium 141.0.7390.37. The
production build fetched and verified WebGazer through the environment's npm
proxy.

- `npm test`: 117 passing. `npm run build`: syntax check plus the test
  extension build.
- Native Chromium: all 152 cases pass at four viewports. The 16 extension cases
  load the real built test extension into a persistent profile. They cover
  auto-start on a strict-CSP third-party page with no navigator code; an
  instruction that navigates, followed by automatic re-injection and an arrival
  announcement; empty website `sessionStorage`/`localStorage`; navigator globals
  invisible to the page; per-tab on/off with persistence only while enabled;
  removal of overlay and spacer; a clear error on `chrome://version`; and camera
  mode. Camera mode injects the bundled estimator (a fake in the test build) into
  the isolated world, keeps `window.webgazer` absent from the page, completes
  no-click calibration in real time, uses isolated-world gaze to select context,
  and releases the estimator on "stop camera".

A defect found and fixed during this work: `use_dynamic_url` made the boot
module's relative imports resolve to the blocked static extension URL. Resources
now use static URLs, so websites can detect that the extension is installed.

## Not established

- Real websites beyond the routed fixture: their DOM variety, iframes,
  shadow-DOM widgets and framework-managed controls.
- The toolbar popup and keyboard shortcut themselves. Automated browsers cannot
  click extension UI or permission prompts, so tests drive the same background
  messages and a test build with host access granted.
- Real camera, microphone and speech services, and intended-user evaluation
  (#132). Per-page recalibration effort remains a known usability gap.
