// Execution stage: performs one interpreted action on ordinary page elements.
// Returns a short, user-facing result; throws only for programming errors.

import { isEditable, captureSelectSnapshot, accessibleName } from './page-context.js';

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

function linkProblem(element) {
  if (element.tagName !== 'A' || !element.hasAttribute('href')) return null;
  const href = element.getAttribute('href').trim();
  if (href.startsWith('#')) return null;
  let url;
  try {
    url = new URL(href, element.ownerDocument.baseURI);
  } catch {
    return 'That link address is not valid.';
  }
  return SAFE_PROTOCOLS.has(url.protocol) ? null : `Links using ${url.protocol} are not opened by the navigator.`;
}

// Frameworks track input values through the native setter, so assignment alone can be ignored.
function setNativeValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
}

export function readValue(element) {
  return 'value' in element && element.tagName !== 'BUTTON' ? element.value : element.textContent;
}

// Captured context can outlive a field's editable state. Check the current DOM
// before writing or consuming history, including native and ARIA restrictions.
function unlocked(element) {
  if (element.matches(':disabled')) return false;
  for (let scope = element; scope;) {
    if (scope.closest('[inert], [aria-disabled="true"], [aria-readonly="true"]')) return false;
    try { scope = scope.getRootNode().host ?? scope.ownerDocument.defaultView.frameElement; }
    catch { return false; }
  }
  return true;
}

export function canWrite(element) {
  return isEditable(element) && unlocked(element);
}

function setAriaChecked(element, checked) {
  const role = element.getAttribute('role')?.trim();
  const state = () => {
    const value = element.getAttribute('aria-checked');
    return value === 'true' ? true : value === 'false' ? false : null;
  };
  const available = () => ['checkbox', 'switch'].includes(role) && element.getAttribute('role')?.trim() === role &&
    !['INPUT', 'SELECT', 'TEXTAREA', 'OPTION'].includes(element.tagName) &&
    !(element.tagName === 'A' && element.hasAttribute('href')) &&
    !(element.tagName === 'BUTTON' && element.form && ['submit', 'reset'].includes(element.type)) &&
    element.isConnected && !element.readOnly && unlocked(element) &&
    typeof element.focus === 'function' && typeof element.click === 'function';
  if (typeof checked !== 'boolean' || !available() || state() === null) {
    return { ok: false, message: 'This command needs an available binary checkbox or switch. Missing, mixed or invalid ARIA state is not supported.' };
  }
  const label = role === 'switch' ? 'Switch' : 'Checkbox';
  if (state() === checked) return { ok: true, message: `${label} is already ${checked ? 'checked' : 'unchecked'}.` };
  const before = state();
  element.focus({ preventScroll: true });
  if (!available() || !ownsFocus(element) || state() !== before) {
    return { ok: false, message: 'The control changed while focusing it. Look at it and try again.' };
  }
  // The website owns state and events. Never assign aria-checked or retry a
  // click; let its click microtasks drain, then report only the retained state.
  element.click();
  return { message: 'Checking the requested control state…', followUp: new Promise(resolve => element.ownerDocument.defaultView.setTimeout(resolve, 0)).then(() => {
    const ok = available() && state() === checked;
    return { ok, message: ok ? `${label} ${checked ? 'checked' : 'unchecked'}.` : 'The website did not retain an available control with the requested state. Check it before continuing.' };
  }) };
}

export function setChecked(element, checked) {
  if (!(element.tagName === 'INPUT' && element.type === 'checkbox')) return setAriaChecked(element, checked);
  const available = () => element.tagName === 'INPUT' && element.type === 'checkbox' &&
    element.isConnected && !element.readOnly && unlocked(element);
  if (typeof checked !== 'boolean' || !available()) return { ok: false, message: 'This command needs an available native checkbox.' };
  if (element.indeterminate) return { ok: false, message: 'This checkbox has a mixed state. Choose its state on the website before using check or uncheck.' };
  if (element.checked === checked) return { ok: true, message: `Checkbox is already ${checked ? 'checked' : 'unchecked'}.` };
  const before = element.checked;
  element.focus({ preventScroll: true });
  if (!available() || !ownsFocus(element) || element.checked !== before || element.indeterminate) {
    return { ok: false, message: 'The checkbox changed while focusing it. Look at it and try again.' };
  }
  // Native activation supplies input/change, shadow propagation and canceled
  // click rollback. Never overwrite a website's preventDefault or state update.
  element.click();
  if (!available()) return { ok: false, message: 'The website replaced, removed or locked the checkbox. Check the current control before continuing.' };
  const ok = element.checked === checked && !element.indeterminate;
  return { ok, message: ok ? `Checkbox ${checked ? 'checked' : 'unchecked'}.` : 'The website did not retain the requested checkbox state. Check it before continuing.' };
}

export function setRangeValue(element, value) {
  const available = () => element.tagName === 'INPUT' && element.type === 'range' &&
    element.isConnected && !element.readOnly && unlocked(element);
  if (!available()) return { ok: false, message: 'This command needs an available native range slider. Custom ARIA sliders are not supported.' };
  if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, message: 'Say a finite numeric slider value.' };
  // Range setters silently clamp and snap. The detached native control must
  // retain exactly the requested number before any live focus, event or write.
  const probe = element.cloneNode(false);
  setNativeValue(probe, String(value));
  if (probe.valueAsNumber !== value || !probe.validity.valid) {
    return { ok: false, message: `That exact value is outside the slider’s range or step. Current limits: ${element.min || '0'} to ${element.max || '100'}, step ${element.step || '1'}.` };
  }
  const before = element.value;
  if (Number(before) === value) return { ok: true, changed: false, message: `Slider is already ${before}.` };
  const capture = () => JSON.stringify([element.value, element.min, element.max, element.step, element.getAttribute('value')]);
  const snapshot = capture();
  element.focus({ preventScroll: true });
  if (!available() || !ownsFocus(element) || capture() !== snapshot) {
    return { ok: false, message: 'The slider changed while focusing it. Look at it and try again.' };
  }
  setNativeValue(element, String(value));
  const view = element.ownerDocument.defaultView;
  const retired = () => ({ ok: false, changed: element.value !== before, before,
    message: 'The website replaced, removed or locked the slider. Check the current control before continuing.' });
  element.dispatchEvent(new view.Event('input', { bubbles: true, composed: true }));
  if (!available()) return retired();
  element.dispatchEvent(new view.Event('change', { bubbles: true }));
  if (!available()) return retired();
  const ok = element.valueAsNumber === value;
  return { ok, changed: element.value !== before, before, message: ok ? `Slider set to ${element.value}.` : `The website changed the slider to ${element.value}. Check it before continuing.` };
}

// Selection APIs are deliberately limited to native, writable text controls. Rich-text
// editors and input types such as email/number do not expose compatible offsets.
export function readSelection(element) {
  if (!['INPUT', 'TEXTAREA'].includes(element.tagName) || !canWrite(element)) return null;
  const start = element.selectionStart;
  const end = element.selectionEnd;
  return Number.isInteger(start) && Number.isInteger(end) ? { start, end } : null;
}

// Literal, nonoverlapping matches use the original string's UTF-16 offsets.
// Lowercasing the value first would shift offsets for characters such as İ.
function phraseSelection(value, text, occurrence) {
  if (typeof text !== 'string' || !text.length) return { ok: false, message: 'Say the text to select.' };
  if (occurrence != null && occurrence !== 'last' && (!Number.isInteger(occurrence) || occurrence < 1)) {
    return { ok: false, message: 'Say a positive occurrence number, or last.' };
  }
  const pattern = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  let count = 0, range;
  for (const match of value.matchAll(pattern)) {
    count++;
    if (occurrence == null || occurrence === 'last' || count === occurrence) {
      range = { start: match.index, end: match.index + match[0].length };
    }
  }
  if (!count) return { ok: false, message: 'That text was not found in this field. Check the words and try again.' };
  if (occurrence == null && count > 1) return { ok: false, message: `That text occurs ${count} times. Say “select first occurrence of” followed by the text, or choose another occurrence.` };
  if (!range) return { ok: false, message: `Only ${count} occurrence${count === 1 ? '' : 's'} found. Choose an available occurrence.` };
  return { ok: true, ...range };
}

function ownsFocus(element) {
  // A child document can retain its activeElement after an outer field gains
  // focus, so check the entire host/frame chain rather than just the leaf root.
  for (let scope = element; scope;) {
    const root = scope.getRootNode();
    if (root.activeElement !== scope) return false;
    try {
      scope = root.host ?? scope.ownerDocument.defaultView.frameElement;
    } catch {
      return false;
    }
  }
  return true;
}

export function selectText(element, position, { text, occurrence = null } = {}) {
  if (!readSelection(element)) return { ok: false, message: 'Selection commands need a writable native text field. This field does not support them.' };
  const value = element.value;
  const length = value.length;
  const start = position === 'end' ? length : 0;
  const range = position === 'phrase' ? phraseSelection(value, text, occurrence) : { ok: true, start, end: position === 'all' ? length : start };
  if (!range.ok) return range;
  element.focus({ preventScroll: true });
  // A site's focus handler can replace or lock the field before offsets apply.
  if (element.value !== value || !readSelection(element) || element.isConnected === false || !ownsFocus(element)) {
    return { ok: false, message: 'The field changed while focusing it. Look at it and try again.' };
  }
  element.setSelectionRange(range.start, range.end);
  return { ok: true, message: position === 'phrase' ? 'Text selected. Say “replace selected text with” followed by the correction.' : position === 'all' ? 'All text selected.' : `Cursor moved to the ${position}.` };
}

export function writeValue(element, value, { caret = value.length } = {}) {
  element.focus({ preventScroll: true });
  if ('value' in element && element.tagName !== 'BUTTON') setNativeValue(element, value);
  else element.textContent = value;
  const view = element.ownerDocument.defaultView;
  element.dispatchEvent(new view.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  element.dispatchEvent(new view.Event('change', { bubbles: true }));
  if (typeof element.setSelectionRange === 'function' && element.type !== 'number' && element.type !== 'email') {
    element.setSelectionRange(caret, caret);
  }
}

export function activate(element, name, { preserveFocus = false } = {}) {
  const problem = linkProblem(element);
  if (problem) return { ok: false, message: problem };
  // Keyboard commands can select blur-dismissed suggestions without moving website focus.
  const editable = element.matches('input:not([type=button]):not([type=submit]):not([type=reset]):not([type=image]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable=""], [contenteditable="true"]');
  if (!preserveFocus || editable) element.focus({ preventScroll: true });
  if (editable) {
    return { ok: true, message: `${name || 'Field'} is ready for dictation.` };
  }
  element.click();
  return { ok: true, message: `${name || 'Control'} activated.` };
}

export function selectOption(element, optionIndex, snapshot) {
  const available = () => element.tagName === 'SELECT' && element.isConnected &&
    !element.multiple && !element.readOnly && unlocked(element);
  const refuse = message => ({ ok: false, message });
  if (!available() || !snapshot || !Number.isInteger(optionIndex) || optionIndex < 0 || !snapshot.options?.[optionIndex]) {
    return refuse('This command needs an available native single-choice dropdown. Multiple-selection controls are not supported.');
  }
  const liveFrames = () => Array.isArray(snapshot.frames) && snapshot.frames.every(frame =>
    frame.element.isConnected && frame.element.contentDocument === frame.document);
  const unchanged = () => {
    if (!liveFrames()) return false;
    const current = captureSelectSnapshot(element);
    return current.frames.length === snapshot.frames.length && current.frames.every((frame, i) =>
      frame.element === snapshot.frames[i].element && frame.document === snapshot.frames[i].document) &&
      ['document','name','role','multiple','selectedIndex'].every(key => current[key] === snapshot[key]) &&
      current.options.length === snapshot.options.length && current.options.every((option, i) =>
        Object.keys(option).every(key => option[key] === snapshot.options[i][key]));
  };
  const intended = snapshot.options[optionIndex];
  if (!unchanged() || intended.disabled || intended.groupDisabled) return refuse('The dropdown or option changed or is unavailable. Look at it and choose again.');
  if (intended.selected) return { ok: true, message: `${intended.label.trim()} is already selected.` };
  element.focus({ preventScroll: true });
  if (!available() || !ownsFocus(element) || !unchanged()) return refuse('The dropdown changed while focusing it. Look at it and choose again.');
  const retained = () => available() && liveFrames() && element.ownerDocument === snapshot.document && accessibleName(element) === snapshot.name &&
    element.getAttribute('role') === snapshot.role && intended.element.parentElement === intended.parent &&
    (intended.parent.tagName !== 'OPTGROUP' || intended.parent.label === intended.groupLabel) && intended.element.closest('select') === element &&
    !intended.element.disabled && !intended.element.matches(':disabled') && intended.element.selected &&
    intended.element.value === intended.value && intended.element.textContent === intended.text && intended.element.label === intended.label;
  const changed = () => refuse('The website did not retain an available dropdown with the requested option. Check it before continuing.');
  const view = element.ownerDocument.defaultView;
  Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype, 'selectedIndex').set.call(element, optionIndex);
  if (!retained()) return changed();
  element.dispatchEvent(new view.Event('input', { bubbles: true, composed: true }));
  if (!retained()) return changed();
  element.dispatchEvent(new view.Event('change', { bubbles: true }));
  // Site handlers and their microtasks own the final state. No retry or forced rollback.
  return { message: 'Checking the requested dropdown selection…', followUp: new Promise(resolve => globalThis.setTimeout(resolve, 0)).then(() =>
    retained() ? { ok: true, message: `${intended.label.trim()} selected.` } : changed()) };
}

export function submit(element) {
  const form = element.form ?? element.closest('form');
  if (form) {
    if (element.matches('button, input[type=submit], input[type=image]')) form.requestSubmit(element);
    else form.requestSubmit();
    return { ok: true, message: 'Form submitted.' };
  }
  const view = element.ownerDocument.defaultView;
  for (const type of ['keydown', 'keyup']) {
    element.dispatchEvent(new view.KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true }));
  }
  return { ok: true, message: 'Enter pressed.' };
}

export function scroll(region, direction, amount, window) {
  const document = window.document;
  const page = !region || region === document.scrollingElement || region === document.documentElement || region === document.body;
  const target = page ? document.scrollingElement ?? document.documentElement : region;
  const height = page ? window.innerHeight : target.clientHeight;
  const width = page ? window.innerWidth : target.clientWidth;
  const step = amount === 'small' ? 0.25 : 0.8;
  const before = [target.scrollLeft, target.scrollTop];
  const options = { behavior: 'auto' };
  if (direction === 'top') target.scrollTo({ ...options, top: 0 });
  else if (direction === 'bottom') target.scrollTo({ ...options, top: target.scrollHeight });
  else {
    const sign = direction === 'up' || direction === 'left' ? -1 : 1;
    const horizontal = direction === 'left' || direction === 'right';
    target.scrollBy({ ...options, top: horizontal ? 0 : sign * height * step, left: horizontal ? sign * width * step : 0 });
  }
  const moved = before[0] !== target.scrollLeft || before[1] !== target.scrollTop;
  const where = page ? 'Page' : 'Region';
  return moved ? { ok: true, message: `${where} scrolled ${direction}.` } : { ok: false, message: `${where} cannot scroll ${direction} any further.` };
}

export function navigate(window, direction) {
  if (direction === 'back') window.history.back();
  else window.history.forward();
  return { ok: true, message: direction === 'back' ? 'Going back.' : 'Going forward.' };
}
