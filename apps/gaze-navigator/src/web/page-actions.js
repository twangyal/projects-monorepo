// Execution stage: performs one interpreted action on ordinary page elements.
// Returns a short, user-facing result; throws only for programming errors.

import { isEditable } from './page-context.js';

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
export function canWrite(element) {
  if (!isEditable(element) || element.matches(':disabled')) return false;
  // Context discovery crosses these boundaries, so a lock on a shadow host or
  // same-origin frame must also invalidate an already captured child field.
  for (let scope = element; scope;) {
    if (scope.closest('[inert], [aria-disabled="true"], [aria-readonly="true"]')) return false;
    try {
      scope = scope.getRootNode().host ?? scope.ownerDocument.defaultView.frameElement;
    } catch {
      return false; // A frame that became inaccessible cannot authorize a write.
    }
  }
  return true;
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

export function selectOption(element, optionIndex) {
  if (element.tagName !== 'SELECT' || !element.options[optionIndex] || element.options[optionIndex].disabled) {
    return { ok: false, message: 'That option is not available.' };
  }
  element.focus({ preventScroll: true });
  element.selectedIndex = optionIndex;
  const view = element.ownerDocument.defaultView;
  element.dispatchEvent(new view.Event('input', { bubbles: true }));
  element.dispatchEvent(new view.Event('change', { bubbles: true }));
  return { ok: true, message: `${element.options[optionIndex].textContent.trim()} selected.` };
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
