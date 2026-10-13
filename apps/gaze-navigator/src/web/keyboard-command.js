// Explicit command entry while website focus stays put. Read-only protection on a focused
// native field prevents paste/IME defaults from accidentally changing the website's text.
export function createKeyboardCommands({ getActiveElement, onStart = () => true, onChange = () => {}, onSubmit = () => {}, onCancel = () => {}, onUnavailable = () => {} }) {
  let session = null;
  const documents = new Map();
  const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  function changed() {
    const { chars, cursor, anchor } = session;
    onChange({ text: chars.join(''), selectionStart: chars.slice(0, Math.min(cursor, anchor)).join('').length, selectionEnd: chars.slice(0, Math.max(cursor, anchor)).join('').length });
  }
  function end(cancelled = true, restoreProtection = true) {
    if (!session) return;
    const old = session; session = null;
    const pageChangedProtection = Boolean(old.observer?.takeRecords().length);
    old.observer?.disconnect();
    if (old.protected && restoreProtection && !pageChangedProtection) old.field.readOnly = old.readOnly;
    if (cancelled) onCancel();
  }
  function replace(text) {
    const { chars, cursor, anchor } = session;
    const start = Math.min(cursor, anchor), length = Math.abs(cursor - anchor), added = Array.from(text);
    chars.splice(start, length, ...added);
    session.cursor = session.anchor = start + added.length;
    changed();
  }
  function stale(event) {
    const pageChangedProtection = Boolean(session.observer?.takeRecords().length);
    if (!pageChangedProtection && getActiveElement() === session.field) return false;
    consume(event); end(true, !pageChangedProtection); return true;
  }
  function keydown(event) {
    const shortcut = event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && (event.code === 'KeyG' || event.key.toLowerCase() === 'g');
    if (shortcut) {
      consume(event);
      if (event.repeat) return;
      if (session) { end(); return; }
      const field = getActiveElement();
      if (field?.isContentEditable) { onUnavailable('Use speech or the ordinary instruction box for an editable page region.'); return; }
      if (!onStart()) return;
      const protect = /^(INPUT|TEXTAREA)$/.test(field?.tagName ?? '');
      session = { chars: [], cursor: 0, anchor: 0, field, protected: protect, readOnly: field?.readOnly };
      if (protect) {
        field.readOnly = true;
        const Observer = field.ownerDocument?.defaultView?.MutationObserver;
        if (Observer) {
          const active = session;
          active.observer = new Observer(() => {
            // Website-owned readonly changes supersede our temporary protection.
            if (session === active) end(true, false);
          });
          active.observer.observe(field, { attributes: true, attributeFilter: ['readonly'] });
        }
      }
      changed(); return;
    }
    if (!session) return;
    if (stale(event)) return;
    if (event.key === 'Escape') { consume(event); end(); return; }
    if (event.key === 'Tab' || ((event.ctrlKey || event.metaKey) && !['a', 'v'].includes(event.key.toLowerCase()))) {
      end(); return; // Browser/system shortcuts retain their normal behavior.
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return; // Capture the resulting paste event.
    consume(event);
    if (event.isComposing || event.key === 'Dead' || event.key === 'Process') {
      onUnavailable('For composed characters, paste the instruction or use the ordinary instruction box.'); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      session.anchor = 0; session.cursor = session.chars.length; changed(); return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter') {
      const text = session.chars.join('').trim();
      end(false); if (text) onSubmit(text); else onCancel(); return;
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const { cursor, anchor, chars } = session;
      const selected = cursor !== anchor;
      session.cursor = event.key === 'Home' ? 0 : event.key === 'End' ? chars.length
        : event.key === 'ArrowLeft' ? (selected && !event.shiftKey ? Math.min(cursor, anchor) : Math.max(0, cursor - 1))
          : selected && !event.shiftKey ? Math.max(cursor, anchor) : Math.min(chars.length, cursor + 1);
      if (!event.shiftKey) session.anchor = session.cursor;
      changed(); return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      if (session.cursor === session.anchor) {
        if (event.key === 'Backspace') session.anchor = Math.max(0, session.cursor - 1);
        else session.anchor = Math.min(session.chars.length, session.cursor + 1);
      }
      replace(''); return;
    }
    if (Array.from(event.key).length === 1) replace(event.key);
  }
  function paste(event) {
    if (!session) return;
    if (stale(event)) return;
    consume(event); replace(event.clipboardData?.getData('text/plain') ?? '');
  }
  function focusChanged() {
    if (session && getActiveElement() !== session.field) end();
  }
  return {
    get active() { return Boolean(session); },
    attach(document) {
      if (documents.has(document)) return;
      const view = document.defaultView;
      const retire = () => { if (session?.field?.ownerDocument === document) end(); };
      const hidden = () => { if (document.hidden) retire(); };
      documents.set(document, { view, retire, hidden });
      view?.addEventListener('blur', retire);
      view?.addEventListener('pagehide', retire);
      document.addEventListener('visibilitychange', hidden);
      document.addEventListener('keydown', keydown, true);
      document.addEventListener('paste', paste, true);
      document.addEventListener('focusin', focusChanged, true);
    },
    cancel: () => end(),
    stop() {
      end();
      for (const [document, { view, retire, hidden }] of documents) {
        view?.removeEventListener('blur', retire);
        view?.removeEventListener('pagehide', retire);
        document.removeEventListener('visibilitychange', hidden);
        document.removeEventListener('keydown', keydown, true);
        document.removeEventListener('paste', paste, true);
        document.removeEventListener('focusin', focusChanged, true);
      }
      documents.clear();
    },
  };
}
