// Execution stage: performs one interpreted action on ordinary page elements.
// Returns a short, user-facing result; throws only for programming errors.

import { isEditable, isSensitive, captureSelectSnapshot, captureTextSelectionSnapshot, captureDisclosureSnapshot, captureRadioSnapshot, captureTabSnapshot, captureNumberSnapshot, captureDateSnapshot, captureTimeSnapshot, captureMonthSnapshot, captureWeekSnapshot, accessibleName } from './page-context.js';

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

export { isSensitive };

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

function controlVisible(element) {
  for (let scope = element; scope;) {
    const style = scope.ownerDocument.defaultView.getComputedStyle(scope);
    if (style.visibility === 'hidden' || style.visibility === 'collapse' ||
      ![...scope.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) return false;
    try { scope = scope.getRootNode().host ?? scope.ownerDocument.defaultView.frameElement; }
    catch { return false; }
  }
  return true;
}

/** Request a website-owned disclosure state with one activation at most. */
export function setExpanded(element, expanded, snapshot = captureDisclosureSnapshot(element), { isCurrent = () => true } = {}) {
  const native = snapshot.kind === 'native';
  const state = () => native ? snapshot.details.open : element.getAttribute('aria-expanded') === 'true' ? true
    : element.getAttribute('aria-expanded') === 'false' ? false : null;
  const available = () => element.isConnected && !element.readOnly && unlocked(element) && controlVisible(element) &&
    (native ? element.tagName === 'SUMMARY' && element.parentElement === snapshot.details &&
      [...snapshot.details.children].find(child => child.tagName === 'SUMMARY') === element && [null, 'button'].includes(element.getAttribute('role'))
      : snapshot.kind === 'aria' && (element.tagName === 'BUTTON' ? [null, 'button'].includes(element.getAttribute('role')) : element.getAttribute('role') === 'button') &&
        !['INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'SUMMARY'].includes(element.tagName) &&
        !(element.tagName === 'A' && element.hasAttribute('href')) &&
        !(element.tagName === 'BUTTON' && element.form && ['submit', 'reset'].includes(element.type))) &&
    typeof element.focus === 'function' && typeof element.click === 'function';
  const unchanged = (includeName = true) => {
    const current = captureDisclosureSnapshot(element);
    return ['document', 'root', 'form', 'formOwner', 'type', 'role', 'details', 'id', 'controls', 'kind', 'href', ...(includeName ? ['name'] : [])]
      .every(key => current[key] === snapshot[key]) && current.frames.length === snapshot.frames.length &&
      current.frames.every((frame, i) => frame.element === snapshot.frames[i].element && frame.document === snapshot.frames[i].document && frame.element.isConnected);
  };
  const ready = (includeName = true) => !snapshot.blocked && isCurrent() && available() && unchanged(includeName) && state() !== null;
  const refused = () => ({ ok: false, message: 'The disclosure changed, is unavailable or has unsupported state. Look at the current panel and try again.' });
  if (typeof expanded !== 'boolean' || !ready()) return refused();
  if (state() === expanded) return { ok: true, message: `Panel is already ${expanded ? 'expanded' : 'collapsed'}.` };
  element.focus({ preventScroll: true });
  const tick = () => new Promise(resolve => element.ownerDocument.defaultView.setTimeout(resolve, 0));
  return { message: 'Checking the requested panel state…', followUp: (async () => {
    await tick();
    if (!ready() || !ownsFocus(element)) return refused();
    if (state() !== expanded) { element.click(); await tick(); }
    // Sites may change Show to Hide as part of successful activation.
    const ok = ready(false) && state() === expanded;
    return { ok, message: ok ? `Panel ${expanded ? 'expanded' : 'collapsed'}.` : 'The website did not retain the requested available panel state. Check it before continuing.' };
  })() };
}

export function selectRadio(element, snapshot = captureRadioSnapshot(element)) {
  const native = element.tagName === 'INPUT' && element.type === 'radio';
  const state = () => native ? element.checked : element.getAttribute('aria-checked') === 'true' ? true
    : element.getAttribute('aria-checked') === 'false' ? false : null;
  const available = () => element.isConnected && !element.readOnly && unlocked(element) && controlVisible(element) &&
    (native ? element.tagName === 'INPUT' && element.type === 'radio' &&
      [null, 'radio'].includes(element.getAttribute('role'))
      : element.getAttribute('role') === 'radio' && !['INPUT', 'SELECT', 'TEXTAREA', 'OPTION'].includes(element.tagName) &&
        !(element.tagName === 'A' && element.hasAttribute('href')) &&
        !(element.tagName === 'BUTTON' && element.form && ['submit', 'reset'].includes(element.type))) &&
    typeof element.focus === 'function' && typeof element.click === 'function';
  const unchanged = () => {
    const current = captureRadioSnapshot(element);
    return ['document', 'root', 'form', 'type', 'role', 'name', 'group', 'value', 'groupOwner', 'formOwner'].every(key => current[key] === snapshot[key]) &&
      current.frames.length === snapshot.frames.length && current.frames.every((frame, i) =>
        frame.element === snapshot.frames[i].element && frame.document === snapshot.frames[i].document && frame.element.isConnected);
  };
  if (!available() || !unchanged() || state() === null) return { ok: false, message: 'This command needs an unchanged available native or binary ARIA radio button. Look at the current choice and try again.' };
  if (state()) return { ok: true, message: 'Radio button is already selected.' };
  element.focus({ preventScroll: true });
  if (!available() || !unchanged() || !ownsFocus(element) || state() !== false) {
    return { ok: false, message: 'The radio button changed while focusing it. Look at it and try again.' };
  }
  // Native grouping, cancellation and custom widget state belong to the site.
  // One click only; drain nested microtasks before reporting retained state.
  element.click();
  return { message: 'Checking the radio selection…', followUp: new Promise(resolve => element.ownerDocument.defaultView.setTimeout(resolve, 0)).then(() => {
    const ok = available() && unchanged() && state() === true;
    return { ok, message: ok ? 'Radio button selected.' : 'The website did not retain the requested available radio selection. Check it before continuing.' };
  }) };
}

/** Select a website-owned ARIA tab. Ownership is checked before any deferred click. */
export function selectTab(element, snapshot = captureTabSnapshot(element), { isCurrent = () => true } = {}) {
  const state = tab => tab.getAttribute('aria-selected') === 'true' ? true : tab.getAttribute('aria-selected') === 'false' ? false : null;
  const available = () => element.isConnected && !element.readOnly && unlocked(element) && controlVisible(element) &&
    element.getAttribute('role') === 'tab' && !['INPUT', 'SELECT', 'TEXTAREA', 'OPTION'].includes(element.tagName) &&
    !(element.tagName === 'A' && element.hasAttribute('href')) &&
    !(element.tagName === 'BUTTON' && element.form && ['submit', 'reset'].includes(element.type)) &&
    snapshot.groupOwner?.isConnected && snapshot.groupOwner.getAttribute('role') === 'tablist' &&
    [null, 'false'].includes(snapshot.groupOwner.getAttribute('aria-multiselectable')) && !snapshot.groupOwner.hasAttribute('aria-owns') &&
    typeof element.focus === 'function' && typeof element.click === 'function';
  const unchanged = () => {
    const current = captureTabSnapshot(element);
    return ['document', 'root', 'form', 'type', 'role', 'name', 'group', 'value', 'groupOwner', 'formOwner', 'groupName', 'id', 'controls'].every(key => current[key] === snapshot[key]) &&
      current.frames.length === snapshot.frames.length && current.frames.every((frame, i) => frame.element === snapshot.frames[i].element && frame.document === snapshot.frames[i].document && frame.element.isConnected) &&
      current.members.length === snapshot.members.length && current.members.every((member, i) => ['element', 'id', 'name', 'controls', 'type'].every(key => member[key] === snapshot.members[i][key]));
  };
  const validGroup = () => snapshot.members.length > 0 && snapshot.members.every(member => state(member.element) !== null) &&
    snapshot.members.filter(member => state(member.element) === true).length <= 1;
  const ready = () => isCurrent() && available() && unchanged() && validGroup();
  const refused = () => ({ ok: false, message: 'The website tab or its single-select group changed, is unavailable or has invalid selection state. Look at it and try again.' });
  if (!ready()) return refused();
  if (state(element) === true) return { ok: true, message: 'Website tab is already selected.' };
  element.focus({ preventScroll: true });
  const tick = () => new Promise(resolve => element.ownerDocument.defaultView.setTimeout(resolve, 0));
  return { message: 'Selecting the website tab…', followUp: (async () => {
    // Automatic activation can happen in focus handlers or their microtasks.
    await tick();
    if (!ready() || !ownsFocus(element)) return refused();
    if (state(element) === false) { element.click(); await tick(); }
    const ok = ready() && state(element) === true;
    return { ok, message: ok ? 'Website tab selected.' : 'The website did not retain the requested available tab selection. Check it before continuing.' };
  })() };
}

export function setNumberValue(element, value, snapshot = captureNumberSnapshot(element), { restore = false } = {}) {
  const available = () => element.tagName === 'INPUT' && element.type === 'number' &&
    [null, 'spinbutton'].includes(element.getAttribute('role')) && element.isConnected &&
    !element.readOnly && unlocked(element) && controlVisible(element);
  const unchanged = (includeValue = true) => {
    const current = captureNumberSnapshot(element);
    return Object.keys(snapshot).filter(key => key !== 'frames' && (includeValue || !['value', 'badInput'].includes(key)))
      .every(key => current[key] === snapshot[key]) && current.frames.length === snapshot.frames.length &&
      current.frames.every((frame, i) => frame.element === snapshot.frames[i].element &&
        frame.document === snapshot.frames[i].document && frame.element.isConnected);
  };
  const refused = () => ({ ok: false, message: 'The number field changed, is unavailable or is not a native numeric input. Look at the current field and try again.' });
  if (!available() || !unchanged()) return refused();
  // Empty is reserved for restoring an empty history entry, including a required
  // field. Nonempty edits must obey the browser's exact numeric constraints.
  if (!['number', 'string'].includes(typeof value) || !Number.isFinite(Number(value)) || (value === '' && !restore)) return refused();
  const text = String(value);
  const probe = element.cloneNode(false);
  setNativeValue(probe, String(value));
  const numericValid = input => !input.validity.badInput && !input.validity.rangeUnderflow &&
    !input.validity.rangeOverflow && !input.validity.stepMismatch;
  if (value !== '' && (probe.value !== text || probe.valueAsNumber !== Number(value) || !numericValid(probe))) {
    return { ok: false, message: 'That exact number does not fit the field’s current min, max or step. No value was changed.' };
  }
  const before = element.value;
  if (!element.validity.badInput && before === text) {
    return { ok: true, changed: false, message: `Number field is already ${before || 'empty'}.` };
  }
  element.focus({ preventScroll: true });
  if (!available() || !unchanged() || !ownsFocus(element)) return refused();
  setNativeValue(element, String(value));
  const view = element.ownerDocument.defaultView;
  element.dispatchEvent(new view.Event('input', { bubbles: true, composed: true }));
  if (available() && unchanged(false)) element.dispatchEvent(new view.Event('change', { bubbles: true }));
  return { before, wrote: true, message: 'Checking the numeric field…',
    followUp: new Promise(resolve => view.setTimeout(resolve, 0)).then(() => {
      const ok = available() && unchanged(false) && numericValid(element) &&
        element.value === text;
      return { ok, message: ok ? `Number field set to ${element.value || 'empty'}.`
        : `The website did not retain the requested available number field (observed ${element.value || 'empty'}). Check it before continuing.` };
    }) };
}

export function setDateValue(element, value, snapshot = captureDateSnapshot(element), options = {}) {
  return setTemporalValue(element, value, snapshot, options, 'date', captureDateSnapshot, [null, 'combobox'], 'calendar');
}

export function setTimeValue(element, value, snapshot = captureTimeSnapshot(element), options = {}) {
  return setTemporalValue(element, value, snapshot, options, 'time', captureTimeSnapshot, [null], 'clock');
}

export function setMonthValue(element, value, snapshot = captureMonthSnapshot(element), options = {}) {
  return setTemporalValue(element, value, snapshot, options, 'month', captureMonthSnapshot, [null], 'calendar month');
}

export function setWeekValue(element, value, snapshot = captureWeekSnapshot(element), options = {}) {
  return setTemporalValue(element, value, snapshot, options, 'week', captureWeekSnapshot, [null], 'ISO week calendar');
}

function setTemporalValue(element, value, snapshot, { restore = false }, kind, capture, roles, constraint) {
  const label = kind[0].toUpperCase() + kind.slice(1);
  const available = () => element.tagName === 'INPUT' && element.type === kind &&
    roles.includes(element.getAttribute('role')) && element.isConnected &&
    !element.readOnly && unlocked(element) && controlVisible(element);
  const unchanged = (includeValue = true) => {
    const current = capture(element);
    return Object.keys(snapshot).filter(key => key !== 'frames' && (includeValue || !['value', 'badInput'].includes(key)))
      .every(key => current[key] === snapshot[key]) && current.frames.length === snapshot.frames.length &&
      current.frames.every((frame, i) => frame.element === snapshot.frames[i].element &&
        frame.document === snapshot.frames[i].document && frame.element.isConnected);
  };
  const refused = () => ({ ok: false, message: `The ${kind} field changed, is unavailable or is not a native ${kind} input. Look at the current field and try again.` });
  if (!available() || !unchanged()) return refused();
  // Empty is reserved for restoring an empty history entry, including a required
  // field. Nonempty edits must obey the browser's exact temporal constraints.
  if (typeof value !== 'string' || (value === '' && !restore)) return refused();
  const text = String(value);
  const probe = element.cloneNode(false);
  setNativeValue(probe, String(value));
  const temporalValid = input => !input.validity.badInput && !input.validity.rangeUnderflow &&
    !input.validity.rangeOverflow && !input.validity.stepMismatch;
  if (value !== '' && (probe.value !== text || !Number.isFinite(probe.valueAsNumber) || !temporalValid(probe))) {
    return { ok: false, message: `That ${kind} does not fit the current ${constraint}, min, max or step. No value was changed.` };
  }
  const before = element.value;
  if (!element.validity.badInput && before === text) {
    return { ok: true, changed: false, message: `${label} field is already ${before || 'empty'}.` };
  }
  element.focus({ preventScroll: true });
  if (!available() || !unchanged() || !ownsFocus(element)) return refused();
  setNativeValue(element, String(value));
  const view = element.ownerDocument.defaultView;
  element.dispatchEvent(new view.Event('input', { bubbles: true, composed: true }));
  if (available() && unchanged(false)) element.dispatchEvent(new view.Event('change', { bubbles: true }));
  return { before, wrote: true, message: `Checking the ${kind} field…`,
    followUp: new Promise(resolve => view.setTimeout(resolve, 0)).then(() => {
      const ok = available() && unchanged(false) && temporalValid(element) &&
        element.value === text;
      return { ok, message: ok ? `${label} field set to ${element.value || 'empty'}.`
        : `The website did not retain the requested available ${kind} field (observed ${element.value || 'empty'}). Check it before continuing.` };
    }) };
}

export function setRangeValue(element, value, options = {}) {
  if (!(element.tagName === 'INPUT' && element.type === 'range') && ['slider', 'spinbutton'].includes(element.getAttribute('role'))) {
    return setAriaRangeValue(element, value, options);
  }
  const available = () => element.tagName === 'INPUT' && element.type === 'range' &&
    element.isConnected && !element.readOnly && unlocked(element);
  if (!available()) return { ok: false, message: 'This command needs an available slider.' };
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

// Custom ARIA widgets are driven the way their keyboard contract (WAI-ARIA Authoring Practices) promises, and
// judged only by the state they report afterwards. Websites may update that state after the key event.
const ARIA_RANGE_PRESSES = 400;
const LIST_OPEN_MS = 1500;
const LIST_SEARCH_MS = 2500;

function ariaNumber(element, attribute) {
  const value = Number(element.getAttribute(attribute));
  return element.hasAttribute(attribute) && element.getAttribute(attribute).trim() !== '' && Number.isFinite(value) ? value : null;
}

function pressKey(element, key) {
  const view = element.ownerDocument.defaultView;
  for (const type of ['keydown', 'keyup']) element.dispatchEvent(new view.KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true, composed: true }));
}

const pause = (view, ms = 0) => new Promise(resolve => view.setTimeout(resolve, ms));

/** Move a custom slider or spinbutton to exactly `value` with arrow keys (Home/End first when an end is nearer). */
export function setAriaRangeValue(element, value, { isCurrent = () => true } = {}) {
  const role = element.getAttribute('role'), noun = role === 'spinbutton' ? 'number' : 'slider';
  const label = accessibleName(element) || (role === 'spinbutton' ? 'Number' : 'Slider');
  const available = () => element.isConnected && element.getAttribute('role') === role && unlocked(element);
  if (!available()) return { ok: false, message: `This ${noun} is not available.` };
  if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, message: `Say a finite numeric ${noun} value.` };
  const now = () => ariaNumber(element, 'aria-valuenow');
  const before = now(), min = ariaNumber(element, 'aria-valuemin'), max = ariaNumber(element, 'aria-valuemax');
  if (before === null) return { ok: false, message: `${label} does not report its value, so it cannot be set safely.` };
  if ((min !== null && value < min) || (max !== null && value > max)) {
    return { ok: false, message: `${value} is outside ${label}’s range of ${min ?? 'any'} to ${max ?? 'any'}.` };
  }
  if (before === value) return { ok: true, changed: false, message: `${label} is already ${value}.` };
  element.focus({ preventScroll: true });
  if (!available() || !ownsFocus(element) || now() !== before) return { ok: false, message: `The ${noun} changed while focusing it. Look at it and try again.` };
  const view = element.ownerDocument.defaultView;
  const vertical = role === 'spinbutton' || element.getAttribute('aria-orientation') === 'vertical';
  const [up, down] = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowRight', 'ArrowLeft'];
  const outcome = (ok, message) => ({ ok, changed: now() !== before, before: String(before), message });
  // A key press may show its result at once, after a microtask or after the next frame.
  const press = async key => {
    const previous = now();
    pressKey(element, key);
    for (const wait of [0, 0, 50]) {
      if (now() !== previous || !available()) break;
      await pause(view, wait);
    }
    return now();
  };
  return { before: String(before), message: `Moving ${label} to ${value}…`, followUp: (async () => {
    if (min !== null && value - min < Math.abs(value - before)) await press('Home');
    else if (max !== null && max - value < Math.abs(value - before)) await press('End');
    for (let presses = 0; presses < ARIA_RANGE_PRESSES; presses++) {
      if (!isCurrent()) return outcome(false, `Stopped moving ${label}; it is ${now()}.`);
      if (!available()) return outcome(false, `The website replaced, removed or locked ${label}. Check it before continuing.`);
      const current = now();
      if (current === value) break;
      const next = await press(current < value ? up : down);
      if (next === current || next === null) return outcome(false, `${label} did not respond to the keyboard; it is ${current}.`);
      if ((current < value) !== (next < value) && next !== value) return outcome(false, `${label} moves in steps and cannot be exactly ${value}; it is now ${next}.`);
    }
    const final = now();
    return outcome(final === value, final === value ? `${label} set to ${element.getAttribute('aria-valuetext') || final}.` : `${label} stopped at ${final}. Check it before continuing.`);
  })() };
}

const comparable = text => (text ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function shown(node) {
  if (!node.isConnected || !node.getClientRects().length) return false;
  return node.ownerDocument.defaultView.getComputedStyle(node).visibility !== 'hidden';
}

// The options a custom combobox offers now: in the list it controls or owns, else in the one open listbox.
function listOptions(element) {
  const root = element.getRootNode(), document = element.ownerDocument;
  const ids = [element, ...element.querySelectorAll('[aria-controls], [aria-owns]')]
    .flatMap(node => `${node.getAttribute('aria-controls') ?? ''} ${node.getAttribute('aria-owns') ?? ''}`.split(/\s+/)).filter(Boolean);
  const controlled = ids.map(id => root.getElementById?.(id) ?? document.getElementById(id)).filter(Boolean).filter(shown);
  let lists = controlled;
  if (!lists.length) {
    const open = [...document.querySelectorAll('[role=listbox]')].filter(shown);
    lists = open.length === 1 ? open : [];
  }
  const options = lists.flatMap(list => list.matches('[role=option]') ? [list] : [...list.querySelectorAll('[role=option]')]);
  return [...new Set(options)].filter(shown);
}

function pickOption(options, query) {
  const wanted = comparable(query), named = options.map(option => ({ option, name: comparable(accessibleName(option)) }));
  for (const test of [name => name === wanted, name => name.startsWith(wanted), name => name.includes(wanted)]) {
    const found = named.filter(entry => wanted && test(entry.name));
    if (found.length === 1) return { option: found[0].option };
    if (found.length > 1) return { ambiguous: found.map(entry => accessibleName(entry.option)) };
  }
  return { none: options.map(option => accessibleName(option)) };
}

function pressOption(option) {
  const view = option.ownerDocument.defaultView, init = { bubbles: true, cancelable: true, composed: true, view, button: 0 };
  option.dispatchEvent(new view.PointerEvent('pointerdown', { ...init, pointerType: 'mouse', isPrimary: true }));
  option.dispatchEvent(new view.MouseEvent('mousedown', init));
  option.dispatchEvent(new view.PointerEvent('pointerup', { ...init, pointerType: 'mouse', isPrimary: true }));
  option.dispatchEvent(new view.MouseEvent('mouseup', init));
  option.click();
}

const listing = names => names.slice(0, 8).join(', ') + (names.length > 8 ? `, and ${names.length - 8} more` : '');

/**
 * Choose the option named `optionName` in a custom combobox: open its list (typing the name first into an
 * editable combobox when the shown choices do not include it), press the one matching option, then check
 * that the combobox shows it. Several or no matches leave the list open and name the choices.
 */
export function chooseListOption(element, optionName, { isCurrent = () => true } = {}) {
  const label = accessibleName(element) || 'The list';
  const available = () => element.isConnected && unlocked(element);
  if (!available()) return { ok: false, message: `${label} is not available.` };
  const view = element.ownerDocument.defaultView, editable = isEditable(element);
  const shows = name => comparable(editable ? element.value : element.textContent).includes(comparable(name));
  const until = async (ms, test) => {
    for (let waited = 0; ; waited += 50) {
      const found = test();
      if (found || waited >= ms || !isCurrent()) return found;
      await pause(view, 50);
    }
  };
  return { message: `Opening ${label}…`, followUp: (async () => {
    if (!listOptions(element).length) {
      element.focus({ preventScroll: true });
      if (editable) pressKey(element, 'ArrowDown'); else element.click();
      await until(LIST_OPEN_MS, () => listOptions(element).length);
    }
    let choice = pickOption(listOptions(element), optionName);
    if (!choice.option && editable && isCurrent() && available()) {
      writeValue(element, optionName);
      await until(LIST_SEARCH_MS, () => pickOption(listOptions(element), optionName).option);
      choice = pickOption(listOptions(element), optionName);
    }
    if (!isCurrent()) return { ok: false, message: `Stopped before choosing in ${label}.` };
    if (!available()) return { ok: false, message: `The website removed or locked ${label}. Check it before continuing.` };
    if (choice.ambiguous) return { ok: false, message: `Several choices match “${optionName}”: ${listing(choice.ambiguous)}. Say “click” and the one you mean.` };
    if (!choice.option) {
      return { ok: false, message: choice.none.length ? `No choice called “${optionName}” in ${label}. Shown: ${listing(choice.none)}.` : `${label} did not show any choices.` };
    }
    const option = choice.option, name = accessibleName(option);
    if (option.getAttribute('aria-disabled') === 'true') return { ok: false, message: `${name} is unavailable in ${label}.` };
    if (shows(name) && option.getAttribute('aria-selected') === 'true') return { ok: true, message: `${name} is already chosen in ${label}.` };
    option.scrollIntoView?.({ block: 'nearest' });
    pressOption(option);
    const chosen = await until(300, () => shows(name));
    return chosen ? { ok: true, message: `${name} chosen in ${label}.` }
      : { ok: false, message: `The website did not show ${name} as chosen in ${label}. Check it before continuing.` };
  })() };
}

// Selection APIs are deliberately limited to native, writable text controls. Rich-text
// editors and input types such as email/number do not expose compatible offsets.
export function readSelection(element) {
  if (!['INPUT', 'TEXTAREA'].includes(element.tagName) || !canWrite(element)) return null;
  const start = element.selectionStart;
  const end = element.selectionEnd;
  return Number.isInteger(start) && Number.isInteger(end) ? { start, end } : null;
}

/** Delete precisely the captured native selection; site events own the result. */
export function deleteSelection(element, snapshot = captureTextSelectionSnapshot(element), { isCurrent = () => true, onWrite = () => {} } = {}) {
  const available = () => element.type !== 'password' && element.isConnected && !!readSelection(element) && controlVisible(element);
  const unchanged = (includeSelection = true) => {
    const current = captureTextSelectionSnapshot(element);
    return ['document', 'root', 'form', 'formOwner', 'type', 'role', 'name', 'group', 'id', ...(includeSelection ? ['valueAttribute', 'value', 'start', 'end'] : [])]
      .every(key => current[key] === snapshot[key]) && current.frames.length === snapshot.frames.length &&
      current.frames.every((frame, i) => frame.element === snapshot.frames[i].element && frame.document === snapshot.frames[i].document && frame.element.isConnected);
  };
  const ready = () => !snapshot.blocked && isCurrent() && available() && unchanged();
  const refused = () => ({ ok: false, message: 'Select nonempty text in an unchanged available native text field. Look at it and try again.' });
  const { value, start, end } = snapshot;
  const splitsPair = index => index > 0 && index < value.length && /[\uD800-\uDBFF]/.test(value[index - 1]) && /[\uDC00-\uDFFF]/.test(value[index]);
  if (typeof value !== 'string' || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > value.length || splitsPair(start) || splitsPair(end) || !ready()) return refused();
  element.focus({ preventScroll: true });
  const tick = () => new Promise(resolve => element.ownerDocument.defaultView.setTimeout(resolve, 0));
  return { message: 'Removing selected text…', followUp: (async () => {
    await tick();
    if (!ready() || !ownsFocus(element)) return refused();
    const after = value.slice(0, start) + value.slice(end), view = element.ownerDocument.defaultView;
    setNativeValue(element, after); element.setSelectionRange(start, start);
    // Record immediately after the write, before site handlers can start Undo.
    onWrite(value);
    element.dispatchEvent(new view.InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward', data: null }));
    if (available() && unchanged(false)) element.dispatchEvent(new view.Event('change', { bubbles: true }));
    await tick();
    const ok = isCurrent() && available() && unchanged(false) && element.value === after;
    return { ok, wrote: true, message: ok ? 'Selected text removed. Say “undo” to restore it.' : 'The website did not retain the requested available text change. Check the field before continuing.' };
  })() };
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

// The text node and offset at a textContent offset (text nodes in tree order make up textContent).
function textPoint(element, offset) {
  const walker = element.ownerDocument.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
  let last = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (offset <= node.length) return [node, offset];
    offset -= node.length;
    last = node;
  }
  return last ? [last, last.length] : [element, element.childNodes.length];
}

// Rich-text editors (mail composers, comment boxes) keep their formatting and links: only the changed span
// is replaced, through the browser's editing command so the site sees an ordinary insertion. Returns
// whether the browser already fired the input events.
function writeRichText(element, value) {
  const before = element.textContent;
  if (before === value) return true;
  let start = 0;
  while (start < before.length && start < value.length && before[start] === value[start]) start++;
  let end = 0;
  while (end < before.length - start && end < value.length - start && before[before.length - 1 - end] === value[value.length - 1 - end]) end++;
  // Never split a surrogate pair at either boundary.
  if (start > 0 && /[\uD800-\uDBFF]/.test(before[start - 1])) start--;
  if (end > 0 && /[\uDC00-\uDFFF]/.test(before[before.length - end])) end--;
  const document = element.ownerDocument;
  const range = document.createRange();
  range.setStart(...textPoint(element, start));
  range.setEnd(...textPoint(element, before.length - end));
  const inserted = value.slice(start, value.length - end);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  let native = false;
  try {
    native = selection?.rangeCount === 1 && document.execCommand(inserted ? 'insertText' : 'delete', false, inserted);
  } catch {
    native = false;
  }
  if (native && element.textContent === value) return true;
  // The site blocked or altered the native edit: replace just that span directly.
  if (element.textContent !== before) return true;
  range.deleteContents();
  if (inserted) {
    const node = document.createTextNode(inserted);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  return false;
}

export function writeValue(element, value, { caret = value.length } = {}) {
  element.focus({ preventScroll: true });
  const view = element.ownerDocument.defaultView;
  if (!('value' in element && element.tagName !== 'BUTTON') && element.isContentEditable) {
    if (!writeRichText(element, value)) element.dispatchEvent(new view.InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    return;
  }
  if ('value' in element && element.tagName !== 'BUTTON') setNativeValue(element, value);
  else element.textContent = value;
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

/** Change exactly one native multi-select choice against the captured selection graph. */
export function setMultipleOption(element, optionIndex, selected, snapshot) {
  const refuse = message => ({ ok: false, message });
  const available = () => element.tagName === 'SELECT' && element.isConnected && element.multiple && !element.readOnly && unlocked(element);
  if (!available() || typeof selected !== 'boolean' || !snapshot?.multiple || !Number.isInteger(optionIndex) || optionIndex < 0 || !snapshot.options?.[optionIndex]) {
    return refuse('This command needs an available native multiple-selection list.');
  }
  const intended = snapshot.options[optionIndex];
  const matches = (after = false) => {
    if (!available() || !Array.isArray(snapshot.frames) || !snapshot.frames.every(frame => frame.element.isConnected && frame.element.contentDocument === frame.document)) return false;
    const current = captureSelectSnapshot(element);
    const expectedIndex = after ? snapshot.options.findIndex((option, index) => index === optionIndex ? selected : option.selected) : snapshot.selectedIndex;
    return current.frames.length === snapshot.frames.length && current.frames.every((frame, i) => frame.element === snapshot.frames[i].element && frame.document === snapshot.frames[i].document) &&
      ['document', 'name', 'role', 'multiple'].every(key => current[key] === snapshot[key]) && current.selectedIndex === expectedIndex &&
      current.options.length === snapshot.options.length && current.options.every((option, index) =>
        Object.keys(option).every(key => option[key] === (after && index === optionIndex && key === 'selected' ? selected : snapshot.options[index][key])));
  };
  if (!matches() || intended.disabled || intended.groupDisabled) return refuse('The list, option or selection changed or is unavailable. Look at it and choose again.');
  if (intended.selected === selected) return { ok: true, message: `${intended.label.trim()} is already ${selected ? 'selected' : 'not selected'}.` };
  element.focus({ preventScroll: true });
  if (!ownsFocus(element) || !matches()) return refuse('The list changed while focusing it. Look at it and choose again.');
  const changed = () => refuse('The website did not retain the requested selection and other choices. Check the list before continuing.');
  const view = element.ownerDocument.defaultView;
  Object.getOwnPropertyDescriptor(view.HTMLOptionElement.prototype, 'selected').set.call(intended.element, selected);
  if (!matches(true)) return changed();
  element.dispatchEvent(new view.Event('input', { bubbles: true, composed: true }));
  if (!matches(true)) return changed();
  element.dispatchEvent(new view.Event('change', { bubbles: true }));
  return { message: 'Checking the requested list selection…', followUp: new Promise(resolve => globalThis.setTimeout(resolve, 0)).then(() =>
    matches(true) ? { ok: true, message: `${intended.label.trim()} ${selected ? 'added to' : 'removed from'} the selection.` } : changed()) };
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

function scrollRegionVisible(region, document) {
  const view = region.ownerDocument.defaultView;
  if (!region.isConnected || !view) return false;
  const { visibility } = view.getComputedStyle(region);
  if (['hidden', 'collapse'].includes(visibility) || ![...region.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) return false;
  for (let owner = region.ownerDocument; owner !== document;) {
    const frame = owner.defaultView?.frameElement;
    if (!frame?.isConnected || frame.contentDocument !== owner || !controlVisible(frame)) return false;
    owner = frame.ownerDocument;
  }
  return true;
}

export function scroll(region, direction, amount, window) {
  const document = window.document;
  const page = !region || region === document.scrollingElement || region === document.documentElement || region === document.body;
  if (!page && !scrollRegionVisible(region, document)) return { ok: false, message: 'That scrolling region is no longer visible on the page. Look at it again.' };
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
