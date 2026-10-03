# Gaze Navigator

A small browser-first vertical slice for project #1, **Eye detector with agentic AI**.

The current milestone deliberately isolates gaze estimation from action execution. WebGazer provides webcam-based gaze coordinates; a tiny resolver maps those coordinates only to explicit `[data-gaze-target]` controls; a dwell timer confirms the selection. No arbitrary browser clicking is implemented yet.

## Run

The demo is static, so serve this directory over HTTP (camera APIs generally require a secure context or localhost):

```bash
cd apps/gaze-navigator
python3 -m http.server 4173
```

Open `http://localhost:4173`.

- **Start camera** requests webcam access and uses WebGazer from jsDelivr.
- **Pointer simulation** runs the same target resolver/dwell logic with pointer coordinates, making the interaction testable without a webcam.
- Calibration asks for three clicks at each of nine screen positions before enabling targets.

## Architecture

- `index.html` — demo UI and explicit gaze targets.
- `src/app.js` — calibration, WebGazer adapter, target resolution, dwell confirmation, and simulation mode.
- `styles.css` — responsive presentation.

The next useful step is to collect basic accuracy/latency measurements and separate the target resolver into a testable module before introducing an AI decision model. That keeps the eventual model comparison independent from webcam estimation and browser actions.

## Privacy and limitations

Webcam frames are processed by the browser-side WebGazer dependency; this project does not upload or persist them. The demo loads WebGazer from a public CDN, so it needs network access on first load. Webcam gaze estimation varies significantly with lighting, camera placement, head movement, calibration quality, and individual users. This prototype is an experiment, not an assistive-device claim.
