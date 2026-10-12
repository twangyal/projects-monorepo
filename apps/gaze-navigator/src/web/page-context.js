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

const clean = text => (text ?? '').replace(/\s+/g, ' ').trim();

function visibleText(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return '';
  if (node.tagName === 'IMG') return ` ${node.getAttribute('alt') ?? ''} `;
  // Form controls inside a label contribute their own values, not their option lists.
  if (node.getAttribute?.('aria-hidden') === 'true' || ['SCRIPT', 'STYLE', 'TEMPLATE', 'SELECT', 'TEXTAREA'].includes(node.tagName)) return '';
  return [...node.childNodes].map(visibleText).join('');
}

export function roleOf(element) {
  const explicit = element.getAttribute('role')?.split(/\s+/)[0];
  if (explicit) return explicit;
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
    const text = clean(labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' '));
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

// Visible where the user could be looking: at the point nearest the gaze center or at the element center.
function unobscured(document, element, rect, x, y) {
  const inset = Math.min(2, rect.width / 2, rect.height / 2);
  return [
    [clamp(x, rect.left + inset, rect.right - inset), clamp(y, rect.top + inset, rect.bottom - inset)],
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
  ].some(([px, py]) => {
    const hit = document.elementFromPoint(px, py);
    return Boolean(hit) && (hit === element || element.contains(hit));
  });
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

function describe(element) {
  const role = roleOf(element);
  const form = element.form ?? element.closest('form');
  const submits = (element.tagName === 'BUTTON' && (element.getAttribute('type') ?? 'submit') === 'submit' && Boolean(form)) ||
    (element.tagName === 'INPUT' && ['submit', 'image'].includes(element.type));
  const name = accessibleName(element);
  const description = {
    name, role, editable: isEditable(element), submits,
    consequential: submits || CONSEQUENTIAL.test(name) || element.hasAttribute?.('download'),
  };
  if (element.tagName === 'SELECT') {
    description.options = [...element.options].map(option => clean(option.textContent));
    description.value = clean(element.selectedOptions?.[0]?.textContent);
  } else if (description.editable) {
    description.value = element.value ?? element.textContent ?? '';
  } else if (['checkbox', 'radio', 'switch'].includes(role)) {
    description.checked = element.checked ?? element.getAttribute('aria-checked') === 'true';
  }
  return description;
}

// Elements whose rectangles intersect the circle, nearest first, numbered for clarification.
export function captureContext(document, { x, y, radius, exclude = null, limit = 12 }) {
  if (![x, y, radius].every(Number.isFinite) || radius <= 0) return { x, y, radius, elements: [], region: null };
  const candidates = [];
  for (const element of document.querySelectorAll(ACTIONABLE)) {
    const rect = element.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) continue;
    const distance = distanceToRect(x, y, rect);
    if (distance > radius || !usable(element, exclude) || !unobscured(document, element, rect, x, y)) continue;
    candidates.push({ element, rect, distance });
  }
  // A generic focusable container is redundant when it contains a more specific control.
  const kept = candidates.filter(({ element }) => roleOf(element) !== 'generic' ||
    !candidates.some(other => other.element !== element && element.contains(other.element)));
  kept.sort((a, b) => a.distance - b.distance);
  const elements = kept.slice(0, limit).map((candidate, index) => ({
    id: index + 1, element: candidate.element, rect: candidate.rect, distance: candidate.distance, ...describe(candidate.element),
  }));
  return { x, y, radius, elements, region: scrollRegionAt(document, x, y, exclude), pageSearch: findPageSearch(document, exclude) };
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
