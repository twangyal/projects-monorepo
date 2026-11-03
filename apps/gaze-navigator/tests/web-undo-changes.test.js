import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../src/web/controller.js';

const control = (id, element, extra = {}) => ({ id, element, name: element.name, role: 'checkbox', distance: id === 1 ? 0 : 20, editable: false, consequential: false, ...extra });

function page() {
  const log = [];
  let clock = 0;
  const node = name => ({ name, isConnected: true });
  const actions = {
    setChecked: (element, checked) => { log.push(['check', element.name, checked]); return { ok: true, message: `Checkbox ${checked ? 'checked' : 'unchecked'}.` }; },
    selectOption: (element, index) => { log.push(['option', element.name, index]); return { ok: true, message: `Option ${index} selected.` }; },
    rememberChange: (type, element) => ({ type, element, before: type === 'check' ? false : 0 }),
    revertChange: change => { log.push(['revert', change.type, change.element.name, change.before]); return { ok: true, message: `${change.element.name} put back.` }; },
    readValue: () => '', writeValue: (element, value) => log.push(['write', element.name, value]),
  };
  return { log, node, actions, tick: ms => { clock += ms; }, now: () => clock };
}

test('"undo" straight after a checkbox or dropdown changed puts it back, once', () => {
  const site = page(), copy = site.node('Send me a copy'), topic = site.node('Topic');
  const controller = createController({ window: {}, actions: site.actions, now: site.now });
  const context = { elements: [control(1, copy), control(2, topic, { role: 'combobox', options: ['General question', 'Order problem'], value: 'General question' })] };
  assert.equal(controller.handle('check send me a copy', context).performed, 'check');
  const undone = controller.handle('undo', context);
  assert.equal(undone.message, 'Undone. Send me a copy put back.');
  assert.deepEqual(site.log.at(-1), ['revert', 'check', 'Send me a copy', false]);
  // Nothing more to put back.
  assert.notEqual(controller.handle('undo', context).performed, 'undo');
  controller.handle('choose order problem', context);
  assert.equal(controller.handle('change it back', context).performed, 'undo');
  assert.deepEqual(site.log.at(-1), ['revert', 'select-option', 'Topic', 0]);
});

test('an old change, or text typed since, is not what "undo" puts back', () => {
  const site = page(), copy = site.node('Send me a copy'), message = site.node('Message');
  const controller = createController({ window: {}, actions: site.actions, now: site.now });
  const context = { elements: [control(1, copy), control(2, message, { role: 'textbox', editable: true, value: '' })], focusedId: 2 };
  controller.handle('check send me a copy', context);
  site.tick(121000);
  assert.ok(!site.log.some(([kind]) => kind === 'revert') && controller.handle('undo that', context).performed !== 'undo', 'two minutes later it is too late');
  controller.handle('check send me a copy', context);
  controller.handle('type hello', context);
  controller.handle('undo', context);
  assert.ok(!site.log.some(([kind]) => kind === 'revert'), 'the typing is undone instead');
});
