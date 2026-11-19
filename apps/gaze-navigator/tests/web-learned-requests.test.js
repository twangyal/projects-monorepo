import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';
import { MAX_LEARNED, learnedAction, learnedEntry, learnedSummary, taughtEntry, validLearned, withLearned, withoutLearned } from '../src/web/learned.js';

const control = (id, name, role = 'button', extra = {}) => ({ id, name, role, distance: id * 10, element: { isConnected: true, name }, ...extra });

function setup() {
  let learned = [];
  const clicks = [];
  const actions = {
    activate: (target, name) => { clicks.push(name); return { ok: true, message: `${name} activated.` }; },
  };
  const commands = { learned: { list: () => learned, remember: entry => { learned = withLearned(learned, entry); }, forget: said => { learned = said == null ? [] : withoutLearned(learned, said); } } };
  return { controller: createController({ window: {}, interpret, actions, commands }), clicks, learned: () => learned };
}
// A request the rules do not understand, whose words point to the Newsletter sign-up button.
const page = { elements: [control(1, 'Subscribe to our newsletter'), control(2, 'Contact us', 'link')] };

test('a spoken request confirmed once is learned, and said again acts on the control without asking', () => {
  const { controller, clicks, learned } = setup();
  const asked = controller.handle('put me on the newsletter list', page, { spoken: true });
  assert.match(asked.message, /^Did you mean "Subscribe to our newsletter"\?/);
  const done = controller.handle('yes', page, { spoken: true });
  assert.match(done.message, /^Subscribe to our newsletter activated\. Next time, “put me on the newsletter list” does this without asking\.$/);
  assert.deepEqual(learned().map(item => [item.said, item.name, item.role]), [['put me on the newsletter list', 'subscribe to our newsletter', 'button']]);
  // Said again, even with other capitals and punctuation, it acts at once and says why.
  const again = controller.handle('Put me on the newsletter list!', page, { spoken: true });
  assert.equal(again.message, 'Subscribe to our newsletter activated. (Learned from an earlier yes.)');
  assert.deepEqual(clicks, ['Subscribe to our newsletter', 'Subscribe to our newsletter']);
  // With no such control here, it is not understood as before.
  assert.equal(controller.handle('put me on the newsletter list', { elements: [control(2, 'Contact us', 'link')] }, { spoken: true }).tone, 'error');
});

test('typed requests, cancelled offers and words the rules understand are not learned; forgetting clears them', () => {
  const { controller, learned } = setup();
  controller.handle('put me on the newsletter list', page);
  controller.handle('yes', page);
  assert.equal(learned().length, 0, 'typed, which a page could do');
  controller.handle('put me on the newsletter list', page, { spoken: true });
  controller.handle('yes', page);
  assert.equal(learned().length, 0, 'spoken, but the yes typed');
  controller.handle('put me on the newsletter list', page, { spoken: true });
  controller.handle('cancel', page, { spoken: true });
  assert.equal(learned().length, 0, 'cancelled');
  controller.handle('put me on the newsletter list', page, { spoken: true });
  controller.handle('yes', page, { spoken: true });
  assert.equal(controller.handle('what have you learned', page, { spoken: true }).message,
    '1 taught or learned, latest first: “put me on the newsletter list” for subscribe to our newsletter. Say "forget" and one of them, or "forget what you learned" to clear them all.');
  assert.equal(controller.handle('forget what you learned', page, { spoken: true }).message, 'Forgot the one phrase taught or learned.');
  assert.equal(learned().length, 0);
  assert.equal(controller.handle('put me on the newsletter list', page, { spoken: true }).tone, 'question', 'offered again');
});

test('learned entries name the control and a dropdown’s option, act only on one control of that name, and stay bounded', () => {
  const sizes = control(3, 'Size', 'combobox', { options: ['S', 'M', 'L'] });
  const entry = learnedEntry('the roomy one', { type: 'select-option', targetId: 3, optionIndex: 2 }, sizes);
  assert.deepEqual(entry, { said: 'the roomy one', type: 'select-option', role: 'combobox', name: 'size', option: 'l' });
  assert.deepEqual(learnedAction([entry], 'The roomy one.', { elements: [sizes] }), { type: 'select-option', targetId: 3, optionIndex: 2, optionName: 'L' });
  // Just outside the circle counts; two of the same name, or none, do not.
  assert.equal(learnedAction([entry], 'the roomy one', { elements: [], nearby: [sizes] })?.targetId, 3);
  assert.equal(learnedAction([entry], 'the roomy one', { elements: [sizes, { ...sizes, id: 4 }] }), null);
  assert.equal(learnedAction([entry], 'the roomy one', { elements: [control(5, 'Size', 'button')] }), null, 'another kind of control');
  // A box is ticked, never clicked off.
  const box = learnedEntry('copy me', { type: 'check', targetId: 6, checked: true }, control(6, 'Send me a copy', 'checkbox'));
  assert.deepEqual(learnedAction([box], 'copy me', { elements: [control(6, 'Send me a copy', 'checkbox')] }), { type: 'check', targetId: 6, checked: true });
  // Typing and the like are not learned; the list keeps the latest of each request, up to its limit, and loads only
  // well-formed entries.
  assert.equal(learnedEntry('write hello', { type: 'edit', targetId: 1 }, control(1, 'Message', 'textbox')), null);
  let list = [];
  for (let k = 0; k < MAX_LEARNED + 5; k++) list = withLearned(list, { ...entry, said: `request ${k}` });
  list = withLearned(list, { ...entry, said: 'request 200', option: 's' });
  assert.equal(list.length, MAX_LEARNED);
  assert.equal(list[0].option, 's');
  assert.equal(list.filter(item => item.said === 'request 200').length, 1);
  assert.deepEqual(validLearned([entry, { said: 'x' }, null, { ...entry, type: 'edit' }, 'text']), [entry]);
  assert.equal(validLearned('nope').length, 0);
  assert.equal(learnedSummary([entry, box]), '“the roomy one” for l; “copy me” for send me a copy');
});

test('a phrase taught by voice stands for an instruction, understood afresh wherever it is said, until forgotten', () => {
  const { controller, clicks, learned } = setup();
  const said = (text, context = page, spoken = true) => controller.handle(text, context, { spoken });
  assert.equal(said('when I say help me out, I mean open contact us').message, 'From now on, “help me out” does “open contact us”. Say “forget help me out” to undo this.');
  assert.deepEqual(learned(), [{ said: 'help me out', type: 'alias', alias: 'open contact us' }]);
  assert.equal(said('Help me out!').message, 'Contact us activated. (Taught as “help me out”.)');
  // Typed, it is used too; on another page it reaches that page's control of the name, and none says so.
  assert.equal(said('help me out', { elements: [control(7, 'Contact us', 'button')] }, false).message, 'Contact us activated. (Taught as “help me out”.)');
  assert.equal(said('help me out', { elements: [control(1, 'Subscribe to our newsletter')] }).message, '“help me out” stands for “open contact us”, which does not apply here.');
  assert.deepEqual(clicks, ['Contact us', 'Contact us']);
  // Spoken without a comma, the phrase ends where a command word or a control's whole name begins (the rules would also
  // take a name with words before it); taught again, it is replaced.
  assert.deepEqual(interpret('when I say the usual subscribe to our newsletter', page), { type: 'teach', phrase: 'the usual', instruction: 'subscribe to our newsletter' });
  assert.deepEqual(interpret('when I say open sesame open contact us', page), { type: 'teach', phrase: 'open sesame', instruction: 'open contact us' });
  assert.equal(said('when I say lots of words with no instruction').tone, 'question');
  said('when I say news subscribe to our newsletter');
  said('when I say help me out I mean subscribe to our newsletter');
  assert.deepEqual(learned().map(item => [item.said, item.alias]), [['help me out', 'subscribe to our newsletter'], ['news', 'subscribe to our newsletter']]);
  assert.match(said('what have I taught you').message, /^2 taught or learned, latest first: “help me out” for “subscribe to our newsletter”; “news” for “subscribe to our newsletter”\./);
  // Forgotten one at a time, or all at once.
  assert.equal(said('forget help me out').message, 'Forgot “help me out”.');
  assert.equal(said('forget what nonsense means').message, '“nonsense” was neither taught nor learned, so there is nothing to forget.');
  assert.equal(said('forget what news means').message, 'Forgot “news”.');
  assert.equal(learned().length, 0);
});

test('teaching is spoken, keeps the navigator’s own commands, needs an instruction understood here, and still confirms consequences', () => {
  const { controller, learned } = setup();
  const said = (text, context = page, spoken = true) => controller.handle(text, context, { spoken });
  assert.match(said('when I say help me out, I mean open contact us', page, false).message, /^Say it aloud to teach a phrase/);
  assert.match(said('when I say yes, I mean open contact us').message, /^“yes” is already one of my commands/);
  assert.match(said('when I say go back, I mean open contact us').message, /^“go back” is already one of my commands/);
  assert.match(said('when I say help me out, I mean fly to the moon').message, /^“fly to the moon” is not understood here/);
  assert.equal(said('when I say help me out').tone, 'question');
  assert.match(said('what can I say', { elements: [] }).message, /when I say …, I mean …/);
  assert.equal(learned().length, 0);
  // A control with consequences is confirmed when the phrase is used, as when it is named.
  const form = { elements: [control(1, 'Send message', 'button', { consequential: true, submits: true })] };
  said('when I say off it goes, I mean send message', form);
  assert.equal(said('off it goes', form).tone, 'question');
  // Only well-formed, bounded phrases are kept, and loaded back.
  assert.equal(taughtEntry('', 'open contact us'), null);
  assert.equal(taughtEntry('help', 'x'.repeat(201)), null);
  assert.deepEqual(validLearned([{ said: 'off it goes', type: 'alias', alias: 'send message' }, { said: 'x', type: 'alias' }]), [{ said: 'off it goes', type: 'alias', alias: 'send message' }]);
  assert.deepEqual(learnedAction([{ said: 'off it goes', type: 'alias', alias: 'send message' }], 'Off it goes.', { elements: [] }), { type: 'alias', instruction: 'send message', said: 'off it goes' });
});
