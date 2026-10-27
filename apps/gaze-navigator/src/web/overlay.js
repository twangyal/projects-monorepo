// Presentation and tracking for the web navigator. Runs inside any page; all UI lives in a
// shadow root that is excluded from context capture.
import { captureContext, frameOffset, sameOriginFrames, viewportRect } from './page-context.js';
import { createController } from './controller.js';
import { createAssistedInterpreter } from './assisted-interpreter.js';
import { createSpeechInput } from './speech-input.js';
import { createKeyboardCommands } from './keyboard-command.js';
import { createGazeFilter } from '../gaze-filter.js';
import { createLocalCamera } from './camera-source.js';
import { runCalibration } from './calibration.js';

const RADII = { small: 60, medium: 90, large: 130 };
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
.calibration-dot.hidden { display: none; }
.outline { position: fixed; border: 2px solid #75e5b4; border-radius: 6px; box-shadow: 0 0 0 2px #0008; }
.outline.question { border-color: #f5c76b; border-width: 3px; }
.badge { position: absolute; left: -2px; top: -22px; min-width: 22px; padding: 1px 6px; border-radius: 10px; background: #75e5b4; color: #07110e; font: 700 13px/18px system-ui, sans-serif; text-align: center; }
.outline.question .badge { background: #f5c76b; }
.panel { position: fixed; right: 12px; bottom: 12px; width: min(380px, calc(100vw - 24px)); max-height: min(70vh, 560px); overflow: auto; pointer-events: auto; padding: 14px; border: 1px solid #456b5c; border-radius: 14px; background: #0a1b16; color: #eef8f3; box-shadow: 0 10px 36px #000a; font-size: 15px; line-height: 1.4; }
.panel.collapsed .body { display: none; }
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
export function startWebNavigator({ window = globalThis.window, document = window.document, interpret, loadCamera, loadAssistant = null, store = sessionStore(window), createCamera = createLocalCamera, createSpeech = createSpeechInput, embeddedFrames = null } = {}) {
  const settings = { size: 'medium', listening: false, speak: false, source: 'pointer', assist: false, ...store.load() };
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
          <button class="recalibrate" disabled>Recalibrate</button>
        </div>
        <div class="row">
          <label>Circle size <select class="size"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
          <label><input type="checkbox" class="speak" /> Speak feedback</label>
        </div>
        <div class="assist-row">
          <label><input type="checkbox" class="assist" /> Smarter target matching</label>
          <p class="hint assist-note">Understands names that do not match exactly, such as "show the ratings" for Reviews, using the WaterSheep model on this device. It downloads 158 MB once; instructions are not sent anywhere.</p>
          <p class="hint assist-state" role="status"></p>
        </div>
      </details>
      <details class="context-details"><summary class="context-summary">In the circle</summary><ol class="context"></ol></details>
      <details><summary>What can I say?</summary>
      <p class="hint">Keep website suggestions open: focus the page, press Alt+Shift+G, type a command, then Enter. Escape cancels. Use direct keyboard characters or paste.</p>
        <p class="hint">"Open pricing", "click the second one", "type hello into search", "delete last word", "replace Tuesday with Friday", "choose large", "add option Jazz to Genres", "remove option Jazz from Genres", "scroll down", "go back", "submit", "pause", "cancel". Numbers answer questions; "confirm" approves a consequential action.</p>
        <p class="hint">To correct words in a text field: "select text Tuesday", then "replace selected text with Friday". For repeated words, say "select second occurrence of Tuesday". "Undo" restores the last text edit.</p>
        <p class="hint">Selected text: say "delete selected text" or "remove highlighted text" to remove only a native selected range. Say "undo" to restore it. Select words first; changed or unavailable selections refuse.</p>
        <p class="hint">Panels: "expand FAQ" or "collapse that panel" requests that state. Repeating it keeps the state. Native details and binary ARIA buttons use the website’s click behavior; unsupported state is refused.</p>
        <p class="hint">Radio choices: "select Express radio button" or "select that radio button" selects and checks the requested choice. Repeating it keeps it selected. Native and binary ARIA radios use the website’s click behavior; mixed or missing custom state is refused.</p>
        <p class="hint">Checkboxes: "check Newsletter" or "uncheck that checkbox" sets the requested state; repeating it keeps that state. Binary ARIA checkboxes and switches use one website click and verify its state. Missing or mixed state is refused. "Click" and "toggle" keep ordinary website activation.</p>
        <p class="hint">Dates, times and numbers: "set departure to November first", "set appointment time to 2:30 pm", "set guests to four", "set volume to forty percent", "set reporting month to next month". Spoken words and digits both work. "Undo departure date field" restores the earlier value. The website's own min, max and step rules still apply.</p>
        <p class="hint">Custom lists and sliders: "set size to large" or "choose Finland from country" opens a website's own list, types to search it when it is a search box, and picks the named choice. Custom sliders move by their arrow keys and stop if they cannot reach the exact value.</p>
        <p class="hint">"Use camera" starts webcam gaze and a no-click calibration (look at each dot); "recalibrate" repeats it; "stop camera" or "use pointer" turns the camera off.</p>
        <p class="hint">Say "make the circle bigger" or "make the circle smaller", or "use a small circle", "use a medium circle" or "use a large circle". This changes the visible area without acting on a page control. Give the page instruction again; previous questions are cancelled.</p>
        <p class="hint">The circle follows your gaze (or pointer). Looking at this panel keeps the last page area. Context is captured when you start speaking.</p>
      </details>
    </div>
  </section>`;
  const $ = selector => shadow.querySelector(selector);
  const ui = {
    circle: $('.circle'), outlines: $('.outlines'), panel: $('.panel'), status: $('.status'), transcript: $('.transcript'),
    prompt: $('.prompt'), listen: $('.listen'), pause: $('.pause'), cancel: $('.cancel'), form: $('.typed'),
    instruction: $('.instruction'), size: $('.size'), speak: $('.speak'), context: $('.context'), summary: $('.context-summary'),
    collapse: $('.collapse'), dot: $('.calibration-dot'), usePointer: $('.use-pointer'), useCamera: $('.use-camera'),
    recalibrate: $('.recalibrate'), assist: $('.assist'), assistState: $('.assist-state'), assistRow: $('.assist-row'),
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
  const assistantRelay = { needs: (...args) => Boolean(assistant?.needs(...args)), improve: (...args) => assistant.improve(...args) };
  const controller = createController({ window, interpret, commands: { tracking: setSource, calibrate, circleSize: setCircleSize }, assistant: assistantRelay });
  const filter = createGazeFilter();
  const camera = createCamera({
    document, window, load: loadCamera, store, mount: shadow,
    onGaze: (x, y, time) => track(x, y, time),
    onLost: () => ui.circle.classList.add('lost'),
  });
  let calibration = null;
  let point = null;
  let frozen = false;
  let context = { elements: [], region: null };
  let spokenContext = null;
  let promptContext = null;
  let lastCapture = -Infinity;
  let trailing = null;
  let frame = null;

  const radius = () => RADII[settings.size] ?? RADII.medium;

  function feedback({ message, tone = 'info' }) {
    ui.status.textContent = message;
    ui.status.className = `status ${tone}`;
    renderPrompt();
    if (settings.speak && window.speechSynthesis && window.SpeechSynthesisUtterance) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new window.SpeechSynthesisUtterance(message));
    }
  }

  function renderPrompt() {
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

  function renderOutlines() {
    const pending = controller.pending;
    const question = pending?.kind === 'clarify' ? new Map() : null;
    for (const candidate of question ? pending.candidates : []) {
      const previous = question.get(candidate.elementId);
      question.set(candidate.elementId, previous ? `${previous}, ${candidate.number}` : String(candidate.number));
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
  const onFocusIn = () => { pageChanged = true; const active = deepActiveElement(document); if (!inPanel(active)) lastPageFocus = active; };
  // Focus leaving to nothing (a click on the page background) forgets the field.
  const onFocusOut = event => { if (!event.relatedTarget) lastPageFocus = null; };
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
    return score;
  };
  function placePanel() {
    placement = 0;
    if (stopped || shadow.activeElement) return;
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

  // Viewport coordinates from the active source. Gaze resting on the panel keeps the last page area.
  function track(x, y, time) {
    if (calibration) return;
    ui.circle.classList.remove('lost');
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
      run(text, captured);
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
  const refresh = () => { pageChanged = true; scopeCache.rects = null; recapture(); schedulePlacement(); };
  window.addEventListener('scroll', refresh, true);
  window.addEventListener('resize', refresh);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  onFocusIn();

  function run(utterance, captured) {
    if (stopped || closing) return { message: 'Navigator is stopped.', tone: 'info' };
    keyboard.cancel();
    // While calibrating the circle is hidden, so instructions cannot target page elements.
    const used = calibration ? { elements: [], region: null } : captured ?? spokenContext ?? (recapture(true), context);
    spokenContext = null;
    const result = controller.handle(utterance, used);
    show(result, used);
    // A model-assisted answer follows unless a newer instruction came first.
    result.followUp?.then(later => { if (later && !stopped && !closing) show(later, used); });
    return result;
  }

  function show(result, used) {
    if (calibration && (result.cancelled || result.paused)) calibration.cancel();
    promptContext = result.pending ? used : null;
    ui.pause.setAttribute('aria-pressed', String(controller.paused));
    ui.pause.textContent = controller.paused ? 'Resume' : 'Pause';
    feedback(result);
    if (result.performed) {
      // Shown after a navigation this action may cause; ignored if it arrives much later.
      store.save({ ...settings, announce: result.message, announcedAt: Date.now() });
      window.setTimeout(() => recapture(true), 50);
    }
    renderOutlines();
  }

  const speech = createSpeech(window, {
    // Keeps the earliest capture of an utterance: where the user looked when they began speaking.
    onSpeechStart() {
      if (controller.paused || spokenContext) return;
      recapture(true);
      spokenContext = context;
      ui.transcript.textContent = `Listening… ${context.elements.length} element${context.elements.length === 1 ? '' : 's'} captured.`;
    },
    onInterim(text) { ui.transcript.textContent = `Heard: ${text}`; },
    onImmediate(text) {
      ui.transcript.textContent = `Heard: ${text}`;
      run(text, { elements: [] });
    },
    onFinal(text) {
      ui.transcript.textContent = `Heard: ${text}`;
      if (text) run(text, null);
    },
    onError(message) {
      spokenContext = null;
      feedback({ message, tone: 'error' });
      if (!speech.listening) setListening(false);
    },
    onState(state) {
      if (closing || stopped) return;
      if (state === 'stopped' && settings.listening && !speech.listening) setListening(false);
    },
  });

  function renderSource() {
    ui.usePointer.setAttribute('aria-pressed', String(settings.source === 'pointer'));
    ui.useCamera.setAttribute('aria-pressed', String(settings.source === 'camera'));
    ui.recalibrate.disabled = settings.source !== 'camera' || camera.state === 'off';
  }

  function setSource(source) {
    if (source === 'pointer') {
      sourceGeneration++;
      // Detach first so the cancelled calibration does not announce itself over "Camera off".
      const active = calibration;
      calibration = null;
      active?.cancel();
      const wasOn = camera.stop();
      // Turning the camera off also forgets the saved calibration (eye-patch training data).
      camera.clearCalibration();
      settings.source = 'pointer';
      store.save(settings);
      filter.reset();
      ui.circle.classList.remove('lost');
      renderSource();
      return { ok: true, message: wasOn ? 'Camera off. The circle follows the pointer.' : 'The circle follows the pointer.' };
    }
    if (camera.state !== 'off') return { ok: true, message: 'The camera is already on. Say recalibrate to calibrate again.' };
    const generation = ++sourceGeneration;
    settings.source = 'camera';
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
    return { ok: true, message: 'Starting the camera. Allow camera access if the browser asks.' };
  }

  // Reuses a calibration saved by an earlier page when the window is unchanged and it is recent.
  async function restoreOrCalibrate(generation) {
    const session = camera.session;
    let restored = { ok: false, reason: 'none' };
    try {
      restored = await camera.restoreCalibration({ width: window.innerWidth, height: window.innerHeight, now: Date.now() });
    } catch { /* Fall back to a fresh calibration. */ }
    if (generation !== sourceGeneration || camera.state !== 'ready' || camera.session !== session || stopped || closing) return null;
    if (restored.ok) {
      filter.reset();
      return { ok: true, message: 'Camera on with your earlier calibration. Say recalibrate if the circle drifts.', tone: 'success' };
    }
    const decoded = restored;
    const result = calibrate();
    if (decoded.reason === 'resized') result.message = `The window size changed, so the camera needs calibrating again. ${result.message}`;
    return result;
  }

  function calibrate() {
    if (camera.state !== 'ready') return { ok: false, message: 'Turn the camera on first by saying "use camera".' };
    const session = camera.session;
    calibration?.cancel();
    camera.resetCalibration();
    filter.reset();
    ui.circle.classList.remove('visible');
    ui.outlines.replaceChildren();
    let instruction = '';
    const run = runCalibration({
      record: (x, y) => camera.session === session && camera.recordSample(x, y), window, dot: ui.dot,
      onProgress({ point: number, total, phase, attempt }) {
        instruction = phase === 'retry' || attempt > 1
          ? `Dot ${number} of ${total} needs another look. Keep your face visible and look at the dot.`
          : `Look at dot ${number} of ${total} until it turns green.`;
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
        if (camera.session === session) camera.saveCalibration({ width: window.innerWidth, height: window.innerHeight, now: Date.now() });
        feedback({ message: `Calibrated with ${result.calibrated} of ${result.total} dots. The circle now follows your gaze.`, tone: 'success' });
      }
      else feedback({ message: `Only ${result.calibrated} of ${result.total} dots could be learned. Check lighting and that your face is visible, then say recalibrate.`, tone: 'error' });
    }, () => {
      if (calibration === run) calibration = null;
      feedback({ message: 'Calibration failed. Say recalibrate to try again, or use pointer.', tone: 'error' });
    });
    return { ok: true, message: `Calibrating without clicks. ${instruction}` };
  }

  function setListening(on) {
    if (on && !speech.supported) {
      feedback({ message: 'Speech recognition is not available in this browser. Type instructions instead.', tone: 'error' });
      on = false;
    }
    if (on && !speech.listening && !speech.start()) on = false;
    if (!on) speech.stop();
    settings.listening = on;
    store.save(settings);
    ui.listen.setAttribute('aria-pressed', String(on));
    ui.listen.textContent = on ? 'Stop listening' : 'Start listening';
  }

  ui.listen.addEventListener('click', () => setListening(!settings.listening));
  ui.usePointer.addEventListener('click', () => run('use pointer', { elements: [] }));
  ui.useCamera.addEventListener('click', () => run('use camera', { elements: [] }));
  ui.recalibrate.addEventListener('click', () => run('recalibrate', { elements: [] }));
  const onPageHide = () => {
    closing = true; sourceGeneration++;
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
      feedback({ message: `${returned} ${setSource('camera').message}` });
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
    const result = run(text, (recapture(true), context));
    if (result.tone !== 'error') ui.instruction.value = '';
  });
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
  ui.speak.checked = settings.speak;
  ui.speak.addEventListener('change', () => {
    settings.speak = ui.speak.checked;
    store.save(settings);
  });
  ui.collapse.addEventListener('click', () => {
    const collapsed = ui.panel.classList.toggle('collapsed');
    ui.collapse.setAttribute('aria-expanded', String(!collapsed));
    ui.collapse.textContent = collapsed ? 'Show' : 'Hide';
  });

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
    feedback({ message: `${arrival} ${setSource('camera').message}` });
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
      stopped = true; closing = true; assistLoad++; sourceGeneration++;
      keyboard.stop();
      controller.cancel(); spokenContext = null; promptContext = null;
      const active = calibration; calibration = null; active?.cancel();
      camera.stop();
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      speech.stop();
      window.removeEventListener('pointermove', onPointer, true);
      window.removeEventListener('load', watchFrames, true);
      document.removeEventListener('load', onFrameLoad, true);
      for (const [frameDocument, listener] of frameListeners) {
        frameDocument.removeEventListener('pointermove', listener, true);
        frameDocument.removeEventListener('load', onFrameLoad, true);
      }
      window.removeEventListener('scroll', refresh, true);
      pageObserver.disconnect();
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      window.removeEventListener('resize', refresh);
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
