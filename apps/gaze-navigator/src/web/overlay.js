// Presentation and tracking for the web navigator. Runs inside any page; all UI lives in a
// shadow root that is excluded from context capture.
import { captureContext } from './page-context.js';
import { createController } from './controller.js';
import { createSpeechInput } from './speech-input.js';
import { createGazeFilter } from '../gaze-filter.js';

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
.circle.paused { border-color: #9aa7a1; background: none; }
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
details { margin-top: 8px; }
summary { cursor: pointer; }
.prompt:empty { display: none; }
.hint { color: #a9c2b8; font-size: 13px; }
`;

function load(window) {
  try {
    return JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function save(window, settings) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* Settings then last only for this page. */ }
}

const ROLE_LABELS = { link: 'Link', button: 'Button', textbox: 'Text field', searchbox: 'Search field', combobox: 'Dropdown', checkbox: 'Checkbox', radio: 'Option', switch: 'Switch', tab: 'Tab', menuitem: 'Menu item', option: 'Option', slider: 'Slider', generic: 'Control' };

export function describeElement(element) {
  const role = ROLE_LABELS[element.role] ?? element.role;
  const state = element.checked !== undefined ? (element.checked ? ', checked' : ', not checked') : '';
  const value = element.options ? `, ${element.value || 'no choice'}` : element.editable && element.value ? `, contains "${element.value.slice(0, 40)}"` : '';
  return `${role}: ${element.name || '(unnamed)'}${state}${value}`;
}

export function startWebNavigator({ window = globalThis.window, document = window.document, source = 'pointer', interpret } = {}) {
  const settings = { size: 'medium', listening: false, speak: false, ...load(window) };
  const host = document.createElement('div');
  host.id = 'gaze-web-navigator';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${STYLE}</style>
  <div class="layer" aria-hidden="true"><div class="outlines"></div><div class="circle"></div></div>
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
        <input class="instruction" aria-label="Typed instruction" placeholder="e.g. open pricing" autocomplete="off" />
        <button type="submit">Do it</button>
      </form>
      <div class="row">
        <label>Circle size <select class="size"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
        <label><input type="checkbox" class="speak" /> Speak feedback</label>
      </div>
      <details class="context-details" open><summary class="context-summary">In the circle</summary><ol class="context"></ol></details>
      <details><summary>What can I say?</summary>
        <p class="hint">"Open pricing", "click the second one", "type hello into search", "delete last word", "replace Tuesday with Friday", "choose large", "scroll down", "go back", "submit", "pause", "cancel". Numbers answer questions; "confirm" approves a consequential action.</p>
        <p class="hint">The circle follows your gaze (or pointer). Looking at this panel keeps the last page area. Context is captured when you start speaking.</p>
      </details>
    </div>
  </section>`;
  const $ = selector => shadow.querySelector(selector);
  const ui = {
    circle: $('.circle'), outlines: $('.outlines'), panel: $('.panel'), status: $('.status'), transcript: $('.transcript'),
    prompt: $('.prompt'), listen: $('.listen'), pause: $('.pause'), cancel: $('.cancel'), form: $('.typed'),
    instruction: $('.instruction'), size: $('.size'), speak: $('.speak'), context: $('.context'), summary: $('.context-summary'),
    collapse: $('.collapse'),
  };
  document.documentElement.append(host);
  // Reserve scroll space so the panel never permanently covers the end of a page.
  const spacer = document.createElement('div');
  spacer.id = 'gaze-web-navigator-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  document.body.append(spacer);
  const reserve = () => { spacer.style.height = `${ui.panel.getBoundingClientRect().height + 24}px`; };
  const resizeObserver = new window.ResizeObserver(reserve);
  resizeObserver.observe(ui.panel);

  const controller = createController({ window, interpret });
  const filter = createGazeFilter();
  let point = null;
  let frozen = false;
  let context = { elements: [], region: null };
  let spokenContext = null;
  let promptContext = null;
  let lastCapture = -Infinity;
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
      const rect = element.element.getBoundingClientRect();
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
    ui.context.replaceChildren(...items);
    ui.summary.textContent = `In the circle (${context.elements.length})`;
  }

  function recapture(force = false) {
    if (!point || controller.paused) return;
    const time = window.performance.now();
    if (!force && time - lastCapture < CONTEXT_INTERVAL_MS) return;
    lastCapture = time;
    context = captureContext(document, { x: point.x, y: point.y, radius: radius(), exclude: host });
    const focused = context.elements.find(element => element.element === document.activeElement);
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

  function track(x, y, time) {
    const next = source === 'camera' ? filter.filter(x, y, time) : { x, y };
    if (!next) return;
    point = next;
    schedule();
  }

  const onPointer = event => {
    // Looking at the panel keeps the last page context, so instructions can be typed or chosen there.
    frozen = event.composedPath().includes(host);
    if (frozen) {
      ui.circle.classList.add('frozen');
      return;
    }
    track(event.clientX, event.clientY, event.timeStamp);
  };
  if (source === 'pointer') window.addEventListener('pointermove', onPointer, true);
  const refresh = () => recapture(true);
  window.addEventListener('scroll', refresh, true);
  window.addEventListener('resize', refresh);

  function run(utterance, captured) {
    const used = captured ?? spokenContext ?? (recapture(true), context);
    spokenContext = null;
    const result = controller.handle(utterance, used);
    promptContext = result.pending ? used : null;
    ui.pause.setAttribute('aria-pressed', String(controller.paused));
    ui.pause.textContent = controller.paused ? 'Resume' : 'Pause';
    feedback(result);
    if (result.performed) {
      // Shown after a navigation this action may cause; ignored if it arrives much later.
      save(window, { ...settings, announce: result.message, announcedAt: Date.now() });
      window.setTimeout(() => recapture(true), 50);
    }
    renderOutlines();
    return result;
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
      if (state === 'stopped' && settings.listening && !speech.listening) setListening(false);
    },
  });

  function setListening(on) {
    if (on && !speech.supported) {
      feedback({ message: 'Speech recognition is not available in this browser. Type instructions instead.', tone: 'error' });
      on = false;
    }
    if (on && !speech.listening && !speech.start()) on = false;
    if (!on) speech.stop();
    settings.listening = on;
    save(window, settings);
    ui.listen.setAttribute('aria-pressed', String(on));
    ui.listen.textContent = on ? 'Stop listening' : 'Start listening';
  }

  ui.listen.addEventListener('click', () => setListening(!settings.listening));
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
    save(window, settings);
    schedule();
    recapture(true);
  });
  ui.speak.checked = settings.speak;
  ui.speak.addEventListener('change', () => {
    settings.speak = ui.speak.checked;
    save(window, settings);
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
  save(window, settings);
  feedback({ message: arrival });
  if (settings.listening) setListening(true);

  return {
    host,
    shadow,
    controller,
    get context() { return context; },
    // Tracking adapters (camera, tests) feed viewport coordinates here.
    track,
    run: utterance => run(utterance, null),
    stop() {
      speech.stop();
      window.removeEventListener('pointermove', onPointer, true);
      window.removeEventListener('scroll', refresh, true);
      window.removeEventListener('resize', refresh);
      if (frame !== null) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      spacer.remove();
      host.remove();
    },
  };
}
