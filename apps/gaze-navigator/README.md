# Gaze Navigator

**Owner direction update (2026-10-14): extension-first.** The Chrome extension is the primary product for gaze/voice control on real websites. The website supports onboarding and practice. Prioritize usable extension installation/setup, contextual controls, navigation/calibration continuity and real-user acceptance. A standalone system-wide app is a future possibility. See [product direction, section 1](../../docs/PRODUCT_DIRECTION.md#1-gaze-navigator).

**Product direction (2026-10-08): ACTIVE.** The destination is gaze context plus spoken instructions interpreted on real websites, with WaterSheep (replacing Jev, per the owner on 2026-10-13) as the intended model interpreter. See [the portfolio direction](../../docs/PRODUCT_DIRECTION.md) for the full vision and acceptance expectations. The implementation and verification described below are current milestones, not completion of that destination.

A small browser-first vertical slice for project #1, **Eye detector with agentic AI**.

It has two parts:

- **Spoken web navigation** (`src/web/`, newest): a page-agnostic runtime that shows a context circle, numbers the ordinary links/controls/fields inside it, and carries out spoken or typed instructions on unannotated pages — with clarification, confirmation of consequential actions and spoken pause/cancel. It currently runs on the bundled practice website with the pointer standing in for gaze. See [Spoken web navigation](#spoken-web-navigation).
- **Dwell navigator** (`index.html`): WebGazer webcam gaze, calibration, held-out accuracy checks and dwell confirmation of explicit `[data-gaze-target]` controls in a confined practice inbox.

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
- **Nearby assist** (default Standard) lets gaze that lands just outside a control select it: within 48 pixels, or 96 pixels with **Wide assist**. Exact hits always win, two similarly close controls are skipped (the cursor ring turns dashed), and assisted controls show a dashed amber outline and still need the full hold. **Assist off** requires a direct hit. While paused only Resume and Stop are eligible, and held-out accuracy checks never use assist. The choice is gaze-reachable and lasts for the page session.
- Camera samples are smoothed with an adaptive One Euro filter so small fixation jitter does not restart a hold, while large gaze shifts follow quickly. Pointer simulation and held-out accuracy measurements use unsmoothed coordinates.
- Calibration asks for three clicks at each of nine screen positions before enabling targets.
- In camera mode, only physical pointer clicks on the dot add samples. Keyboard/synthetic clicks and clicks without a recorded eye sample do not advance calibration. Simulation permits ordinary keyboard activation.
- Resizing restarts calibration from the first point and suspends navigation and accuracy checks until it completes. Pause also pauses calibration; resume before collecting more clicks.
- Stop is available during camera startup and returns without waiting for the dependency. A pending browser permission request may still finish; its late stream is released. Simulation and camera retry remain available. Every camera restart uses a fresh estimator instance with separate video elements so old initialization or inference cannot interfere with the new session. Retired model resources are released after any active inference finishes.
- A fixed toolbar supports gaze Pause/Resume/Stop, Recalibrate, Check accuracy, and Page up/down after calibration. While paused, only Resume and Stop accept gaze; looking away before reusing Pause prevents an accidental toggle. Escape pauses navigation. During an accuracy check, gaze Pause/Stop remain available and cancel the measurement; the completed report can be closed with gaze.
- The gaze keyboard keeps Earlier keys, Later keys, case, and Close controls outside its scrolling grid. Use those controls to reach lower keys on short screens; opening another field returns to the first row.
- Session drafts have large **Open draft** controls. Reopening then **Update draft** changes that saved record without adding another copy. **Compose** reopens your current unsaved fields; **New draft** starts blank. Switching away from changed text requires the inline **Keep current composer** or **Replace composer** decision, reachable by gaze. A switch closes the gaze keyboard before replacing fields. Keep up to 20 drafts, with the existing 200-character subject and 10,000-character message limits. Previews are shortened; reopening retains the full text. Refresh clears the notebook. **Download saved drafts** explicitly keeps a local JSON backup of saved records, excluding current unsaved composer text. **Import draft backup** reveals a visible file chooser; your browser requires a mouse or keyboard to choose a file. Valid backups append up to the combined 20-draft limit without replacing current drafts or composer fields. Files are versioned and limited to 2 MiB; malformed, stale or excessive imports leave current work untouched. There is no automatic storage or sending.

## Keep website suggestions open while typing commands

Focus the website field or control, move the context circle over the desired option, then press **Alt+Shift+G**. Type an instruction without moving website focus. The panel displays the command; **Enter** submits, **Escape** cancels, and the shortcut toggles the mode off. Arrow keys, Home/End, Backspace/Delete, selection and paste edit the command. Ctrl/Cmd+A selects the command text; other browser shortcuts or Tab leave the mode. Your ordinary typed-instruction draft is restored afterward.

Use direct keyboard characters or paste for composed/IME text. This mode supports native input/textarea fields and ordinary controls; editable page regions (`contenteditable`) continue to use speech or the ordinary instruction box. Same-origin frames are supported. Leaving the page, stopping the navigator or changing focus ends the mode and restores ordinary website typing. Consequential commands still require confirmation.

## Spoken web navigation

Serve this directory as above and open `http://localhost:4173/practice-site/index.html` (or follow **Try spoken navigation on an ordinary practice website** from the navigator). Northwind Books is a fictional six-page site with no gaze annotations: navigation, search, cards with repeated "Read more" links, a horizontally scrolling shelf, a dropdown, a scrolling review list, a contact form, and consequential buttons. Nothing is sold, sent or stored.

1. Move the pointer over the page (it stands in for gaze). The circle shows the area in context; links, buttons, fields, dropdowns, checkboxes and ARIA widgets inside it get numbered outlines, and the panel lists them with roles, names and values.
2. Choose **Start listening** and speak, or type into **Typed instruction**. Looking at (hovering) the panel keeps the last page area, shown by a dashed circle. Speech context is captured at the instant speaking begins, so gaze can move while you finish the sentence.
3. Examples: "open catalog", "click the second one", "type Ada Lovelace", "type see you soon into message", "replace Tuesday with Friday", "delete last word", "undo", "choose large print", "scroll down", "scroll up a bit", "search for river", "go back", "submit".
4. When names are equally plausible the navigator asks "Which one?" and outlines only the candidates; answer with a number (or the on-screen buttons). Submitting forms and controls named like delete/remove/buy/pay/place order/send/sign out/unsubscribe ask for **confirm**; a confirmation expires after 15 seconds, and any new instruction, "no" or "cancel" discards it.
5. **Camera gaze:** choose **Camera** or say "use camera". After camera permission, a no-click calibration shows nine dots: look at each until it turns green (0.9 s settle, then four samples; a dot without detectable eyes is retried once, and fewer than seven learned dots fails with guidance). Webcam samples then pass through the One Euro filter to move the circle; gaze on the panel keeps the last page area, and lost tracking dims the circle without discarding context. "Recalibrate" repeats calibration, "stop camera" or "use pointer" releases the camera, and these work even while paused. Camera mode continues after a page navigation but recalibrates there, because estimator data is never stored.
6. "Pause" blocks everything except "resume" and "cancel". "Cancel", "stop" and "pause" act on the interim transcript before recognition finalizes. Settings (circle size, listening, spoken feedback) last for the browser tab session.

Discovery reaches controls inside open shadow roots (web components) and same-origin iframes, including pointer input over those frames. It also finds script-only "Clickable" elements that set a pointer cursor without any role. Cross-origin frames inside the circle are listed as content the navigator cannot reach. Try it on the practice site's **Help** page. The panel keeps tracking and settings in a **Tracking and settings** disclosure, and opens the element list by default only on tall screens, so it covers less of small screens.

### Choosing native dropdown options (#293)

“Choose Hardcover from Format” retains the captured native option through clarification and focus. Locked/disabled selects or optgroups, stale/reordered/replaced options and focus changes refuse. An already selected choice sends no events. A real change sends native selection plus input/change and checks the website’s retained state after handlers/microtasks; newer commands retire old feedback. Consequential control or choice labels require confirmation naming the option and dropdown. Implicit multi-select choices refuse without clearing existing selections; use the explicit add/remove commands below. Custom ARIA comboboxes remain unsupported by this command. [Verification and boundaries](docs/2026-10-20-native-dropdowns.md) distinguish software checks from physical speech/gaze acceptance.

### Add or remove one choice in a native multi-select (#304)

Say **“add option Jazz to Genres”** or **“remove option Jazz from Genres”** while the list is in the gaze circle. You can omit the list name when the visible choice is unambiguous. The same commands work in the typed instruction box and with **Alt+Shift+G**. Duplicate options ask a numbered question; consequential list/option labels still require confirmation.

Each command changes only that option and preserves the other selections. “Choose Jazz” keeps its single-choice meaning and refuses a multi-select. A repeated add/remove is a no-op. Captured list/option identities, labels, values, grouping and every selected state must still match after clarification and focus. Disabled/locked controls refuse; input/change handlers and their microtasks own the final state. If the site changes another choice, feedback asks you to check the list instead of claiming success or forcing rollback. Custom ARIA listboxes are not included. Physical gaze/speech-service quality remains unverified.

### Writable-field protection (#274)

**Checkbox state:** “check Newsletter” / “tick Newsletter” and “uncheck Newsletter” / “untick that checkbox” set a native checkbox or binary ARIA checkbox/switch to the requested state. Repeating a request that is already satisfied sends no click or edit events. An actual change uses one native click, respecting the website's event handlers and canceled activation; a refused, replaced or overridden result is reported. Ambiguity, pause/cancel and consequential confirmation still apply. Custom widgets must expose explicit true/false ARIA state. The website owns one click and all state/events; feedback checks after click microtasks drain, and reports failure when the requested state is not retained. Missing, invalid, mixed and indeterminate states are refused. This observation does not wait for network or arbitrarily delayed site updates. Assisted matching also waits for final state, and newer commands retire old feedback. Ordinary “click” / “toggle” activation is unchanged. [Native checkbox verification](docs/2026-10-17-checkbox-state.md) and [custom widget verification](docs/2026-10-18-aria-check-state.md) does not establish physical speech/gaze or intended-user acceptance.

Ordinary typing, clearing, correction and text Undo keep the focused or explicitly named text field as their target, including when that field is read-only. They refuse a nonwritable target instead of silently choosing a writable neighbor. Explicitly naming another writable field still works. Before a text edit or search writes anything, the runtime rechecks current native read-only/disabled state, inert ancestors, and ARIA read-only/disabled restrictions. Refused actions dispatch no edit events and do not consume text history; searches also recheck after confirmation. Selection commands retain their existing native-field restrictions.

[Verification and boundaries](../../docs/2026-10-16-gaze-writable-fields.md) distinguish hosted Node/Chromium checks from the unavailable local execution environment. This does not establish real microphone/webcam or broad framework acceptance.

### Setting native sliders (#283)

Look at a native range slider and say **“set Volume slider to 40”** (using its name), or **“set slider to 40”** for the slider under the circle. Signed decimals such as `set Balance slider to -0.25` work in the control's own numeric units. The word **slider** makes this explicit; ordinary text/option commands retain their existing meaning. Percentages and spoken number words are not converted. Equal names ask a numbered question; Cancel/Pause retire the pending action.

The exact value must fit the slider's current min/max/step. The runtime refuses silent browser clamping or rounding; it also rechecks native type, connection, disabled/read-only/inert/ARIA locks across shadow/frame ancestors and focus-handler changes before dispatching input/change. Custom ARIA sliders need widget-specific keyboard behavior and are refused. A website can react to those ordinary events; if it changes the requested value, feedback reports the observed value rather than claiming success.

**“Undo Volume slider”** or **“undo slider”** restores the last changed value for that same element (up to20 changes, session only). Text Undo is separate. Refusals, unchanged values and invalid/locked Undo preserve the history; an old value that no longer fits current limits refuses until the limits permit it again. Navigation/replacement does not transfer history to a different element.

[Verification and remaining limits](../../docs/2026-10-17-gaze-native-sliders.md) separate actual DOM/browser checks from real speech, webcam and intended-user acceptance.

### Correcting a native text selection

In a writable text input or textarea, say **“select all text”**, **“move cursor to the start”**, or **“move cursor to the end”**. Say **“insert Hello at the cursor”** to insert at the caret (or replace the selected range), or **“replace selected text with Hello”** to require a nonempty selection. Quoted text preserves intentional spaces: `insert "next " at the cursor`. These explicit insertions add no automatic spaces. Ordinary `type Hello` / `insert Hello` still append with the existing dictation spacing.

To select an interior phrase without a pointer range, say **“select text Tuesday”**, then **“replace selected text with Friday”**. Matching is case-insensitive and literal (not a regular expression). If it appears more than once, the command refuses without moving the selection: say **“select second occurrence of Tuesday”**, **“select first occurrence of Tuesday”**, or **“select last occurrence of Tuesday”**. Spoken first–twelfth and numeric ordinals such as `12th` are supported. Occurrences count nonoverlapping matches from the beginning. Missing text or an unavailable occurrence leaves the previous selection alone. Quotes preserve spaces and punctuation: `select text " next "`, `select text "a+b [x]."`. Punctuation after a closing quote is ignored; unquoted punctuation is literal. This uses browser Unicode case matching, without accent folding or Unicode normalization. Selection changes add no text Undo step.

The focused field must be in the gaze circle; otherwise the usual nearby-field choice and clarification apply. Insertion is one text Undo step, while selecting/moving the cursor adds none. Use speech or Alt+Shift+G to keep a website's selection while issuing a correction. These commands refuse read-only/disabled fields, rich-text editors and native input types without selection offsets (for example email and number); existing whole-field dictation remains available where supported. Physical speech/gaze usability is still unverified.

Execution never opens `javascript:` or other non-web link schemes, writes fields through native value setters plus `input`/`change` events so framework-managed forms see the change, keeps a 20-step per-field undo history, and acts only on elements captured inside the circle (plus the page's single search field for "search for…"). The panel lives in an open shadow root that context capture ignores, and a spacer reserves room so it never permanently covers the end of a page.

Interpretation quality is measured on a fixed suite: `npm run evaluate:instructions` scores 120 tuned phrasings (120/120) and 50 held-out phrasings (34/50, 68%). Both suites have zero wrong page actions; every miss is a question or an explanation. See [the evaluation](docs/2026-10-12-instruction-suite-evaluation.md). This is the baseline a model interpreter must beat.

**WaterSheep target choice (#229, measured, not yet in the live runtime).** The owner chose [WaterSheep](https://github.com/SamratDuttaOfficial/WaterSheep) instead of Jev. WaterSheep is an Apache-2.0 ModernBERT model that answers single-choice and yes/no questions with calibrated probabilities and runs locally through ONNX Runtime.

`src/web/assisted-interpreter.js` keeps the rules first and asks the model only to choose a control:

- when a requested target matched no name;
- to break a tie between the controls the rules proposed (identical names stay a question);
- for an unparsed phrase, only after a yes/no "does this ask to use a control?" answer of at least 0.8.

The model sees the instruction and the controls' role, name, checked state and choices, never field values or page text. A pick of at least 0.8 acts, and still goes through consequential-action confirmation. A split answer asks a numbered question; anything else keeps the rule answer.

`src/web/watersheep.js` adapts WaterSheep's browser inference with an injected runtime. `npm run evaluate:instructions -- --watersheep DIR` scores it on both suites from a local model copy.

**Measured** (revision `236de64`), as correct / unsafe answers:

| Suite | Rules | Rules + WaterSheep |
| --- | --- | --- |
| Tuned (120) | 120 / 0 | 120 / 0 |
| Held-out (50) | 34 / 0 | 35 / 0 |
| Second held-out (50, paraphrased targets) | 18 / 0 | **27 / 0** |

Model calls take about 0.36 s. First scorings found unsafe picks, which led to safety-only fixes; both are recorded. **On live websites** (Wikipedia, GOV.UK, MDN, Python docs), seventeen scripted tasks through the real extension completed 15/17 with the rules alone and **17/17 with smarter matching** (an earlier run 16/17), with no unintended actions. They cover links, search, dictation and spoken correction, dropdowns, page and region scrolling, pagination, menus, disclosure toggles and checkboxes. The runs found and fixed five gaps: one-way synonyms, "next page" ignoring a Next page link, typed corrections losing their field, "close the menu" doing nothing, and filter toggles asking for confirmation. The pointer stood in for gaze and typed text for speech. See [the real-site evaluation](docs/2026-10-13-real-site-evaluation.md); rerun it with `node scripts/evaluate-real-sites.mjs --extension DIR [--assist]`.

**Smarter target matching** (#232) is an opt-in setting under **Tracking and settings**. It uses WaterSheep live: the rules answer first and instantly. When they cannot name a control, the panel says "Working out which control you mean…" and asks the model, and any newer instruction (including cancel or pause) discards that pending answer. Consequential picks are still confirmed.

- **On the practice site,** run `npm run vendor:watersheep` once. This fetches ONNX Runtime Web 1.23.0 and the tokenizer with npm, pinned by SHA-256, into `dist/vendor/watersheep`. The setting then downloads the model from Hugging Face at the pinned revision, checks its SHA-256, and caches it.
- **In the extension,** the model runs in one shared offscreen document: it downloads once per browser and is cached in extension storage, never a website's. `npm run build:extension` bundles the runtime (the extension is about 14 MB).

Measured live in Chromium on 4 CPU cores:

- the first enable takes about 7–12 s (download included), and later enables about 3 s from cache;
- each model-assisted instruction takes 1.3–3.5 s on the practice site, which is single-threaded. In the extension, isolated pages use 4 wasm threads, about halving each model call (0.6–0.7 s against 1.1–1.2 s). See [the WaterSheep notes](docs/2026-10-13-watersheep.md).

Components stay separate so each can be replaced: tracking (`overlay.js` pointer input, `camera-gaze.js` webcam session and `calibration.js` hands-free calibration), context (`page-context.js`), interpretation (`interpreter.js`, a deterministic rule baseline behind a `interpret(utterance, context) → action` contract), coordination (`controller.js`) and execution (`page-actions.js`). Speech uses the browser's Web Speech API (`speech-input.js`).

### On real websites (Chrome extension)

Open [the extension setup guide](extension-setup.html) for installation, deliberate website-access choices, a first real-page task, optional speech/camera setup and recovery. The landing page now leads to this guide; the dwell lab and built-in bookshop remain separate practice tools. Leave the installed extension off on the built-in practice site to avoid two panels. No store installer or installation detection is provided.


```bash
cd apps/gaze-navigator
npm run build:extension      # fetches pinned WebGazer 3.3.0 with npm, verifies its SHA-256, writes dist/extension
```

In Chrome (116+), open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked** and select `apps/gaze-navigator/dist/extension`. Then open any website and use the toolbar popup's **Turn on for this page**, or the suggested page-toggle shortcut <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>. The in-page command editor keeps **Alt+Shift+G**. The popup reports the actual assigned shortcut, warns about a conflicting old binding, and explains an unassigned or unavailable shortcut without blocking toolbar controls. Existing installations can retain older/custom bindings; review `chrome://extensions/shortcuts` and keep page toggle distinct from command entry. Reserved or unassigned shortcuts can be replaced there; the toolbar popup remains available.

- By default the extension uses only `activeTab` + `scripting` + `storage`: it runs on the page you turned it on for and stops when that page changes.
- **Stay on in this tab when pages change** and **Start automatically on every website** ask for optional access to websites (`<all_urls>`), because restarting after a navigation needs host access. Auto-start makes the navigator hands-free after this one-time setup.
- The popup checks the current document and distinguishes starting, on, off, failed startup and unavailable page access. **Check this page again** retries a failed check. Turning the navigator off during startup cancels that session; turning it on again on the same page starts a fresh session. A newer Stop also cancels an older pending navigation continuation. Permission refusal and failed preference saves remain visible below the status.
- Navigator settings live in the extension's in-memory session storage, never in the website's storage; the navigator runs in the extension's isolated world, invisible to page scripts, and its styles use constructable stylesheets so strict page CSPs cannot strip them.
- "Use camera" injects the bundled WebGazer into the isolated world (MV3 forbids remotely hosted code). Its face models still download from tfhub.dev, and the camera/microphone prompts are for the website's origin.
- In the extension, a successful camera calibration follows you between pages. Its training samples (tiny eye-patch images plus screen positions) are kept only in the extension's in-memory session storage, never in website storage. They are reused while the window size is unchanged and for up to two hours. "Stop camera" or "use pointer" deletes them, and the browser discards them when it closes. The practice site (no extension) still recalibrates on each page.
- Protected pages (`chrome://`, the web store) report that the navigator cannot run there. Cross-origin iframes and other browsers are not handled. The navigator's modules are web-accessible, so a website can detect that the extension is installed. WebGazer is GPL-3.0; its license is copied into the build.

Current limits: The practice site loads WebGazer 3.3.0 from jsDelivr; the extension bundles its code. Face models download from tfhub.dev. Real camera accuracy, microphone use and calibration continuity in physical use remain unmeasured. Opt-in on-device WaterSheep target matching is integrated, with retained developer-authored evaluations; broader real-site and intended-user acceptance remain outstanding. Spoken commands are English only.

## Architecture

- `src/web/` — spoken web navigation runtime: context, interpreter, controller, actions, speech, camera source, hands-free calibration and overlay; `boot.js` (practice site) and `extension-boot.js` (extension) start it.
- `practice-site/` — unannotated six-page website used to demonstrate and test spoken navigation.
- `extension/` + `scripts/build-extension.js` — MV3 Chrome extension packaging (`dist/extension`; `--test` adds a fake estimator and pre-granted host access for automated tests).
- `index.html` — demo UI and explicit gaze targets.
- `src/app.js` — calibration, WebGazer adapter and animation-frame sampling for simulation.
- `src/resolver.js` — isolated hit testing; rejects invalid coordinates, disabled controls, and targets outside the demo.
- `src/gaze-filter.js` — adaptive One Euro smoothing for camera samples, reset on gaps and tracking changes.
- `src/target-assist.js` — bounded nearby-target selection with ambiguity abstention, occlusion checks, eligibility and hysteresis.
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

The practice-site suite (`browser-tests/web-navigator.spec.js`) installs a controllable fake `SpeechRecognition` before page scripts run, then verifies discovery, speech-start context capture, dictation and correction, clarification, confirmation, pause/interim cancel, dropdowns, region scrolling, search, back navigation, unsafe-link refusal and speech-permission failure on all four viewports. `npm run lint` syntax-checks every JavaScript file under the app. Playwright starts the static server and tests pointer dwell, safety controls, keyboard draft entry, multiline previews/case changes, accuracy-target visibility/report closing, resize calibration, and the decision lab at 1280×900, 390×740, 390×480, and the compact-height boundary 390×651. The lab tests use controlled local API responses for offline comparison, explicit local routing, cloud/invalid-output rejection, cancellation/retry, and safe report export/import. Its controlled clock advances actual animation frames; these are interface tests, not webcam accuracy/latency measurements. Tests reject external requests in simulation and page exceptions. The GitHub workflow runs the same checks on a standard Ubuntu runner with read-only repository access, no persistent artifact/cache uploads, and a 25-minute limit. Extension tests (`browser-tests/extension.spec.js`) build `dist/extension-test` and load it into full Chromium (the headless shell cannot load extensions).

[CI run 37136868563](https://github.com/twangyal/projects-monorepo/actions/runs/37136868563) verified commit `8c1910b`: **55 Node tests and 48 native Chromium cases passed** (24 navigation, 24 decision lab), alongside lint/build syntax checks. The browser regression also established that all five accuracy target centers and keyboard footer controls remain reachable at the tested sizes. Local Chromium launch was blocked by the development runtime's Unix-socket restriction; native browser verification ran in CI. Physical webcam accuracy, hardware release indicators, and actual TensorFlow memory measurements remain unverified.

The static app has no compilation step; build validates JavaScript syntax, as does lint. The dependency-free tests exercise continuous dwell, target changes, tracking gaps, reset, camera-session ownership, cleanup, and simulation/calibration flows using controlled adapters. The separate Chromium suite verifies actual browser hit testing and layout. Neither suite measures physical webcam estimation.

Manual browser check: complete simulation calibration, move onto Compose once, hold still, and confirm it activates once. Leave and return to confirm again. Recalibration, leaving the document, changing tabs, scrolling, and resizing reset pending dwell; simulation requires a fresh pointer movement afterward. Camera tracking resets on missing or invalid gaze samples.

### Run record — 2026-10-03

Continued the initial prototype by fixing stationary-pointer dwell and repeated confirmations. Five automated tests and syntax validation passed locally on Node.js 24. The simulation regression test fails against the original app. No webcam/browser visual check was run, and the repository had no CI workflows or runs. Project #1 remains ACTIVE at its existing path; project #8 remains skipped.

Next: measure webcam accuracy/latency and isolate target resolution before evaluating decision models.

## Privacy and limitations

Spoken web navigation uses the browser's built-in speech recognition. In Chrome and Edge this sends microphone audio to the browser vendor's speech service; the navigator itself never records, uploads or stores audio, transcripts or page content. Typed instructions work without a microphone.

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
lint/build. First [CI run37718757731](https://github.com/twangyal/projects-monorepo/actions/runs/37718757731) passes the same69 units and88 native cases. [Verification record](docs/2026-10-08-draft-backups/README.md) retains
first failures, corrections and limitations. Physical webcam acceptance remains
separate in issue132.

### Stabilized gaze and nearby assist — 2026-10-07

Camera samples pass through a One Euro filter and live navigation can select the
uniquely closest control within 48/96 pixels when gaze misses it slightly, with
ambiguity abstention, visible assisted outlines and unchanged hold confirmation.
79 unit and 84 native Chromium cases pass locally. Filter constants and radii are
untuned defaults pending physical webcam checks (#132).
[Verification record](docs/2026-10-07-nearby-assist-verification.md); issue #137.

### Spoken control of ordinary pages — 2026-10-12

First milestone toward the revised destination: context circle, numbered discovery of unannotated controls, speech/typed instructions, rule-based interpretation, clarification, consequential-action confirmation, dictation and correction, scrolling, search and back navigation on a six-page practice site. 109 unit and 124 native Chromium cases pass locally (28 new practice-site cases across four viewports, driven by a controllable fake speech recognizer). Real microphone/speech-service behavior, camera gaze in this runtime, third-party sites and Jev remain unverified.
[Verification record](docs/2026-10-12-spoken-web-navigation-verification.md); issue #203.

### Camera gaze for spoken navigation — 2026-10-12

The spoken web runtime can now follow webcam gaze after a hands-free, no-click calibration, with spoken or button control of the tracking source, cancel-safe camera startup and release, and per-page recalibration after navigation. 117 unit and 136 native Chromium cases pass locally with a controllable fake estimator; real face-model camera tracking could not run here (tfhub.dev is unreachable). [Verification record](docs/2026-10-12-camera-web-navigation-verification.md); issue #204.

### Real websites through a Chrome extension — 2026-10-12

`npm run build:extension` packages the spoken gaze runtime as an MV3 extension with a pinned, checksum-verified WebGazer. It runs on any website from the popup or its registered page-toggle shortcut, optionally stays on across navigations or starts everywhere after the user grants website access, keeps settings out of website storage and survives strict CSP. 117 unit and 152 native Chromium cases pass locally, including 16 that load the real built extension. [Verification record](docs/2026-10-12-extension-verification.md); issue #205.

### Real-site discovery: web components, frames, script-only clickables — 2026-10-12

Context capture descends into open shadow roots and same-origin frames, and infers pointer-cursor clickables. It reports unreachable cross-origin frames and fixes stale context after a quick stop (trailing capture). 117 unit and 156 native Chromium cases pass locally. [Verification record](docs/2026-10-12-real-site-discovery-verification.md); issue #207.

### Calibration that follows navigation — 2026-10-12

In the extension, camera calibrations are serialized from WebGazer's regression, kept in extension session memory, and restored on the next page when the window size matches (≤ 2 h). Stopping the camera deletes them. 120 unit and 160 native Chromium cases pass locally. [Verification record](docs/2026-10-12-calibration-persistence-verification.md); issue #208.

### Measured spoken phrasing — 2026-10-12

A versioned 120-instruction suite plus a 50-instruction held-out set measures the interpreter. Broadening raised the tuned suite from 91/120 with one unsafe action to 120/120. The held-out set scores 34/50, with 0 unsafe actions on both. 124 unit tests pass, and the 64 web-runtime native cases pass. [Evaluation](docs/2026-10-12-instruction-suite-evaluation.md); issue #209.


## Explicit radio choices (#308)

Look at the choices and say or type **select Express radio button**, **choose the Express radio**, **pick radio button Express**, **select that radio button**, or **select second radio button**. These commands target radios only. Ambiguous names ask for a number; consequential choices still require confirmation. Cancel or pause retires pending feedback.

A native radio uses one website-owned click, preserving browser radio-group behavior. Binary ARIA radios also use one site-owned click; the navigator never assigns custom state or retries. An already selected radio needs no click. Feedback checks retained availability, identity and selection after website microtasks. Missing/mixed custom state, disabled/inert/read-only or hidden controls, focus redirects, changed names/values/form/group owners and replaced nodes refuse. Native groups stay browser-owned; this does not validate a website's complete custom radiogroup implementation. Ordinary **click** and dropdown commands retain their existing behavior.

The same interpreter/controller runs in the injected MV3 extension, practice runtime, speech and typed command paths. Physical speech/gaze and intended-user acceptance remain open in #132. [Verification and limits](docs/2026-10-23-radio-selection.md).

### Select a website tab (#312)

Say **“select Details tab”**, **“choose tab Details”**, **“select that tab”** or **“select second tab”** while the website's tabs are inside the gaze circle. Equal matches ask a numbered question. The requested action keeps its selection meaning through clarification and optional target matching. Consequential names still require confirmation; Cancel/Pause retire pending work.

The website must expose binary `aria-selected` tabs inside an ordinary single-select ancestor `tablist`. A valid already-selected tab needs no focus or click. Focus may activate a tab automatically; otherwise the navigator issues one website-owned click, then checks the retained selection. It never writes `aria-selected`, forces panel content or retries a refused click. A newer command or cancellation prevents an older deferred click. Website changes scheduled after feedback can still change selection later.

Missing/invalid selection states, multiple simultaneous selections, multiselectable or externally owned tablists, unsafe submit/link targets and changed/hidden/locked/replaced controls refuse. Current group membership, order, names, control references, form, shadow and frame ownership remain part of the captured choice. This controls tabs within a webpage; browser chrome tabs are outside this milestone. Selection feedback observes the website's declared state, rather than verifying panel rendering or network loading. See [verification and limits](docs/2026-10-23-website-tabs.md).
