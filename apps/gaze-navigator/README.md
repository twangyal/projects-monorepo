# Gaze Navigator

Operate real websites by looking and speaking. It is for people who find a mouse or keyboard hard to use. A context circle follows your gaze (or the pointer). You say or type what to do, and the navigator acts on the controls inside the circle. It asks when the target is unclear and asks you to confirm consequential actions. The main product is a Chrome (Manifest V3) extension. The website in this folder covers setup, practice and developer labs.

**Status:** ACTIVE — portfolio priority. Direction: [docs/PRODUCT_DIRECTION.md](../../docs/PRODUCT_DIRECTION.md)

## What works today

- **Chrome extension** that runs on the page you are viewing. Turn it on from the toolbar popup or with the suggested shortcut <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>. Two optional settings ask for access to all websites: keep it on in the tab when pages change, and start it automatically on every site.
- **Context circle** driven by the pointer or by webcam gaze (WebGazer). Camera mode uses a nine-dot calibration that needs no clicks, plus One Euro smoothing. Four more dots then check the calibration: the circle is sized to hold 9 in 10 of the smoothed gaze samples (small, medium or large), and when even the large circle cannot, the navigator says so and suggests recalibrating or using the pointer. While you work, each small control you name inside the circle and use becomes one more calibration sample at its centre (at most one every two seconds), which corrects drift and is saved with the calibration. An explicit missing camera estimate or disconnected camera frame clears the old page target, speech capture and pending confirmation. Page actions wait for a fresh gaze on the page; looking at the panel does not reuse the old target. Pause, cancel and pointer/camera recovery remain available. In the extension, a calibration is reused on later pages for up to two hours, as long as the window size stays the same.
- **Control discovery** inside the circle: links, buttons, fields, dropdowns, checkboxes and ARIA widgets get numbered outlines. Discovery also reaches open shadow roots, same-origin iframes and script-only clickables that set a pointer cursor. In the extension, embedded frames from other sites (sign-up forms, widgets) are reached too when it has access to all websites: their controls join the circle and are acted on inside the frame, and pointer moves over them steer the circle. Without that access they are listed as unreachable.
- **Spoken or typed instructions** through the browser's Web Speech API, or through a typed instruction box. Extension speech runs in its own capture frame, with a microphone setup tab and typed recovery when permission or recognition fails. Camera and listening can be stopped independently. Where Chrome can recognize speech on the device, the navigator uses that once its language pack is installed (settings offer the one-time download): no audio then leaves the device, and recognition favours the names of the controls in and around the circle. Context is captured when you start speaking. If recognition ends without words, or you stop listening, that unfinished capture is released so the next instruction uses a fresh gaze. <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> opens command entry while the page keeps its focus.
- **Navigation**: open or click by name or ordinal ("the second one"), scroll the page or a scrolling region, go back or forward, search the page's search field, and submit. If gaze lands just outside a list, scrolling can recover a unique region touched by the circle; competing regions ask you to look further inside. A named region ("scroll the list down", "the sidebar", "the comments") is found anywhere on screen when the gaze is not on a scrolling region, and the reply says which moved. "Scroll the page down" explicitly moves the page.
- **Topic words**: everyday words for about 40 common website topics are understood without the model, so "take me to the stuff about cars" opens GOV.UK's "Driving and transport" and "open careers" finds "Working, jobs and pensions". A related word counts for less than a word the control actually says. A control found only through its topic is used when it is inside the circle, and offered for confirmation when it is just outside. Words that are common in unrelated link text ("learn", "show", "policy", "pay") are never treated as related.
- **Pointing recovery**: a control named in an instruction but not in the circle is looked for just outside it (up to three circle-radii), where it is used and the reply says so, and then anywhere on screen. A far control is only outlined and offered ("“Log in” is not near your gaze… Say confirm"); two or three far matches become a numbered question, and more are refused. Unnamed requests such as "click this" never reach outside the circle.
- **Dictation and correction** in text fields and rich-text editors (mail and comment composers): type, replace a word, delete the last word, select text or a specific occurrence, insert at the cursor, replace or delete the selection, and undo per field. Editors keep their formatting and links. A correction such as "change Turnig to Turing" reaches the field being typed in even after the gaze drifts off it, when the words are in that field. Explicit **"continue typing …"**, **"keep typing …"** or **"continue writing …"** append words to the focused regular text field even when gaze rests on another field; ordinary "type …" keeps its gaze-based target. **"Undo typing"** can recover that focused field when there is no text field in the circle. Continuation refuses changed focus, protected fields and fields that become locked or disconnected; the navigator’s own instruction box preserves the last page focus. Name the first field explicitly with “type hello into Message” or “type hello in the Message field/box/input”: nearby fields are recovered and distant fields need confirmation. A missing named field leaves other fields unchanged. Quote the whole dictated phrase to keep words such as “meet in the football field” literal.
- **Native form controls**: dropdowns, adding or removing a single multi-select option, checkboxes and switches, radios, website tabs, expand/collapse disclosures, sliders, and number, date, time, month and week fields. Values can be spoken naturally ("set departure to November first", "set appointment time to 2:30 pm", "set guests to four") or given as digits. Value commands have their own undo. Read-only, disabled and changed controls are refused rather than forced.
- **Custom widgets** built by component libraries: "set size to large" opens a custom combobox, types into it first when it is a search box, waits for its suggestions and picks the one named choice, then checks the combobox shows it. Several or no matches name the choices and leave the list open. Custom sliders and spinbuttons are moved with their arrow, Home and End keys to the exact spoken value; steps that skip it, ranges and unresponsive widgets are reported.
- **Circle recovery**: say "make the circle bigger/smaller" or "use a small/medium/large circle" to select the existing 60/90/130 px radii. The size is saved and the next page instruction uses the new area. Resizing retires pending choices/confirmations and never activates a control; it also works while paused without resuming.
- **Safety**: equally plausible targets get a numbered "Which one?" question. Page badges and spoken choices use the same numbers. Answer within 30 seconds or give the instruction again. Submits, downloads and controls named like delete, buy, book, send, reply, share, upload, archive or sign out need **confirm**, which expires after 15 seconds. Speech that is not understood leaves a pending confirmation or question waiting without extending its deadline, and a number on its own only answers a question ("click 2" activates). "Pause", "cancel" and "stop" act on the interim transcript. Links with non-web schemes such as `javascript:` are never opened.
- **Smarter target matching (optional)**: on-device [WaterSheep](https://github.com/SamratDuttaOfficial/WaterSheep) runs through ONNX Runtime Web. The rules answer first. The model is asked only when the rules cannot name a control: first about the controls in the circle, then, if none is meant, about those just outside it. It sees control roles and names, never field values or page text.
- **Panel placement**: the panel stays above website layers whatever their z-index, and moves to another corner when it would hide a website's fixed controls, such as a cookie banner. It avoids corners that would cover where you are looking.
- **Practice site** (`practice-site/`): a fictional bookshop with no gaze annotations, where the navigator runs without the extension. **Practice tasks**, started from its home page, walk through eight everyday tasks (open a page, sort, search, choose a format, write a note, add to cart, scroll reviews, pick a contact topic). The page checks each task itself and counts the time, the instructions and how the navigator answered them, and actions nobody asked for (detours, orders, removals, other books in the cart). The run stays in the tab, and its JSON report is downloaded only on request, ready for sessions with real users. There is also an **extension setup guide** (`extension-setup.html`).
- **Dwell lab** (`index.html`): WebGazer dwell selection in a practice inbox, with nearby-target assist, a gaze keyboard, session drafts with JSON backup, and a held-out accuracy check whose measurement you can download.
- **Decision lab** (`decision-lab.html`): compares a geometric nearby-target baseline with an optional local Ollama model on a synthetic task suite, with JSON report import and export.

## Known gaps

- The real end-to-end loop has not been evaluated with intended users (the practice tasks are the intended way to start): physical webcam gaze plus a real microphone on representative sites. Each calibration now measures its own accuracy and keeps learning from used controls, but webcam accuracy, drift, latency and calibration continuity across real users have not been measured.
- On real sites, the pointer has stood in for gaze and typed text for speech so far. With simulated webcam error (120 px), about 90% of scripted tasks complete with no unintended actions (each trial starts from a fresh browser profile). With exact pointing, 19 of 20 complete, including custom widgets from the WAI-ARIA examples and MUI, with no unintended actions. Everyday names for common page tools are understood ("past versions" for History, "basket" for Cart, "preferences" for Settings), and so are everyday words for common topics: "the stuff about cars" now reaches GOV.UK's Driving section in every trial, where the rules alone found it in none. Paraphrases outside the topic vocabulary still need the optional model, and remaining misses include scroll regions far from the gaze and initial typing after a large gaze miss; "press enter" submits the field being typed in even after the gaze drifts. The scripted Wikipedia "Keep me logged in" task currently fails to find its checkbox and needs updating.
- WaterSheep matching is opt-in and only chooses targets. It needs a model download of about 158 MB on first use. The rule interpreter still misses many paraphrases; those end in a question or an explanation, not an action.
- Custom widgets are driven through their documented keyboard and pointer behaviour, so a widget that ignores both, uses a virtualized list with the named choice scrolled out of view, or allows several choices at once may not respond as expected. Embedded frames from other sites need the extension's all-websites access, and their controls are outlined where they were when captured.
- Scroll recovery samples visible points inside the circle; a tiny region between samples may need a more direct look. Unnamed requests ("scroll down") do not reach distant regions; named ones do, by the region's markup (lists, sidebars, menus, comments, chat, results, tables), which some sites do not label.
- Spoken commands are English only. Recognition uses your browser’s primary language when it is English, otherwise the first English language in its preferences, or US English if none is listed. That choice stays the same for recognition, on-device availability and installation until the navigator restarts. Without on-device recognition, Chrome's speech recognition depends on the browser vendor's service. On-device recognition and its favouring of control names have been tested only with stand-in recognizers, not real speech; Chrome may require installing the language pack from its own settings if the download offered here is refused.
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
- Embedded frames answer only through the extension: the navigator in the top page receives their controls' roles, names, positions and non-sensitive values, and sends back confirmed actions. Neither page's scripts can read or send these messages; a frame is identified by a random number the navigator posts into it.
- The navigator never records, uploads or stores audio, transcripts or page content. In Chrome and Edge, the browser's own speech recognition sends microphone audio to the browser vendor. Typed instructions work without a microphone.
- In the extension, the camera and WebGazer run in an invisible extension frame (`extension/capture.html`), so camera access is granted to Gaze Navigator once (through its setup tab), not to each website, and pages cannot see the video. Only gaze points reach the page's content script, over a private extension port.
- Speech recognition runs in a separate extension capture frame, so its microphone permission belongs to Gaze Navigator. The setup tab requests audio only after you click Allow microphone, then stops that check immediately. Stop listening, leaving the page or turning the navigator off destroys the listening frame. Native microphone permission prompts and real speech still need physical verification; automated tests use a controlled recognizer. A website’s restrictive permissions policy may prevent capture; typed instructions remain available.
- Webcam frames are processed in the browser by WebGazer and are not uploaded or stored. The extension bundles WebGazer and its face models (pinned by SHA-256 at build time), and its camera frame makes no network requests at all. On the practice website, WebGazer loads from jsDelivr and its face models from tfhub.dev.
- Extension state lives in extension storage, never in the website's storage. Navigator settings and camera calibration samples (small eye-patch images plus screen positions) are kept in in-memory session storage. "Stop camera" deletes the samples, and closing the browser discards them. The popup's stay-on and auto-start preferences are kept in extension local storage. The website version keeps settings in `sessionStorage` and recalibrates on every page.
- The WaterSheep model is cached in Cache Storage: the extension's own cache, or the practice site's origin.
- The navigator runs in the extension's isolated world. Its modules are web-accessible, so a website can detect that the extension is installed.
- Dwell-lab drafts live in memory and are cleared on refresh. Backups and measurements are saved only when you download them.

## Licences

- WebGazer is GPL-3.0. Its licence is copied into the extension build as `vendor/WEBGAZER-LICENSE.md`.
- ONNX Runtime Web is MIT (Microsoft). `@huggingface/tokenizers` is Apache-2.0. The WaterSheep model is Apache-2.0 and is downloaded on request, not bundled. A `NOTICE.txt` is written beside the vendored runtime.
