# Gaze Navigator

Operate real websites by looking and speaking. It is for people who find a mouse or keyboard hard to use. A context circle follows your gaze (or the pointer). You say or type what to do, and the navigator acts on the controls inside the circle. It asks when the target is unclear and asks you to confirm consequential actions. The main product is a Chrome (Manifest V3) extension. The website in this folder covers setup, practice and developer labs.

**Status:** ACTIVE — portfolio priority. Direction: [docs/PRODUCT_DIRECTION.md](../../docs/PRODUCT_DIRECTION.md)

## What works today

- **Chrome extension** that runs on the page you are viewing. Turn it on from the toolbar popup or with the suggested shortcut <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>. Two optional settings ask for access to all websites: keep it on in the tab when pages change, and start it automatically on every site.
- **Context circle** driven by the pointer or by webcam gaze (WebGazer). Camera mode uses a nine-dot calibration that needs no clicks, plus One Euro smoothing. In the extension, a calibration is reused on later pages for up to two hours, as long as the window size stays the same.
- **Control discovery** inside the circle: links, buttons, fields, dropdowns, checkboxes and ARIA widgets get numbered outlines. Discovery also reaches open shadow roots, same-origin iframes and script-only clickables that set a pointer cursor. Cross-origin frames are listed as unreachable.
- **Spoken or typed instructions** through the browser's Web Speech API, or through a typed instruction box. Context is captured when you start speaking. <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> opens command entry while the page keeps its focus.
- **Navigation**: open or click by name or ordinal ("the second one"), scroll the page or a scrolling region, go back or forward, search the page's search field, and submit.
- **Dictation and correction** in text fields: type, replace a word, delete the last word, select text or a specific occurrence, insert at the cursor, delete the selection, and undo per field.
- **Native form controls**: dropdowns, adding or removing a single multi-select option, checkboxes and switches, radios, website tabs, expand/collapse disclosures, sliders, and number, date, time, month and week fields. Values can be spoken naturally ("set departure to November first", "set appointment time to 2:30 pm", "set guests to four") or given as digits. Value commands have their own undo. Read-only, disabled and changed controls are refused rather than forced.
- **Safety**: equally plausible targets get a numbered "Which one?" question. Submits, downloads and controls named like delete/buy/pay/send/sign out need **confirm**, which expires after 15 seconds. "Pause", "cancel" and "stop" act on the interim transcript. Links with non-web schemes such as `javascript:` are never opened.
- **Smarter target matching (optional)**: on-device [WaterSheep](https://github.com/SamratDuttaOfficial/WaterSheep) runs through ONNX Runtime Web. The rules answer first. The model is asked only when the rules cannot name a control. It sees control roles and names, never field values or page text.
- **Practice site** (`practice-site/`): a fictional bookshop with no gaze annotations, where the navigator runs without the extension. There is also an **extension setup guide** (`extension-setup.html`).
- **Dwell lab** (`index.html`): WebGazer dwell selection in a practice inbox, with nearby-target assist, a gaze keyboard, session drafts with JSON backup, and a held-out accuracy check whose measurement you can download.
- **Decision lab** (`decision-lab.html`): compares a geometric nearby-target baseline with an optional local Ollama model on a synthetic task suite, with JSON report import and export.

## Known gaps

- The real end-to-end loop has not been evaluated with intended users: physical webcam gaze plus a real microphone on representative sites. Webcam accuracy, latency and calibration continuity in physical use are unmeasured.
- On real sites, the pointer has stood in for gaze and typed text for speech so far. With simulated webcam error (120 px), scripted tasks drop to about half completed; a control just outside the circle is refused rather than offered.
- WaterSheep matching is opt-in and only chooses targets. It needs a model download of about 158 MB on first use. The rule interpreter still misses many paraphrases; those end in a question or an explanation, not an action.
- Custom ARIA comboboxes, listboxes, sliders and spinbuttons and cross-origin iframes are not controlled. Rich-text editors get dictation and word replacement, but not selection commands.
- Spoken commands are English only. In Chrome, speech recognition depends on the browser vendor's service.
- Chrome is the only supported browser. There is no store listing; install the unpacked build. Protected pages (`chrome://`, the Web Store) cannot be controlled.
- The decision lab's Ollama path is a separate experiment and is not connected to live navigation.

## Run locally

Prerequisites: Node.js 20 or newer (CI uses 24), npm, Python 3 (for the static server) and Chrome 116+.

```sh
cd apps/gaze-navigator
npm ci --ignore-scripts
python3 -m http.server 4173
```

Open `http://localhost:4173` for the landing page, dwell lab and links to the labs. The practice site is at `http://localhost:4173/practice-site/index.html`. Camera APIs need localhost or HTTPS.

**Extension.** `npm run build:extension` writes `dist/extension`. It fetches WebGazer 3.3.0 and the WaterSheep browser runtime with npm and checks each against a pinned SHA-256. Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked** and select `apps/gaze-navigator/dist/extension`. Review shortcuts at `chrome://extensions/shortcuts`. Leave the extension off on the practice site, or you will get two panels.

**WaterSheep (smarter matching).**
- *Extension:* the runtime is bundled. The model downloads from Hugging Face the first time you enable the setting. It is pinned to a revision and checked by SHA-256.
- *Practice site:* run `npm run vendor:watersheep` once. This writes the runtime to `dist/vendor/watersheep`, then enable **Smarter target matching** under **Tracking and settings**.
- *Developer evaluation:* `npm run evaluate:instructions -- --watersheep DIR` scores a local model copy against the instruction suites. It needs `npm install --no-save onnxruntime-node@1.23.0 @huggingface/tokenizers@0.2.0`.

**Decision lab with a local model (optional).** Install Ollama 0.35+ yourself and run it local-only:

```sh
OLLAMA_NO_CLOUD=1 OLLAMA_HOST=127.0.0.1:11434 ollama serve
ollama pull tev1:0.8b-q8_0        # about 812 MB; any GGUF decision model works
npm run benchmark:local -- --model tev1:0.8b-q8_0 > decision-report.json
```

The lab talks only to `127.0.0.1:11434` and refuses to run unless the server reports cloud disabled. The app never downloads models. An example report for import is at `browser-tests/fixtures/tev1-report.json`.

## Verify

```sh
npm test                 # Node unit tests (node --test)
npm run lint             # syntax check of every JavaScript file
npm run build            # lint + test build of the extension (dist/extension-test)
npx playwright install chromium
npm run test:browser     # Playwright: dwell lab, practice site, decision lab, extension
```

Browser tests start `python3 -m http.server` on port 4173 themselves. They use a fake speech recognizer and a fake gaze estimator, so they check interface behaviour, not webcam accuracy. CI: `.github/workflows/gaze-navigator.yml`. The manual-dispatch `.github/workflows/gaze-decision-benchmark.yml` runs the Ollama benchmark. `node scripts/evaluate-real-sites.mjs --extension dist/extension-test [--assist] [--gaze-error 120 --trials 3]` drives a built extension through scripted tasks on live public sites; `--gaze-error` adds webcam-like pointing error (standard deviation in pixels) and reports completion, unintended actions and questions.

## Project layout

- `extension/`: MV3 manifest, service worker, popup, content script and the offscreen page that hosts the model.
- `scripts/build-extension.js`: assembles `dist/extension` (or `dist/extension-test` with `--test`).
- `src/web/`: navigation runtime. Context capture (`page-context.js`), rule interpreter (`interpreter.js`), WaterSheep assist (`assisted-interpreter.js`, `watersheep*.js`), controller, page actions, speech, camera gaze, calibration, overlay. `boot.js` starts the practice site and `extension-boot.js` starts the extension.
- `practice-site/`: unannotated practice website.
- `index.html`, `src/*.js`: dwell lab (resolver, dwell, gaze filter, target assist, keyboard, workspace, accuracy check).
- `decision-lab.html`, `src/decision-*.js`, `src/local-decision-model.js`: decision lab and local-model adapter.
- `scripts/`: syntax check, instruction evaluation, real-site evaluation, local benchmark, WaterSheep vendoring.
- `tests/`: Node unit tests. `browser-tests/`: Playwright specs and fixtures. `test-support/`: fakes.

## Data & privacy

- Password, one-time-code and payment-card fields stay writable, but their values are never shown in the panel, announced, spoken or sent to the WaterSheep model.
- The navigator never records, uploads or stores audio, transcripts or page content. In Chrome and Edge, the browser's own speech recognition sends microphone audio to the browser vendor. Typed instructions work without a microphone.
- In the extension, the camera and WebGazer run in an invisible extension frame (`extension/capture.html`), so camera access is granted to Gaze Navigator once (through its setup tab), not to each website, and pages cannot see the video. Only gaze points reach the page's content script, over a private extension port.
- **Known issue:** speech recognition still runs in the page, so the microphone permission is asked for, and kept by, the website being viewed.
- Webcam frames are processed in the browser by WebGazer and are not uploaded or stored. WebGazer's face models download from tfhub.dev. On the website, WebGazer itself loads from jsDelivr; the extension bundles it.
- Extension state lives in extension storage, never in the website's storage. Navigator settings and camera calibration samples (small eye-patch images plus screen positions) are kept in in-memory session storage. "Stop camera" deletes the samples, and closing the browser discards them. The popup's stay-on and auto-start preferences are kept in extension local storage. The website version keeps settings in `sessionStorage` and recalibrates on every page.
- The WaterSheep model is cached in Cache Storage: the extension's own cache, or the practice site's origin.
- The navigator runs in the extension's isolated world. Its modules are web-accessible, so a website can detect that the extension is installed.
- Dwell-lab drafts live in memory and are cleared on refresh. Backups and measurements are saved only when you download them.

## Licences

- WebGazer is GPL-3.0. Its licence is copied into the extension build as `vendor/WEBGAZER-LICENSE.md`.
- ONNX Runtime Web is MIT (Microsoft). `@huggingface/tokenizers` is Apache-2.0. The WaterSheep model is Apache-2.0 and is downloaded on request, not bundled. A `NOTICE.txt` is written beside the vendored runtime.
