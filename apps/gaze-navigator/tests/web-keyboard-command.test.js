import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyboardCommands } from '../src/web/keyboard-command.js';

function session() {
  const field = { tagName: 'INPUT', readOnly: false, value: 'Ada Lov' };
  let active = field;
  const windowEvents = new Map();
  const view = { addEventListener: (type, listener) => windowEvents.set(type, listener), removeEventListener: type => windowEvents.delete(type) };
  const events = new Map(), changes = [], submitted = [], cancelled = [];
  const document = { defaultView: view, hidden: false, addEventListener: (type, listener) => events.set(type, listener), removeEventListener: type => events.delete(type) };
  const commands = createKeyboardCommands({ getActiveElement: () => active, onChange: value => changes.push(value), onSubmit: text => submitted.push(text), onCancel: () => cancelled.push(true) });
  field.ownerDocument = document;
  commands.attach(document);
  const key = (key, extra = {}) => {
    const event = { key, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
    events.get('keydown')?.(event); return event;
  };
  const start = () => key('G', { altKey: true, shiftKey: true });
  return { field, commands, events, windowEvents, document, changes, submitted, cancelled, key, start, changeFocus: next => { active = next; } };
}

test('explicit mode captures a command without editing or blurring the page field', () => {
  const s = session();
  assert.equal(s.key('x').prevented, undefined);
  assert.equal(s.start().prevented, true);
  assert.equal(s.field.readOnly, true);
  for (const letter of 'open Ada Lovelace') assert.equal(s.key(letter).prevented, true);
  s.key('Enter');
  assert.deepEqual(s.submitted, ['open Ada Lovelace']);
  assert.equal(s.field.value, 'Ada Lov');
  assert.equal(s.field.readOnly, false);
  assert.equal(s.commands.active, false);
});

test('command editing, paste and escape affect only the command buffer', () => {
  const s = session(); s.start();
  for (const letter of 'opxn') s.key(letter);
  s.key('ArrowLeft'); s.key('Backspace'); s.key('e');
  const paste = { clipboardData: { getData: () => ' pricing' }, preventDefault() {}, stopImmediatePropagation() {} };
  s.key('End'); s.events.get('paste')(paste);
  assert.equal(s.changes.at(-1).text, 'open pricing');
  s.key('Escape');
  assert.deepEqual(s.submitted, []);
  assert.equal(s.field.value, 'Ada Lov');
  assert.equal(s.field.readOnly, false);
  assert.equal(s.cancelled.length, 1);
});

test('browser shortcuts leave command mode and stop releases page-field protection', () => {
  const s = session(); s.start();
  assert.equal(s.key('l', { ctrlKey: true }).prevented, undefined);
  assert.equal(s.commands.active, false);
  assert.equal(s.field.readOnly, false);
  s.start(); assert.equal(s.commands.active, true); s.commands.stop();
  assert.equal(s.field.readOnly, false);
  assert.equal(s.commands.active, false);
  assert.equal(s.events.size, 0);
});

test('select-all replaces the command and unsupported editable targets are refused', () => {
  const s = session(); s.start();
  for (const letter of 'wrong') s.key(letter);
  s.key('a', { ctrlKey: true }); s.key('c'); s.key('Enter');
  assert.deepEqual(s.submitted, ['c']);
  s.field.isContentEditable = true;
  s.start();
  assert.equal(s.commands.active, false);
  assert.equal(s.field.readOnly, false);
});

import { activate } from '../src/web/page-actions.js';
test('keyboard selection clicks a blur-dismissed option while it is still connected', () => {
  let selected = false;
  const option = {
    tagName: 'BUTTON', isConnected: true,
    matches: () => false,
    focus() { this.isConnected = false; },
    click() { if (this.isConnected) selected = true; },
  };
  activate(option, 'Ada Lovelace', { preserveFocus: true });
  assert.equal(selected, true);
  assert.equal(option.isConnected, true);
});

test('focus loss without focusin and owner-window retirement cancel stale capture', () => {
  const s = session(); s.start();
  s.changeFocus({ tagName: 'BODY' }); s.key('a');
  assert.equal(s.commands.active, false);
  assert.equal(s.field.readOnly, false);
  assert.deepEqual(s.submitted, []);
  s.changeFocus(s.field); s.start(); s.windowEvents.get('blur')?.();
  assert.equal(s.commands.active, false);
  assert.equal(s.field.readOnly, false);
  s.start(); s.windowEvents.get('pagehide')?.();
  assert.equal(s.commands.active, false);
  assert.equal(s.field.readOnly, false);
  s.commands.stop(); assert.equal(s.windowEvents.size, 0);
});

test('the physical shortcut works when Alt changes the produced character', () => {
  const s = session(); s.key('˝', { altKey: true, shiftKey: true, code: 'KeyG' });
  assert.equal(s.commands.active, true);
  s.commands.stop(); assert.equal(s.field.readOnly, false);
});

test('pending website readonly changes cancel submission before observer delivery', () => {
  const s = session(); let observer;
  s.document.defaultView.MutationObserver = class {
    constructor() { observer = this; this.records = []; }
    observe() {}
    takeRecords() { const records = this.records; this.records = []; return records; }
    disconnect() {}
  };
  s.start(); s.key('c');
  // A window-capture website handler runs before our document keydown handler.
  s.field.readOnly = true; observer.records.push({ type: 'attributes' });
  s.key('Enter');
  assert.deepEqual(s.submitted, []);
  assert.equal(s.field.readOnly, true);
  assert.equal(s.commands.active, false);
});

test('modifier keydown preserves capture until the following shortcut or paste', () => {
  const s = session(); s.start(); s.key('a');
  s.key('Control', { ctrlKey: true });
  assert.equal(s.commands.active, true);
  s.key('a', { ctrlKey: true });
  assert.equal(s.changes.at(-1).selectionStart, 0);
  assert.equal(s.changes.at(-1).selectionEnd, 1);
  s.key('v', { ctrlKey: true });
  assert.equal(s.commands.active, true);
  s.events.get('paste')({ clipboardData: { getData: () => 'open Ada Lovelace' }, preventDefault() {}, stopImmediatePropagation() {} });
  s.key('Enter');
  assert.deepEqual(s.submitted, ['open Ada Lovelace']);
});

import { readFile } from 'node:fs/promises';
test('the extension page-toggle binding does not enter the in-page command editor', async () => {
  const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
  const binding = manifest.commands['toggle-navigator'].suggested_key.default;
  const s = session();
  s.key(binding.split('+').at(-1), { altKey: binding.includes('Alt+'), shiftKey: binding.includes('Shift+'), ctrlKey: binding.includes('Ctrl+'), metaKey: binding.includes('Command+') });
  assert.equal(s.commands.active, false, 'page toggle and command entry must use distinct bindings');
  s.start(); assert.equal(s.commands.active, true, 'existing command entry stays available'); s.commands.stop();
});
