// Context stage: discovers ordinary actionable elements near the gaze point without page annotations.
// Elements are described for interpretation; DOM references stay here and in execution.

const ACTIONABLE = [
  'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
  '[contenteditable=""]', '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])',
  ...['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option', 'combobox', 'textbox', 'searchbox', 'slider', 'spinbutton']
    .map(role => `[role=${role}]`),
].join(',');

const TEXT_INPUTS = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number']);
const INPUT_ROLES = { checkbox: 'checkbox', radio: 'radio', range: 'slider', button: 'button', submit: 'button', reset: 'button', image: 'button', search: 'searchbox' };
// Names of controls whose effects are hard to undo or reach other people; activating them asks for confirmation.
const CONSEQUENTIAL = /\b(delete|remove|erase|destroy|discard|empty trash|buy|purchase|pay|place order|order now|checkout|check out|book|reserve|send|reply|reply all|forward|share|invite|submit|post|publish|upload|apply|accept|decline|transfer|archive|report|block|leave|sign out|log out|logout|unsubscribe|cancel (?:order|subscription|booking|reservation|membership)|close account|deactivate|reset|confirm)\b/i;

export const isConsequentialName = name => CONSEQUENTIAL.test(name ?? '');

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

// Fields whose contents must never be shown, announced, spoken or described to a model: passwords and
// one-time or payment codes. They stay writable; only their values are withheld.
const SENSITIVE_AUTOCOMPLETE = /\b(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp(-month|-year)?)\b/;

export function isSensitive(element) {
  return element.tagName === 'INPUT' && (element.type === 'password' || SENSITIVE_AUTOCOMPLETE.test(element.getAttribute('autocomplete') ?? ''));
}

export function isEditable(element) {
  if (element.tagName === 'TEXTAREA') return !element.readOnly;
  if (element.tagName === 'INPUT') return TEXT_INPUTS.has(element.getAttribute('type') ?? '') && !element.readOnly;
  return element.isContentEditable === true || ['textbox', 'searchbox'].includes(element.getAttribute('role'));
}

// What a text field asks for, from its type, autocomplete hint, label and id: an email address, a phone number, a
// postcode or a street address, or free text (a box of several lines). Dictated text of a kind finds its field.
function fieldKind(element, name) {
  if (element.tagName === 'TEXTAREA' || element.isContentEditable || element.getAttribute('aria-multiline') === 'true') return 'text';
  if (element.tagName !== 'INPUT') return null;
  const type = element.getAttribute('type')?.toLowerCase() ?? '', hint = (element.getAttribute('autocomplete') ?? '').toLowerCase();
  if (type === 'search' || element.getAttribute('role') === 'searchbox') return null;
  const label = (name ?? '').toLowerCase(), id = `${element.id ?? ''} ${element.getAttribute('name') ?? ''}`.toLowerCase();
  const says = pattern => pattern.test(label) || pattern.test(id);
  if (type === 'email' || /\bemail\b/.test(hint) || says(/e-?mail/)) return 'email';
  if (type === 'tel' || /\btel\b/.test(hint) || says(/phone|\bmobile\b|\btel\b/)) return 'tel';
  if (/postal-code/.test(hint) || says(/post ?code|postal|\bzip(?: ?code)?\b/)) return 'postal-code';
  // The first line of an address holds the street; a second line holds a flat or building.
  const line = (hint.match(/address-line(\d)/) ?? label.match(/\bline ?(\d)\b/) ?? id.match(/(?:line|address)[-_ ]?(\d)\b/))?.[1];
  if (/street-address/.test(hint) || says(/\bstreet\b/) || (says(/^address\b/) && (!line || line === '1'))) return line && line !== '1' ? null : 'street';
  return null;
}

// A date asked for in three boxes (Day, Month and Year, as on GOV.UK and many bank forms): the three text fields in
// the same fieldset, told apart by their autocomplete hint, label or id. One spoken date fills all three.
const DATE_PART_HINTS = { day: /^(?:day|dd)\b/i, month: /^(?:month|mm)\b/i, year: /^(?:year|yyyy|yy)\b/i };
function datePartsOf(element) {
  const box = input => input.tagName === 'INPUT' && ['text', 'number', 'tel'].includes(input.type);
  if (!box(element)) return null;
  const group = element.closest('fieldset');
  const inputs = group ? [...group.querySelectorAll('input')].filter(box) : [];
  if (inputs.length !== 3) return null;
  const parts = {};
  for (const input of inputs) {
    const hint = /bday-(day|month|year)/.exec(input.getAttribute('autocomplete') ?? '')?.[1];
    const name = accessibleName(input), id = input.id || input.name || '';
    const kind = hint ?? Object.keys(DATE_PART_HINTS).find(part => DATE_PART_HINTS[part].test(name) || new RegExp(`[-_]${part}$`, 'i').test(id));
    if (!kind || parts[kind]) return null;
    parts[kind] = input;
  }
  return { ...parts, legend: clean(group.querySelector('legend')?.textContent ?? '') };
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

function composedParent(node) {
  try { return node.parentNode ?? node.host ?? node.defaultView?.frameElement ?? null; }
  catch { return null; }
}

// contains() that also crosses open shadow roots and same-origin frames.
export function composedContains(ancestor, node) {
  for (let current = node; current; current = composedParent(current)) {
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
  return scrollRegionsAt(document, x, y, exclude)[0] ?? document.scrollingElement ?? document.documentElement;
}

function scrollRegionsAt(document, x, y, exclude, axes = new Map()) {
  const regions = [];
  for (let node = deepElementFromPoint(document, x, y); node; node = composedParent(node)) {
    if (composedContains(exclude, node)) break;
    if (node.nodeType !== 1 || node === node.ownerDocument.body || node === node.ownerDocument.documentElement) continue;
    if (!axes.has(node)) axes.set(node, scrollAxes(node));
    const { vertical, horizontal } = axes.get(node);
    if (vertical || horizontal) regions.push(node);
  }
  return regions;
}

function scrollAxes(node) {
  const { overflowY, overflowX } = node.ownerDocument.defaultView.getComputedStyle(node);
  return {
    vertical: /(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight + 1,
    horizontal: /(auto|scroll)/.test(overflowX) && node.scrollWidth > node.clientWidth + 1,
  };
}

export function regionSupportsAxis(node, axis) {
  return Boolean(node?.isConnected && node.ownerDocument.defaultView && scrollAxes(node)[axis]);
}

// Scrolling regions anywhere on screen, for requests that name one ("scroll the list down") when the gaze is not on
// it: a coarse grid of hit tests over the viewport, so only painted regions count and big pages stay cheap.
function screenScrollRegions(document, exclude, x, y, radius) {
  const view = document.defaultView, found = new Set(), axes = new Map(), step = 60;
  for (let left = step / 2; left < view.innerWidth; left += step) {
    for (let top = step / 2; top < view.innerHeight; top += step) for (const region of scrollRegionsAt(document, left, top, exclude, axes)) found.add(region);
  }
  for (const { element, vertical, horizontal } of nearbyScrollRegions(document, x, y, radius, exclude)) {
    if (!found.has(element)) { found.add(element); axes.set(element, { vertical, horizontal }); }
  }
  return [...found].map(element => {
    const frames = [];
    for (let owner = element.ownerDocument; owner !== document;) {
      const frame = owner.defaultView?.frameElement;
      if (!frame) break;
      frames.push(frame); owner = frame.ownerDocument;
    }
    return { element, rect: viewportRect(element, frames), ...axes.get(element) };
  });
}

const described = element => `${element.id} ${element.getAttribute('class') ?? ''} ${element.getAttribute('aria-label') ?? ''}`;
// What a spoken region name can mean: the region itself, or what it holds.
const REGION_KINDS = {
  list: element => element.matches('ul, ol, table, [role=list], [role=listbox], [role=tree], [role=grid]') ||
    element.querySelectorAll('li, tr, [role=option], [role=treeitem], [role=listitem], [role=row]').length >= 5,
  sidebar: element => Boolean(element.closest('aside, [role=complementary]')) || /side-?bar|side-?nav|aside/i.test(described(element)),
  menu: element => Boolean(element.closest('nav, [role=navigation], [role=menu], [role=menubar]')) || /menu|\bnav/i.test(described(element)),
  comments: element => /comment|repl(y|ies)/i.test(described(element)),
  chat: element => /chat|message|conversation/i.test(described(element)),
  results: element => /result/i.test(described(element)),
  table: element => element.matches('table, [role=grid], [role=table]') || Boolean(element.querySelector('table, [role=grid], [role=table]')),
};
export const REGION_NAMES = Object.keys(REGION_KINDS);
export function regionIs(element, kind) { return Boolean(REGION_KINDS[kind]?.(element)); }

// Hit-test a fixed grid, rather than scanning every DOM node on every gaze update.
// Only painted content within the circle can contribute a recovery candidate.
function nearbyScrollRegions(document, x, y, radius, exclude) {
  const found = new Set();
  const axes = new Map();
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
    if (dx * dx + dy * dy > 9) continue;
    for (const region of scrollRegionsAt(document, x + dx * radius / 3, y + dy * radius / 3, exclude, axes)) found.add(region);
  }
  return [...found].map(element => ({ element, ...axes.get(element) }));
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
export function captureMonthSnapshot(element) { return captureNumberSnapshot(element); }
export function captureWeekSnapshot(element) { return captureNumberSnapshot(element); }

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

function disclosureLocked(element) {
  for (let scope = element; scope;) {
    if (scope.readOnly || scope.matches(':disabled') || scope.closest('[inert], [aria-disabled="true"], [aria-readonly="true"]')) return true;
    try { scope = scope.getRootNode().host ?? scope.ownerDocument.defaultView.frameElement; }
    catch { return true; }
  }
  return false;
}

// Rich-text editors (contenteditable) have no selectionStart/End: their selection is measured in text offsets of
// textContent. Typing in the navigator's own panel can move the page's selection, so the selection the navigator
// last set in an editor is kept too, and used while the editor's text is unchanged.
const richSelections = new WeakMap();
export const isRichText = element => !('value' in element && element.tagName !== 'BUTTON') && element.isContentEditable;
export function richSelection(element) {
  const selection = element.ownerDocument.getSelection?.();
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0);
    if (element.contains(range.startContainer) && element.contains(range.endContainer)) {
      const before = element.ownerDocument.createRange();
      before.selectNodeContents(element);
      before.setEnd(range.startContainer, range.startOffset);
      const start = before.toString().length;
      before.setEnd(range.endContainer, range.endOffset);
      return { start, end: before.toString().length };
    }
  }
  const kept = richSelections.get(element);
  return kept && kept.text === element.textContent ? { start: kept.start, end: kept.end } : null;
}
export function rememberRichSelection(element, start, end) {
  richSelections.set(element, { start, end, text: element.textContent });
}

// Values/offsets stay local to the execution context, never model descriptions.
export function captureTextSelectionSnapshot(element) {
  const rich = isRichText(element) ? richSelection(element) ?? { start: null, end: null } : null;
  return { ...captureRadioSnapshot(element), id: element.id, valueAttribute: element.getAttribute('value'),
    value: rich ? element.textContent : element.value, start: rich ? rich.start : element.selectionStart, end: rich ? rich.end : element.selectionEnd,
    blocked: disclosureLocked(element) };
}

// Capture admission too: invalid ARIA cannot become actionable while pending.
export function captureDisclosureSnapshot(element) {
  const details = element.tagName === 'SUMMARY' && element.parentElement?.tagName === 'DETAILS' ? element.parentElement : null;
  const primary = details && [...details.children].find(child => child.tagName === 'SUMMARY') === element;
  return { ...captureRadioSnapshot(element), details, id: element.id, controls: element.getAttribute('aria-controls'), href: element.getAttribute('href'), blocked: disclosureLocked(element),
    kind: details ? (primary ? 'native' : null) : ['true', 'false'].includes(element.getAttribute('aria-expanded')) ? 'aria' : null };
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

/** Capture the visible identity and native destination of a control awaiting a yes. */
export function captureActivationSnapshot(element, name = null) {
  if (!element?.getAttribute || !element.isConnected || !element.ownerDocument?.defaultView) return null;
  const frames = [];
  for (let document = element.ownerDocument; document.defaultView?.frameElement;) {
    const frame = document.defaultView.frameElement;
    if (!frame.isConnected || frame.contentDocument !== document) return null;
    frames.push(frame, document); document = frame.ownerDocument;
  }
  const attr = name => element.getAttribute(name);
  const link = element.tagName === 'A' && element.hasAttribute('href');
  const submitter = ['BUTTON', 'INPUT'].includes(element.tagName) && ['submit', 'image'].includes(element.type);
  const form = submitter ? element.form : null;
  let destination = null;
  if (form) {
    const action = attr('formaction') ?? form.getAttribute('action');
    try { destination = action?.trim() ? new URL(action, element.ownerDocument.baseURI).href : element.ownerDocument.URL; }
    catch { destination = action; }
  }
  const baseTarget = () => element.ownerDocument.querySelector('base[target]')?.getAttribute('target') ?? null;
  return [element.ownerDocument, element.getRootNode(), name ?? accessibleName(element), attr('role'), element.type, element.disabled, attr('aria-disabled'),
    link ? element.href : null, link ? attr('target') || baseTarget() : null, attr('download'), form, destination,
    form ? attr('formmethod') ?? form.getAttribute('method') : null,
    form ? (attr('formtarget') ?? form.getAttribute('target')) || baseTarget() : null,
    form ? attr('name') : null, form ? attr('value') : null, ...frames];
}
// Native form ownership can be set by a form attribute rather than an ancestor.
export function submissionBinding(element) {
  const form = 'form' in element ? element.form : element.closest('form');
  const submitter = form && ['BUTTON', 'INPUT'].includes(element.tagName) && ['submit', 'image'].includes(element.type) ? element : null;
  return { form, submitter };
}

export function captureSubmissionSnapshot(element, identity = captureActivationSnapshot(element)) {
  if (!identity) return null;
  const disabled = element.matches(':disabled');
  const { form, submitter } = submissionBinding(element);
  if (!form) return [...identity, disabled, null];
  if (!form.isConnected || form.ownerDocument !== element.ownerDocument) return null;
  const override = (button, property) => submitter?.getAttribute(button) ?? form.getAttribute(property);
  const action = override('formaction', 'action');
  let destination;
  try { destination = action ? new URL(action, form.ownerDocument.baseURI).href : form.ownerDocument.URL; }
  catch { destination = action; }
  const target = override('formtarget', 'target') || form.ownerDocument.querySelector('base[target]')?.getAttribute('target') || null;
  const method = override('formmethod', 'method');
  const dialog = method?.toLowerCase() === 'dialog' ? form.closest('dialog') : null;
  return [...identity, disabled, form, form.getRootNode(), submitter, action, destination, target,
    method, dialog, dialog?.open, override('formenctype', 'enctype'), form.getAttribute('accept-charset'), form.getAttribute('rel'),
    form.hasAttribute('novalidate'), submitter?.hasAttribute('formnovalidate') ?? false];
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
    name, role, editable: isEditable(element), submits, activationSnapshot: captureActivationSnapshot(element, name),
    consequential: submits || CONSEQUENTIAL.test(name) || element.hasAttribute?.('download'),
  };
  const dateParts = datePartsOf(element);
  if (dateParts) description.dateParts = dateParts;
  if (description.editable || submits) description.submissionSnapshot = captureSubmissionSnapshot(element, description.activationSnapshot);
  const holds = description.editable ? fieldKind(element, name) : null;
  if (holds) description.holds = holds;
  if (element.tagName === 'SELECT') {
    description.selectSnapshot = captureSelectSnapshot(element);
    description.options = description.selectSnapshot.options.map(option => clean(option.label));
    description.consequentialOptions = description.options.map(label => CONSEQUENTIAL.test(label));
    description.value = clean(element.selectedOptions?.[0]?.label);
  } else if (description.editable && isSensitive(element)) {
    description.sensitive = true;
    description.value = '';
    description.hasValue = Boolean(element.value);
  } else if (description.editable) {
    description.value = element.value ?? element.textContent ?? '';
  } else if (['checkbox', 'radio', 'switch'].includes(role)) {
    if (element.tagName === 'INPUT' && ['checkbox', 'radio'].includes(element.type)) description.checked = element.checked;
    else if (['true', 'false'].includes(element.getAttribute('aria-checked'))) description.checked = element.getAttribute('aria-checked') === 'true';
  }
  // Custom ARIA widgets: a slider or spinbutton reports its value in aria-valuenow; a combobox (or a button
  // that pops up a listbox) offers options that often exist only while it is open.
  if (['slider', 'spinbutton'].includes(role) && element.tagName !== 'INPUT') {
    description.customRange = true;
    description.value = clean(element.getAttribute('aria-valuetext') ?? element.getAttribute('aria-valuenow'));
  }
  if ((role === 'combobox' && element.tagName !== 'SELECT') || element.getAttribute('aria-haspopup') === 'listbox') {
    description.customList = true;
    if (!description.editable) description.value = clean(visibleText(element));
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
  for (const [kind, label] of [['month', 'Month'], ['week', 'Week']]) {
    if (element.tagName === 'INPUT' && element.type === kind) {
      description[`native${label}`] = true;
      description[`${kind}Snapshot`] = captureNumberSnapshot(element);
    }
  }
  if (['INPUT', 'TEXTAREA'].includes(element.tagName) || isRichText(element)) description.textSelectionSnapshot = captureTextSelectionSnapshot(element);
  if (role === 'radio') description.radioSnapshot = captureRadioSnapshot(element);
  if (role === 'tab') description.tabSnapshot = captureTabSnapshot(element);
  // Disclosure state: an open menu or panel can be closed by name ("close the menu").
  description.disclosureSnapshot = captureDisclosureSnapshot(element);
  if (description.disclosureSnapshot.kind === 'native') description.expanded = element.parentElement.open;
  else if (['true', 'false'].includes(element.getAttribute('aria-expanded'))) description.expanded = element.getAttribute('aria-expanded') === 'true';
  return description;
}

// Finding shadow roots and frames walks the whole document, and measuring every control dominates capture
// time on large pages. A caller that watches the page can pass `scopeCache` ({ entry: null, rects: null }):
// clear `entry` when nodes are added or removed, and `rects` on any change, scroll or resize. Both expire.
const SCOPE_CACHE_MS = 2000;
// Cached rectangles only pre-select controls near the circle; those are measured again before use.
const RECT_CACHE_MS = 500;
const RECT_MARGIN = 48;
// Webcam gaze is often 100-200 px off. Controls in this wider ring are kept apart from the circle's own,
// so a named control just outside the circle can still be found; ids start here to stay distinct.
export const NEARBY_FACTOR = 3;
const NEARBY_FIRST_ID = 101;
// Beyond that ring, controls anywhere on screen are listed only when an instruction needs them (onScreen), so a
// clearly named control far from where the gaze landed can be offered for confirmation.
export const SCREEN_FIRST_ID = 201;
// The page's focused text field when it is outside the circle: "press enter" still submits what is being typed.
const FOCUSED_FIELD_ID = 200;
const SCREEN_LIMIT = 400;

function searchScopes(document, exclude, cache) {
  const now = document.defaultView?.performance?.now() ?? 0;
  const cached = cache?.entry;
  if (cached && cached.exclude === exclude && now - cached.time < SCOPE_CACHE_MS && cached.scopes.every(scope => scope.root.isConnected !== false)) return cached;
  const scopes = [];
  const outOfReach = [];
  collectScopes(document, [], exclude, scopes, outOfReach);
  const entry = { scopes, outOfReach, exclude, time: now };
  if (cache) cache.entry = entry;
  return entry;
}

// "Show numbers": every control on screen gets a number that can be said instead of looking at it, for when the gaze
// lands too far off. A control keeps its number while it stays on screen, so a number cannot change while it is being
// said; controls that appear take the lowest free numbers, in reading order. Numbered controls have ids from
// NUMBERED_FIRST_ID, so they never mix with the circle's.
export const NUMBERED_FIRST_ID = 1001;
export const NUMBER_LIMIT = 150;
export function numberControls(document, { exclude = null, previous = new Map(), limit = NUMBER_LIMIT, scopeCache = null } = {}) {
  const { scopes } = searchScopes(document, exclude, scopeCache);
  const view = document.defaultView, found = [];
  for (const { root, frames } of scopes) {
    for (const element of root.querySelectorAll(ACTIONABLE)) {
      const rect = viewportRect(element, frames);
      if (!(rect.width > 0 && rect.height > 0) || rect.right <= 0 || rect.bottom <= 0 || rect.left >= view.innerWidth || rect.top >= view.innerHeight) continue;
      if (exclude?.contains(element) || roleOf(element) === 'generic' || !usable(element, exclude)) continue;
      const x = clamp(rect.left + rect.width / 2, 0, view.innerWidth - 1), y = clamp(rect.top + rect.height / 2, 0, view.innerHeight - 1);
      if (unobscured(document, element, rect, x, y)) found.push({ element, rect, frames });
    }
  }
  // One number per target: a label beside its own control, or a control around another of the same name, is that control.
  const listed = new Set(found.map(({ element }) => element)), names = new Map(found.map(item => [item, accessibleName(item.element)]));
  const distinct = found.filter(outer => !(outer.element.tagName === 'LABEL' && outer.element.control && listed.has(outer.element.control)) &&
    !(names.get(outer) && found.some(inner => inner !== outer && composedContains(outer.element, inner.element) && names.get(inner) === names.get(outer))));
  distinct.sort((a, b) => Math.round(a.rect.top / 8) - Math.round(b.rect.top / 8) || a.rect.left - b.rect.left);
  const kept = distinct.slice(0, limit), numbers = new Map(), taken = new Set();
  for (const { element } of kept) {
    const number = previous.get(element);
    if (number && !taken.has(number)) { numbers.set(element, number); taken.add(number); }
  }
  let next = 1;
  for (const { element } of kept) {
    if (numbers.has(element)) continue;
    while (taken.has(next)) next++;
    numbers.set(element, next); taken.add(next);
  }
  return kept.map(({ element, rect, frames }) => ({ id: NUMBERED_FIRST_ID + numbers.get(element) - 1, number: numbers.get(element), element, rect, distance: 0, frames, ...describe(element) }))
    .sort((a, b) => a.number - b.number);
}

// "Find" on the page: where a phrase appears in the page's visible text (case and accents aside), in reading order,
// with the control each match sits in (a link's words, a button's label), which "click it" can then use.
export const FIND_LIMIT = 500;
const foldText = text => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function findText(document, query, { exclude = null, limit = FIND_LIMIT } = {}) {
  const wanted = foldText(clean(query));
  if (wanted.length < 2) return [];
  const view = document.defaultView, nodes = [];
  const walker = document.createTreeWalker(document.body ?? document.documentElement, view.NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      const parent = node.parentElement;
      if (!parent || !node.textContent.trim() || exclude?.contains(parent) || parent.closest('script,style,template,noscript,[aria-hidden="true"]')) return view.NodeFilter.FILTER_REJECT;
      return view.NodeFilter.FILTER_ACCEPT;
    },
  });
  // The visible text as one string, each character mapped back to its node and offset; words split across elements
  // still match.
  let text = '';
  const owners = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const style = view.getComputedStyle(node.parentElement);
    if (style.visibility === 'hidden' || style.display === 'none' || !node.parentElement.getClientRects().length) continue;
    const value = node.textContent;
    for (let i = 0; i < value.length; i++) {
      const folded = foldText(value[i]);
      // A run of white space is one space, as the phrase's is.
      const ch = /\s/.test(folded) ? ' ' : folded;
      if (ch === ' ' && text.endsWith(' ')) continue;
      for (const part of ch) { text += part; owners.push([node, i]); }
    }
    if (!text.endsWith(' ')) { text += ' '; owners.push([node, value.length]); }
    nodes.push(node);
  }
  const matches = [];
  for (let at = text.indexOf(wanted); at >= 0 && matches.length < limit; at = text.indexOf(wanted, at + wanted.length)) {
    const [startNode, startOffset] = owners[at], [endNode, endOffset] = owners[at + wanted.length - 1];
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, Math.min(endNode.textContent.length, endOffset + 1));
    const rect = range.getBoundingClientRect();
    if (!(rect.width > 0 || rect.height > 0)) continue;
    const holder = startNode.parentElement.closest(ACTIONABLE);
    const control = holder && !exclude?.contains(holder) && usable(holder, exclude) ? { id: 0, element: holder, rect: viewportRect(holder), distance: 0, frames: [], ...describe(holder) } : null;
    matches.push({ range, control });
  }
  return matches;
}

// Elements whose rectangles intersect the circle, nearest first, numbered for clarification.
export function captureContext(document, { x, y, radius, exclude = null, limit = 12, scopeCache = null, focus = null }) {
  if (![x, y, radius].every(Number.isFinite) || radius <= 0) return { x, y, radius, elements: [], region: null, unreachable: [] };
  const { scopes, outOfReach } = searchScopes(document, exclude, scopeCache);
  const candidates = [];
  const blocked = [];
  const outside = [];
  const reach = radius * NEARBY_FACTOR;
  const consider = (element, frames) => {
    const rect = viewportRect(element, frames);
    if (!(rect.width > 0 && rect.height > 0)) return;
    const distance = distanceToRect(x, y, rect);
    if (distance > reach || exclude?.contains(element)) return;
    if (distance > radius) {
      if (usable(element, exclude) && unobscured(document, element, rect, x, y)) outside.push({ element, rect, distance, frames });
      return;
    }
    // Explicit state commands must retain visible locked targets for refusal.
    // Keep them out of ordinary context so generic activation remains unchanged.
    if (!usable(element, exclude)) {
      const style = element.ownerDocument.defaultView.getComputedStyle(element);
      if (style.visibility !== 'hidden' && style.display !== 'none') blocked.push({ element, rect, distance, frames });
      return;
    }
    if (!unobscured(document, element, rect, x, y)) return;
    candidates.push({ element, rect, distance, frames });
  };
  const now = document.defaultView?.performance?.now() ?? 0;
  let measured = scopeCache?.rects && now - scopeCache.rects.time < RECT_CACHE_MS && scopeCache.rects.scopes === scopes ? scopeCache.rects.items : null;
  if (!measured) {
    measured = [];
    for (const { root, frames } of scopes) {
      for (const element of root.querySelectorAll(ACTIONABLE)) measured.push({ element, frames, rect: viewportRect(element, frames) });
    }
    if (scopeCache) scopeCache.rects = { time: now, scopes, items: measured };
  }
  for (const { element, frames, rect } of measured) {
    if (distanceToRect(x, y, rect) <= reach + RECT_MARGIN) consider(element, frames);
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
  // A label beside its own control (GOV.UK's radios and checkboxes) is the same target as the control.
  const controls = new Set(kept.map(candidate => candidate.element));
  const distinct = kept.filter(outer => !(names.get(outer) && kept.some(inner => inner !== outer &&
    composedContains(outer.element, inner.element) && names.get(inner) === names.get(outer))))
    .filter(candidate => !(candidate.element.tagName === 'LABEL' && candidate.element.control && controls.has(candidate.element.control)));
  distinct.sort((a, b) => a.distance - b.distance);
  const elements = distinct.slice(0, limit).map((candidate, index) => ({
    id: index + 1, element: candidate.element, rect: candidate.rect, distance: candidate.distance, frames: candidate.frames,
    ...describe(candidate.element),
  }));
  const disclosureElements = [...elements, ...blocked.sort((a, b) => a.distance - b.distance).slice(0, limit).map((candidate, index) => ({
    id: limit + index + 1, element: candidate.element, rect: candidate.rect, distance: candidate.distance, frames: candidate.frames, ...describe(candidate.element),
  }))].sort((a, b) => a.distance - b.distance).slice(0, limit);
  const nearby = outside.filter(({ element }) => roleOf(element) !== 'generic')
    .sort((a, b) => a.distance - b.distance).slice(0, limit).map((candidate, index) => ({
      id: NEARBY_FIRST_ID + index, element: candidate.element, rect: candidate.rect, distance: candidate.distance, frames: candidate.frames,
      ...describe(candidate.element),
    }));
  const unreachable = outOfReach
    .filter(({ frame, frames }) => {
      const rect = viewportRect(frame, frames);
      return rect.width > 0 && rect.height > 0 && distanceToRect(x, y, rect) <= radius;
    })
    .map(({ frame, frames }) => ({ name: clean(frame.getAttribute('title')) || 'Embedded content', frame, frames }));
  // Everything else on screen, including ring controls beyond the ring's limit.
  const view = document.defaultView, listed = new Set([...elements, ...nearby].map(candidate => candidate.element));
  let screen = null;
  const onScreen = () => screen ??= measured.flatMap(({ element, frames }) => {
    const rect = viewportRect(element, frames);
    if (listed.has(element) || !(rect.width > 0 && rect.height > 0) || rect.right <= 0 || rect.bottom <= 0 || rect.left >= view.innerWidth || rect.top >= view.innerHeight) return [];
    const distance = distanceToRect(x, y, rect);
    if (distance <= radius || roleOf(element) === 'generic' || !usable(element, exclude) || !unobscured(document, element, rect, x, y)) return [];
    return [{ element, rect, distance, frames }];
  }).sort((a, b) => a.distance - b.distance).slice(0, SCREEN_LIMIT).map((candidate, index) => ({
    id: SCREEN_FIRST_ID + index, element: candidate.element, rect: candidate.rect, distance: candidate.distance, frames: candidate.frames,
    ...describe(candidate.element),
  }));
  const focusedField = focus && isEditable(focus) && !elements.some(candidate => candidate.element === focus) && usable(focus, exclude)
    ? { id: FOCUSED_FIELD_ID, element: focus, rect: viewportRect(focus), distance: distanceToRect(x, y, viewportRect(focus)), frames: [], ...describe(focus) } : null;
  const pageRegion = document.scrollingElement ?? document.documentElement;
  const region = scrollRegionAt(document, x, y, exclude);
  let regions = null;
  const screenRegions = () => regions ??= screenScrollRegions(document, exclude, x, y, radius);
  const regionsAtGaze = () => scrollRegionsAt(document, x, y, exclude);
  return { x, y, radius, elements, disclosureElements, nearby, onScreen, focusedField, screenRegions, regionsAtGaze, unreachable, region, pageRegion,
    scrollRegions: region === pageRegion ? nearbyScrollRegions(document, x, y, radius, exclude) : [],
    pageSearch: findPageSearch(document, exclude) };
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

// Videos and sounds on the page, in open shadow roots and same-origin frames too, nearest the gaze point first: for
// "play", "pause the video" and the like. Hidden players count (podcast and music sites drive a hidden audio element
// from their own buttons). Live camera and call streams are not media to play, pause or skip.
export function findMedia(document, { x = NaN, y = NaN, exclude = null, scopeCache = null } = {}) {
  const { scopes } = searchScopes(document, exclude, scopeCache);
  const view = document.defaultView, found = [];
  for (const { root, frames } of scopes) {
    for (const element of root.querySelectorAll('video, audio')) {
      if (exclude?.contains(element) || element.srcObject) continue;
      const rect = viewportRect(element, frames);
      const onScreen = rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < view.innerWidth && rect.top < view.innerHeight;
      found.push({ element, rect, frames, onScreen, kind: element.tagName === 'VIDEO' ? 'video' : 'audio', playing: !element.paused && !element.ended,
        distance: onScreen && Number.isFinite(x) && Number.isFinite(y) ? distanceToRect(x, y, rect) : Infinity });
    }
  }
  return found.sort((a, b) => a.distance - b.distance);
}

// Cookie banners and other pop-ups, named rather than looked at ("reject cookies", "close the pop-up"): each layer of
// the page (a dialog, a fixed or sticky layer, or a container that consent tools name for consent) with its own
// controls on screen, and whether it asks about cookies.
const POPUP_DIALOG = '[role=dialog], [role=alertdialog], dialog[open], [aria-modal=true]';
const CONSENT_TEXT = /\b(cookies?|consent|gdpr)\b/i;
const CONSENT_NAMES = /cookie|consent|gdpr|onetrust|didomi|usercentrics|cookiebot|truste|qc-cmp|sp_message/i;
const namesOf = node => `${node.id ?? ''} ${typeof node.className === 'string' ? node.className : node.getAttribute?.('class') ?? ''}`;
function layerOf(element) {
  const view = element.ownerDocument.defaultView;
  for (let node = element.parentElement ?? element.getRootNode().host, depth = 0; node && depth < 40; depth++) {
    if (['BODY', 'HTML'].includes(node.tagName)) return null;
    if (node.matches(POPUP_DIALOG) || CONSENT_NAMES.test(namesOf(node)) || ['fixed', 'sticky'].includes(view.getComputedStyle(node).position)) return node;
    node = node.parentElement ?? node.getRootNode().host ?? null;
  }
  return null;
}
export function findPopups(document, { exclude = null, scopeCache = null } = {}) {
  const { scopes } = searchScopes(document, exclude, scopeCache);
  const view = document.defaultView, layers = new Map();
  for (const { root, frames } of scopes) for (const element of root.querySelectorAll(ACTIONABLE)) {
    if (exclude?.contains(element) || !usable(element, exclude)) continue;
    const rect = viewportRect(element, frames);
    if (!(rect.width > 0 && rect.height > 0) || rect.right <= 0 || rect.bottom <= 0 || rect.left >= view.innerWidth || rect.top >= view.innerHeight) continue;
    const layer = layerOf(element);
    if (!layer) continue;
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer).push({ element, rect, distance: 0, frames, ...describe(element) });
  }
  return [...layers].map(([layer, controls]) => ({
    consent: CONSENT_NAMES.test(namesOf(layer)) || CONSENT_TEXT.test((layer.innerText || layer.textContent || '').slice(0, 4000)),
    dialog: layer.matches(POPUP_DIALOG), controls,
  }));
}

// Personal details the navigator keeps for filling forms ("fill in my details"): what a field asks for, from its
// autocomplete hint, type, label and id. Passwords, payment and one-time codes are never details.
export const DETAIL_KINDS = ['name', 'given', 'family', 'email', 'tel', 'street', 'city', 'postcode'];
const DETAIL_HINTS = { name: 'name', 'given-name': 'given', 'family-name': 'family', email: 'email', tel: 'tel', 'tel-national': 'tel',
  'street-address': 'street', 'address-line1': 'street', 'address-level2': 'city', 'postal-code': 'postcode' };
export function detailKind(element, name = accessibleName(element)) {
  if (!isEditable(element) || isSensitive(element) || element.tagName === 'TEXTAREA' && !/address/i.test(element.getAttribute('autocomplete') ?? '')) return null;
  const hint = (element.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/).find(token => token in DETAIL_HINTS);
  if (hint) return DETAIL_HINTS[hint];
  const type = (element.getAttribute('type') ?? '').toLowerCase();
  if (type === 'email') return 'email';
  if (type === 'tel') return 'tel';
  const said = `${name ?? ''} ${element.id ?? ''} ${element.getAttribute('name') ?? ''}`.toLowerCase().replace(/[_-]+/g, ' ');
  if (/\b(?:first name|given name|forename)\b|\bfname\b/.test(said)) return 'given';
  if (/\b(?:last name|surname|family name)\b|\blname\b/.test(said)) return 'family';
  if (/e ?mail/.test(said)) return 'email';
  if (/\b(?:phone|mobile|telephone|tel)\b/.test(said)) return 'tel';
  if (/\b(?:post ?code|postal code|zip(?: code)?)\b/.test(said)) return 'postcode';
  if (/\b(?:town|city)\b/.test(said)) return 'city';
  if (/\b(?:address line 1|street|address 1)\b|^\s*address\b/.test(said) && !/\bline ?2\b|\baddress 2\b/.test(said)) return 'street';
  if (/\b(?:full name|your name)\b|^\s*name\b/.test(said)) return 'name';
  return null;
}

/**
 * The form nearest the gaze point (or the page's fields outside any form, when it has no forms), with each of its
 * fields that asks for a personal detail: `{ element, kind, name, empty }`. Fields in open shadow roots and
 * same-origin frames count.
 */
export function formDetailFields(document, { x = NaN, y = NaN, exclude = null, scopeCache = null } = {}) {
  const { scopes } = searchScopes(document, exclude, scopeCache), view = document.defaultView, groups = new Map();
  for (const { root, frames } of scopes) for (const element of root.querySelectorAll('input, textarea')) {
    if (exclude?.contains(element) || !usable(element, exclude)) continue;
    const name = accessibleName(element), kind = detailKind(element, name);
    if (!kind) continue;
    const rect = viewportRect(element, frames);
    if (!(rect.width > 0 && rect.height > 0)) continue;
    const form = element.form ?? element.closest('form') ?? root;
    if (!groups.has(form)) groups.set(form, []);
    groups.get(form).push({ element, kind, name, empty: !(element.value ?? '').trim(), rect });
  }
  let best = null, nearest = Infinity;
  for (const fields of groups.values()) {
    const distance = Math.min(...fields.map(field => (Number.isFinite(x) && Number.isFinite(y) ? distanceToRect(x, y, field.rect)
      : field.rect.top < view.innerHeight && field.rect.bottom > 0 ? 0 : 1e6)));
    if (distance < nearest) { nearest = distance; best = fields; }
  }
  return best ?? [];
}

