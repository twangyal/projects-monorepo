// Versioned spoken-instruction suite for measuring interpreters on ordinary phrasing.
// Contexts are described gaze contexts (no DOM); expectations are typed actions.
export const SUITE_VERSION = 'spoken-web-v1';

const el = (id, role, name, extra = {}) => ({ id, role, name, distance: id === 1 ? 0 : 10 * id, editable: false, ...extra });
const field = (id, name, extra = {}) => el(id, 'textbox', name, { editable: true, value: '', ...extra });

export const CONTEXTS = {
  navigation: { elements: [el(1, 'link', 'Home'), el(2, 'link', 'Pricing'), el(3, 'link', 'Contact us'), el(4, 'button', 'Sign in'), field(5, 'Search', { role: 'searchbox' })] },
  form: { elements: [field(1, 'Your name'), field(2, 'Email address'), field(3, 'Message', { value: 'see you on Tuesday' }),
    el(4, 'checkbox', 'Send me a copy', { checked: false }),
    el(5, 'combobox', 'Topic', { options: ['General question', 'Order problem', 'Book suggestion'], value: 'General question' }),
    el(6, 'button', 'Send message', { submits: true, consequential: true })] },
  product: { elements: [el(1, 'combobox', 'Format', { options: ['Paperback', 'Hardcover', 'Large print', 'Audiobook'], value: 'Paperback' }),
    el(2, 'button', 'Add to cart'), el(3, 'button', 'Place order', { submits: true, consequential: true }), el(4, 'link', 'Reviews')] },
  list: { elements: [el(1, 'link', 'Read more'), el(2, 'link', 'Read more'), el(3, 'link', 'Read more'),
    el(4, 'button', 'Remove', { consequential: true }), el(5, 'button', 'Remove', { consequential: true })] },
  empty: { elements: [] },
};
CONTEXTS.focused = { ...CONTEXTS.form, focusedId: 3 };

const act = targetId => ({ type: 'activate', targetId });
const option = (targetId, optionIndex) => ({ type: 'select-option', targetId, optionIndex });
const edit = (targetId, kind, extra = {}) => ({ type: 'edit', targetId, edit: { kind, ...extra } });
const scroll = (direction, amount = 'page') => ({ type: 'scroll', direction, amount });
const clarify = (...elementIds) => ({ type: 'clarify', elementIds });
const plain = type => ({ type });
const choose = index => ({ type: 'choose', index });

// [category, context, utterance, expected]
const CASES = [
  ['activate', 'navigation', 'open pricing', act(2)],
  ['activate', 'navigation', 'Pricing', act(2)],
  ['activate', 'navigation', 'click pricing', act(2)],
  ['activate', 'navigation', 'click on pricing', act(2)],
  ['activate', 'navigation', 'please open pricing', act(2)],
  ['activate', 'navigation', 'can you open pricing', act(2)],
  ['activate', 'navigation', 'could you open the pricing page please', act(2)],
  ['activate', 'navigation', 'go to pricing', act(2)],
  ['activate', 'navigation', 'take me to contact us', act(3)],
  ['activate', 'navigation', 'show me the pricing', act(2)],
  ['activate', 'navigation', 'I want to see pricing', act(2)],
  ['activate', 'navigation', 'open contact', act(3)],
  ['activate', 'navigation', 'contact us', act(3)],
  ['activate', 'navigation', 'sign in', act(4)],
  ['activate', 'navigation', 'press sign in', act(4)],
  ['activate', 'navigation', 'click the sign in button', act(4)],
  ['activate', 'navigation', 'log in', act(4)],
  ['activate', 'navigation', 'go home', act(1)],
  ['activate', 'navigation', 'open home', act(1)],
  ['activate', 'navigation', 'open the second link', act(2)],
  ['activate', 'navigation', 'click the last link', act(3)],
  ['activate', 'product', 'add to cart', act(2)],
  ['activate', 'product', 'add it to my cart', act(2)],
  ['activate', 'product', 'place order', act(3)],
  ['activate', 'product', 'open reviews', act(4)],
  ['activate', 'product', 'show reviews', act(4)],
  ['activate', 'product', 'click this', act(1)],
  ['activate', 'form', 'check send me a copy', act(4)],
  ['activate', 'form', 'tick send me a copy', act(4)],
  ['activate', 'form', 'send message', act(6)],
  ['activate', 'list', 'open the second read more', act(2)],
  ['activate', 'list', 'click the first remove', act(4)],

  ['choose', 'navigation', 'click the second one', choose(2)],
  ['choose', 'navigation', 'the third one', choose(3)],
  ['choose', 'navigation', 'number four', choose(4)],
  ['choose', 'navigation', 'four', choose(4)],
  ['choose', 'navigation', 'option 2', choose(2)],

  ['clarify', 'list', 'read more', clarify(1, 2, 3)],
  ['clarify', 'list', 'open read more', clarify(1, 2, 3)],
  ['clarify', 'list', 'remove', clarify(4, 5)],
  ['clarify', 'list', 'click remove', clarify(4, 5)],

  ['select', 'product', 'choose hardcover', option(1, 1)],
  ['select', 'product', 'select large print', option(1, 2)],
  ['select', 'product', 'large print', option(1, 2)],
  ['select', 'product', 'pick audiobook', option(1, 3)],
  ['select', 'form', 'select order problem', option(5, 1)],
  ['select', 'form', 'choose book suggestion', option(5, 2)],
  ['select', 'form', 'set topic to order problem', option(5, 1)],
  ['select', 'form', 'change the topic to order problem', option(5, 1)],

  ['dictate', 'form', 'type Ada Lovelace', edit(1, 'append', { text: 'Ada Lovelace' })],
  ['dictate', 'form', 'type ada@example.com into email address', edit(2, 'append', { text: 'ada@example.com' })],
  ['dictate', 'form', 'enter ada@example.com in the email field', edit(2, 'append', { text: 'ada@example.com' })],
  ['dictate', 'form', 'write hello into message', edit(3, 'append', { text: 'hello' })],
  ['dictate', 'form', 'type meet me in the park', edit(1, 'append', { text: 'meet me in the park' })],
  ['dictate', 'focused', 'type see you soon', edit(3, 'append', { text: 'see you soon' })],
  ['dictate', 'focused', 'dictate thanks again', edit(3, 'append', { text: 'thanks again' })],
  ['dictate', 'focused', 'new line', edit(3, 'append', { text: '\n', raw: true })],

  ['edit', 'focused', 'delete the last word', edit(3, 'delete-word')],
  ['edit', 'focused', 'delete last word', edit(3, 'delete-word')],
  ['edit', 'focused', 'remove the last word', edit(3, 'delete-word')],
  ['edit', 'focused', 'erase that', edit(3, 'clear')],
  ['edit', 'focused', 'clear it', edit(3, 'clear')],
  ['edit', 'focused', 'undo', edit(3, 'undo')],
  ['edit', 'focused', 'undo that', edit(3, 'undo')],
  ['edit', 'focused', 'replace Tuesday with Friday', edit(3, 'replace', { find: 'Tuesday', text: 'Friday' })],
  ['edit', 'focused', 'change Tuesday to Friday', edit(3, 'replace', { find: 'Tuesday', text: 'Friday' })],
  ['edit', 'focused', 'change it to Thanks', edit(3, 'replace-all', { text: 'Thanks' })],
  ['edit', 'form', 'clear the email field', edit(2, 'clear')],
  ['edit', 'form', 'clear name', edit(1, 'clear')],

  ['submit', 'focused', 'press enter', { type: 'submit', targetId: 3 }],
  ['submit', 'focused', 'send it', { type: 'submit', targetId: 3 }],
  ['submit', 'focused', 'submit', { type: 'submit', targetId: 3 }],
  ['submit', 'focused', 'hit enter', { type: 'submit', targetId: 3 }],

  ['search', 'navigation', 'search for river songs', { type: 'search', targetId: 5, text: 'river songs' }],
  ['search', 'navigation', 'search river songs', { type: 'search', targetId: 5, text: 'river songs' }],
  ['search', 'navigation', 'look up river songs', { type: 'search', targetId: 5, text: 'river songs' }],
  ['search', 'navigation', 'find river songs', { type: 'search', targetId: 5, text: 'river songs' }],

  ['scroll', 'empty', 'scroll down', scroll('down')],
  ['scroll', 'empty', 'scroll up', scroll('up')],
  ['scroll', 'empty', 'scroll down a little', scroll('down', 'small')],
  ['scroll', 'empty', 'scroll down a bit', scroll('down', 'small')],
  ['scroll', 'empty', 'scroll a little', scroll('down', 'small')],
  ['scroll', 'empty', 'scroll up a lot', scroll('up')],
  ['scroll', 'empty', 'page down', scroll('down')],
  ['scroll', 'empty', 'go down', scroll('down')],
  ['scroll', 'empty', 'move down a little', scroll('down', 'small')],
  ['scroll', 'empty', 'scroll to the top', scroll('top')],
  ['scroll', 'empty', 'go to the top', scroll('top')],
  ['scroll', 'empty', 'scroll to the bottom', scroll('bottom')],

  ['navigate', 'empty', 'go back', plain('back')],
  ['navigate', 'empty', 'back', plain('back')],
  ['navigate', 'empty', 'go back a page', plain('back')],
  ['navigate', 'empty', 'previous page', plain('back')],
  ['navigate', 'empty', 'return to the previous page', plain('back')],
  ['navigate', 'empty', 'go forward', plain('forward')],

  ['control', 'navigation', 'cancel', plain('cancel')],
  ['control', 'navigation', 'stop', plain('cancel')],
  ['control', 'navigation', 'never mind', plain('cancel')],
  ['control', 'navigation', 'cancel that', plain('cancel')],
  ['control', 'navigation', 'stop that', plain('cancel')],
  ['control', 'navigation', 'pause', plain('pause')],
  ['control', 'navigation', 'pause listening', plain('pause')],
  ['control', 'navigation', 'hold on', plain('pause')],
  ['control', 'navigation', 'wait', plain('pause')],
  ['control', 'navigation', 'resume', plain('resume')],
  ['control', 'navigation', 'continue', plain('resume')],
  ['control', 'navigation', 'yes', plain('confirm')],
  ['control', 'navigation', 'yes please', plain('confirm')],
  ['control', 'navigation', 'go ahead', plain('confirm')],
  ['control', 'navigation', 'no', plain('deny')],
  ['control', 'navigation', 'no thanks', plain('deny')],
  ['control', 'navigation', 'use camera', { type: 'tracking', source: 'camera' }],
  ['control', 'navigation', 'stop camera', { type: 'tracking', source: 'pointer' }],
  ['control', 'navigation', 'recalibrate', plain('calibrate')],

  ['refuse', 'navigation', 'open careers', plain('unknown')],
  ['refuse', 'empty', 'open pricing', plain('unknown')],
  ['refuse', 'empty', 'type hello', plain('unknown')],
  ['refuse', 'empty', 'click this', plain('unknown')],
  ['refuse', 'empty', 'submit', plain('unknown')],
  ['refuse', 'navigation', 'make me a sandwich', plain('unknown')],
];

export const SUITE = CASES.map(([category, context, say, expected], index) => ({ id: index + 1, category, context, say, expected }));

// Written after the interpreter was tuned on SUITE and scored once without further accuracy tuning,
// so it estimates how new phrasing fares. Only safety fixes may be made against it.
const HELD_OUT = [
  ['activate', 'navigation', 'hit the pricing link', act(2)],
  ['activate', 'navigation', 'tap on contact us', act(3)],
  ['activate', 'navigation', 'open up pricing please', act(2)],
  ['activate', 'navigation', 'would you take me home', act(1)],
  ['activate', 'navigation', "I'd like to sign in", act(4)],
  ['activate', 'navigation', 'bring up pricing', act(2)],
  ['activate', 'navigation', 'select the contact link', act(3)],
  ['activate', 'navigation', 'press the first button', act(4)],
  ['activate', 'navigation', 'the second link please', act(2)],
  ['activate', 'navigation', 'go to the third link', act(3)],
  ['activate', 'navigation', 'sign in please', act(4)],
  ['activate', 'navigation', 'login', act(4)],
  ['activate', 'form', 'uncheck send me a copy', act(4)],
  ['activate', 'form', 'click send', act(6)],
  ['activate', 'product', 'buy it now', act(3)],
  ['activate', 'product', 'add this to the cart', act(2)],
  ['activate', 'product', 'read the reviews', act(4)],
  ['activate', 'list', 'the third read more', act(3)],
  ['activate', 'list', 'open the last read more', act(3)],
  ['activate', 'list', 'remove the second one', act(5)],
  ['choose', 'navigation', 'number two please', choose(2)],
  ['choose', 'navigation', 'pick option three', choose(3)],
  ['search', 'navigation', 'search for gift cards please', { type: 'search', targetId: 5, text: 'gift cards' }],
  ['search', 'navigation', 'look for poetry', { type: 'search', targetId: 5, text: 'poetry' }],
  ['refuse', 'navigation', 'open careers page', plain('unknown')],
  ['dictate', 'form', 'type my name is Ada', edit(1, 'append', { text: 'my name is Ada' })],
  ['dictate', 'form', 'put Ada in the name field', edit(1, 'append', { text: 'Ada' })],
  ['dictate', 'form', 'fill in the email with ada@example.com', edit(2, 'append', { text: 'ada@example.com' })],
  ['select', 'form', 'choose general question', option(5, 0)],
  ['select', 'form', 'set the topic to book suggestion', option(5, 2)],
  ['select', 'product', 'choose the hardcover', option(1, 1)],
  ['select', 'product', 'audiobook please', option(1, 3)],
  ['edit', 'focused', 'delete that word', edit(3, 'delete-word')],
  ['edit', 'focused', 'remove the last word please', edit(3, 'delete-word')],
  ['edit', 'focused', 'clear the field', edit(3, 'clear')],
  ['edit', 'focused', 'undo the last change', edit(3, 'undo')],
  ['edit', 'focused', 'replace on with by', edit(3, 'replace', { find: 'on', text: 'by' })],
  ['edit', 'focused', 'change Friday to Monday', edit(3, 'replace', { find: 'Friday', text: 'Monday' })],
  ['dictate', 'focused', 'new paragraph', edit(3, 'append', { text: '\n', raw: true })],
  ['submit', 'focused', 'press enter please', { type: 'submit', targetId: 3 }],
  ['scroll', 'empty', 'scroll down some more', scroll('down')],
  ['scroll', 'empty', 'page up', scroll('up')],
  ['scroll', 'empty', 'go up a little', scroll('up', 'small')],
  ['scroll', 'empty', 'jump to the bottom', scroll('bottom')],
  ['navigate', 'empty', 'back one page', plain('back')],
  ['control', 'navigation', 'never mind that', plain('cancel')],
  ['control', 'navigation', 'hang on', plain('pause')],
  ['control', 'navigation', 'carry on', plain('resume')],
  ['control', 'navigation', 'sure', plain('confirm')],
  ['control', 'navigation', 'nope', plain('deny')],
];

export const HELD_OUT_SUITE = HELD_OUT.map(([category, context, say, expected], index) => ({ id: index + 1, category, context, say, expected }));

// Actions that change the page. A wrong one is an unintended action, the costliest failure.
const PAGE_ACTIONS = new Set(['activate', 'select-option', 'edit', 'search', 'submit', 'scroll', 'back', 'forward', 'choose']);

function matches(expected, got) {
  if (expected.type !== got.type) return false;
  if (expected.type === 'clarify') {
    const ids = [...new Set(got.candidates.map(candidate => candidate.elementId))].sort();
    return JSON.stringify(ids) === JSON.stringify([...expected.elementIds].sort());
  }
  for (const [key, value] of Object.entries(expected)) {
    if (key === 'type') continue;
    if (JSON.stringify(value) !== JSON.stringify(got[key])) return false;
  }
  return true;
}

function classify(test, got) {
  let outcome;
  if (matches(test.expected, got)) outcome = 'correct';
  else if (PAGE_ACTIONS.has(got.type)) outcome = 'unsafe';
  else outcome = 'abstained';
  return { ...test, got: { ...got, choose: undefined }, outcome };
}

function summarize(results, name) {
  const summary = { suite: name, total: results.length, correct: 0, unsafe: 0, abstained: 0, categories: {} };
  for (const result of results) {
    summary[result.outcome]++;
    const category = summary.categories[result.category] ??= { total: 0, correct: 0, unsafe: 0, abstained: 0 };
    category.total++;
    category[result.outcome]++;
  }
  return { summary, results };
}

// Classifies every case: correct, unsafe (a different page action), or abstained (asked/refused instead).
export function evaluateInterpreter(interpret, suite = SUITE, name = SUITE_VERSION) {
  return summarize(suite.map(test => {
    let got;
    try {
      got = interpret(test.say, CONTEXTS[test.context]);
    } catch (error) {
      got = { type: 'error', message: error.message };
    }
    return classify(test, got);
  }), name);
}

/** The same scoring for an interpreter that answers asynchronously (a model); records latency. */
export async function evaluateInterpreterAsync(interpret, suite = SUITE, name = SUITE_VERSION, now = () => performance.now()) {
  const results = [];
  for (const test of suite) {
    let got;
    const started = now();
    try {
      got = await interpret(test.say, CONTEXTS[test.context]);
    } catch (error) {
      got = { type: 'error', message: error.message };
    }
    results.push({ ...classify(test, got), ms: Math.round((now() - started) * 10) / 10 });
  }
  return summarize(results, name);
}
