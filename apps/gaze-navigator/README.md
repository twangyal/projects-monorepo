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
- Hold for **0.9 seconds** by default, or choose **1.5 seconds** or **2.5 seconds** with the gaze-reachable confirmation controls. The setting lasts for this page session and applies to navigation and safety controls; Escape still pauses immediately. Changing timing clears unfinished progress. A control confirms once until you leave it and return, including after a timing change. Refresh restores 0.9 seconds.
- Calibration asks for three clicks at each of nine screen positions before enabling targets.
- In camera mode, only physical pointer clicks on the dot add samples. Keyboard/synthetic clicks and clicks without a recorded eye sample do not advance calibration. Simulation permits ordinary keyboard activation.
- Resizing restarts calibration from the first point and suspends navigation and accuracy checks until it completes. Pause also pauses calibration; resume before collecting more clicks.
- Stop is available during camera startup and returns without waiting for the dependency. A pending browser permission request may still finish; its late stream is released. Simulation and camera retry remain available. Every camera restart uses a fresh estimator instance with separate video elements so old initialization or inference cannot interfere with the new session. Retired model resources are released after any active inference finishes.
- A fixed toolbar supports gaze Pause/Resume/Stop, Recalibrate, Check accuracy, and Page up/down after calibration. While paused, only Resume and Stop accept gaze; looking away before reusing Pause prevents an accidental toggle. Escape pauses navigation. During an accuracy check, gaze Pause/Stop remain available and cancel the measurement; the completed report can be closed with gaze.
- The gaze keyboard keeps Earlier keys, Later keys, case, and Close controls outside its scrolling grid. Use those controls to reach lower keys on short screens; opening another field returns to the first row.
- Session drafts have large **Open draft** controls. Reopening then **Update draft** changes that saved record without adding another copy. **Compose** reopens your current unsaved fields; **New draft** starts blank. Switching away from changed text requires the inline **Keep current composer** or **Replace composer** decision, reachable by gaze. A switch closes the gaze keyboard before replacing fields. Keep up to 20 drafts, with the existing 200-character subject and 10,000-character message limits. Previews are shortened; reopening retains the full text. Refresh clears the notebook. **Download saved drafts** explicitly keeps a local JSON backup of saved records, excluding current unsaved composer text. **Import draft backup** reveals a visible file chooser; your browser requires a mouse or keyboard to choose a file. Valid backups append up to the combined 20-draft limit without replacing current drafts or composer fields. Files are versioned and limited to 2 MiB; malformed, stale or excessive imports leave current work untouched. There is no automatic storage or sending.

## Architecture

- `index.html` — demo UI and explicit gaze targets.
- `src/app.js` — calibration, WebGazer adapter and animation-frame sampling for simulation.
- `src/resolver.js` — isolated hit testing; rejects invalid coordinates, disabled controls, and targets outside the demo.
- `src/dwell.js` — shared, deterministic dwell state machine; prevents repeated confirmations and rejects sample gaps over 250 ms.
- `tests/` — dependency-free unit and app integration tests.
- `src/text-entry.js` / `src/keyboard.js` — explicit-field gaze typing, selection replacement, backspace, case toggle, and field limits.
- `src/camera-loader.js` — camera-only CDN loading with a 15-second timeout and retry.
- `src/camera-calibration.js` — explicit dot training and in-memory estimator reset; implicit mouse training and saved calibration are disabled.
- `src/camera-cleanup.js` — explicit media-track release plus resilient dependency cleanup, including partial/late startup.
- `src/camera-retirement.js` — camera-instance DOM isolation, delayed-stream release, and safe disposal of retired model resources.
- `src/accuracy.js` / `src/accuracy-view.js` — timed held-out measurement and local result display.
- `src/workspace.js` — local sample inbox, search, selection, and session drafts.
- `src/draft-backup.js` — strict portable saved-draft format and byte/record limits.
- `src/workspace-view.js` — renders the workspace using textContent and wires ordinary click actions.
- `styles.css` — responsive presentation.
- `src/decision-contract.js` / `src/decision-fixtures.js` — bounded nearby-target decisions and a versioned synthetic task suite.
- `src/decision-evaluation.js` — cancellation-safe comparison runner, honest partial/error metrics, and strict report validation.
- `src/local-decision-model.js` — explicit, fixed-loopback local System One inference with cloud-disabled/GGUF checks.
- `decision-lab.html` / `src/decision-lab.js` / `decision-lab.css` — case inspection, model comparison, and JSON report import/export.

The navigation prototype and held-out accuracy check remain separate from the decision lab. Synthetic model comparisons can now be developed without conflating them with webcam accuracy or live action execution. Physical webcam measurements and live contextual navigation remain separate milestones.

## Decision lab

Open `http://127.0.0.1:4173/decision-lab.html` or follow **Compare target decision models** from the navigator.

The lab contains 14 author-labeled synthetic tasks: direct hits, small gaze errors, nearby ambiguity, goal context, disabled controls, missing gaze, and incompatible goals. The diagram scales a fixed 1000 × 600 task viewport. **Run baseline offline** chooses the uniquely closest enabled control within 64 task pixels, abstaining when the top distances differ by 4 pixels or less. It ignores the goal and gets 9/14 labels right; that exposes a useful context gap rather than pretending geometry is AI.

**Run local model** is optional. Install [Ollama 0.35 or newer](https://docs.ollama.com/capabilities/decision) yourself and use local-only mode. If needed, stop its currently running service/app before starting a local-only server:

```bash
OLLAMA_NO_CLOUD=1 OLLAMA_HOST=127.0.0.1:11434 ollama serve
```

In another terminal, manually download an explicit GGUF decision model:

```bash
ollama pull tev1:0.8b-q8_0
```

[Tev1 0.8B GGUF](https://ollama.com/library/tev1/tags) is approximately 812 MB; larger Tev1 or Nimble decision models may also be selected if already installed. Use a GGUF tag: the generic tags can select different platform backends, while the current System One endpoint requires GGUF. The app installs/downloads nothing. Serve/open this page from loopback; no extra CORS origins or browser-security flags are needed. On GUI/service installations, follow [Ollama's configuration instructions](https://docs.ollama.com/faq) to enable local-only mode and restart.

The adapter talks only to `http://127.0.0.1:11434`. Before inference it requires `/api/status` to report cloud disabled, verifies installed local GGUF/decision metadata and a model digest, and forces a `:local` model reference. Cloud names, remote metadata, redirects, credentials, and chat-only models are refused. Requests have a 60-second deadline and a 256-KiB response limit. Older servers without cloud status fail closed. Cancel retains completed cases and releases the interface even when a transport ignores cancellation.

The [System One request](https://docs.ollama.com/api/systemone) uses the same typed choice shape as [Jev](https://docs.typesafe.ai/primitives/choice). Only nearby enabled candidate IDs plus an abstention option are supplied. Expected labels, case IDs/titles, camera frames, real drafts, and arbitrary page content are excluded. Confidence is the model's output-concentration score, not a measured chance of correctness on gaze tasks. Mean decision time includes adapter checks/transport and is not webcam latency.

Results show every expected/observed choice alongside the latest baseline. The selected report also shows eligible agreement versus geometry, policy-only agreement, unexpected selections, errors/untested cases and reported eligible median/p95 adapter time. These values are recomputed from validated result rows, including partial/error reports; imported benchmark metadata cannot change the display. Geometry timing is explicitly unmeasured. The off-target, disabled-target, and missing-gaze cases have no eligible control, so the local adapter deterministically abstains without contacting the model or running preflight. These three rule-based successes remain in overall adapter agreement/timing, even if the other eleven cases fail. They are not model-inference evidence; per-case rows identify the missing eligible target. Overall agreement uses all 14 cases as the denominator; failed and missing cases do not improve it. Up to eight reports stay in the page; export useful results before refreshing. JSON exports include the suite version, model ID/kind/digest, timestamp, cancellation state, and per-case decision/error/time. Import rejects wrong suites, unknown/duplicate cases, invalid IDs/confidence, disabled or distant selections, and oversized files. Imported results are unverified file data. A partial external report has this shape:

```json
{
  "format": "gaze-decision-report",
  "version": 1,
  "suite": "gaze-targets-v1",
  "model": { "id": "External candidate", "kind": "external", "digest": null },
  "createdAt": "2026-10-03T00:00:00.000Z",
  "cancelled": false,
  "results": [
    { "caseId": "compose-hit", "decision": { "targetId": "t1", "confidence": 0.8 }, "elapsedMs": 42, "error": null }
  ]
}
```

The first real local Tev1 measurement is retained in [the evaluation record](docs/2026-10-03-tev1-evaluation.md) and [importable report](docs/2026-10-03-tev1-report.json): 6/11 eligible cases agree, equal to geometry, with three unexpected selections versus geometry's one and 3.22-second median adapter time. This candidate stays in the optional lab. A Jev comparison and applying context decisions to live navigation remain unverified/unimplemented. Controlled CI responses test integration boundaries separately.

### Command-line local benchmark

With the cloud-disabled loopback server and GGUF model already installed, run:

```bash
cd apps/gaze-navigator
node scripts/benchmark-local.js --model tev1:0.8b-q8_0 > decision-report.json
```

The CLI prints only one importable report to stdout; case progress goes to stderr. Import `decision-report.json` in the lab. It downloads nothing, rejects hosted model names, handles SIGINT/SIGTERM, and limits the full run to five minutes. An incomplete/error/cancelled report still prints, with a failing exit status. Wrong choices are measured results, not infrastructure failures.

The report's optional `benchmark` metadata separates all 14 cases from the eleven model-eligible cases and three policy-only cases, compares each result with geometry, and records median/p95 eligible-case adapter time. Errors and missing rows remain in their subset's denominator. Times include transport, first-call preflight and cold loading; they are not webcam latency or inference-only timing. The browser imports the ordinary report fields and does not authenticate extra benchmark metadata.

The **Gaze decision model benchmark** workflow is repeatable through GitHub Actions' **Run workflow** button. It runs only on explicit dispatch or edits to its own workflow, rather than every app change. It uses a pinned, SHA-256-verified Ollama v0.35.1 archive, temporary model storage, a verified cloud-disabled loopback server, and one explicit `tev1:0.8b-q8_0` pull. The standard public runner has a 15-minute limit and uploads no artifacts/caches. The workflow logs contain the full JSON report and runtime verification; the first actual result is recorded in [the evaluation](docs/2026-10-03-tev1-evaluation.md). The job completed on 2026-10-03; its successful exit means a complete measurement, not acceptable model quality.

## Verification

Unit and syntax checks require Node.js 20 or newer; no package installation is needed for those checks.

```bash
cd apps/gaze-navigator
npm test
npm run lint
npm run build
```

Real-browser checks additionally require Python 3 and the development dependencies:

```bash
npm ci --ignore-scripts
npx playwright install chromium
npm run test:browser
```

Playwright starts the static server and tests pointer dwell, safety controls, keyboard draft entry, multiline previews/case changes, accuracy-target visibility/report closing, resize calibration, and the decision lab at 1280×900, 390×740, 390×480, and the compact-height boundary 390×651. The lab tests use controlled local API responses for offline comparison, explicit local routing, cloud/invalid-output rejection, cancellation/retry, and safe report export/import. Its controlled clock advances actual animation frames; these are interface tests, not webcam accuracy/latency measurements. Tests reject external requests in simulation and page exceptions. The GitHub workflow runs the same checks on a standard Ubuntu runner with read-only repository access, no persistent artifact/cache uploads, and a 15-minute limit.

[CI run 37136868563](https://github.com/twangyal/projects-monorepo/actions/runs/37136868563) verified commit `8c1910b`: **55 Node tests and 48 native Chromium cases passed** (24 navigation, 24 decision lab), alongside lint/build syntax checks. The browser regression also established that all five accuracy target centers and keyboard footer controls remain reachable at the tested sizes. Local Chromium launch was blocked by the development runtime's Unix-socket restriction; native browser verification ran in CI. Physical webcam accuracy, hardware release indicators, and actual TensorFlow memory measurements remain unverified.

The static app has no compilation step; build validates JavaScript syntax, as does lint. The dependency-free tests exercise continuous dwell, target changes, tracking gaps, reset, camera-session ownership, cleanup, and simulation/calibration flows using controlled adapters. The separate Chromium suite verifies actual browser hit testing and layout. Neither suite measures physical webcam estimation.

Manual browser check: complete simulation calibration, move onto Compose once, hold still, and confirm it activates once. Leave and return to confirm again. Recalibration, leaving the document, changing tabs, scrolling, and resizing reset pending dwell; simulation requires a fresh pointer movement afterward. Camera tracking resets on missing or invalid gaze samples.

### Run record — 2026-10-03

Continued the initial prototype by fixing stationary-pointer dwell and repeated confirmations. Five automated tests and syntax validation passed locally on Node.js 24. The simulation regression test fails against the original app. No webcam/browser visual check was run, and the repository had no CI workflows or runs. Project #1 remains ACTIVE at its existing path; project #8 remains skipped.

Next: measure webcam accuracy/latency and isolate target resolution before evaluating decision models.

## Privacy and limitations

Webcam frames are processed by the browser-side WebGazer dependency; this project does not upload or persist them. Saved estimator data is disabled before camera startup, and each calibration resets only in-memory regression samples. Previous browser storage is left untouched. Pointer movement, ordinary workspace clicks, and held-out checks do not train the estimator. WebGazer's prediction overlay is hidden so it cannot cue the accuracy check. The demo loads WebGazer from a public CDN, so it needs network access on first load. Webcam gaze estimation varies significantly with lighting, camera placement, head movement, calibration quality, and individual users. This prototype is an experiment, not an assistive-device claim.


### Resolver isolation — 2026-10-03

Extracted target resolution into a separately tested module. Seven automated tests passed on Node.js 24, including nested target content, root confinement, disabled controls, invalid coordinates, and empty hits. Browser layout and webcam accuracy remain unverified.

### Working practice inbox — 2026-10-03

Compose opens a draft editor; Save draft stores text in memory for this session. Search filters sample messages by subject/body, Select cycles through results, and Scroll moves the message list. Each message and composer control supports click, keyboard activation, and gaze confirmation. Text entry supports the gaze keyboard or the user's physical keyboard/dictation tools. No messages are sent and no drafts survive refresh.

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

### Gaze text entry — 2026-10-03

Choose Type search/subject/message with gaze to open the on-screen keyboard for that explicit field. Confirm letters, digits, punctuation, Space, or Backspace; Uppercase toggles letter case. A local preview shows the edited value. Close the keyboard to reach Search or Save draft. Each key follows the same dwell/leave/re-enter rule as other controls. Physical typing and selection replacement remain available. Closing/saving a composer also closes its keyboard. Field limits are enforced and backspace does not split a Unicode surrogate pair.

Twenty automated tests and syntax checks passed, including caret insertion, selection replacement, backspace, field limits, keyboard-to-search editing, and composer keyboard cleanup. Physical webcam accuracy and small-screen keyboard usability still require browser/device checks. No browser binary was available in this execution environment.

### Camera session isolation — 2026-10-03

Camera callbacks now verify both the active mode and the exact registered handler. A regression test proved that an old callback could update the cursor after camera-to-camera restart; it is now ignored. Twenty tests and lint/build syntax checks passed. Remaining high-value work: physical browser/webcam verification, calibration quality across viewport sizes, and a decision-model/browser-controller integration.

### Browser report breakdown — 2026-10-05

The decision lab separates model-eligible results from policy-only rule abstentions,
including imported real measurements. Fresh local verification passes 61 unit and
56 native browser cases plus lint/build syntax checks. [Verification record](docs/2026-10-05-lab-metrics-verification.md)
records the tests, independent review and browser limits.

### Portable accuracy receipts — 2026-10-06

Completed held-out checks offer **Download measurement**, also reachable by gaze.
The versioned local JSON matches the displayed data and includes tracking mode,
start/completion timestamps, viewport/device pixel ratio, measurement-area bounds
and the five-target/two-second/500-ms settling protocol. Errors use CSS pixels;
sample intervals remain distinct from end-to-end latency. Missing measurements
stay null, and simulation receipts explicitly do not establish webcam accuracy.
No camera frames or raw prediction streams are included or stored. Starting or
cancelling a check disables downloading and clears the previous report. The
receipt prepares physical measurement handoff without claiming hardware acceptance.
Issue #131 tracks verification.

### Portable saved drafts — 2026-10-08

Explicit JSON backups preserve the saved notebook across refresh. Import appends
with fresh session IDs and atomic capacity validation, retaining unsaved fields
and edits made during reading. Latest file selection owns publication. Gaze can
download and reveal import controls; the browser file chooser requires ordinary
mouse/keyboard activation. No camera/calibration data or unsaved composer text
enters backups, and no automatic storage or sending is added. Full local
verification passes69 units and88 native cases across four viewport sizes, plus
lint/build. [Verification record](docs/2026-10-08-draft-backups/README.md) retains
first failures, corrections and limitations. Physical webcam acceptance remains
separate in issue132.
