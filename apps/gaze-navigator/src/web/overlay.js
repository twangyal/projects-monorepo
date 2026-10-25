// Presentation and tracking for the web navigator. Runs inside any page; all UI lives in a
// shadow root that is excluded from context capture.
import { captureContext, frameOffset, sameOriginFrames, viewportRect } from './page-context.js';
import { createController } from './controller.js';
import { createAssistedInterpreter } from './assisted-interpreter.js';
import { createSpeechInput } from './speech-input.js';
import { createKeyboardCommands } from './keyboard-command.js';
import { createGazeFilter } from '../gaze-filter.js';
import { createCameraGaze } from './camera-gaze.js';
import { runCalibration } from './calibration.js';
import { decodeCalibration, encodeCalibration } from './calibration-store.js';

const RADII = { small: 60, medium: 90, large: 130 };
const STORAGE_KEY = 'gaze-web-navigator';
const CONTEXT_INTERVAL_MS = 100;

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
  const value = element.options ? `, ${element.value || 'no choice'}` : element.editable && element.value ? `, contains "${element.value.slice(0, 40)}"` : '';
  return `${role}: ${element.name || '(unnamed)'}${state}${value}`;
}

// `loadAssistant(progress)` resolves to a calibrated decider (WaterSheep) when the user turns on smarter matching.
export function startWebNavigator({ window = globalThis.window, document = window.document, interpret, loadCamera, loadAssistant = null, store = sessionStore(window) } = {}) {
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
        <p class="hint">Panels: "expand FAQ" or "collapse that panel" requests that state. Repeating it keeps the state. Native details and binary ARIA buttons use the website’s click behavior; unsupported state is refused.</p>
        <p class="hint">Radio choices: "select Express radio button" or "select that radio button" selects and checks the requested choice. Repeating it keeps it selected. Native and binary ARIA radios use the website’s click behavior; mixed or missing custom state is refused.</p>
        <p class="hint">Checkboxes: "check Newsletter" or "uncheck that checkbox" sets the requested state; repeating it keeps that state. Binary ARIA checkboxes and switches use one website click and verify its state. Missing or mixed state is refused. "Click" and "toggle" keep ordinary website activation.</p>
        <p class="hint">Native months and weeks: "set Reporting month field to 2026-11" uses YYYY-MM; "set Reporting week field to 2026-W43" uses YYYY-Www with uppercase W. Native calendar/min/max/step rules apply. "Undo Reporting month field" or "Undo Reporting week field" restores that kind’s prior value. No relative periods, custom widgets or form submission.</p>
        <p class="hint">Native times: "set Appointment time field to 14:30" uses literal 24-hour HH:MM or HH:MM:SS and native min/max/step rules. "Undo Appointment time field" restores its earlier value. Time words, AM/PM and custom widgets are not converted; no form submission is requested.</p>
        <p class="hint">Native dates: "set Departure date field to 2026-11-01" uses YYYY-MM-DD and the field’s calendar, min/max/step rules. "Undo Departure date field" restores its earlier value. Date words and custom calendar widgets are not converted. This command does not request form submission.</p>
        <p class="hint">Native numeric fields: "set Quantity number field to 3" or "change number field to -0.25" uses the field’s current min/max/step. "Undo Quantity number field" restores its earlier value, including an empty field. Use decimal digits in the field’s own units; custom ARIA spinbuttons and number words are not supported. This command does not request form submission.</p>
        <p class="hint">Native sliders: "set Volume slider to 40", or "set slider to -0.25" in its own units. "Undo Volume slider" restores its last changed value. Exact min/max/step values are required; custom ARIA sliders are not supported.</p>
        <p class="hint">"Use camera" starts webcam gaze and a no-click calibration (look at each dot); "recalibrate" repeats it; "stop camera" or "use pointer" turns the camera off.</p>
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
  const controller = createController({ window, interpret, commands: { tracking: setSource, calibrate }, assistant: assistantRelay });
  const filter = createGazeFilter();
  const camera = createCameraGaze({
    document, window, load: loadCamera,
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
    const question = pending?.kind === 'clarify' ? new Set(pending.candidates.map(candidate => candidate.elementId)) : null;
    const shown = controller.paused ? [] : (pending ? promptContext : spokenContext ?? context)?.elements ?? [];
    ui.outlines.replaceChildren();
    for (const element of shown) {
      if (question && !question.has(element.id)) continue;
      if (!element.element.isConnected) continue;
      const rect = viewportRect(element.element, element.frames);
      const box = document.createElement('div');
      box.className = question ? 'outline question' : 'outline';
      Object.assign(box.style, { left: `${rect.left - 3}px`, top: `${rect.top - 3}px`, width: `${rect.width + 6}px`, height: `${rect.height + 6}px` });
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = element.id;
      box.append(badge);
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
  const onFocusIn = () => { const active = deepActiveElement(document); if (!inPanel(active)) lastPageFocus = active; };
  // Focus leaving to nothing (a click on the page background) forgets the field.
  const onFocusOut = event => { if (!event.relatedTarget) lastPageFocus = null; };
  const pageFocus = () => { const active = deepActiveElement(document); return inPanel(active) ? lastPageFocus : active; };

  function recapture(force = false) {
    if (!point || controller.paused) return;
    const time = window.performance.now();
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
    context = captureContext(document, { x: point.x, y: point.y, radius: radius(), exclude: host });
    const focused = context.elements.find(element => element.element === pageFocus());
    context.focusedId = focused?.id ?? null;
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
  const onFrameLoad = event => { if (/^I?FRAME$/.test(event.target?.tagName ?? '')) watchFrames(); };
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
  // Frame load events reach their document in capture phase, but skip its window.
  document.addEventListener('load', onFrameLoad, true);
  const refresh = () => recapture(true);
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

  const speech = createSpeechInput(window, {
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
      store.clearCalibration?.();
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
    const api = camera.api;
    let decoded = { ok: false, reason: 'none' };
    try {
      decoded = decodeCalibration(await store.loadCalibration?.(), { width: window.innerWidth, height: window.innerHeight, now: Date.now() });
    } catch { /* Fall back to a fresh calibration. */ }
    if (generation !== sourceGeneration || !api || camera.api !== api || stopped || closing) return null;
    if (decoded.ok) {
      try {
        camera.resetCalibration();
        api.getRegression()[0].setData(decoded.samples);
        filter.reset();
        return { ok: true, message: 'Camera on with your earlier calibration. Say recalibrate if the circle drifts.', tone: 'success' };
      } catch { /* Incompatible data: calibrate again. */ }
    }
    const result = calibrate();
    if (decoded.reason === 'resized') result.message = `The window size changed, so the camera needs calibrating again. ${result.message}`;
    return result;
  }

  function calibrate() {
    const api = camera.api;
    if (!api) return { ok: false, message: 'Turn the camera on first by saying "use camera".' };
    calibration?.cancel();
    camera.resetCalibration();
    filter.reset();
    ui.circle.classList.remove('visible');
    ui.outlines.replaceChildren();
    let instruction = '';
    const session = runCalibration({
      api, window, dot: ui.dot,
      onProgress({ point: number, total, phase, attempt }) {
        instruction = phase === 'retry' || attempt > 1
          ? `Dot ${number} of ${total} needs another look. Keep your face visible and look at the dot.`
          : `Look at dot ${number} of ${total} until it turns green.`;
        ui.status.textContent = instruction;
        ui.status.className = 'status question';
      },
    });
    calibration = session;
    session.done.then(result => {
      if (calibration !== session) return;
      calibration = null;
      if (result.cancelled) feedback({ message: 'Calibration stopped. Say recalibrate to try again, or use pointer.', tone: 'info' });
      else if (result.ok) {
        try {
          const saved = encodeCalibration(api.getRegression()[0].getData(), { width: window.innerWidth, height: window.innerHeight, now: Date.now() });
          store.saveCalibration?.(saved);
        } catch { /* The calibration still works on this page. */ }
        feedback({ message: `Calibrated with ${result.calibrated} of ${result.total} dots. The circle now follows your gaze.`, tone: 'success' });
      }
      else feedback({ message: `Only ${result.calibrated} of ${result.total} dots could be learned. Check lighting and that your face is visible, then say recalibrate.`, tone: 'error' });
    }, () => {
      if (calibration === session) calibration = null;
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
    feedback({ message: 'Returned to this page. Listening is stopped. Choose Start listening to continue.' });
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
  ui.size.value = settings.size;
  ui.size.addEventListener('change', () => {
    settings.size = RADII[ui.size.value] ? ui.size.value : 'medium';
    store.save(settings);
    schedule();
    recapture(true);
  });
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
  // Camera mode continues across pages; estimator data never persists, so each page recalibrates.
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
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      window.removeEventListener('resize', refresh);
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.clearTimeout(trailing);
      resizeObserver.disconnect();
      spacer.remove();
      host.remove();
    },
  };
}
