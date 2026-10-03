import { editText } from './text-entry.js';

export function setupKeyboard(document, onChange) {
  const node = id => document.querySelector(`#${id}`);
  const panel = node('textKeyboard');
  const keys = node('keyboardKeys');
  let field = null;
  let fieldId = null;
  let uppercase = false;
  const letters = [];

  function choose(id, label) {
    fieldId = id;
    field = node(id);
    panel.classList.remove('hidden');
    keys.scrollTop = 0;
    node('keyboardTitle').textContent = `Typing into ${label}`;
    node('keyboardPreview').textContent = field.value || '(empty)';
    field.focus({ preventScroll: true });
    onChange();
  }

  for (const [id, label, button] of [
    ['searchInput', 'message search', 'editSearch'],
    ['draftSubject', 'draft subject', 'editSubject'],
    ['draftBody', 'draft message', 'editBody'],
  ]) node(button).addEventListener('click', () => choose(id, label));

  function close() {
    field = null;
    fieldId = null;
    panel.classList.add('hidden');
    onChange();
  }
  node('closeKeyboard').addEventListener('click', close);
  for (const [id, direction] of [['keyboardUp', -1], ['keyboardDown', 1]]) {
    node(id).addEventListener('click', () => {
      if (!field) return;
      keys.scrollBy({ top: direction * Math.max(54, keys.clientHeight - 62), behavior: 'auto' });
      onChange();
    });
  }
  node('keyboardCaps').addEventListener('click', () => {
    uppercase = !uppercase;
    node('keyboardCaps').textContent = uppercase ? 'Lowercase' : 'Uppercase';
    for (const button of letters) button.textContent = uppercase ? button.textContent.toUpperCase() : button.textContent.toLowerCase();
    onChange();
  });

  for (const key of [...'abcdefghijklmnopqrstuvwxyz0123456789.,?!', 'Space', 'Backspace']) {
    const button = document.createElement('button');
    button.textContent = key;
    button.setAttribute('data-gaze-target', '');
    button.addEventListener('click', () => {
      if (!field) return;
      const text = key === 'Space' ? ' ' : uppercase && key.length === 1 ? key.toUpperCase() : key;
      const limit = field.maxLength >= 0 ? field.maxLength : 10000;
      const edited = editText(field.value, field.selectionStart, field.selectionEnd, text, limit);
      field.value = edited.value;
      field.focus({ preventScroll: true });
      field.setSelectionRange(edited.caret, edited.caret);
      node('keyboardPreview').textContent = field.value || '(empty)';
      onChange();
    });
    if (/^[a-z]$/.test(key)) letters.push(button);
    keys.append(button);
  }
  return {
    sync() {
      if (fieldId && fieldId !== 'searchInput' && node('composer').classList.contains('hidden')) close();
    },
  };
}
