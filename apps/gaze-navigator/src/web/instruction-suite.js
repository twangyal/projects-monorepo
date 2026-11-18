// Versioned spoken-instruction suite for measuring interpreters on ordinary phrasing.
// Contexts are described gaze contexts (no DOM); expectations are typed actions.
export const SUITE_VERSION = 'spoken-web-v2-checkbox-state';

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
// A clothes shop's product and checkout choices, as dropdowns name them on many sites.
CONTEXTS.shop = { elements: [
  el(1, 'combobox', 'Size', { options: ['XS', 'S', 'M', 'L', 'XL'], value: 'M' }),
  el(2, 'combobox', 'Colour', { options: ['Navy blue', 'Forest green', 'Charcoal grey', 'Off-white'], value: 'Navy blue' }),
  el(3, 'combobox', 'Quantity', { options: ['1', '2', '3', '4', '5'], value: '1' }),
  el(4, 'combobox', 'Delivery', { options: ['Standard (3-5 working days)', 'Express (next working day)', 'Click and collect'], value: 'Standard (3-5 working days)' }),
  el(5, 'combobox', 'Country', { options: ['United Kingdom', 'United States', 'Ireland', 'France', 'Germany'], value: 'United Kingdom' }),
  el(6, 'button', 'Add to bag')] };

// A basket and an address book: the same controls repeated on each row, which says what the row is about (`row`).
const basketRow = (first, item, quantity) => [
  el(first, 'combobox', 'Quantity', { options: ['1', '2', '3', '4', '5'], value: quantity, row: item }),
  el(first + 1, 'button', 'Remove', { consequential: true, row: item }), el(first + 2, 'link', 'Save for later', { row: item })];
CONTEXTS.basket = { elements: [...basketRow(1, 'Wool socks, grey, £8.00', '1'), ...basketRow(4, 'Bobble hat, navy, £15.00', '2'),
  ...basketRow(7, 'Stoneware mug, £12.50', '1'), el(10, 'button', 'Checkout', { consequential: true })] };
const addressRow = (first, address) => [el(first, 'link', 'Edit', { row: address }), el(first + 1, 'button', 'Delete', { consequential: true, row: address })];
CONTEXTS.addresses = { elements: [...addressRow(1, 'Home, 12 Mill Lane, Leeds'), ...addressRow(3, 'Work, 4 Station Road, York'),
  ...addressRow(5, "Mum's house, 9 Elm Close, Hull"), el(7, 'button', 'Add a new address')] };

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
  ['activate', 'form', 'check send me a copy', { type: 'check', targetId: 4, checked: true }],
  ['activate', 'form', 'tick send me a copy', { type: 'check', targetId: 4, checked: true }],
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
// so it estimated how new phrasing fares. Only safety fixes may be made against it. Its misses were read on
// 2026-11-03 while everyday phrasing (everyday.js) was added, so scores since then overstate how new phrasing fares.
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
  ['activate', 'form', 'uncheck send me a copy', { type: 'check', targetId: 4, checked: false }],
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

// Second held-out set (2026-10-13), written before WaterSheep's design was changed again and scored
// once, to test whether a model's target choice generalizes. It leans toward paraphrased and indirect
// names for controls, with negatives where nothing in the circle fits. Never tune on it. Its misses were read on
// 2026-11-03 while everyday phrasing (everyday.js) was added, so scores since then overstate how new phrasing fares.
const HELD_OUT_2 = [
  ['activate', 'navigation', 'show me how much it costs', act(2)],
  ['activate', 'navigation', 'open the prices', act(2)],
  ['activate', 'navigation', 'open the cost page', act(2)],
  ['activate', 'navigation', 'I want to get in touch', act(3)],
  ['activate', 'navigation', 'take me to support', act(3)],
  ['activate', 'navigation', 'open the contact page please', act(3)],
  ['activate', 'navigation', 'click the login', act(4)],
  ['activate', 'navigation', 'press log on', act(4)],
  ['activate', 'navigation', 'go to my account', act(4)],
  ['activate', 'navigation', 'go to the start page', act(1)],
  ['activate', 'navigation', 'open the front page', act(1)],
  ['activate', 'navigation', 'click the button', act(4)],
  ['activate', 'product', 'put it in my basket', act(2)],
  ['activate', 'product', 'add this one to the cart', act(2)],
  ['activate', 'product', 'check out now', act(3)],
  ['activate', 'product', 'complete my purchase', act(3)],
  ['activate', 'product', 'see what people said about it', act(4)],
  ['activate', 'product', 'open customer reviews', act(4)],
  ['activate', 'product', 'show the ratings', act(4)],
  ['activate', 'product', 'open the comments', act(4)],
  ['activate', 'form', 'press the send button', act(6)],
  ['activate', 'form', 'tick the copy box', { type: 'check', targetId: 4, checked: true }],
  ['activate', 'form', 'email me a copy', act(4)],
  ['activate', 'form', 'open the topic list', act(5)],
  ['activate', 'form', 'go to the email field', act(2)],
  ['activate', 'form', 'click on the name box', act(1)],
  ['activate', 'list', 'open the first article', act(1)],
  ['activate', 'list', 'open the third story', act(3)],
  ['select', 'product', 'pick the hardback', option(1, 1)],
  ['select', 'product', 'the paperback edition', option(1, 0)],
  ['select', 'product', 'choose the audio version', option(1, 3)],
  ['select', 'product', 'switch format to large print', option(1, 2)],
  ['select', 'form', 'choose a problem with my order', option(5, 1)],
  ['select', 'form', 'set the subject to book suggestion', option(5, 2)],
  ['clarify', 'list', 'remove it', clarify(4, 5)],
  ['dictate', 'focused', 'write thanks so much', edit(3, 'append', { text: 'thanks so much' })],
  ['edit', 'focused', 'erase everything', edit(3, 'clear')],
  ['edit', 'focused', 'take back that change', edit(3, 'undo')],
  ['scroll', 'empty', 'move down the page', scroll('down')],
  ['scroll', 'empty', 'scroll back up', scroll('up')],
  ['navigate', 'empty', 'previous page please', plain('back')],
  ['control', 'navigation', 'stop everything', plain('cancel')],
  ['control', 'navigation', 'wait a sec', plain('pause')],
  ['control', 'navigation', 'yes do it', plain('confirm')],
  ['control', 'navigation', "no don't", plain('deny')],
  ['refuse', 'navigation', 'open the blog', plain('unknown')],
  ['refuse', 'navigation', 'click download', plain('unknown')],
  ['refuse', 'navigation', 'open the shopping basket', plain('unknown')],
  ['refuse', 'product', 'open the size guide', plain('unknown')],
  ['refuse', 'form', 'attach a file', plain('unknown')],
];

export const HELD_OUT_2_SUITE = HELD_OUT_2.map(([category, context, say, expected], index) => ({ id: index + 1, category, context, say, expected }));

// Third held-out set (2026-11-03), written before the interpreter learned everyday words for pausing, confirming,
// scrolling, editing and common site sections, and scored once before that change. It mixes those kinds of phrasing
// with negatives where nothing in the circle fits. Never tune on it. The same person wrote it and that change, so
// its score after the change is optimistic too.
const HELD_OUT_3 = [
  ['control', 'navigation', 'hold it', plain('pause')],
  ['control', 'navigation', 'give me a minute', plain('pause')],
  ['control', 'navigation', 'just a moment', plain('pause')],
  ['control', 'navigation', 'keep going', plain('resume')],
  ['control', 'navigation', "I'm back", plain('resume')],
  ['control', 'navigation', 'yep', plain('confirm')],
  ['control', 'navigation', 'yeah go ahead', plain('confirm')],
  ['control', 'navigation', 'go for it', plain('confirm')],
  ['control', 'navigation', 'nah', plain('deny')],
  ['control', 'navigation', 'no not that', plain('deny')],
  ['control', 'navigation', 'cancel that please', plain('cancel')],
  ['control', 'navigation', 'abort', plain('cancel')],
  ['control', 'navigation', 'forget about it', plain('cancel')],
  ['scroll', 'empty', 'keep scrolling', scroll('down')],
  ['scroll', 'empty', 'down a bit', scroll('down', 'small')],
  ['scroll', 'empty', 'up a little bit', scroll('up', 'small')],
  ['scroll', 'empty', 'take me back to the top', scroll('top')],
  ['scroll', 'empty', 'all the way down', scroll('bottom')],
  ['scroll', 'empty', 'scroll a bit further', scroll('down', 'small')],
  ['navigate', 'empty', 'take me back', plain('back')],
  ['navigate', 'empty', 'forward a page', plain('forward')],
  ['edit', 'focused', 'scratch that', edit(3, 'undo')],
  ['edit', 'focused', 'delete that last word', edit(3, 'delete-word')],
  ['edit', 'focused', 'wipe the field', edit(3, 'clear')],
  ['edit', 'focused', 'swap Tuesday for Wednesday', edit(3, 'replace', { find: 'Tuesday', text: 'Wednesday' })],
  ['edit', 'focused', 'undo my last edit', edit(3, 'undo')],
  ['dictate', 'focused', 'start a new line', edit(3, 'append', { text: '\n', raw: true })],
  ['activate', 'navigation', 'go to the homepage', act(1)],
  ['activate', 'navigation', 'open the main page', act(1)],
  ['activate', 'navigation', 'open the fees page', act(2)],
  ['activate', 'navigation', 'contact customer service', act(3)],
  ['activate', 'navigation', 'log me in', act(4)],
  ['activate', 'product', 'add it to the basket', act(2)],
  ['activate', 'product', 'add to bag', act(2)],
  ['activate', 'product', 'see the customer ratings', act(4)],
  ['activate', 'product', 'what do people think of it', act(4)],
  ['activate', 'form', 'hit send', act(6)],
  ['activate', 'form', 'tick the box', { type: 'check', targetId: 4, checked: true }],
  ['activate', 'form', 'jump to the message box', act(3)],
  ['activate', 'list', 'open the second article', act(2)],
  ['activate', 'list', 'read the first one', act(1)],
  ['activate', 'list', 'delete the first one', act(4)],
  ['select', 'form', 'make the topic general question', option(5, 0)],
  ['select', 'product', 'make it hardcover', option(1, 1)],
  ['select', 'product', 'switch to the audiobook', option(1, 3)],
  ['select', 'product', 'I want the large print one', option(1, 2)],
  ['dictate', 'form', 'write hello there in the message', edit(3, 'append', { text: 'hello there' })],
  ['dictate', 'form', 'put ada@example.com in the email box', edit(2, 'append', { text: 'ada@example.com' })],
  ['search', 'navigation', 'find me some poetry books', { type: 'search', targetId: 5, text: 'poetry books' }],
  ['refuse', 'navigation', 'show me the blog posts', plain('unknown')],
  ['refuse', 'navigation', 'go to settings', plain('unknown')],
  ['refuse', 'product', 'add to wishlist', plain('unknown')],
  ['refuse', 'product', 'open the delivery info', plain('unknown')],
  ['refuse', 'form', 'upload a photo', plain('unknown')],
  ['refuse', 'list', 'share it', plain('unknown')],
];

export const HELD_OUT_3_SUITE = HELD_OUT_3.map(([category, context, say, expected], index) => ({ id: index + 1, category, context, say, expected }));

// Held-out set 4 (2026-11-03): tasks said the way people say them, naming what they want done rather than the control
// ("pop this in the cart", "how much does it cost", "it's about an order problem"). Written before the rules for task
// phrasing, by the same developer, so it is held out from those rules but not independent of their author; the earlier
// sets check nothing else regressed. Four instructions that turned out to repeat earlier sets were dropped, not replaced.
const HELD_OUT_4 = [
  ['activate', 'product', 'pop this in the cart', act(2)],
  ['activate', 'product', 'add this book to my bag', act(2)],
  ['activate', 'product', 'complete the purchase', act(3)],
  ['activate', 'product', 'go ahead and order it', act(3)],
  ['activate', 'product', 'finish my order', act(3)],
  ['activate', 'product', 'what do other readers think', act(4)],
  ['activate', 'product', 'read what people wrote about it', act(4)],
  ['activate', 'product', 'any reviews', act(4)],
  ['select', 'product', "I'd like the hardcover", option(1, 1)],
  ['select', 'product', 'get me the audiobook version', option(1, 3)],
  ['select', 'product', 'large print please', option(1, 2)],
  ['select', 'product', 'the paperback is fine', option(1, 0)],
  ['select', 'product', 'can I have it in large print', option(1, 2)],
  ['activate', 'form', "I'm done, send it off", act(6)],
  ['select', 'form', "it's about an order problem", option(5, 1)],
  ['select', 'form', 'my question is about a book suggestion', option(5, 2)],
  ['activate', 'form', 'I want a copy too', { type: 'check', targetId: 4, checked: true }],
  ['dictate', 'form', 'my name is Ada Lovelace', edit(1, 'append', { text: 'Ada Lovelace' })],
  ['dictate', 'form', 'my email is ada@example.com', edit(2, 'append', { text: 'ada@example.com' })],
  ['activate', 'navigation', 'how much does it cost', act(2)],
  ['activate', 'navigation', 'what are your prices', act(2)],
  ['activate', 'navigation', 'I need to get in touch', act(3)],
  ['activate', 'navigation', 'how do I reach you', act(3)],
  ['activate', 'navigation', 'let me log in', act(4)],
  ['activate', 'navigation', 'I want to sign into my account', act(4)],
  ['activate', 'navigation', 'back to the start page', act(1)],
  ['search', 'navigation', 'do you have anything about gardening', { type: 'search', targetId: 5, text: 'gardening' }],
  ['search', 'navigation', "I'm looking for cookbooks", { type: 'search', targetId: 5, text: 'cookbooks' }],
  ['activate', 'list', 'get rid of the second one', act(5)],
  ['activate', 'list', 'take the first one out', act(4)],
  ['activate', 'list', 'tell me more about the third one', act(3)],
  ['clarify', 'list', 'get rid of it', clarify(4, 5)],
  ['refuse', 'product', 'gift wrap it', plain('unknown')],
  ['refuse', 'product', 'compare prices', plain('unknown')],
  ['refuse', 'navigation', 'open the forum', plain('unknown')],
  ['refuse', 'list', 'save it for later', plain('unknown')],
];

export const HELD_OUT_4_SUITE = HELD_OUT_4.map(([category, context, say, expected], index) => ({ id: index + 1, category, context, say, expected }));

// Held-out set 5 (2026-11-17): choices said in other words, on a clothes shop's dropdowns (sizes by name, colours by
// one word, delivery by what it does, countries by their short names, quantities as words), plus choices the page does
// not offer, which must not act. Written before any rule for it, by the same developer, on a new page context, avoiding
// the product and topic wordings earlier sets missed.
const HELD_OUT_5 = [
  ['select', 'shop', 'make it a medium', option(1, 2)],
  ['select', 'shop', 'I need a small', option(1, 1)],
  ['select', 'shop', 'extra large please', option(1, 4)],
  ['select', 'shop', 'can I get size large', option(1, 3)],
  ['select', 'shop', 'the extra small one', option(1, 0)],
  ['select', 'shop', 'go one size up', option(1, 3)],
  ['select', 'shop', 'in green', option(2, 1)],
  ['select', 'shop', "I'll take the grey", option(2, 2)],
  ['select', 'shop', 'change the colour to white', option(2, 3)],
  ['select', 'shop', 'do you have it in navy', option(2, 0)],
  ['select', 'shop', 'the blue one', option(2, 0)],
  ['select', 'shop', 'next day delivery', option(4, 1)],
  ['select', 'shop', 'I want it tomorrow', option(4, 1)],
  ['select', 'shop', "I'll pick it up in store", option(4, 2)],
  ['select', 'shop', 'standard shipping is fine', option(4, 0)],
  ['select', 'shop', 'express please', option(4, 1)],
  ['select', 'shop', 'I live in the UK', option(5, 0)],
  ['select', 'shop', 'ship it to the US', option(5, 1)],
  ['select', 'shop', 'set the country to America', option(5, 1)],
  ['select', 'shop', 'Germany', option(5, 4)],
  ["select", 'shop', "I'm in Ireland", option(5, 2)],
  ['select', 'shop', "I'll take two", option(3, 1)],
  ['select', 'shop', 'make it three', option(3, 2)],
  ['select', 'shop', 'just one', option(3, 0)],
  ['select', 'shop', 'four of them please', option(3, 3)],
  ['activate', 'shop', 'put it in my bag', act(6)],
  ['refuse', 'shop', 'in pink', plain('unknown')],
  ['refuse', 'shop', 'size 12', plain('unknown')],
  ['refuse', 'shop', 'ship it to Japan', plain('unknown')],
  ['refuse', 'shop', 'two-day delivery', plain('unknown')],
  ['refuse', 'shop', 'make it ten', plain('unknown')],
  ['refuse', 'shop', 'in a tall fit', plain('unknown')],
];

export const HELD_OUT_5_SUITE = HELD_OUT_5.map(([category, context, say, expected], index) => ({ id: index + 1, category, context, say, expected }));

// Held-out set 6 (2026-11-17): controls repeated on every row of a basket and an address book (Remove, Save for later,
// Quantity, Edit, Delete), named by what their row is about ("remove the socks", "edit my work address"), plus rows the
// page does not have, which must not act. Written before any rule for it, by the same developer, on new page contexts.
const HELD_OUT_6 = [
  ['activate', 'basket', 'remove the socks', act(2)],
  ['activate', 'basket', 'take the hat out of my basket', act(5)],
  ['activate', 'basket', 'delete the mug', act(8)],
  ['activate', 'basket', 'get rid of the bobble hat', act(5)],
  ['activate', 'basket', 'remove the grey socks from my basket', act(2)],
  ['activate', 'basket', "I don't want the mug any more", act(8)],
  ['activate', 'basket', 'save the hat for later', act(6)],
  ['activate', 'basket', 'save the mug for later', act(9)],
  ['activate', 'basket', 'remove the second item', act(5)],
  ['activate', 'basket', 'remove the last one', act(8)],
  ['activate', 'basket', 'checkout', act(10)],
  ['select', 'basket', 'make the mug two', option(7, 1)],
  ['select', 'basket', 'change the socks quantity to 3', option(1, 2)],
  ['select', 'basket', 'I want three hats', option(4, 2)],
  ['select', 'basket', 'just one hat', option(4, 0)],
  ['activate', 'addresses', 'edit my work address', act(3)],
  ['activate', 'addresses', 'change the home address', act(1)],
  ['activate', 'addresses', "delete mum's address", act(6)],
  ['activate', 'addresses', 'edit the York one', act(3)],
  ['activate', 'addresses', 'remove the Leeds address', act(2)],
  ['activate', 'addresses', 'add an address', act(7)],
  ['refuse', 'basket', 'remove the scarf', plain('unknown')],
  ['refuse', 'basket', 'save the shoes for later', plain('unknown')],
  ['refuse', 'basket', 'make the scarf two', plain('unknown')],
  ['refuse', 'addresses', 'delete the office address', plain('unknown')],
  ['refuse', 'addresses', 'edit the Paris one', plain('unknown')],
];

export const HELD_OUT_6_SUITE = HELD_OUT_6.map(([category, context, say, expected], index) => ({ id: index + 1, category, context, say, expected }));

// Held-out set 7 (2026-11-18): requests wrapped in politeness or said as the goal rather than the control ("could you
// take me to the home page", "I need to get in touch with you", "I no longer want the mug", "time to pay"), on the
// existing contexts, plus requests the pages cannot meet, which must not act. Written before the rules for them, by the
// same developer, after reading the misses left in the earlier held-out sets (which then served as development cases).
// Three instructions that turned out to repeat earlier sets were dropped, not replaced.
const HELD_OUT_7 = [
  ['activate', 'navigation', 'could you take me to the home page', act(1)],
  ['activate', 'navigation', 'bring me back to the start page', act(1)],
  ['activate', 'navigation', 'please open the pricing page', act(2)],
  ['activate', 'navigation', 'I need to get in touch with you', act(3)],
  ['activate', 'navigation', 'sign me in please', act(4)],
  ['search', 'navigation', 'can you search for jazz records', { type: 'search', targetId: 5, text: 'jazz records' }],
  ['select', 'product', 'I would like the hardcover', option(1, 1)],
  ['select', 'product', 'make it the audiobook', option(1, 3)],
  ['select', 'product', 'the large print one please', option(1, 2)],
  ['activate', 'product', 'let me see the reviews', act(4)],
  ['activate', 'product', 'show me what other readers said', act(4)],
  ['activate', 'product', 'could you add it to my cart', act(2)],
  ['activate', 'product', 'I am ready to order', act(3)],
  ['dictate', 'form', 'put grace@example.com in the email box', edit(2, 'append', { text: 'grace@example.com' })],
  ['select', 'form', 'the topic is an order problem', option(5, 1)],
  ['activate', 'form', 'yes please send me a copy', act(4)],
  ['activate', 'form', 'send my message', act(6)],
  ['edit', 'form', 'get rid of the message', edit(3, 'clear')],
  ['edit', 'form', 'empty the email box', edit(2, 'clear')],
  ['select', 'shop', 'I need a large', option(1, 3)],
  ['select', 'shop', 'can I have it in green', option(2, 1)],
  ['select', 'shop', "I'll collect it myself", option(4, 2)],
  ['select', 'shop', 'send it to Ireland', option(5, 2)],
  ['select', 'shop', 'two of these please', option(3, 1)],
  ['activate', 'shop', 'stick it in my bag', act(6)],
  ['activate', 'basket', 'I no longer want the mug', act(8)],
  ['activate', 'basket', 'keep the hat for later', act(6)],
  ['activate', 'basket', 'time to pay', act(10)],
  ['select', 'basket', 'I want three pairs of socks', option(1, 2)],
  ['activate', 'addresses', 'change my home address', act(1)],
  ['activate', 'addresses', "I don't need the work address anymore", act(4)],
  ['activate', 'addresses', 'I have a new address to add', act(7)],
  ['navigate', 'empty', 'take me back one page', plain('back')],
  ['navigate', 'empty', 'go back to where I was', plain('back')],
  ['navigate', 'empty', 'could you go forward', plain('forward')],
  ['control', 'navigation', 'hang on a second', plain('pause')],
  ['control', 'navigation', 'forget it', plain('cancel')],
  ['refuse', 'product', 'buy the whole series', plain('unknown')],
  ['refuse', 'shop', 'make it yellow', plain('unknown')],
  ['refuse', 'basket', 'remove the gloves', plain('unknown')],
  ['refuse', 'addresses', 'delete the address in Bristol', plain('unknown')],
  ['refuse', 'navigation', 'open my settings', plain('unknown')],
];

export const HELD_OUT_7_SUITE = HELD_OUT_7.map(([category, context, say, expected], index) => ({ id: index + 1, category, context, say, expected }));

// Held-out set 8 (2026-11-18): more requests of the same kinds, written after the rules for set 7 and scored once, with
// no rule changed for it, to measure how far those rules carry to wording they were not written for.
const HELD_OUT_8 = [
  ['activate', 'navigation', 'go to the homepage please', act(1)],
  ['activate', 'navigation', 'show me your prices please', act(2)],
  ['activate', 'navigation', 'is there a way to contact you', act(3)],
  ['activate', 'navigation', 'log me into my account', act(4)],
  ['search', 'navigation', 'please look up second hand bikes', { type: 'search', targetId: 5, text: 'second hand bikes' }],
  ['select', 'product', 'I prefer the paperback', option(1, 0)],
  ['select', 'product', 'switch it to the audio book', option(1, 3)],
  ['activate', 'product', 'put this one in my cart please', act(2)],
  ['activate', 'product', 'I would like to buy it now', act(3)],
  ['activate', 'product', 'are there any reviews', act(4)],
  ['activate', 'product', 'what are people saying about it', act(4)],
  ['select', 'form', 'my question is about an order problem', option(5, 1)],
  ['dictate', 'form', 'type hello there into the message box', edit(3, 'append', { text: 'hello there' })],
  ['edit', 'form', 'erase my name', edit(1, 'clear')],
  ['activate', 'form', 'submit my message', act(6)],
  ['select', 'shop', 'go up to an extra large', option(1, 4)],
  ['select', 'shop', 'I would like it in grey', option(2, 2)],
  ['select', 'shop', 'I need it by tomorrow', option(4, 1)],
  ['select', 'shop', 'ship it to France', option(5, 3)],
  ['activate', 'shop', 'add it to my bag', act(6)],
  ['select', 'shop', 'three of them', option(3, 2)],
  ['activate', 'basket', 'take the socks out', act(2)],
  ['activate', 'basket', 'save the mug for another time', act(9)],
  ['activate', 'basket', 'go to the checkout', act(10)],
  ['select', 'basket', 'make it two hats', option(4, 1)],
  ['activate', 'addresses', "edit mum's address", act(5)],
  ['activate', 'addresses', 'remove the York address', act(4)],
  ['activate', 'addresses', 'add another address', act(7)],
  ['navigate', 'empty', 'take me back to the last page', plain('back')],
  ['navigate', 'empty', 'forward one page', plain('forward')],
  ['control', 'navigation', 'give me a sec', plain('pause')],
  ['control', 'navigation', 'cancel it please', plain('cancel')],
  ['refuse', 'product', 'wrap it as a present', plain('unknown')],
  ['refuse', 'shop', 'size 16', plain('unknown')],
  ['refuse', 'basket', 'remove the shoes', plain('unknown')],
  ['refuse', 'addresses', 'delete the Glasgow address', plain('unknown')],
  ['refuse', 'navigation', 'open the careers page', plain('unknown')],
];

export const HELD_OUT_8_SUITE = HELD_OUT_8.map(([category, context, say, expected], index) => ({ id: index + 1, category, context, say, expected }));

// Held-out set 9, written before unparsed requests were answered with an offer of the control their words point to,
// and scored first without it.
const HELD_OUT_9 = [
  ['activate', 'navigation', 'how much do you charge', act(2)],
  ['activate', 'navigation', 'I want to speak to someone', act(3)],
  ['activate', 'navigation', 'I have an account already', act(4)],
  ['activate', 'navigation', 'bring up the main page', act(1)],
  ['search', 'navigation', 'search for cheap flights to rome', { type: 'search', targetId: 5, text: 'cheap flights to rome' }],
  ['activate', 'navigation', 'what are your plans and costs', act(2)],
  ['activate', 'navigation', 'where do I sign in', act(4)],
  ['activate', 'navigation', 'can I email you', act(3)],
  ['select', 'product', 'the hardcover one please', option(1, 1)],
  ['select', 'product', 'can I listen to it instead', option(1, 3)],
  ['select', 'product', 'bigger print please', option(1, 2)],
  ['activate', 'product', "I'll add it to the cart", act(2)],
  ['activate', 'product', 'show the customer reviews', act(4)],
  ['activate', 'product', 'any good ratings', act(4)],
  ['activate', 'product', 'finalise my purchase', act(3)],
  ['select', 'form', 'I have a problem with my order', option(5, 1)],
  ['select', 'form', 'I want to suggest a book', option(5, 2)],
  ['activate', 'form', 'send it off', act(6)],
  ['activate', 'form', 'copy me in', act(4)],
  ['edit', 'form', 'clear the message', edit(3, 'clear')],
  ['dictate', 'form', 'write thanks a lot in the message', edit(3, 'append', { text: 'thanks a lot' })],
  ['select', 'shop', 'a small one', option(1, 1)],
  ['select', 'shop', 'in white', option(2, 3)],
  ['select', 'shop', 'the green one', option(2, 1)],
  ['select', 'shop', 'four please', option(3, 3)],
  ['select', 'shop', 'I will pick it up from the store', option(4, 2)],
  ['select', 'shop', 'send it to Germany', option(5, 4)],
  ['select', 'shop', 'as fast as possible', option(4, 1)],
  ['activate', 'shop', 'pop it in my bag', act(6)],
  ['activate', 'basket', 'get rid of the hat', act(5)],
  ['activate', 'basket', 'keep the socks for later', act(3)],
  ['select', 'basket', 'I want two mugs', option(7, 1)],
  ['activate', 'basket', 'I am ready to pay', act(10)],
  ['activate', 'addresses', 'change my work address', act(3)],
  ['activate', 'addresses', 'I have moved, add my new address', act(7)],
  ['navigate', 'empty', 'go back where I came from', plain('back')],
  ['navigate', 'empty', 'the page before please', plain('back')],
  ['control', 'navigation', 'wait a moment', plain('pause')],
  ['refuse', 'product', 'can you gift wrap this', plain('unknown')],
  ['refuse', 'shop', 'make it purple', plain('unknown')],
  ['refuse', 'basket', 'take the gloves out', plain('unknown')],
  ['refuse', 'navigation', 'show me the blog', plain('unknown')],
  ['refuse', 'addresses', 'delete the London address', plain('unknown')],
];

export const HELD_OUT_9_SUITE = HELD_OUT_9.map(([category, context, say, expected], index) => ({ id: index + 1, category, context, say, expected }));

// Held-out set 10, written after set 9 was seen and before offers were scored by the words of a control's name they
// cover, and scored once.
const HELD_OUT_10 = [
  ['activate', 'navigation', 'I would like to get in contact', act(3)],
  ['activate', 'navigation', 'who do I talk to about my bill', act(3)],
  ['activate', 'navigation', 'what does it cost', act(2)],
  ['activate', 'navigation', 'I am already a member', act(4)],
  ['activate', 'navigation', 'take me to the front page', act(1)],
  ['activate', 'navigation', 'let me log on', act(4)],
  ['select', 'product', 'is there an audio version', option(1, 3)],
  ['activate', 'product', 'what did readers make of it', act(4)],
  ['select', 'product', 'something with larger text', option(1, 2)],
  ['select', 'product', 'I would like the hard back', option(1, 1)],
  ['activate', 'product', 'go on then, order it', act(3)],
  ['select', 'form', 'my order never arrived', option(5, 1)],
  ['select', 'form', 'I have a recommendation for you', option(5, 2)],
  ['activate', 'form', 'please send me a copy as well', act(4)],
  ['activate', 'form', 'post my message', act(6)],
  ['select', 'shop', 'the largest size', option(1, 4)],
  ['select', 'shop', 'something darker, the grey', option(2, 2)],
  ['select', 'shop', "I'll collect it in person", option(4, 2)],
  ['select', 'shop', 'deliver it to Ireland', option(5, 2)],
  ['select', 'shop', 'next day please', option(4, 1)],
  ['activate', 'shop', 'put it in the bag', act(6)],
  ['activate', 'basket', 'take the hat off my order', act(5)],
  ['activate', 'basket', 'move the socks to my saved items', act(3)],
  ['activate', 'basket', 'let me pay now', act(10)],
  ['activate', 'addresses', 'update the Leeds address', act(1)],
  ['activate', 'addresses', 'I need another address', act(7)],
  ['refuse', 'navigation', 'tell me a joke', plain('unknown')],
  ['refuse', 'navigation', 'show me the weather', plain('unknown')],
  ['refuse', 'shop', 'make it red', plain('unknown')],
  ['refuse', 'navigation', 'delete my account', plain('unknown')],
  ['refuse', 'basket', 'delete the scarf from my basket', plain('unknown')],
];

export const HELD_OUT_10_SUITE = HELD_OUT_10.map(([category, context, say, expected], index) => ({ id: index + 1, category, context, say, expected }));

// Held-out set 11, written after offers were scored by how well a request's words point to a control, and scored once.
const HELD_OUT_11 = [
  ['activate', 'navigation', "I'd like to drop you a line", act(3)],
  ['activate', 'navigation', 'how expensive is it', act(2)],
  ['activate', 'navigation', 'my login please', act(4)],
  ['activate', 'navigation', 'back to the beginning', act(1)],
  ['activate', 'navigation', 'is there a phone number', act(3)],
  ['activate', 'navigation', 'enter my password', act(4)],
  ['select', 'product', 'do you have it as a hardback', option(1, 1)],
  ['activate', 'product', 'customer opinions', act(4)],
  ['select', 'product', 'I want to hear it read aloud', option(1, 3)],
  ['activate', 'product', 'buy it', act(3)],
  ['activate', 'product', 'stick it in the basket', act(2)],
  ['select', 'form', 'my parcel is missing', option(5, 1)],
  ['select', 'form', 'it is about a missing order', option(5, 1)],
  ['select', 'form', 'tick the box to get a copy', { type: 'check', targetId: 4, checked: true }],
  ['activate', 'form', 'send my enquiry', act(6)],
  ['select', 'shop', 'the smallest one', option(1, 0)],
  ['select', 'shop', 'the cream colour', option(2, 3)],
  ['select', 'shop', 'quickest delivery', option(4, 1)],
  ['select', 'shop', 'can I get it delivered to the States', option(5, 1)],
  ['select', 'shop', 'five of these', option(3, 4)],
  ['activate', 'basket', 'bin the mug', act(8)],
  ['activate', 'basket', 'save the hat for another day', act(6)],
  ['activate', 'basket', 'proceed to payment', act(10)],
  ['activate', 'addresses', 'fix the York one', act(3)],
  ['activate', 'addresses', 'new address please', act(7)],
  ['navigate', 'empty', 'one page back', plain('back')],
  ['control', 'navigation', 'hold on a second', plain('pause')],
  ['refuse', 'navigation', 'I do not want to sign in', plain('unknown')],
  ['refuse', 'navigation', 'show me my orders', plain('unknown')],
  ['refuse', 'shop', 'make it in purple', plain('unknown')],
  ['refuse', 'form', 'remove my phone number', plain('unknown')],
  ['refuse', 'product', 'open the basket', plain('unknown')],
];

export const HELD_OUT_11_SUITE = HELD_OUT_11.map(([category, context, say, expected], index) => ({ id: index + 1, category, context, say, expected }));

// Held-out set 12, written after choices could be said by their rank ("the largest size"), and scored once.
const HELD_OUT_12 = [
  ['activate', 'navigation', 'take me to the start page', act(1)],
  ['activate', 'navigation', 'how much will it set me back', act(2)],
  ['activate', 'navigation', 'who can I ring about this', act(3)],
  ['activate', 'navigation', 'sign me in', act(4)],
  ['select', 'product', 'softback is fine', option(1, 0)],
  ['activate', 'product', 'any reviews worth reading', act(4)],
  ['activate', 'product', 'pop it in my cart', act(2)],
  ['select', 'product', 'the large print edition please', option(1, 2)],
  ['select', 'form', 'I have a complaint about my order', option(5, 1)],
  ['select', 'form', "I'd like a copy of this sent to me", { type: 'check', targetId: 4, checked: true }],
  ['select', 'form', "I've got an idea for a book", option(5, 2)],
  ['activate', 'form', 'fire it off', act(6)],
  ['select', 'shop', 'the biggest one you have', option(1, 4)],
  ['select', 'shop', 'go for the tiniest size', option(1, 0)],
  ['select', 'shop', 'the fastest way to get it', option(4, 1)],
  ['select', 'shop', 'the quickest option', option(4, 1)],
  ['select', 'shop', 'the grey please', option(2, 2)],
  ['select', 'shop', 'two of them', option(3, 1)],
  ['select', 'shop', 'ship it to Germany', option(5, 4)],
  ['select', 'shop', "I'll pick it up from the shop", option(4, 2)],
  ['activate', 'basket', 'get rid of the socks', act(2)],
  ['activate', 'basket', 'keep the mug for later', act(9)],
  ['activate', 'basket', "I'm ready to pay", act(10)],
  ['select', 'basket', 'three hats please', option(4, 2)],
  ['activate', 'addresses', 'update the address at work', act(3)],
  ['activate', 'addresses', "remove mum's house", act(6)],
  ['activate', 'addresses', 'add another one', act(7)],
  ['navigate', 'empty', 'go to the previous page', plain('back')],
  ['navigate', 'empty', 'go forward a page', plain('forward')],
  ['control', 'navigation', 'stop listening for a moment', plain('pause')],
  ['refuse', 'shop', 'the cheapest size', plain('unknown')],
  ['refuse', 'product', "don't add it to my cart", plain('unknown')],
];

export const HELD_OUT_12_SUITE = HELD_OUT_12.map(([category, context, say, expected], index) => ({ id: index + 1, category, context, say, expected }));

// Written after choices could be said as a preference ("softback is fine", "I have a complaint about my order"), by
// quantity per item ("three hats please") and as a wish to tick a box, and scored once.
const HELD_OUT_13 = [
  ['activate', 'navigation', 'I need to speak to someone', act(3)],
  ['activate', 'navigation', 'what does it cost per month', act(2)],
  ['activate', 'navigation', 'back to the homepage please', act(1)],
  ['activate', 'navigation', 'let me log into my account', act(4)],
  ['select', 'product', "I'd prefer the hardback", option(1, 1)],
  ['select', 'product', "I'd rather hear it than read it", option(1, 3)],
  ['activate', 'product', 'chuck it in my trolley', act(2)],
  ['activate', 'product', 'has anyone reviewed it', act(4)],
  ['select', 'product', 'the one with bigger writing', option(1, 2)],
  ['select', 'form', "something's wrong with my order", option(5, 1)],
  ['select', 'form', "it's just a general question", option(5, 0)],
  ['select', 'form', 'send me a copy too', { type: 'check', targetId: 4, checked: true }],
  ['activate', 'form', "that's it, send it", act(6)],
  ['select', 'shop', 'a small would be better', option(1, 1)],
  ['select', 'shop', 'do you have it in green', option(2, 1)],
  ['select', 'shop', "I'll go for the off-white", option(2, 3)],
  ['select', 'shop', 'make it four', option(3, 3)],
  ['select', 'shop', 'I want it here tomorrow', option(4, 1)],
  ['select', 'shop', 'standard delivery is fine', option(4, 0)],
  ['select', 'shop', "it's going to Ireland", option(5, 2)],
  ['select', 'shop', "the smallest you've got", option(1, 0)],
  ['activate', 'shop', 'pop it in the bag', act(6)],
  ['activate', 'basket', "I don't need the mug", act(8)],
  ['select', 'basket', 'only the one hat', option(4, 0)],
  ['activate', 'basket', 'save the socks for another time', act(3)],
  ['activate', 'basket', 'take me to the checkout', act(10)],
  ['activate', 'addresses', "change my mum's address", act(5)],
  ['activate', 'addresses', 'get rid of the work address', act(4)],
  ['activate', 'addresses', "I've moved, add my new address", act(7)],
  ['navigate', 'empty', 'take me back where I was', plain('back')],
  ['control', 'navigation', 'hang on a sec', plain('pause')],
  ['refuse', 'basket', 'bin the umbrella', plain('unknown')],
];
export const HELD_OUT_13_SUITE = HELD_OUT_13.map(([category, context, say, expected], index) => ({ id: index + 1, category, context, say, expected }));

// Actions that change the page. A wrong one is an unintended action, the costliest failure.
const PAGE_ACTIONS = new Set(['activate', 'hover', 'double-click', 'context-menu', 'disclosure', 'check', 'select-radio', 'select-tab', 'range', 'select-text', 'delete-selection', 'select-option', 'edit', 'search', 'submit', 'scroll', 'back', 'forward', 'choose']);

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

// Clicking an unticked checkbox ticks it: either action on the box meant is the same thing done.
function sameTick(test, expected, got) {
  const box = CONTEXTS[test.context]?.elements.find(element => element.id === expected.targetId);
  if (!box || !['checkbox', 'switch'].includes(box.role) || box.checked || got.targetId !== expected.targetId) return false;
  const ticks = action => action.type === 'activate' || (action.type === 'check' && action.checked === true);
  return ticks(expected) && ticks(got);
}

function classify(test, got) {
  let outcome;
  if (matches(test.expected, got) || sameTick(test, test.expected, got)) outcome = 'correct';
  // A number said on its own only answers a question, so it acts on nothing without one.
  else if (PAGE_ACTIONS.has(got.type) && !(got.type === 'choose' && got.bare)) outcome = 'unsafe';
  else outcome = 'abstained';
  // An abstention can offer a control for a yes ("Did you mean …?"): one more word when it offers the one meant.
  let offer;
  if (outcome === 'abstained' && got.type === 'unknown' && got.alike) {
    const { heardAs: _as, heardName: _name, ...offered } = got.alike;
    offer = matches(test.expected, offered) || sameTick(test, test.expected, offered) ? 'right' : 'wrong';
  }
  return { ...test, got: { ...got, choose: undefined }, outcome, ...(offer ? { offer } : {}) };
}

function summarize(results, name) {
  const summary = { suite: name, total: results.length, correct: 0, unsafe: 0, abstained: 0, offered: 0, misoffered: 0, categories: {} };
  for (const result of results) {
    summary[result.outcome]++;
    if (result.offer) summary[result.offer === 'right' ? 'offered' : 'misoffered']++;
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
