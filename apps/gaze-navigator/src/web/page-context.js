// Context stage: discovers ordinary actionable elements near the gaze point without page annotations.
// Elements are described for interpretation; DOM references stay here and in execution.

const ACTIONABLE = [
  'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
  '[contenteditable=""]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
  ...['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option', 'combobox', 'textbox', 'searchbox']
    .map(role => `[role=${role}]`),
].join(',');

const TEXT_INPUTS = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);
const INPUT_ROLES = { checkbox: 'checkbox', radio: 'radio', range: 'slider', button: 'button', submit: 'button', reset: 'button', image: 'button', search: 'searchbox' };
const CONSEQUENTIAL = /\b(delete|remove|erase|destroy|buy|purchase|pay|place order|order now|checkout|check out|send|submit|post|publish|transfer|sign out|log out|logout|unsubscribe|close account|deactivate|confirm)\b/i;

// Elements recognized only by their pointer cursor; they have no semantic role of their own.
const inferred = new WeakSet();

const clean = text => (text ?? '').replace(/\s+/g, ' ').trim();

function visibleText(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return '';
  if (node.tagName === 'IMG') return ` ${node.getAttribute('alt') ?? ''} `;
  // Form controls inside a label contribute their own values, not their option lists.
  if (node.getAttribute?.('aria-hidden') === 'true' || ['SCRIPT', 'STYLE', 'TEMPLATE', 'SELECT', 'TEXTAREA'].includes(node.tagName)) return '';
  if (node.tagName === 'BR') return ' ';
  // Hidden text is not part of the name, and block-level parts are separate words: a suggestion reading
  // "Ada Lovelace" above "English mathematician" is not named "Ada LovelaceEnglish mathematician".
  const display = node.ownerDocument?.defaultView?.getComputedStyle?.(node).display ?? 'inline';
  if (display === 'none') return '';
  const text = [...node.childNodes].map(visibleText).join('');
  return display === 'inline' || display === 'contents' ? text : ` ${text} `;
}

export function roleOf(element) {
  const explicit = element.getAttribute('role')?.split(/\s+/)[0];
  if (explicit) return explicit;
  if (inferred.has(element)) return 'clickable';
  const tag = element.tagName;
  if (tag === 'A') return 'link';
  if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
  if (tag === 'SELECT') return 'combobox';
  if (tag === 'TEXTAREA') return 'textbox';
  if (tag === 'INPUT') return INPUT_ROLES[element.type] ?? 'textbox';
  if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') return 'textbox';
  return 'generic';
}

export function isEditable(element) {
  if (element.tagName === 'TEXTAREA') return !element.readOnly;
  if (element.tagName === 'INPUT') return TEXT_INPUTS.has(element.getAttribute('type') ?? '') && !element.readOnly;
  return element.isContentEditable === true || ['textbox', 'searchbox'].includes(element.getAttribute('role'));
}

export function accessibleName(element) {
  const document = element.ownerDocument;
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    // IDs are scoped to the element's own document or shadow root.
    const scope = element.getRootNode();
    const lookup = id => (scope.getElementById ? scope.getElementById(id) : null) ?? document.getElementById(id);
    const text = clean(labelledBy.split(/\s+/).map(id => lookup(id)?.textContent ?? '').join(' '));
    if (text) return text;
  }
  const label = clean(element.getAttribute('aria-label'));
  if (label) return label;
  if (element.labels?.length) {
    const text = clean([...element.labels].map(visibleText).join(' '));
    if (text) return text;
  }
  if (element.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(element.type)) {
    return clean(element.value) || (element.type === 'reset' ? 'Reset' : 'Submit');
  }
  if (element.tagName === 'INPUT' && element.type === 'image') return clean(element.alt) || 'Submit';
  if (!isEditable(element) && element.tagName !== 'SELECT') {
    const text = clean(visibleText(element));
    if (text) return text.slice(0, 80);
  }
  return clean(element.getAttribute('title')) || clean(element.getAttribute('placeholder')) || '';
}

function usable(element, exclude) {
  if (exclude?.contains(element) || element.closest('[inert]') || element.matches(':disabled')) return false;
  if (element.getAttribute('aria-disabled') === 'true') return false;
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

export function distanceToRect(x, y, rect) {
  return Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom));
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Offset of a same-origin frame chain (outermost first) in top-level viewport coordinates.
function frameOffset(frames = []) {
  let x = 0;
  let y = 0;
  for (const frame of frames) {
    const rect = frame.getBoundingClientRect();
    x += rect.left + frame.clientLeft;
    y += rect.top + frame.clientTop;
  }
  return { x, y };
}

export function viewportRect(element, frames = []) {
  const rect = element.getBoundingClientRect();
  const { x, y } = frameOffset(frames);
  return { left: rect.left + x, top: rect.top + y, right: rect.right + x, bottom: rect.bottom + y, width: rect.width, height: rect.height };
}

function sameOriginDocument(frame) {
  try {
    return frame.contentDocument?.documentElement ? frame.contentDocument : null;
  } catch {
    return null;
  }
}

// The element actually painted at a top-level point, descending into open shadow roots and
// same-origin frames.
export function deepElementFromPoint(document, x, y) {
  let hit = document.elementFromPoint(x, y);
  for (let depth = 0; hit && depth < 32; depth++) {
    if (hit.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(x, y);
      if (inner && inner !== hit) {
        hit = inner;
        continue;
      }
    }
    const frameDocument = /^I?FRAME$/.test(hit.tagName) ? sameOriginDocument(hit) : null;
    if (!frameDocument) break;
    const rect = hit.getBoundingClientRect();
    x -= rect.left + hit.clientLeft;
    y -= rect.top + hit.clientTop;
    const inner = frameDocument.elementFromPoint(x, y);
    if (!inner) break;
    hit = inner;
  }
  return hit;
}

// contains() that also crosses shadow-root boundaries.
function composedContains(ancestor, node) {
  for (let current = node; current; current = current.parentNode ?? current.host) {
    if (current === ancestor) return true;
  }
  return false;
}

// Visible where the user could be looking: at the point nearest the gaze center or at the element center.
function unobscured(document, element, rect, x, y) {
  const inset = Math.min(2, rect.width / 2, rect.height / 2);
  return [
    [clamp(x, rect.left + inset, rect.right - inset), clamp(y, rect.top + inset, rect.bottom - inset)],
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
  ].some(([px, py]) => composedContains(element, deepElementFromPoint(document, px, py)));
}

// Same-origin frames (with their chains) so pointer input inside them can be translated.
export function sameOriginFrames(document, exclude = null) {
  const scopes = [];
  collectScopes(document, [], exclude, scopes, []);
  return scopes.filter(scope => scope.frames.length && scope.root.nodeType === 9)
    .map(scope => ({ document: scope.root, frames: scope.frames }));
}

export { frameOffset };

// Every searchable scope: the document, open shadow roots and same-origin frames.
// Cross-origin frames are collected so the user can be told they are out of reach.
function collectScopes(root, frames, exclude, scopes, unreachable) {
  scopes.push({ root, frames });
  for (const node of root.querySelectorAll('*')) {
    if (node === exclude) continue;
    if (node.shadowRoot) collectScopes(node.shadowRoot, frames, exclude, scopes, unreachable);
    if (/^I?FRAME$/.test(node.tagName)) {
      const inner = sameOriginDocument(node);
      if (inner) collectScopes(inner, [...frames, node], exclude, scopes, unreachable);
      else unreachable.push({ frame: node, frames });
    }
  }
}

const pointerCursor = node => node.nodeType === 1 && node.ownerDocument.defaultView.getComputedStyle(node).cursor === 'pointer';

// Script-only clickables: the element that sets a pointer cursor (its parent does not), with a
// readable name and no real control inside. Sampled under the circle to stay cheap on big pages.
function inferredClickables(document, x, y, radius, exclude, known) {
  const found = new Set();
  const step = radius / 3;
  for (let dx = -radius; dx <= radius; dx += step) {
    for (let dy = -radius; dy <= radius; dy += step) {
      if (Math.hypot(dx, dy) > radius) continue;
      let node = deepElementFromPoint(document, x + dx, y + dy);
      if (!node || composedContains(exclude, node) || !pointerCursor(node)) continue;
      for (let parent = node.parentElement ?? node.getRootNode().host; parent && pointerCursor(parent);
        parent = parent.parentElement ?? parent.getRootNode().host) node = parent;
      if (['HTML', 'BODY'].includes(node.tagName) || node.matches(ACTIONABLE) || node.closest(ACTIONABLE)) continue;
      if (node.querySelector(ACTIONABLE) || [...known].some(element => composedContains(node, element))) continue;
      if (clean(visibleText(node)) || node.getAttribute('aria-label')) found.add(node);
    }
  }
  return found;
}

export function scrollRegionAt(document, x, y, exclude) {
  const view = document.defaultView;
  for (let node = document.elementFromPoint(x, y); node && node !== document.documentElement; node = node.parentElement) {
    if (exclude?.contains(node) || node === document.body) break;
    const { overflowY, overflowX } = view.getComputedStyle(node);
    const vertical = /(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight + 1;
    const horizontal = /(auto|scroll)/.test(overflowX) && node.scrollWidth > node.clientWidth + 1;
    if (vertical || horizontal) return node;
  }
  return document.scrollingElement ?? document.documentElement;
}

// Native references stay inside this page context; model descriptions use explicit text fields.
export function captureSelectSnapshot(element) {
  const frames = [];
  for (let document = element.ownerDocument; document.defaultView?.frameElement;) {
    const frame = document.defaultView.frameElement; frames.push({ element: frame, document }); document = frame.ownerDocument;
  }
  return { frames, document: element.ownerDocument, name: accessibleName(element), role: element.getAttribute('role'),
    multiple: element.multiple, selectedIndex: element.selectedIndex,
    options: [...element.options].map(option => ({ element: option, parent: option.parentElement,
      value: option.value, text: option.textContent, label: option.label, disabled: option.disabled, selected: option.selected,
      groupDisabled: option.parentElement?.tagName === 'OPTGROUP' && option.parentElement.disabled,
      groupLabel: option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : null })) };
}

export function captureNumberSnapshot(element) {
  return { ...captureRadioSnapshot(element), valueAttribute: element.getAttribute('value'), value: element.value,
    min: element.min, max: element.max, step: element.step, badInput: element.validity?.badInput };
}

export function captureDateSnapshot(element) { return captureNumberSnapshot(element); }
export function captureTimeSnapshot(element) { return captureNumberSnapshot(element); }

// Identity only: state may legitimately change while a confirmation is pending.
export function captureRadioSnapshot(element) {
  const frames = [];
  let document = element.ownerDocument;
  while (document.defaultView?.frameElement) {
    const frame = document.defaultView.frameElement; frames.push({ element: frame, document }); document = frame.ownerDocument;
  }
  let groupOwner = null, formOwner = null;
  for (let parent = element.parentElement ?? element.getRootNode().host; parent;
    parent = parent.parentElement ?? parent.getRootNode().host) {
    if (!groupOwner && parent.getAttribute('role') === 'radiogroup') groupOwner = parent;
    if (!formOwner && parent.tagName === 'FORM') formOwner = parent;
  }
  return { document: element.ownerDocument, root: element.getRootNode(), form: element.form, groupOwner, formOwner,
    type: element.type, role: element.getAttribute('role'), name: accessibleName(element),
    group: element.getAttribute('name'), value: element.getAttribute('value'), frames };
}

/** Identity only; website-owned selection can legitimately change during a pending request. */
export function captureTabSnapshot(element) {
  const groupOwner = element.closest('[role="tablist"]');
  return { ...captureRadioSnapshot(element), groupOwner, groupName: groupOwner ? accessibleName(groupOwner) : null,
    id: element.id, controls: element.getAttribute('aria-controls'),
    members: groupOwner ? [...groupOwner.querySelectorAll('[role="tab"]')]
      .filter(tab => tab.closest('[role="tablist"]') === groupOwner)
      .map(tab => ({ element: tab, id: tab.id, name: accessibleName(tab), controls: tab.getAttribute('aria-controls'), type: tab.type })) : [] };
}

function describe(element) {
  const role = roleOf(element);
  const form = element.form ?? element.closest('form');
  // A button with aria-expanded is a disclosure toggle (menus, filter panels), even when it sits in a form and so
  // defaults to type="submit"; its name can still make it consequential.
  const disclosure = element.hasAttribute?.('aria-expanded');
  const submits = (element.tagName === 'BUTTON' && !disclosure && (element.getAttribute('type') ?? 'submit') === 'submit' && Boolean(form)) ||
    (element.tagName === 'INPUT' && ['submit', 'image'].includes(element.type));
  const name = accessibleName(element);
  const description = {
    name, role, editable: isEditable(element), submits,
    consequential: submits || CONSEQUENTIAL.test(name) || element.hasAttribute?.('download'),
  };
  if (element.tagName === 'SELECT') {
    description.selectSnapshot = captureSelectSnapshot(element);
    description.options = description.selectSnapshot.options.map(option => clean(option.label));
    description.consequentialOptions = description.options.map(label => CONSEQUENTIAL.test(label));
    description.value = clean(element.selectedOptions?.[0]?.label);
  } else if (description.editable) {
    description.value = element.value ?? element.textContent ?? '';
  } else if (['checkbox', 'radio', 'switch'].includes(role)) {
    if (element.tagName === 'INPUT' && ['checkbox', 'radio'].includes(element.type)) description.checked = element.checked;
    else if (['true', 'false'].includes(element.getAttribute('aria-checked'))) description.checked = element.getAttribute('aria-checked') === 'true';
  }
  if (element.tagName === 'INPUT' && element.type === 'number') {
    description.nativeNumber = true; description.numberSnapshot = captureNumberSnapshot(element);
  }
  if (element.tagName === 'INPUT' && element.type === 'date') {
    description.nativeDate = true; description.dateSnapshot = captureDateSnapshot(element);
  }
  if (element.tagName === 'INPUT' && element.type === 'time') {
    description.nativeTime = true; description.timeSnapshot = captureTimeSnapshot(element);
  }
  if (role === 'radio') description.radioSnapshot = captureRadioSnapshot(element);
  if (role === 'tab') description.tabSnapshot = captureTabSnapshot(element);
  // Disclosure state: an open menu or panel can be closed by name ("close the menu").
  if (disclosure) description.expanded = element.getAttribute('aria-expanded') === 'true';
  else if (element.tagName === 'SUMMARY' && element.parentElement?.tagName === 'DETAILS') description.expanded = element.parentElement.open;
  return description;
}

// Elements whose rectangles intersect the circle, nearest first, numbered for clarification.
export function captureContext(document, { x, y, radius, exclude = null, limit = 12 }) {
  if (![x, y, radius].every(Number.isFinite) || radius <= 0) return { x, y, radius, elements: [], region: null, unreachable: [] };
  const scopes = [];
  const outOfReach = [];
  collectScopes(document, [], exclude, scopes, outOfReach);
  const candidates = [];
  const consider = (element, frames) => {
    const rect = viewportRect(element, frames);
    if (!(rect.width > 0 && rect.height > 0)) return;
    const distance = distanceToRect(x, y, rect);
    if (distance > radius || !usable(element, exclude) || !unobscured(document, element, rect, x, y)) return;
    candidates.push({ element, rect, distance, frames });
  };
  for (const { root, frames } of scopes) {
    for (const element of root.querySelectorAll(ACTIONABLE)) consider(element, frames);
  }
  for (const element of inferredClickables(document, x, y, radius, exclude, new Set(candidates.map(candidate => candidate.element)))) {
    inferred.add(element);
    const frames = scopes.find(scope => scope.root === element.ownerDocument)?.frames ?? [];
    consider(element, frames);
  }
  // A generic focusable container is redundant when it contains a more specific control.
  const kept = candidates.filter(({ element }) => roleOf(element) !== 'generic' ||
    !candidates.some(other => other.element !== element && composedContains(element, other.element)));
  // A control inside another with the same name (a link inside a suggestion's list option) is one target, not two
  // identical choices: the inner one is kept, and a click on it reaches the outer one too.
  const names = new Map(kept.map(candidate => [candidate, accessibleName(candidate.element)]));
  const distinct = kept.filter(outer => !(names.get(outer) && kept.some(inner => inner !== outer &&
    composedContains(outer.element, inner.element) && names.get(inner) === names.get(outer))));
  distinct.sort((a, b) => a.distance - b.distance);
  const elements = distinct.slice(0, limit).map((candidate, index) => ({
    id: index + 1, element: candidate.element, rect: candidate.rect, distance: candidate.distance, frames: candidate.frames,
    ...describe(candidate.element),
  }));
  const unreachable = outOfReach
    .filter(({ frame, frames }) => {
      const rect = viewportRect(frame, frames);
      return rect.width > 0 && rect.height > 0 && distanceToRect(x, y, rect) <= radius;
    })
    .map(({ frame }) => ({ name: clean(frame.getAttribute('title')) || 'Embedded content' }));
  return { x, y, radius, elements, unreachable, region: scrollRegionAt(document, x, y, exclude), pageSearch: findPageSearch(document, exclude) };
}

// The page's single visible search field, usable by "search for …" without looking at it first.
export function findPageSearch(document, exclude = null) {
  const fields = [...document.querySelectorAll('input[type=search], [role=search] input, [role=searchbox]')]
    .filter((field, index, all) => all.indexOf(field) === index && isEditable(field) && usable(field, exclude))
    .filter(field => {
      const rect = field.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  if (fields.length !== 1) return null;
  return { id: 0, element: fields[0], distance: Infinity, ...describe(fields[0]) };
}
