# Gaze Navigator

A small browser-first vertical slice for project #1, **Eye detector with agentic AI**.

The current milestone deliberately isolates gaze estimation from action execution. WebGazer provides webcam-based gaze coordinates; a tiny resolver maps those coordinates only to explicit `[data-gaze-target]` controls; a dwell timer confirms the selection and invokes the same local action as a normal click. No arbitrary browser clicking is implemented yet.

## Run

The demo is static, so serve this directory over HTTP (camera APIs generally require a secure context or localhost):

```bash
cd apps/gaze-navigator
python3 -m http.server 4173
```

Open `http://localhost:4173`.

- **Start camera** requests webcam access and loads WebGazer from jsDelivr on demand.
- **Pointer simulation** runs the same target resolver/dwell logic with pointer coordinates, making the interaction testable without a webcam.
- Hold a pointer still for 0.9 seconds to confirm. A control confirms once until you leave it and return.
- Calibration asks for three clicks at each of nine screen positions before enabling targets.

## Architecture

- `index.html` — demo UI and explicit gaze targets.
- `src/app.js` — calibration, WebGazer adapter and animation-frame sampling for simulation.
- `src/resolver.js` — isolated hit testing; rejects invalid coordinates, disabled controls, and targets outside the demo.
- `src/dwell.js` — shared, deterministic dwell state machine; prevents repeated confirmations and rejects sample gaps over 250 ms.
- `tests/` — dependency-free unit and app integration tests.
- `src/camera-loader.js` — camera-only CDN loading with a 15-second timeout and retry.
- `src/accuracy.js` / `src/accuracy-view.js` — timed held-out measurement and local result display.
- `src/workspace.js` — local sample inbox, search, selection, and session drafts.
- `src/workspace-view.js` — renders the workspace using textContent and wires ordinary click actions.
- `styles.css` — responsive presentation.

The target resolver and a held-out accuracy check are now implemented. The next useful step is to collect physical webcam measurements before introducing an AI decision model. That keeps the eventual model comparison independent from webcam estimation and browser actions.

## Verification

Requires Node.js 20 or newer; no package installation is needed.

```bash
cd apps/gaze-navigator
npm test
npm run lint
npm run build
```

The static app has no compilation step; build validates JavaScript syntax, as does lint. Tests exercise continuous dwell, target changes, tracking gaps, reset, and the simulation/calibration flow using a small DOM/event harness. They do not verify browser layout or webcam estimation.

Manual browser check: complete simulation calibration, move onto Compose once, hold still, and confirm it activates once. Leave and return to confirm again. Recalibration, leaving the document, changing tabs, scrolling, and resizing reset pending dwell; simulation requires a fresh pointer movement afterward. Camera tracking resets on missing or invalid gaze samples.

### Run record — 2026-10-03

Continued the initial prototype by fixing stationary-pointer dwell and repeated confirmations. Five automated tests and syntax validation passed locally on Node.js 24. The simulation regression test fails against the original app. No webcam/browser visual check was run, and the repository had no CI workflows or runs. Project #1 remains ACTIVE at its existing path; project #8 remains skipped.

Next: measure webcam accuracy/latency and isolate target resolution before evaluating decision models.

## Privacy and limitations

Webcam frames are processed by the browser-side WebGazer dependency; this project does not upload or persist them. The demo loads WebGazer from a public CDN, so it needs network access on first load. Webcam gaze estimation varies significantly with lighting, camera placement, head movement, calibration quality, and individual users. This prototype is an experiment, not an assistive-device claim.


### Resolver isolation — 2026-10-03

Extracted target resolution into a separately tested module. Seven automated tests passed on Node.js 24, including nested target content, root confinement, disabled controls, invalid coordinates, and empty hits. Browser layout and webcam accuracy remain unverified.

### Working practice inbox — 2026-10-03

Compose opens a draft editor; Save draft stores text in memory for this session. Search filters sample messages by subject/body, Select cycles through results, and Scroll moves the message list. Each message and composer control supports click, keyboard activation, and gaze confirmation. Text entry still requires a keyboard or the user's existing dictation/input tools. No messages are sent and no drafts survive refresh.

Nine automated tests passed, including search/selection, draft validation and detached snapshots, and the complete simulated gaze-to-composer path. Lint/build validate syntax only. No browser visual or webcam check was performed. Layout-changing actions clear pending dwell and require fresh pointer movement in simulation.

Next: provide a held-out accuracy check with local measurement results, then separate camera lifecycle controls and evaluate decision models. Project #1 remains ACTIVE: arbitrary browser control and AI decision-making are still absent.

### Tracking lifecycle — 2026-10-03

Pause clears dwell and suspends navigation; Resume starts fresh. Pause leaves the camera running. Stop tracking calls WebGazer's listener cleanup/end methods, cancels simulation frames, removes pointer listeners, and enables choosing another mode. Restart requires calibration again. Camera startup failure also cleans up before permitting retry; camera controls become available once startup resolves. Late camera callbacks are ignored in other modes. Ten automated tests passed; camera tests use an adapter harness and do not establish physical webcam release or accuracy.

### Held-out measurement — 2026-10-03

After calibration, choose Check accuracy. Look at each of five numbered targets without clicking; each stays for two seconds and samples from its first 500 ms are discarded. Navigation is suspended, the gaze cursor is hidden, and these targets do not intentionally train the estimator. The result shows mean/median/90th-percentile pixel error, per-target sample counts, and mean within-target sample interval. Local JSON can be copied from the results. Simulation is explicitly labeled and cannot establish webcam accuracy. Sample interval is not end-to-end latency. Missing samples produce unavailable metrics rather than a perfect score. Scrolling, resizing, pausing, stopping, tab changes, and missing camera data cancel an active check; close the result panel to return to the inbox.

Fourteen automated tests and syntax checks passed on Node.js 24, covering known distances, settling exclusion, empty samples, invalid clocks, completion/cancellation, and existing navigation flows. No physical webcam measurement or browser visual check was run. The current check covers its visible panel, not the whole screen; pixel errors depend on viewport and setup. Next: collect real measurements and evaluate a decision-model adapter against the deterministic resolver.

### Camera dependency isolation — 2026-10-03

Pointer simulation no longer waits for WebGazer or contacts its CDN. Start camera loads the pinned library on demand; load failure or a 15-second timeout restores the mode controls for retry/simulation. Sixteen automated tests and syntax checks passed, including deferred loading, shared pending requests, failures, timeouts, and retry. Webcam permission prompts are browser-managed and are not subject to the library-loading timeout.

### Action confirmation regression — 2026-10-03

Action-driven layout resets and scroll events now clear pending dwell while preserving an already confirmed target until gaze leaves it. This prevents continuously looking at Compose or Scroll from repeatedly invoking it after its own UI change. A camera-adapter regression reproduced three confirmations before the fix and one afterward; the scroll-event case also failed before the fix. Seventeen automated tests and syntax checks passed.
