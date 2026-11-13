// Presentation and tracking for the web navigator. Runs inside any page; all UI lives in a
// shadow root that is excluded from context capture.
import { NUMBER_LIMIT, captureContext, composedContains, findMedia, findPopups, findText, formDetailFields, frameOffset, numberControls, sameOriginFrames, viewportRect } from './page-context.js';
import { createController } from './controller.js';
import { canWrite, isSensitive, chooseMedia, choosePopupControl, controlMedia, detailLabel, fillDetails, keyEventTarget, planDetails, pressKeys, restoreDetails } from './page-actions.js';
import { createAssistedInterpreter } from './assisted-interpreter.js';
import { createSpeechInput } from './speech-input.js';
import { addressedSpeech, addressedFeedback, immediateSpeech } from './speech-address.js';
import { createFeedbackVoice } from './feedback-voice.js';
import { createKeyboardCommands } from './keyboard-command.js';
import { createGazeFilter } from '../gaze-filter.js';
import { createLocalCamera } from './camera-source.js';
import { runCalibration } from './calibration.js';
import { recommendedSize, runAccuracyCheck } from './accuracy-check.js';

const RADII = { small: 60, medium: 90, large: 130 };
// Shown numbers follow scrolling and page changes at most this often.
const NUMBERS_REFRESH_MS = 300;
// Self-calibration takes at most one sample from used controls in this many milliseconds.
const LEARN_MS = 2000;
const STORAGE_KEY = 'gaze-web-navigator';
const CONTEXT_INTERVAL_MS = 100;
// A gaze resting within this distance (or this fraction of the radius) on an unchanged page keeps its
// context for up to RESTING_MAX_AGE_MS; camera gaze jitters even when the eyes are still.
const RESTING_PX = 3;
const RESTING_FRACTION = 0.1;
const RESTING_MAX_AGE_MS = 500;

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, sans-serif; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
.circle { position: fixed; left: 0; top: 0; border-radius: 50%; border: 3px solid #f5c76b; box-shadow: 0 0 0 2px #0009, inset 0 0 0 2px #0009; background: rgba(245,199,107,.08); opacity: 0; transition: opacity 120ms ease; }
.circle.visible { opacity: 1; }
.circle.frozen { border-style: dashed; }
.circle.paused, .circle.lost { border-color: #9aa7a1; background: none; }
.circle.lost { border-style: dotted; }
.calibration-dot { position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; background: #f5c76b; box-shadow: 0 0 0 6px #0009, 0 0 0 14px rgba(245,199,107,.35); }
.calibration-dot.sampling { background: #75e5b4; box-shadow: 0 0 0 6px #0009, 0 0 0 10px rgba(117,229,180,.45); }
.calibration-dot.checking { background: #8fc7ff; box-shadow: 0 0 0 6px #0009, 0 0 0 10px rgba(143,199,255,.45); }
.calibration-dot.hidden { display: none; }
.outline { position: fixed; border: 2px solid #75e5b4; border-radius: 6px; box-shadow: 0 0 0 2px #0008; }
.outline.question { border-color: #f5c76b; border-width: 3px; }
.badge { position: absolute; left: -2px; top: -22px; min-width: 22px; padding: 1px 6px; border-radius: 10px; background: #75e5b4; color: #07110e; font: 700 13px/18px system-ui, sans-serif; text-align: center; }
.outline.question .badge { background: #f5c76b; }
.outline.found { border-color: #ffd166; border-width: 3px; background: rgba(255,209,102,.22); }
.outline.numbered { border-color: #8fc7ff; border-width: 1px; box-shadow: none; }
.outline.numbered .badge { top: -2px; left: -2px; transform: translate(-30%, -60%); background: #8fc7ff; box-shadow: 0 0 0 2px #0009; }
.panel { position: fixed; right: 12px; bottom: 12px; width: min(380px, calc(100vw - 24px)); max-height: min(70vh, 560px); overflow: auto; pointer-events: auto; padding: 14px; border: 1px solid #456b5c; border-radius: 14px; background: #0a1b16; color: #eef8f3; box-shadow: 0 10px 36px #000a; font-size: 15px; line-height: 1.4; }
/* Hidden, the panel keeps its answers and any question, so instructions still get feedback. */
.panel.collapsed { width: min(300px, calc(100vw - 24px)); }
.panel.collapsed .body > :not(.status):not(.prompt):not(.dictation) { display: none; }
.panel.left { right: auto; left: 12px; }
.panel.top { bottom: auto; top: 12px; }
@media (max-height: 700px) { .panel { max-height: 45vh; padding: 10px; } }
h2 { margin: 0; font-size: 16px; }
.head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.status { margin: 8px 0; padding: 8px; border-radius: 8px; background: #102820; min-height: 2.6em; }
.status.error { background: #3b1717; }
.status.question { background: #3a2f12; }
.status.success { background: #133b2a; }
.transcript { margin: 0 0 8px; color: #a9c2b8; font-style: italic; }
.transcript:empty { display: none; }
.row label { display: inline-flex; align-items: center; gap: 6px; margin: 0; }
.row { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; align-items: center; }
button, select, input { font: inherit; color: #eef8f3; background: #102820; border: 1px solid #456b5c; border-radius: 8px; padding: 8px 10px; min-height: 40px; }
button { cursor: pointer; }
button[aria-pressed="true"] { background: #285743; outline: 2px solid #75e5b4; }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid #f5c76b; outline-offset: 1px; }
form { display: flex; gap: 6px; }
form input { flex: 1; min-width: 0; }
label { display: block; margin-top: 8px; font-size: 14px; color: #c6d9d1; }
ol { margin: 6px 0; padding-left: 26px; }
li { margin: 2px 0; }
li.unreachable { list-style: none; margin-left: -18px; color: #f5c76b; }
details { margin-top: 8px; }
summary { cursor: pointer; }
.prompt:empty { display: none; }
.hint { color: #a9c2b8; font-size: 13px; }
.assist-row { display: grid; gap: 2px; margin-top: 6px; }
.assist-row[hidden] { display: none; }
.assist-row .hint { margin: 0; }
`;

// Default settings store: the tab's session storage. The extension supplies its own store so
// nothing is written into a website's storage.
export function sessionStore(window) {
  return {
    load() {
      try {
        return JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)) ?? {};
      } catch {
        return {};
      }
    },
    save(settings) {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch { /* Settings then last only for this page. */ }
    },
    // On the practice website, saved details last only as long as the page: the website's own storage is not used.
    loadDetails: async () => null,
    saveDetails: () => {},
  };
}

const ROLE_LABELS = { link: 'Link', button: 'Button', textbox: 'Text field', searchbox: 'Search field', combobox: 'Dropdown', checkbox: 'Checkbox', radio: 'Option', switch: 'Switch', tab: 'Tab', menuitem: 'Menu item', option: 'Option', slider: 'Slider', clickable: 'Clickable', generic: 'Control' };

// Focus inside shadow roots and same-origin frames is reported on their hosts; follow it down.
function deepActiveElement(document) {
  let active = document.activeElement;
  for (let depth = 0; active && depth < 32; depth++) {
    let inner = active.shadowRoot?.activeElement ?? null;
    if (!inner && /^I?FRAME$/.test(active.tagName)) {
      try { inner = active.contentDocument?.activeElement ?? null; } catch { inner = null; }
    }
    if (!inner || inner === active) break;
    active = inner;
  }
  return active;
}

export function describeElement(element) {
  const role = element.nativeMonth ? 'Month field' : element.nativeWeek ? 'Week field' : element.nativeTime ? 'Time field' : element.nativeDate ? 'Date field' : element.nativeNumber ? 'Number field' : ROLE_LABELS[element.role] ?? element.role;
  const state = element.checked !== undefined ? (element.checked ? ', checked' : ', not checked') : '';
  const value = element.options ? `, ${element.value || 'no choice'}`
    : element.sensitive ? (element.hasValue ? ', contains hidden text' : '')
    : element.editable && element.value ? `, contains "${element.value.slice(0, 40)}"`
    : (element.customRange || element.customList) && element.value ? `, ${element.value.slice(0, 40)}` : '';
  return `${role}: ${element.name || '(unnamed)'}${state}${value}`;
}

// `loadAssistant(progress)` resolves to a calibrated decider (WaterSheep) when the user turns on smarter matching.
// `createCamera` supplies the camera (see camera-source.js); by default WebGazer runs in this document.
/** What an answer did: acted, asked a question, cancelled, or did nothing (not understood, refused or failed). */
export function outcomeOf(result) {
  const outcome = result.performed ? 'acted' : result.pending || result.tone === 'question' ? 'asked' : result.cancelled ? 'cancelled'
    : result.tone === 'error' ? 'failed' : 'other';
  return { outcome, message: result.message };
}

// Browser commands a page can carry out itself (outside the extension): reloading and going to a website. Tabs and
// zoom belong to the browser, which only the extension can ask.
export function pageBrowser(window) {
  return {
    async run(action) {
      if (action.type === 'reload') { window.setTimeout(() => window.location.reload(), 300); return { ok: true, message: 'Reloading the page.' }; }
      if (action.type === 'visit') { window.setTimeout(() => window.location.assign(action.url), 300); return { ok: true, message: `Opening ${new URL(action.url).host}.` }; }
      return { ok: false, message: 'Tabs and zoom need the Gaze Navigator extension. Nothing was changed.' };
    },
  };
}

export function startWebNavigator({ window = globalThis.window, document = window.document, interpret, loadCamera, loadAssistant = null, store = sessionStore(window), createCamera = createLocalCamera, createSpeech = createSpeechInput, embeddedFrames = null, onResult = null, browser = pageBrowser(window) } = {}) {
  const settings = { size: 'medium', listening: false, speak: false, requireAddress: false, source: 'pointer', cameraMode: 'eyes', assist: false, ...store.load() };
  settings.requireAddress = settings.requireAddress === true;
  // The camera follows the eyes (WebGazer's gaze estimate) or the head (head-pointer.js).
  const following = () => (settings.cameraMode === 'head' ? 'head' : 'eyes');
  const host = document.createElement('div');
  host.id = 'gaze-web-navigator';
  const shadow = host.attachShadow({ mode: 'open' });
  // Constructable stylesheets are not subject to a website's style-src policy.
  const sheet = 'adoptedStyleSheets' in shadow && window.CSSStyleSheet ? new window.CSSStyleSheet() : null;
  if (sheet) {
    sheet.replaceSync(STYLE);
    shadow.adoptedStyleSheets = [sheet];
  }
  shadow.innerHTML = `${sheet ? '' : `<style>${STYLE}</style>`}
  <div class="layer" aria-hidden="true"><div class="outlines"></div><div class="circle"></div><div class="calibration-dot hidden"></div></div>
  <section class="panel" role="region" aria-label="Gaze Navigator">
    <div class="head"><h2>Gaze Navigator</h2><button class="collapse" aria-expanded="true">Hide</button></div>
    <div class="body">
      <p class="status" role="status" aria-live="polite"></p>
      <p class="transcript" aria-live="off"></p>
      <p class="dictation hint" role="status" hidden></p>
      <div class="prompt" role="group" aria-label="Answer the question"></div>
      <div class="row">
        <button class="listen" aria-pressed="false">Start listening</button>
        <button class="pause" aria-pressed="false">Pause</button>
        <button class="cancel">Cancel</button>
      </div>
      <form class="typed">
        <input class="instruction" aria-label="Typed instruction" title="Alt+Shift+G: type without leaving website focus" placeholder="e.g. open pricing" autocomplete="off" />
        <button type="submit">Do it</button>
      </form>
      <details class="settings"><summary>Tracking and settings</summary>
        <div class="row" role="group" aria-label="Tracking">
          <button class="use-pointer" aria-pressed="true">Pointer</button>
          <button class="use-camera" aria-pressed="false">Camera</button>
          <button class="use-head" aria-pressed="false">Head</button>
          <button class="recalibrate" disabled>Recalibrate</button>
        </div>
        <div class="row">
          <label>Circle size <select class="size"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
          <label><input type="checkbox" class="speak" /> Speak feedback</label>
        </div>
        <p class="hint">With Speak feedback enabled, wait for each reply to finish before speaking an instruction. Overlapping phrases are ignored, including later final results. Pause, stop and cancel still work, and you can type or use the panel buttons at any time. This is not acoustic echo cancellation.</p>
        <label><input type="checkbox" class="speech-address" /> Require “Navigator” before spoken instructions</label>
        <p class="hint">When enabled, begin every spoken instruction, confirmation and dictation phrase with “Navigator”, for example “Navigator, open help”. Pause, stop and cancel still work alone. Say “require navigator prefix” to enable, or “Navigator turn off navigator prefix” to disable. Typed instructions stay available. This routes recognized words; it does not identify who spoke or guarantee that background speech is ignored.</p>
        <div class="assist-row">
          <label><input type="checkbox" class="assist" /> Smarter target matching</label>
          <p class="hint assist-note">Understands names that do not match exactly, such as "show the ratings" for Reviews, using the WaterSheep model on this device. It downloads 158 MB once; instructions are not sent anywhere.</p>
          <p class="hint assist-state" role="status"></p>
        </div>
        <div class="speech-row">
          <p class="hint speech-mode" role="status"></p>
          <button class="speech-install" hidden>Use on-device speech</button>
        </div>
      </details>
      <details class="context-details"><summary class="context-summary">In the circle</summary><ol class="context"></ol></details>
      <details><summary>What can I say?</summary>
      <p class="hint">Keep website suggestions open: focus the page, press Alt+Shift+G, type a command, then Enter. Escape cancels. Use direct keyboard characters or paste.</p>
        <p class="hint">"Open pricing", "click the second one", "type hello into search", "start dictation into Message" (then speak phrases; "stop dictation" returns to commands), "delete last word", "replace Tuesday with Friday", "choose large", "add option Jazz to Genres", "remove option Jazz from Genres", "scroll down", "go back", "submit", "pause", "cancel". Numbers answer questions; "confirm" approves a consequential action.</p>
        <p class="hint">To correct words in a text field: "select text Tuesday", then "replace selected text with Friday". For repeated words, say "select second occurrence of Tuesday". "Undo" restores the last text edit. After looking away, say "continue typing" and more words to append in the focused regular field; "undo typing" can recover it when no text field is in the circle.</p>
        <p class="hint">Selected text: say "delete selected text" or "remove highlighted text" to remove only a native selected range. Say "undo" to restore it. Select words first; changed or unavailable selections refuse.</p>
        <p class="hint">This panel: say "hide the navigator" to keep only its answers, "show the navigator" to bring it back, or "move the navigator to the top left" (any corner, or up and down). "Place the navigator automatically" lets it move out of the way of website controls again.</p>
        <p class="hint">Panels: "expand FAQ" or "collapse that panel" requests that state. Repeating it keeps the state. Native details and binary ARIA buttons use the website’s click behavior; unsupported state is refused.</p>
        <p class="hint">Radio choices: "select Express radio button" or "select that radio button" selects and checks the requested choice. Repeating it keeps it selected. Native and binary ARIA radios use the website’s click behavior; mixed or missing custom state is refused.</p>
        <p class="hint">Checkboxes: "check Newsletter" or "uncheck that checkbox" sets the requested state; repeating it keeps that state. Binary ARIA checkboxes and switches use one website click and verify its state. Missing or mixed state is refused. "Click" and "toggle" keep ordinary website activation.</p>
        <p class="hint">Dates, times and numbers: "set departure to November first", "set appointment time to 2:30 pm", "set guests to four", "set volume to forty percent", "set reporting month to next month". Spoken words and digits both work. "Undo departure date field" restores the earlier value. The website's own min, max and step rules still apply.</p>
        <p class="hint">Custom lists and sliders: "set size to large" or "choose Finland from country" opens a website's own list, types to search it when it is a search box, and picks the named choice. Custom sliders move by their arrow keys and stop if they cannot reach the exact value.</p>
        <p class="hint">"Use camera" starts webcam gaze and a no-click calibration (look at each dot); "recalibrate" repeats it; "stop camera" or "use pointer" turns the camera off.</p>
        <p class="hint">"Use head pointer" makes the circle follow where your nose points instead of your eyes: the webcam sees how your head is turned. Turning your head is more work but steadier than webcam eye tracking. Its calibration asks you to point your nose at each dot.</p>
        <p class="hint">Say "make the circle bigger" or "make the circle smaller", or "use a small circle", "use a medium circle" or "use a large circle". This changes the visible area without acting on a page control. Give the page instruction again; previous questions are cancelled.</p>
        <p class="hint">The circle follows your gaze (or pointer). Looking at this panel keeps the last page area. Context is captured when you start speaking.</p>
      </details>
    </div>
  </section>`;
  const $ = selector => shadow.querySelector(selector);
  const ui = {
    circle: $('.circle'), outlines: $('.outlines'), panel: $('.panel'), status: $('.status'), dictation: $('.dictation'), transcript: $('.transcript'),
    prompt: $('.prompt'), listen: $('.listen'), pause: $('.pause'), cancel: $('.cancel'), form: $('.typed'),
    instruction: $('.instruction'), speechAddress: $('.speech-address'), size: $('.size'), speak: $('.speak'), context: $('.context'), summary: $('.context-summary'),
    collapse: $('.collapse'), dot: $('.calibration-dot'), usePointer: $('.use-pointer'), useCamera: $('.use-camera'), useHead: $('.use-head'),
    recalibrate: $('.recalibrate'), assist: $('.assist'), assistState: $('.assist-state'), assistRow: $('.assist-row'),
    speechMode: $('.speech-mode'), speechInstall: $('.speech-install'),
  };
  // The element list is open by default only where the panel has room to spare.
  if ((window.innerHeight ?? 0) > 700) $('.context-details').open = true;
  document.documentElement.append(host);
  // The browser's top layer keeps the panel and circle above website content (cookie banners, sticky headers),
  // whatever z-index the website uses. A manual popover never closes on its own.
  if (typeof host.showPopover === 'function') {
    host.popover = 'manual';
    try { host.showPopover(); } catch { /* left in the page's own stacking order */ }
  }
  // Reserve scroll space so the panel never permanently covers the end of a page.
  const spacer = document.createElement('div');
  spacer.id = 'gaze-web-navigator-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  document.body.append(spacer);
  const reserve = () => { spacer.style.height = `${ui.panel.getBoundingClientRect().height + 24}px`; };
  const resizeObserver = new window.ResizeObserver(reserve);
  resizeObserver.observe(ui.panel);

  // The assistant is attached only after the model has loaded; until then rules answer alone.
  let assistant = null, assistLoad = 0, stopped = false;
  let closing = false;
  let sourceGeneration = 0;
  const assistantRelay = {
    needs: (...args) => Boolean(assistant?.needs(...args)),
    improve: async (...args) => {
      try { return await assistant.improve(...args); }
      finally { expireCameraSilence(); }
    },
  };
  // Personal details kept for filling forms, on this device only (see the store); never spoken or shown in replies.
  let details = {};
  Promise.resolve(store.loadDetails?.()).then(saved => { if (saved && typeof saved === 'object') details = { ...saved, ...details }; }).catch(() => {});
  const listOf = kinds => kinds.length > 1 ? `${kinds.slice(0, -1).join(', ')} and ${kinds.at(-1)}` : kinds[0] ?? '';
  const savedDetails = {
    remember({ field, value }) {
      details = { ...details, [field]: value };
      store.saveDetails?.(details);
      return { ok: true, message: `Your ${detailLabel(field)} is saved on this device. On a form, say "fill in my details".` };
    },
    forget({ field }) {
      details = field ? Object.fromEntries(Object.entries(details).filter(([kind]) => kind !== field)) : {};
      store.saveDetails?.(details);
      return { ok: true, message: field ? `Your ${detailLabel(field)} is forgotten.` : 'All your saved details are forgotten.' };
    },
    list() {
      const kinds = Object.keys(details).filter(kind => details[kind]);
      return { ok: true, message: kinds.length ? `Saved on this device: your ${listOf(kinds.map(detailLabel))}.` : 'No details are saved. Say, for example, "remember my email is …".' };
    },
    plan({ only }, used) {
      if (!Object.keys(details).length) return { ok: false, message: 'No details are saved yet. Say, for example, "remember my email is …", then try again.' };
      const fields = planDetails(formDetailFields(document, { x: used.x, y: used.y, exclude: host, scopeCache }), details, only);
      if (!fields.length) return { ok: false, message: only ? `No empty field for your ${detailLabel(only)} was found in the form nearest your gaze.` : 'No empty field this form asks for matches your saved details.' };
      return { ok: true, fields, message: `Fill ${fields.length === 1 ? `"${fields[0].name || detailLabel(fields[0].kind)}"` : `${fields.length} fields (${listOf(fields.map(field => field.name || detailLabel(field.kind)))})`} with your saved details? Say confirm, or cancel.` };
    },
    fill(plan) {
      const filled = fillDetails(plan ?? []);
      return filled.length ? { ok: true, filled, message: `Filled ${listOf(filled.map(field => field.name || detailLabel(field.kind)))}. Check them before sending; say undo to empty them again.` }
        : { ok: false, message: 'The form changed and those fields cannot be written. Nothing was filled.' };
    },
    restore(entries) {
      restoreDetails(entries);
      return { message: `Emptied ${listOf(entries.map(field => field.name || detailLabel(field.kind)))} again.` };
    },
  };

  const controller = createController({ window, interpret, commands: { tracking: setSource, calibrate, circleSize: setCircleSize, speechPrefix: setSpeechAddress, panel: changePanel, numbers: setNumbers, find: findOnPage, keyTarget: () => keyEventTarget(document, pageFocus(), host), keys: action => pressKeys(document, pageFocus(), action, { exclude: host }), media: controlPageMedia, popup: findPopupControl, details: savedDetails, browser: action => browser.run(action) }, assistant: assistantRelay });
  // "Find": the words looked for, where they appear and which of those places is shown.
  let found = null;
  // "Show numbers": every control on screen numbered, kept up to date while the page scrolls or changes.
  let numbering = null, numbered = [], numbersTimer = null;
  const filter = createGazeFilter();
  const camera = createCamera({
    document, window, load: loadCamera, store, mount: shadow,
    onGaze: (x, y, time) => track(x, y, time),
    onLost: reason => loseCameraContext(true, reason),
  });
  // The running calibration, or the accuracy check after it (which takes gaze samples); both block page actions.
  let calibration = null;
  let point = null;
  let cameraUnavailable = false;
  let cameraSilenceTimer = null;
  let cameraEstimateAt = null;
  let cameraVisibleSince = null;
  let cameraCalibrated = false;
  let calibrationGeneration = 0;
  let viewport = { width: window.innerWidth, height: window.innerHeight };
  let frozen = false;
  let context = { elements: [], region: null };
  // Set once speech exists: on-device recognition favours the names of the controls in and just around the circle.
  let contextChanged = () => {};
  let spokenContext = null;
  let spokenInvalid = false;
  let promptContext = null;
  let lastCapture = -Infinity;
  let trailing = null;
  let frame = null;

  const radius = () => RADII[settings.size] ?? RADII.medium;

  let observedDictation = null;
  const dictationScopes = [];
  const dictationObserver = new window.MutationObserver(records => {
    const target = controller.dictation?.element;
    if (!target) return;
    const restricted = new Set(['readonly', 'disabled', 'aria-disabled', 'aria-readonly', 'inert', 'type', 'autocomplete', 'contenteditable']);
    // Even a lock and unlock in one mutation batch retires the explicit choice. A later phrase needs a restart.
    const bindingChanged = records.some(record => record.type === 'attributes'
      ? restricted.has(record.attributeName) && composedContains(record.target, target)
      : [...record.removedNodes].some(node => dictationScopes.some(scope => node === scope || node.contains(scope))));
    if (bindingChanged || !target.isConnected || !canWrite(target) || isSensitive(target)) {
      controller.endDictation();
      feedback({ message: 'Dictation stopped because the selected field changed. Start dictation again when ready.' });
    }
  });

  function renderDictation() {
    const active = controller.dictation;
    if ((active?.element ?? null) !== observedDictation) {
      dictationObserver.disconnect(); dictationScopes.length = 0;
      observedDictation = active?.element ?? null;
      for (let scope = observedDictation; scope;) {
        dictationScopes.push(scope);
        const root = scope.getRootNode();
        dictationObserver.observe(root, { subtree: true, childList: true, attributes: true });
        scope = root.host ?? scope.ownerDocument.defaultView.frameElement;
      }
    }
    const text = active ? `Dictating into ${active.name || 'the field'}. ${settings.requireAddress ? 'Begin every spoken phrase with “Navigator”. ' : ''}Say “stop dictation” for commands, “undo typing” for the last phrase, or pause/cancel.` : '';
    if (ui.dictation.textContent !== text) ui.dictation.textContent = text;
    ui.dictation.hidden = !active;
  }

  const feedbackVoice = createFeedbackVoice(window);
  // Keep an overlapping capture blocked even when its final transcript arrives after output ends.
  let spokenDuringFeedback = false, speechCaptureActive = false;
  function resetSpeechCapture() { spokenContext = null; spokenInvalid = false; spokenDuringFeedback = false; speechCaptureActive = false; }
  const feedbackWait = 'Spoken feedback is playing or overlapped this phrase; speech ignored. Wait for it to finish, or say pause or cancel. Typed instructions remain available.';

  function feedback({ message, tone = 'info', pending = null }) {
    message = addressedFeedback(message, pending, settings.requireAddress);
    ui.status.textContent = message;
    ui.status.className = `status ${tone}`;
    renderPrompt();
    if (settings.speak && !document.hidden && !closing && !stopped) {
      if (feedbackVoice.say(message) && speechCaptureActive) spokenDuringFeedback = true;
    }
  }

  function renderPrompt() {
    renderDictation();
    const pending = controller.pending;
    ui.prompt.replaceChildren();
    if (!pending) return;
    const choices = pending.kind === 'confirm'
      ? [['Confirm', 'confirm'], ['Cancel', 'cancel']]
      : [...pending.candidates.map(candidate => [`${candidate.number}: ${candidate.label}`, `${candidate.number}`]), ['Cancel', 'cancel']];
    for (const [label, utterance] of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => run(utterance, null));
      ui.prompt.append(button);
    }
    renderOutlines();
  }

  // The place shown by "find", outlined wherever the page has scrolled it.
  function drawFound() {
    const match = found?.matches[found.index];
    if (!match || !match.range.startContainer.isConnected) return;
    const rect = match.range.getBoundingClientRect(), box = document.createElement('div');
    box.className = 'outline found';
    Object.assign(box.style, { left: `${rect.left - 3}px`, top: `${rect.top - 3}px`, width: `${rect.width + 6}px`, height: `${rect.height + 6}px` });
    ui.outlines.append(box);
  }
  function renderOutlines() {
    renderDictation();
    const pending = controller.pending;
    const question = pending?.kind === 'clarify' ? new Map() : null;
    for (const candidate of question ? pending.candidates : []) {
      const previous = question.get(candidate.elementId);
      question.set(candidate.elementId, previous ? `${previous}, ${candidate.number}` : String(candidate.number));
    }
    // While numbers are shown (and no question is asked), they replace the circle's own numbers.
    if (numbering && !question && !pending?.farTarget) {
      ui.outlines.replaceChildren();
      if (controller.paused || calibration) return;
      for (const element of numbered) {
        if (!element.element.isConnected) continue;
        const rect = viewportRect(element.element, element.frames), box = document.createElement('div'), badge = document.createElement('span');
        box.className = 'outline numbered';
        Object.assign(box.style, { left: `${rect.left - 2}px`, top: `${rect.top - 2}px`, width: `${rect.width + 4}px`, height: `${rect.height + 4}px` });
        badge.className = 'badge';
        badge.textContent = String(element.number);
        box.append(badge);
        ui.outlines.append(box);
      }
      drawFound();
      return;
    }
    const shownContext = controller.paused || calibration ? null : pending ? promptContext : spokenContext ?? context;
    // A question about controls outside the circle outlines those too; confirming a far control outlines only it.
    const outside = question ? [...(shownContext?.nearby ?? []), ...(pending.candidates.some(candidate => candidate.elementId > 200) ? shownContext?.onScreen?.() ?? [] : [])] : [];
    const shown = !shownContext ? [] : pending?.farTarget ? [pending.farTarget] : [...(shownContext.elements ?? []), ...outside];
    ui.outlines.replaceChildren();
    for (const element of shown) {
      if (question && !question.has(element.id)) continue;
      if (!element.element.isConnected) continue;
      // Controls in an embedded frame from another site keep the rectangle they were captured with.
      const rect = element.element.remote ? element.rect : viewportRect(element.element, element.frames);
      const box = document.createElement('div');
      box.className = question ? 'outline question' : 'outline';
      Object.assign(box.style, { left: `${rect.left - 3}px`, top: `${rect.top - 3}px`, width: `${rect.width + 6}px`, height: `${rect.height + 6}px` });
      // The control waiting for confirmation is outlined without a number: it is not chosen by saying one.
      if (!pending?.farTarget) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = question ? question.get(element.id) : element.id;
        box.append(badge);
      }
      ui.outlines.append(box);
    }
    drawFound();
  }

  function renderContextList() {
    const items = context.elements.map(element => {
      const item = document.createElement('li');
      item.value = element.id;
      item.textContent = describeElement(element);
      return item;
    });
    for (const embedded of context.unreachable ?? []) {
      const item = document.createElement('li');
      item.className = 'unreachable';
      item.textContent = `${embedded.name}: content from another site that the navigator cannot reach`;
      items.push(item);
    }
    ui.context.replaceChildren(...items);
    ui.summary.textContent = `In the circle (${context.elements.length})`;
  }

  // The page element with focus. Typing an instruction into the navigator's own panel moves focus there, but a
  // following correction ("change Tuesday to Friday") still means the page field that had it before.
  let lastPageFocus = null;
  const inPanel = active => active === host || active?.getRootNode?.() === shadow;
  const onFocusIn = () => {
    pageChanged = true;
    const active = deepActiveElement(document);
    if (!inPanel(active)) {
      lastPageFocus = active;
      if (controller.dictation && controller.dictation.element !== active) {
        controller.endDictation();
        feedback({ message: 'Dictation stopped because the website focus changed. Start dictation again when ready.' });
      }
    }
  };
  // Focus leaving to nothing (a click on the page background) forgets the field.
  const onFocusOut = event => { if (!event.relatedTarget) { lastPageFocus = null; controller.endDictation(); renderDictation(); } };
  const pageFocus = () => { const active = deepActiveElement(document); return inPanel(active) ? lastPageFocus : active; };

  // The panel sits in the top layer, so it would hide fixed website controls under it (cookie banners, chat
  // buttons, sticky toolbars). Each corner is scored by the fixed or sticky controls it would hide, with dialogs
  // and consent banners counting most, and by whether it would cover the gaze circle (where the user is looking,
  // unless that is the panel itself); the panel moves only to a corner that hides less, and never while focus is in
  // it (someone is typing).
  const CORNERS = [[false, false], [true, false], [false, true], [true, true]]; // [left, top]
  const PLACEMENT_MS = 400;
  const GAZE_WEIGHT = 5;
  const CONTROLS = 'a[href], button, input, select, textarea, [role=button], [role=link], [role=checkbox], [tabindex]';
  // Ordinary page controls under a corner count too, at half weight: they could be scrolled out from under the panel,
  // but a corner over the page's main controls (a switch, a form) hides what the person came to use, as moving away
  // from a "Back to top" button into the content did on the WAI-ARIA examples.
  const ORDINARY = `${CONTROLS}, [role=switch], [role=radio], [role=tab], [role=menuitem], [role=option], [role=slider], [role=treeitem]`;
  const ORDINARY_WEIGHT = 0.5;
  // Together they never outweigh covering the gaze (GAZE_WEIGHT), and on a narrow screen, where the panel is a sheet
  // across the width, they are not counted: it would only swap which half of the page it covers.
  const ORDINARY_CAP = 4;
  const DIALOGS = '[role=dialog], [role=alertdialog], [aria-modal=true]';
  let placement = 0;
  const fixedLayer = node => {
    if (node === host || node === spacer) return null;
    for (let scope = node, depth = 0; scope?.nodeType === 1 && scope !== document.body && depth < 25; scope = scope.parentElement, depth++) {
      if (['fixed', 'sticky'].includes(window.getComputedStyle(scope).position)) return scope;
    }
    return null;
  };
  const hides = (left, top, width, height) => {
    const layers = new Set();
    for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.1, 0.4, 0.7, 0.95]) {
      for (const node of document.elementsFromPoint(left + width * fx, top + height * fy)) {
        const layer = fixedLayer(node);
        if (layer) layers.add(layer);
      }
    }
    let score = 0;
    for (const layer of layers) {
      const weight = layer.matches(DIALOGS) || layer.closest(DIALOGS) || layer.querySelector(DIALOGS) || /\b(cookies?|consent)\b/i.test(layer.textContent.slice(0, 2000)) ? 10 : 1;
      for (const control of [layer, ...layer.querySelectorAll(CONTROLS)]) {
        if (!control.matches(CONTROLS)) continue;
        const box = control.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
        if (box.width && x >= left && x <= left + width && y >= top && y <= top + height) score += weight;
      }
    }
    let ordinary = 0;
    if (width <= window.innerWidth / 2) for (const control of document.querySelectorAll(ORDINARY)) {
      const box = control.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
      if (box.width && box.height && x >= left && x <= left + width && y >= top && y <= top + height && !fixedLayer(control)) ordinary += ORDINARY_WEIGHT;
    }
    return score + Math.min(ORDINARY_CAP, ordinary);
  };
  function placePanel() {
    placement = 0;
    // A corner the person chose stays until they let the panel place itself again.
    if (stopped || shadow.activeElement || settings.corner) return;
    const { width, height } = ui.panel.getBoundingClientRect(), margin = 12;
    const at = ([left, top]) => [left ? margin : window.innerWidth - margin - width, top ? margin : window.innerHeight - margin - height];
    const here = at([ui.panel.classList.contains('left'), ui.panel.classList.contains('top')]), r = radius();
    const reading = point && point.x >= here[0] && point.x <= here[0] + width && point.y >= here[1] && point.y <= here[1] + height;
    const covers = (left, top) => !reading && point && point.x + r > left && point.x - r < left + width && point.y + r > top && point.y - r < top + height;
    const cost = corner => { const [left, top] = at(corner); return hides(left, top, width, height) + (covers(left, top) ? GAZE_WEIGHT : 0); };
    const current = cost([ui.panel.classList.contains('left'), ui.panel.classList.contains('top')]);
    if (!current) return;
    const [best, score] = CORNERS.map(corner => [corner, cost(corner)]).reduce((a, b) => (b[1] < a[1] ? b : a));
    if (score >= current) return;
    ui.panel.classList.toggle('left', best[0]);
    ui.panel.classList.toggle('top', best[1]);
  }
  function schedulePlacement() {
    if (!placement && typeof document.elementsFromPoint === 'function') placement = window.setTimeout(placePanel, PLACEMENT_MS);
  }

  // Capturing scans the page, so a resting gaze on an unchanged page reuses the last context.
  const scopeCache = { entry: null, rects: null };
  let pageChanged = true, capturedAt = null;
  const pageObserver = new window.MutationObserver(records => {
    if (!records.some(record => record.target !== host)) return;
    pageChanged = true;
    scopeCache.rects = null;
    if (records.some(record => record.type === 'childList')) scopeCache.entry = null;
    schedulePlacement();
    scheduleNumbers();
  });
  pageObserver.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  schedulePlacement();

  function recapture(force = false) {
    if (!point || controller.paused) return;
    const time = window.performance.now();
    if (!force && !pageChanged && capturedAt && Math.hypot(point.x - capturedAt.x, point.y - capturedAt.y) < Math.max(RESTING_PX, radius() * RESTING_FRACTION) &&
      capturedAt.radius === radius() && time - lastCapture < RESTING_MAX_AGE_MS) return;
    if (!force && time - lastCapture < CONTEXT_INTERVAL_MS) {
      // Capture once more when the interval ends, so a resting gaze always gets fresh context.
      trailing ??= window.setTimeout(() => {
        trailing = null;
        recapture(true);
      }, CONTEXT_INTERVAL_MS - (time - lastCapture));
      return;
    }
    window.clearTimeout(trailing);
    trailing = null;
    lastCapture = time;
    pageChanged = false;
    capturedAt = { x: point.x, y: point.y, radius: radius() };
    context = captureContext(document, { x: point.x, y: point.y, radius: radius(), exclude: host, scopeCache, focus: pageFocus() });
    context.focusIsCurrent = element => pageFocus() === element;
    contextChanged(context);
    // Embedded frames from other sites answer later; their controls join this context when they do.
    const captured = context;
    embeddedFrames?.extend(captured, {
      isCurrent: () => !stopped && [context, spokenContext, promptContext].includes(captured),
      changed: () => { if (context === captured) renderContextList(); if (!controller.pending) renderOutlines(); },
    });
    const focused = context.elements.find(element => element.element === pageFocus());
    context.focusedId = focused?.id ?? null;
    context.selectionFocusedId = context.disclosureElements?.find(element => element.element === pageFocus())?.id ?? context.focusedId;
    renderContextList();
    if (!controller.pending) renderOutlines();
  }

  function draw() {
    frame = null;
    if (!point) return;
    const size = radius() * 2;
    Object.assign(ui.circle.style, { width: `${size}px`, height: `${size}px`, transform: `translate(${point.x - radius()}px, ${point.y - radius()}px)` });
    ui.circle.classList.add('visible');
    ui.circle.classList.toggle('frozen', frozen);
    ui.circle.classList.toggle('paused', controller.paused);
    recapture();
  }

  function schedule() {
    if (frame === null) frame = window.requestAnimationFrame(draw);
  }

  function expireCameraSilence(now = window.performance.now()) {
    if (settings.source === 'camera' && cameraEstimateAt !== null && now - cameraEstimateAt >= 5000) loseCameraContext();
  }

  function clearCameraSilence() {
    window.clearTimeout(cameraSilenceTimer); cameraSilenceTimer = null; cameraEstimateAt = null;
  }

  // A missing estimate, silent estimator or capture disconnect cannot leave an old page target actionable.
  function loseCameraContext(announce = true, reason = null) {
    clearCameraSilence();
    if (settings.source !== 'camera' || cameraUnavailable) return;
    cameraUnavailable = true;
    point = null; frozen = false; filter.reset();
    window.clearTimeout(trailing); trailing = null;
    capturedAt = null;
    context = { elements: [], region: null, trackingUnavailable: true };
    if (keyboardContext) keyboardContext = { elements: [], region: null, trackingUnavailable: true };
    spokenInvalid ||= !!spokenContext;
    spokenContext = null; promptContext = null;
    controller.cancel();
    ui.circle.classList.add('lost'); ui.circle.classList.remove('visible');
    contextChanged(context); renderContextList(); renderOutlines();
    if (announce && !calibration) feedback({ message: reason === 'frozen'
      ? 'The camera picture has stopped changing, so gaze cannot be trusted. Check the camera (another app may be holding it), or say use pointer.'
      : 'Camera tracking is lost. Keep your face visible and look at the page again, or say use pointer.', tone: 'error' });
  }

  // Viewport coordinates from the active source. Gaze resting on the panel keeps the last page area.
  function track(x, y, time) {
    if (stopped || closing || document.hidden) return;
    if (settings.source === 'camera' && (!Number.isFinite(time) || (cameraVisibleSince !== null && time <= cameraVisibleSince))) return;
    if (settings.source === 'camera' && Number.isFinite(x) && Number.isFinite(y)) {
      const now = window.performance.now();
      // A resumed estimate must retire the old target before refreshing an overdue deadline.
      expireCameraSilence(now);
      clearCameraSilence();
      cameraEstimateAt = now;
      const generation = sourceGeneration;
      cameraSilenceTimer = window.setTimeout(() => {
        cameraSilenceTimer = null;
        if (!stopped && !closing && generation === sourceGeneration) loseCameraContext();
      }, 5000);
    }
    if (calibration) {
      const next = calibration.sample && filter.filter(x, y, time);
      if (next) calibration.sample(next.x, next.y);
      return;
    }
    const next = settings.source === 'camera' ? filter.filter(x, y, time) : { x, y };
    if (!next) return;
    if (settings.source === 'camera') {
      const panel = ui.panel.getBoundingClientRect();
      frozen = next.x >= panel.left && next.x <= panel.right && next.y >= panel.top && next.y <= panel.bottom;
      if (frozen) {
        ui.circle.classList.add('frozen');
        return;
      }
    }
    cameraUnavailable = false;
    ui.circle.classList.remove('lost');
    point = next;
    schedule();
  }

  const onPointer = event => {
    if (settings.source !== 'pointer') return;
    // Looking at the panel keeps the last page context, so instructions can be typed or chosen there.
    frozen = event.composedPath().includes(host);
    if (frozen) {
      ui.circle.classList.add('frozen');
      return;
    }
    track(event.clientX, event.clientY, event.timeStamp);
  };
  window.addEventListener('pointermove', onPointer, true);
  // Pointer events over a same-origin frame go to that frame's document; translate them back.
  let keyboardContext = null, keyboardDraft = '';
  function finishKeyboard() {
    ui.instruction.value = keyboardDraft;
    ui.instruction.readOnly = false;
    ui.transcript.setAttribute('aria-live', 'off');
    keyboardContext = null;
  }
  const keyboard = createKeyboardCommands({
    getActiveElement: () => deepActiveElement(document),
    onStart() {
      if (stopped || closing) return false;
      if (inPanel(deepActiveElement(document))) {
        feedback({ message: 'Focus the website first, then press Alt+Shift+G to type without leaving it.' });
        return false;
      }
      recapture(true);
      keyboardContext = context;
      keyboardDraft = ui.instruction.value;
      ui.instruction.readOnly = true;
      ui.transcript.setAttribute('aria-live', 'polite');
      feedback({ message: 'Keyboard command mode. Type an instruction; Enter runs it and Escape cancels. Website focus stays in place.' });
      return true;
    },
    onChange({ text, selectionStart, selectionEnd }) {
      ui.instruction.value = text;
      ui.instruction.setSelectionRange(selectionStart, selectionEnd);
      ui.transcript.textContent = `Keyboard command: ${text || '(empty)'}` +
        (selectionStart !== selectionEnd ? `. Selected: ${text.slice(selectionStart, selectionEnd)}` : '');
    },
    onSubmit(text) {
      const captured = { ...keyboardContext, preserveFocus: true };
      finishKeyboard();
      ui.transcript.textContent = `Typed: ${text}`;
      run(text, captured, 'typed');
    },
    onCancel() {
      finishKeyboard();
      if (!stopped && !closing) feedback({ message: 'Keyboard command cancelled. Website typing is restored.' });
    },
    onUnavailable(message) { feedback({ message, tone: 'error' }); },
  });
  keyboard.attach(document);
  const watchedFrames = new WeakSet();
  const frameListeners = [];
  const onFrameChange = () => { scopeCache.entry = null; scopeCache.rects = null; pageChanged = true; };
  const onFrameLoad = event => { if (/^I?FRAME$/.test(event.target?.tagName ?? '')) { onFrameChange(); watchFrames(); } };
  function watchFrames() {
    for (const { document: frameDocument, frames } of sameOriginFrames(document, host)) {
      if (watchedFrames.has(frameDocument)) continue;
      watchedFrames.add(frameDocument);
      keyboard.attach(frameDocument);
      frameDocument.addEventListener('load', onFrameLoad, true);
      frameDocument.addEventListener('focusin', onFocusIn, true);
      frameDocument.addEventListener('focusout', onFocusOut, true);
      const listener = event => {
        if (settings.source !== 'pointer') return;
        frozen = false;
        const { x, y } = frameOffset(frames);
        track(event.clientX + x, event.clientY + y, event.timeStamp);
      };
      frameDocument.addEventListener('pointermove', listener, true);
      frameListeners.push([frameDocument, listener]);
    }
  }
  watchFrames();
  window.addEventListener('load', watchFrames, true);
  // Embedded frames from other sites pass their pointer moves on through the extension.
  const detachEmbedded = embeddedFrames?.attach({ document, exclude: host, onPointer: (x, y, time) => {
    if (settings.source !== 'pointer') return;
    frozen = false;
    track(x, y, time);
  } });
  // Frame load events reach their document in capture phase, but skip its window.
  document.addEventListener('load', onFrameLoad, true);
  // Scrolling moves everything under the circle; recapture through the usual interval instead of on every event.
  const refresh = () => { pageChanged = true; scopeCache.rects = null; recapture(); schedulePlacement(); scheduleNumbers(); };
  window.addEventListener('scroll', refresh, true);
  const onViewportResize = () => {
    const next = { width: window.innerWidth, height: window.innerHeight };
    const changed = next.width !== viewport.width || next.height !== viewport.height;
    viewport = next;
    if (changed && settings.source === 'camera' && camera.state === 'ready') {
      calibrationGeneration++;
      cameraCalibrated = false;
      const active = calibration; calibration = null; active?.cancel();
      camera.resetCalibration();
      loseCameraContext(false);
      feedback({ message: 'The window size changed. Camera calibration is not ready. Say recalibrate and finish the dots, or say use pointer.', tone: 'error' });
    }
    refresh();
  };
  window.addEventListener('resize', onViewportResize);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  onFocusIn();

  // `via` says where the instruction came from (speech, typed or a panel button) for `onResult`, which hears each
  // instruction's final answer. Only the website's own pages pass `onResult`; the extension never does.
  function run(utterance, captured, via = 'panel', alternatives = []) {
    if (stopped || closing) return { message: 'Navigator is stopped.', tone: 'info' };
    if (document.hidden) return { message: 'Return to this tab to give an instruction.', tone: 'info' };
    expireCameraSilence();
    keyboard.cancel();
    // While calibrating the circle is hidden, so instructions cannot target page elements.
    const used = settings.source === 'camera' && (!cameraCalibrated || calibration)
      ? { elements: [], region: null, trackingUnavailable: 'calibration' }
      : settings.source === 'camera' && cameraUnavailable
        ? { elements: [], region: null, trackingUnavailable: true }
        : captured ?? spokenContext ?? (recapture(true), context);
    spokenContext = null;
    // Numbers stay usable without the gaze, but not while calibrating.
    if (numbering && used.trackingUnavailable !== 'calibration') used.numbered = numbered;
    // The page's videos and sounds, looked for once per instruction and only when it might be about them.
    if (used.trackingUnavailable !== 'calibration') {
      let media = null;
      used.media = () => (media ??= findMedia(document, { x: used.x, y: used.y, exclude: host, scopeCache }));
    }
    const result = controller.handle(utterance, used, { alternatives });
    show(result, used);
    const report = answer => { try { onResult?.({ utterance, via, source: settings.source, ...outcomeOf(answer) }); } catch { /* A listener's failure is its own. */ } };
    if (!result.followUp) report(result);
    // A model-assisted answer follows unless a newer instruction came first.
    result.followUp?.then(later => { if (later && !stopped && !closing) { show(later, used); report(later); } });
    return result;
  }

  function show(result, used) {
    if (calibration && (result.cancelled || result.paused)) calibration.cancel();
    promptContext = result.pending ? (result.keepPrompt && promptContext ? promptContext : used) : null;
    ui.pause.setAttribute('aria-pressed', String(controller.paused));
    ui.pause.textContent = controller.paused ? 'Resume' : 'Pause';
    feedback(result);
    if (result.performed) learnFrom(result.aimed, used);
    if (result.performed) {
      // Shown after a navigation this action may cause; ignored if it arrives much later.
      store.save({ ...settings, announce: result.message, announcedAt: Date.now() });
      window.setTimeout(() => recapture(true), 50);
      scheduleNumbers();
    }
    renderOutlines();
  }

  // A control the user named inside the circle and then used shows where they were looking. In camera mode it becomes
  // one more calibration sample, which corrects drift as they work: only small controls near the gaze point, at most
  // one every LEARN_MS, saved like the calibration for later pages.
  let learnedAt = -Infinity;
  function learnFrom(aimed, used) {
    if (!aimed?.element?.isConnected || settings.source !== 'camera' || camera.state !== 'ready' || !cameraCalibrated || calibration || document.hidden || !Number.isFinite(used?.x)) return;
    const now = Date.now();
    if (now - learnedAt < LEARN_MS) return;
    const rect = viewportRect(aimed.element, aimed.frames), x = (rect.left + rect.right) / 2, y = (rect.top + rect.bottom) / 2;
    if (Math.max(rect.width, rect.height) > radius() * 2 || Math.hypot(x - used.x, y - used.y) > radius() * 1.5) return;
    learnedAt = now;
    const session = camera.session, source = sourceGeneration, training = calibrationGeneration;
    const width = window.innerWidth, height = window.innerHeight;
    Promise.resolve(camera.recordSample(x, y)).then(kept => {
      // An extension-frame reply can arrive after the old model was reset or replaced in this same camera session.
      if (kept && !stopped && !closing && !document.hidden && settings.source === 'camera' && camera.state === 'ready'
        && cameraCalibrated && !calibration && camera.session === session && sourceGeneration === source && calibrationGeneration === training
        && window.innerWidth === width && window.innerHeight === height) camera.saveCalibration({ width, height, now: Date.now() });
    }, () => {});
  }

  const speech = createSpeech(window, {
    // Keeps the earliest capture of an utterance: where the user looked when they began speaking.
    onSpeechStart() {
      if (!speechCaptureActive) spokenDuringFeedback = false;
      speechCaptureActive = true;
      if (feedbackVoice.active) spokenDuringFeedback = true;
      if (spokenDuringFeedback) { spokenContext = null; ui.transcript.textContent = feedbackWait; return; }
      if (controller.paused || spokenContext || spokenInvalid) return;
      if (settings.source === 'camera' && (cameraUnavailable || !cameraCalibrated || calibration)) { spokenInvalid = true; return; }
      recapture(true);
      spokenContext = context;
      ui.transcript.textContent = `Listening… ${context.elements.length} element${context.elements.length === 1 ? '' : 's'} captured.`;
    },
    onReset() {
      spokenContext = null; spokenInvalid = false; speechCaptureActive = false;
      // A no-speech/aborted error can precede a late final on the same native index.
      // Keep its overlap marker until that final or a genuinely new capture starts.
    },
    onInterim(text) {
      if (spokenDuringFeedback || feedbackVoice.active) { spokenDuringFeedback = true; spokenContext = null; ui.transcript.textContent = feedbackWait; return; }
      ui.transcript.textContent = settings.requireAddress && !addressedSpeech(text, [], true) ? 'Waiting for a “Navigator” address…' : `Heard: ${text}`; },
    onImmediate(text) {
      speechCaptureActive = false; spokenDuringFeedback = false;
      ui.transcript.textContent = `Heard: ${text}`;
      run(text, { elements: [] }, 'speech');
    },
    onFinal(text, alternatives = []) {
      speechCaptureActive = false;
      const overlapping = spokenDuringFeedback || feedbackVoice.active;
      spokenDuringFeedback = false;
      if (overlapping && !immediateSpeech(text)) {
        spokenContext = null; spokenInvalid = false; ui.transcript.textContent = feedbackWait; return;
      }
      expireCameraSilence();
      const addressed = addressedSpeech(text, alternatives, settings.requireAddress);
      const invalid = spokenInvalid; spokenInvalid = false;
      if (!addressed) {
        spokenContext = null;
        ui.transcript.textContent = 'No “Navigator” address heard; speech ignored. Begin the next instruction with “Navigator”.';
        return;
      }
      ui.transcript.textContent = `Heard: ${text}`;
      if (addressed.text) run(addressed.text, invalid ? { elements: [], region: null, trackingUnavailable: true } : null, 'speech', addressed.alternatives);
      else spokenContext = null;
    },
    onError(message) {
      spokenContext = null; spokenInvalid = false;
      feedback({ message, tone: 'error' });
      if (!speech.listening) setListening(false);
    },
    onState(state) {
      if (closing || stopped || document.hidden) return;
      if (state === 'stopped' && settings.listening && !speech.listening) setListening(false);
    },
    onMode() { renderSpeechMode(); },
  });
  // Where speech is recognized, and the one-time download that moves it onto this device where the browser offers it.
  function renderSpeechMode() {
    const mode = speech.mode;
    ui.speechMode.textContent = mode === 'device'
      ? 'Speech is recognized on this device, so no audio leaves it, and the names of controls around your gaze are favoured.'
      : mode === 'downloadable' ? 'Speech is recognized by the browser\'s online service. This browser can recognize it on this device instead after a one-time download.'
        : mode === 'service' ? 'Speech is recognized by the browser\'s online service.' : '';
    ui.speechInstall.hidden = mode !== 'downloadable';
  }
  ui.speechInstall.addEventListener('click', () => {
    ui.speechInstall.disabled = true;
    feedback({ message: 'Downloading on-device speech recognition. You can keep using the navigator meanwhile.' });
    Promise.resolve().then(() => speech.installLocal()).then(installed => {
      feedback(installed ? { message: 'Speech is now recognized on this device.', tone: 'success' }
        : { message: 'The browser did not install on-device speech. Speech keeps using its online service.', tone: 'error' });
    }, error => feedback({ message: `On-device speech could not be installed: ${error.message}`, tone: 'error' }))
      .finally(() => { ui.speechInstall.disabled = false; renderSpeechMode(); });
  });
  renderSpeechMode();
  contextChanged = captured => speech.setPhrases?.([...captured.elements, ...(captured.nearby ?? [])].map(item => item.name).filter(Boolean));

  function renderSource() {
    ui.usePointer.setAttribute('aria-pressed', String(settings.source === 'pointer'));
    ui.useCamera.setAttribute('aria-pressed', String(settings.source === 'camera' && following() === 'eyes'));
    ui.useHead.setAttribute('aria-pressed', String(settings.source === 'camera' && following() === 'head'));
    ui.recalibrate.disabled = settings.source !== 'camera' || camera.state !== 'ready';
  }

  function setSource(source) {
    if (source === 'pointer') {
      clearCameraSilence();
      sourceGeneration++;
      // Detach first so the cancelled calibration does not announce itself over "Camera off".
      const active = calibration;
      calibration = null;
      active?.cancel();
      const wasOn = camera.stop();
      // Turning the camera off also forgets the saved calibration (eye-patch training data).
      camera.clearCalibration();
      settings.source = 'pointer';
      cameraUnavailable = false;
      store.save(settings);
      filter.reset();
      ui.circle.classList.remove('lost');
      renderSource();
      return { ok: true, message: wasOn ? 'Camera off. The circle follows the pointer.' : 'The circle follows the pointer.' };
    }
    const mode = source === 'head' ? 'head' : 'eyes';
    const starting = { ok: true, message: 'Starting the camera. Allow camera access if the browser asks.' };
    if (camera.state !== 'off' && following() === mode) {
      return camera.state === 'starting' ? starting : { ok: true, message: 'The camera is already on. Say recalibrate to calibrate again.' };
    }
    settings.cameraMode = mode;
    camera.setMode(mode);
    if (camera.state === 'starting') {
      // Keep the pending start in charge. When it settles it will use the latest mode or return to pointer.
      store.save(settings);
      renderSource();
      return starting;
    }
    if (camera.state === 'ready') {
      // Switching between the eyes and the head while the camera is on: each needs its own calibration, and one
      // under way for the other is dropped.
      const generation = ++sourceGeneration, active = calibration;
      calibration = null;
      active?.cancel();
      cameraCalibrated = false;
      loseCameraContext(false);
      filter.reset();
      settings.source = 'camera';
      store.save(settings);
      renderSource();
      restoreOrCalibrate(generation).then(result => { if (generation === sourceGeneration && result && !stopped && !closing) feedback(result); });
      return { ok: true, message: mode === 'head' ? 'The circle now follows your head.' : 'The circle now follows your eyes.' };
    }
    const generation = ++sourceGeneration;
    settings.source = 'camera';
    cameraCalibrated = false;
    loseCameraContext(false);
    store.save(settings);
    renderSource();
    camera.start().then(async result => {
      if (settings.source !== 'camera' || generation !== sourceGeneration || stopped || closing) return;
      if (!result.ok) {
        settings.source = 'pointer';
        store.save(settings);
        renderSource();
        feedback({ message: result.message, tone: 'error' });
        return;
      }
      renderSource();
      const restored = await restoreOrCalibrate(generation);
      if (generation === sourceGeneration && restored && !stopped && !closing) feedback(restored);
    });
    return starting;
  }

  // Reuses a calibration saved by an earlier page when the window is unchanged and it is recent.
  async function restoreOrCalibrate(generation) {
    if (document.hidden) return { message: 'Camera ready. Return to this tab and choose Recalibrate before using camera navigation.', tone: 'info' };
    const attempt = ++calibrationGeneration;
    const session = camera.session;
    let restored = { ok: false, reason: 'none' };
    try {
      restored = await camera.restoreCalibration({ width: window.innerWidth, height: window.innerHeight, now: Date.now() });
    } catch { /* Fall back to a fresh calibration. */ }
    if (document.hidden || attempt !== calibrationGeneration || generation !== sourceGeneration || camera.state !== 'ready' || camera.session !== session || stopped || closing) return null;
    if (restored.ok) {
      cameraCalibrated = true;
      filter.reset();
      return { ok: true, message: 'Camera on with your earlier calibration. Say recalibrate if the circle drifts.', tone: 'success' };
    }
    const decoded = restored;
    const result = calibrate();
    if (decoded.reason === 'resized') result.message = `The window size changed, so the camera needs calibrating again. ${result.message}`;
    return result;
  }

  function calibrate() {
    if (document.hidden) return { ok: false, message: 'Return to this tab to calibrate.' };
    if (camera.state !== 'ready') return { ok: false, message: 'Turn the camera on first by saying "use camera".' };
    const session = camera.session;
    calibrationGeneration++;
    cameraCalibrated = false;
    loseCameraContext(false);
    calibration?.cancel();
    camera.resetCalibration();
    filter.reset();
    ui.circle.classList.remove('visible');
    ui.outlines.replaceChildren();
    let instruction = '';
    const run = runCalibration({
      record: (x, y) => camera.session === session && camera.recordSample(x, y), window, dot: ui.dot,
      onProgress({ point: number, total, phase, attempt }) {
        const head = following() === 'head';
        instruction = phase === 'retry' || attempt > 1
          ? `Dot ${number} of ${total} needs another look. Keep your face visible and ${head ? 'point your nose at' : 'look at'} the dot.`
          : `${head ? 'Point your nose at' : 'Look at'} dot ${number} of ${total} until it turns green.`;
        ui.status.textContent = instruction;
        ui.status.className = 'status question';
      },
    });
    calibration = run;
    run.done.then(result => {
      if (calibration !== run) return;
      calibration = null;
      if (result.cancelled) feedback({ message: 'Calibration stopped. Say recalibrate to try again, or use pointer.', tone: 'info' });
      else if (result.ok) {
        cameraCalibrated = true;
        if (camera.session === session) camera.saveCalibration({ width: window.innerWidth, height: window.innerHeight, now: Date.now() });
        checkAccuracy(`Calibrated with ${result.calibrated} of ${result.total} dots.`);
      }
      else feedback({ message: `Only ${result.calibrated} of ${result.total} dots could be learned. Check lighting and that your face is visible, then say recalibrate.`, tone: 'error' });
    }, () => {
      if (calibration === run) calibration = null;
      feedback({ message: 'Calibration failed. Say recalibrate to try again, or use pointer.', tone: 'error' });
    });
    return { ok: true, message: `Calibrating without clicks. ${instruction}` };
  }

  // Four more dots measure where the calibrated gaze lands; the circle is then sized to hold 9 in 10 gaze samples.
  function checkAccuracy(calibrated) {
    filter.reset();
    const check = runAccuracyCheck({
      window, dot: ui.dot,
      onProgress({ point: number, total }) {
        ui.status.textContent = `${calibrated} Checking accuracy: ${following() === 'head' ? 'point your nose at' : 'look at'} dot ${number} of ${total}.`;
        ui.status.className = 'status question';
      },
    });
    calibration = check;
    check.done.then(report => {
      if (calibration !== check) return;
      calibration = null;
      const current = () => `${settings.size} (${radius()} px)`, head = following() === 'head';
      const follows = head ? 'The circle now follows your head.' : 'The circle now follows your gaze.';
      if (report.cancelled) {
        feedback({ message: `${calibrated} Accuracy check stopped, so the circle stays ${current()}. ${follows}`, tone: 'info' });
        return;
      }
      const recommended = recommendedSize(report, RADII);
      if (!recommended) {
        feedback({ message: `${calibrated} The accuracy check saw too little ${head ? 'pointing' : 'gaze'} to measure, so the circle stays ${current()}. ${follows}`, tone: 'info' });
        return;
      }
      settings.size = recommended.size;
      ui.size.value = recommended.size;
      store.save(settings);
      schedule();
      feedback(recommended.low
        ? { message: head
          ? `${calibrated} The head pointer lands up to about ${report.p90Px} px from where you point, more than the large circle (${radius()} px) covers. Check lighting and that your whole face is visible, then say recalibrate, or use pointer.`
          : `${calibrated} Your gaze lands up to about ${report.p90Px} px from where you look, more than the large circle (${radius()} px) covers. Check lighting and keep your head still, then say recalibrate, or use pointer.`, tone: 'error' }
        : { message: `${calibrated} ${head ? 'The head pointer lands' : 'Your gaze lands'} within about ${report.p90Px} px of where you ${head ? 'point' : 'look'}, so the circle is ${current()}. ${follows}`, tone: 'success' });
    });
  }

  function renderListening(on) {
    ui.listen.setAttribute('aria-pressed', String(on));
    ui.listen.textContent = on ? 'Stop listening' : 'Start listening';
  }

  function setListening(on) {
    if (on && document.hidden) { renderListening(false); return; }
    if (on && !speech.supported) {
      feedback({ message: 'Speech recognition is not available in this browser. Type instructions instead.', tone: 'error' });
      on = false;
    }
    if (on && !speech.listening && !speech.start()) on = false;
    if (!on) { resetSpeechCapture(); speech.stop(); controller.endDictation(); renderDictation(); }
    settings.listening = on;
    store.save(settings);
    renderListening(on);
  }

  ui.listen.addEventListener('click', () => setListening(!speech.listening));
  ui.usePointer.addEventListener('click', () => run('use pointer', { elements: [] }));
  ui.useCamera.addEventListener('click', () => run('use camera', { elements: [] }));
  ui.useHead.addEventListener('click', () => run('use head pointer', { elements: [] }));
  ui.recalibrate.addEventListener('click', () => run('recalibrate', { elements: [] }));
  const onVisibilityChange = () => {
    if (stopped || closing) return;
    if (!document.hidden) {
      cameraVisibleSince = window.performance.now();
      return;
    }
    feedbackVoice.cancel(); resetSpeechCapture();
    const wasListening = speech.listening;
    const activeCalibration = calibration;
    const wasCalibrated = cameraCalibrated;
    calibrationGeneration++;
    calibration = null;
    activeCalibration?.cancel();
    const hadPrompt = !!controller.pending;
    keyboard.cancel();
    spokenContext = null; spokenInvalid = false; promptContext = null;
    speech.stop(); controller.cancel();
    // Keep the calibration, but do not act on where the user was looking before the tab left view.
    loseCameraContext(false);
    renderListening(false);
    if (wasListening) {
      ui.transcript.textContent = '';
      feedback({ message: 'Listening stopped when this tab was hidden. Choose Start listening to continue.' });
    } else if (activeCalibration) {
      feedback({ message: wasCalibrated
        ? 'Accuracy check stopped when this tab was hidden. Your completed calibration is kept.'
        : 'Calibration stopped when this tab was hidden. Choose Recalibrate when you return, or use pointer.' });
    } else if (hadPrompt) {
      feedback({ message: 'The pending question was cleared when this tab was hidden.' });
    } else {
      renderPrompt();
    }
    renderOutlines();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  const onPageHide = () => {
    clearCameraSilence();
    closing = true; sourceGeneration++; feedbackVoice.cancel(); resetSpeechCapture();
    keyboard.cancel();
    const active = calibration; calibration = null; active?.cancel();
    camera.stop(); speech.stop(); controller.cancel();
    spokenContext = null; promptContext = null;
  };
  window.addEventListener('pagehide', onPageHide);
  const onPageShow = event => {
    if (!event.persisted || stopped) return;
    closing = false;
    settings.listening = false;
    ui.listen.setAttribute('aria-pressed', 'false');
    ui.listen.textContent = 'Start listening';
    const returned = 'Returned to this page. Listening is stopped. Choose Start listening to continue.';
    // Leaving the page stopped the camera; start it again (with the saved calibration) instead of
    // leaving camera mode selected with nothing moving the circle.
    if (settings.source === 'camera') {
      settings.source = 'pointer';
      feedback({ message: `${returned} ${setSource(following() === 'head' ? 'head' : 'camera').message}` });
      return;
    }
    feedback({ message: returned });
  };
  window.addEventListener('pageshow', onPageShow);
  ui.pause.addEventListener('click', () => run(controller.paused ? 'resume' : 'pause', { elements: [] }));
  ui.cancel.addEventListener('click', () => run('cancel', { elements: [] }));
  ui.form.addEventListener('submit', event => {
    event.preventDefault();
    const text = ui.instruction.value.trim();
    if (!text) return;
    ui.transcript.textContent = `Typed: ${text}`;
    const result = run(text, (recapture(true), context), 'typed');
    if (result.tone !== 'error') ui.instruction.value = '';
  });
  function refreshNumbers() {
    numbersTimer = null;
    if (!numbering || stopped) return;
    numbered = numberControls(document, { exclude: host, previous: numbering, scopeCache });
    numbering = new Map(numbered.map(element => [element.element, element.number]));
    if (!controller.pending || controller.pending.kind !== 'clarify') renderOutlines();
  }
  function scheduleNumbers() {
    if (numbering && numbersTimer === null) numbersTimer = window.setTimeout(refreshNumbers, NUMBERS_REFRESH_MS);
  }
  function findPopupControl({ want }) {
    const choice = choosePopupControl(findPopups(document, { exclude: host, scopeCache }), want);
    if (!choice.control) {
      const embedded = [...document.querySelectorAll('iframe')].some(frame => { try { return !frame.contentDocument; } catch { return true; } });
      return { message: `${choice.message}${embedded && /^No /.test(choice.message) ? ' Banners inside a frame from another site are not reached.' : ''}` };
    }
    const name = choice.control.name || 'the button';
    return { target: { ...choice.control, id: 1 }, message: want === 'close' ? `Closed the ${choice.consent ? 'cookie banner' : 'pop-up'} with "${name}".` : `Pressed "${name}" on the cookie banner.` };
  }

  function controlPageMedia(action, used) {
    const media = used.media?.() ?? findMedia(document, { exclude: host, scopeCache });
    const chosen = chooseMedia(media, { radius: used.radius ?? 0, change: action.change });
    if (chosen.none) {
      const embedded = [...document.querySelectorAll('iframe')].some(frame => { try { return !frame.contentDocument; } catch { return true; } });
      return { ok: false, message: `No video or sound on this page can be reached.${embedded ? ' A video inside a player embedded from another site can still be used with its own buttons: look at one and say click.' : ''}` };
    }
    if (chosen.ambiguous) {
      const videos = chosen.ambiguous.every(item => item.kind === 'video');
      return { ok: false, message: `${chosen.ambiguous.length} ${videos ? 'videos' : 'players'} are on this page. Look at the one you mean and say it again.` };
    }
    return controlMedia(chosen.targets, action);
  }

  function findOnPage({ text = null, move = null, clear = false }) {
    if (clear) {
      const had = Boolean(found);
      found = null; renderOutlines();
      return { ok: true, message: had ? 'Search cleared.' : 'Nothing was being found.' };
    }
    if (move && !found) return { ok: false, message: 'Say find and the words to look for first, such as "find delivery".' };
    const query = move ? found.query : text;
    // The page may have changed since: look again, and keep to the place shown when it is still there.
    const matches = findText(document, query, { exclude: host });
    if (!matches.length) {
      found = null; renderOutlines();
      return { ok: false, message: `"${query}" is not on this page.` };
    }
    let index;
    if (move) {
      const shown = found.matches[found.index]?.range, same = shown ? matches.findIndex(match => match.range.compareBoundaryPoints(window.Range.START_TO_START, shown) === 0) : -1;
      index = ((same < 0 ? found.index : same) + (move === 'next' ? 1 : -1) + matches.length) % matches.length;
    } else {
      // The first match on or below the top of the screen, as a browser's find starts from where you are.
      index = Math.max(0, matches.findIndex(match => match.range.getBoundingClientRect().bottom >= 0));
    }
    found = { query, matches, index };
    const match = matches[index];
    match.range.startContainer.parentElement.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    spokenContext = null; promptContext = null;
    recapture(true);
    renderOutlines();
    const control = match.control;
    return { ok: true, control, message: `Found "${query}"${matches.length > 1 ? ` (${index + 1} of ${matches.length})` : ''}.${control ? ` It is in the ${control.role} "${control.name}": say "click it" to use it.` : ''}${matches.length > 1 ? ' Say next match or previous match.' : ''}` };
  }
  function setNumbers(on) {
    window.clearTimeout(numbersTimer); numbersTimer = null;
    if (!on) {
      const shown = Boolean(numbering);
      numbering = null; numbered = [];
      renderOutlines();
      return { ok: true, message: shown ? 'Numbers hidden.' : 'No numbers are shown.' };
    }
    numbering = new Map();
    refreshNumbers();
    if (!numbered.length) {
      numbering = null;
      return { ok: false, message: 'There are no controls on the screen to number. Scroll to some, then say show numbers again.' };
    }
    const more = numbered.length >= NUMBER_LIMIT ? ` (the first ${NUMBER_LIMIT} on screen)` : '';
    return { ok: true, message: `Numbers shown on ${numbered.length} controls${more}. Say a number, such as "click ${numbered[0].number}", to use one, even without looking at it. Say "hide numbers" when you are done.` };
  }
  function setCircleSize(requested) {
    const sizes = Object.keys(RADII);
    const index = Math.max(0, sizes.indexOf(settings.size));
    const size = requested === 'larger' ? sizes[Math.min(sizes.length - 1, index + 1)]
      : requested === 'smaller' ? sizes[Math.max(0, index - 1)] : requested;
    if (!Object.hasOwn(RADII, size)) return { ok: false, message: 'Choose a small, medium or large circle.' };
    settings.size = size;
    ui.size.value = size;
    spokenContext = null; promptContext = null;
    store.save(settings);
    if (!calibration) { schedule(); recapture(true); }
    const label = size[0].toUpperCase() + size.slice(1);
    return { ok: true, message: `Circle size: ${label} (${RADII[size]} px radius). Give the page instruction again.${controller.paused ? ' Navigator stays paused.' : ''}` };
  }
  ui.size.value = settings.size;
  ui.size.addEventListener('change', () => run(`use a ${Object.hasOwn(RADII, ui.size.value) ? ui.size.value : 'medium'} circle`, { elements: [] }));
  async function setAssist(on) {
    const load = ++assistLoad;
    settings.assist = on; store.save(settings); ui.assist.checked = on;
    assistant = null;
    if (!on) {
      controller.cancel(); promptContext = null; renderPrompt();
      ui.assistState.textContent = ''; return;
    }
    if (!loadAssistant) { ui.assistState.textContent = 'Smarter matching is not available here.'; settings.assist = false; ui.assist.checked = false; return; }
    ui.assistState.textContent = 'Loading the matching model…';
    try {
      const model = await loadAssistant((received, total) => {
        if (load === assistLoad) ui.assistState.textContent = `Downloading the matching model: ${Math.round((received / total) * 100)}% of ${Math.round(total / 1e6)} MB (once).`;
      });
      if (load !== assistLoad) return;
      assistant = createAssistedInterpreter({ model });
      ui.assistState.textContent = 'Smarter target matching is on.';
    } catch (error) {
      if (load !== assistLoad) return;
      settings.assist = false; store.save(settings); ui.assist.checked = false;
      ui.assistState.textContent = `Smarter matching could not start: ${error.message} Instructions still work without it.`;
    }
  }
  ui.assistRow.hidden = !loadAssistant;
  ui.assist.addEventListener('change', () => void setAssist(ui.assist.checked));
  if (settings.assist && loadAssistant) void setAssist(true);
  function setSpeechAddress(required) {
    const wasListening = speech.listening;
    // Retire queued native results and captured gaze before accepting phrases under the new rule.
    setListening(false);
    spokenContext = null; spokenInvalid = false; promptContext = null;
    settings.requireAddress = required; ui.speechAddress.checked = required;
    store.save(settings);
    if (wasListening) setListening(true);
    return { ok: true, message: required
      ? 'Begin every spoken instruction, confirmation and dictation phrase with “Navigator”. Pause, stop and cancel still work alone. Typed instructions are unchanged.'
      : 'Spoken instructions no longer require “Navigator”. Typed instructions are unchanged.' };
  }
  ui.speechAddress.checked = settings.requireAddress;
  ui.speechAddress.addEventListener('change', () => {
    show(controller.cancel(), { elements: [] });
    feedback(setSpeechAddress(ui.speechAddress.checked));
  });
  ui.speak.checked = settings.speak;
  ui.speak.addEventListener('change', () => {
    settings.speak = ui.speak.checked;
    if (!settings.speak) feedbackVoice.cancel();
    store.save(settings);
  });
  // The panel can be hidden to its status line and moved to any corner by voice, since the people it is for may not
  // be able to reach its buttons. Both choices are kept with the other settings.
  function setCollapsed(collapsed) {
    ui.panel.classList.toggle('collapsed', collapsed);
    ui.collapse.setAttribute('aria-expanded', String(!collapsed));
    ui.collapse.textContent = collapsed ? 'Show' : 'Hide';
    settings.collapsed = collapsed;
    store.save(settings);
    schedulePlacement();
  }
  const cornerName = ([left, top]) => `${top ? 'top' : 'bottom'} ${left ? 'left' : 'right'}`;
  function changePanel({ change, left = null, top = null }) {
    if (change === 'collapse') {
      setCollapsed(true);
      return { ok: true, message: 'Navigator panel hidden. Answers still show here; say "show the navigator" to bring it back.' };
    }
    if (change === 'expand') { setCollapsed(false); return { ok: true, message: 'Navigator panel shown.' }; }
    if (change === 'auto') {
      delete settings.corner;
      store.save(settings);
      schedulePlacement();
      return { ok: true, message: 'The navigator panel will move itself out of the way of website controls again.' };
    }
    const corner = [left ?? ui.panel.classList.contains('left'), top ?? ui.panel.classList.contains('top')];
    ui.panel.classList.toggle('left', corner[0]);
    ui.panel.classList.toggle('top', corner[1]);
    settings.corner = corner;
    store.save(settings);
    return { ok: true, message: `Navigator panel moved to the ${cornerName(corner)}. It stays there until you say "place the navigator automatically".` };
  }
  if (Array.isArray(settings.corner) && settings.corner.length === 2 && settings.corner.every(value => typeof value === 'boolean')) {
    ui.panel.classList.toggle('left', settings.corner[0]);
    ui.panel.classList.toggle('top', settings.corner[1]);
  } else delete settings.corner;
  if (settings.collapsed === true) setCollapsed(true);
  ui.collapse.addEventListener('click', () => setCollapsed(!ui.panel.classList.contains('collapsed')));

  const recent = settings.announce && Date.now() - (settings.announcedAt ?? 0) < 10000;
  const arrival = recent ? `Done: ${settings.announce} Now on "${document.title}".` : `Ready on "${document.title}". Move your gaze over the page, then speak or type an instruction.`;
  delete settings.announce;
  delete settings.announcedAt;
  store.save(settings);
  feedback({ message: arrival });
  renderSource();
  if (settings.listening) setListening(true);
  // Camera mode continues across pages; a recent calibration is reused while the window size is unchanged.
  if (settings.source === 'camera') {
    settings.source = 'pointer';
    feedback({ message: `${arrival} ${setSource(following() === 'head' ? 'head' : 'camera').message}` });
  }

  return {
    host,
    shadow,
    controller,
    camera,
    get calibrating() { return Boolean(calibration); },
    get context() { return context; },
    // Tracking adapters (camera, tests) feed viewport coordinates here.
    track,
    run: utterance => run(utterance, null),
    stop() {
      clearCameraSilence();
      stopped = true; closing = true; assistLoad++; sourceGeneration++; feedbackVoice.cancel(); resetSpeechCapture();
      window.clearTimeout(numbersTimer); numbersTimer = null; numbering = null;
      keyboard.stop();
      controller.cancel(); spokenContext = null; promptContext = null;
      const active = calibration; calibration = null; active?.cancel();
      camera.stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      speech.stop();
      window.removeEventListener('pointermove', onPointer, true);
      window.removeEventListener('load', watchFrames, true);
      document.removeEventListener('load', onFrameLoad, true);
      for (const [frameDocument, listener] of frameListeners) {
        frameDocument.removeEventListener('pointermove', listener, true);
        frameDocument.removeEventListener('load', onFrameLoad, true);
        frameDocument.removeEventListener('focusin', onFocusIn, true);
        frameDocument.removeEventListener('focusout', onFocusOut, true);
      }
      window.removeEventListener('scroll', refresh, true);
      pageObserver.disconnect();
      dictationObserver.disconnect();
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      window.removeEventListener('resize', onViewportResize);
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.clearTimeout(trailing);
      window.clearTimeout(placement);
      detachEmbedded?.();
      resizeObserver.disconnect();
      spacer.remove();
      host.remove();
    },
  };
}
