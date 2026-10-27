import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, interpret, matchScore, parseNumber } from '../src/web/interpreter.js';

const element = (id, name, role, extra = {}) => ({ id, name, role, distance: id === 1 ? 0 : id * 10, editable: false, ...extra });
const context = (...elements) => ({ elements });

test('control words are recognized before anything else', () => {
  for (const [said, type] of [['Cancel', 'cancel'], ['stop', 'cancel'], ['never mind', 'cancel'], ['pause', 'pause'], ['Resume', 'resume'],
    ['yes', 'confirm'], ['confirm', 'confirm'], ['no', 'deny'], ['go back', 'back'], ['back', 'back'], ['go forward', 'forward']]) {
    assert.equal(interpret(said, context()).type, type, said);
  }
});

test('numbers and ordinals answer questions or pick numbered elements', () => {
  assert.equal(parseNumber('three'), 3);
  assert.equal(parseNumber('number 12'), 12);
  assert.equal(parseNumber('the second'), 2);
  assert.equal(parseNumber('the second link'), null);
  assert.equal(parseNumber('second'), 2);
  assert.deepEqual(interpret('number two', context()), { type: 'choose', index: 2 });
  assert.deepEqual(interpret('click 3', context()), { type: 'choose', index: 3 });
  // Without a verb a number or ordinal is marked bare: it answers a question but never activates on its own.
  assert.deepEqual(interpret('first one', context()), { type: 'choose', index: 1, bare: true });
  assert.deepEqual(interpret('two', context()), { type: 'choose', index: 2, bare: true });
});

test('names resolve to the uniquely best element, with an optional verb and role hint', () => {
  const page = context(element(1, 'Pricing', 'link'), element(2, 'Sign in', 'button'), element(3, 'Pricing plans for teams', 'link'));
  assert.deepEqual(interpret('open pricing', page), { type: 'activate', targetId: 1 });
  assert.deepEqual(interpret('Sign in', page), { type: 'activate', targetId: 2 });
  assert.deepEqual(interpret('click the sign in button', page), { type: 'activate', targetId: 2 });
  assert.equal(interpret('open teams', page).targetId, 3);
  assert.equal(interpret('open careers', page).type, 'unknown');
  assert.match(interpret('open careers', page).message, /No control called "careers"/);
  assert.match(interpret('make me a sandwich', page).message, /not understood/);
});

test('equally good matches ask a numbered question whose answer performs the action', () => {
  const page = context(element(1, 'Read more', 'link'), element(2, 'Read more', 'link'), element(3, 'Contact', 'link'));
  const question = interpret('read more', page);
  assert.equal(question.type, 'clarify');
  assert.deepEqual(question.candidates.map(candidate => candidate.number), [1, 2]);
  assert.deepEqual(question.candidates[0], { number: 1, label: 'Read more', elementId: 1 });
  assert.match(question.message, /1: Read more; 2: Read more/);
  assert.deepEqual(question.choose(2), { type: 'activate', targetId: 2 });
});

test('word order matters for near-identical option names', () => {
  assert.ok(matchScore('price low to high', 'Price, low to high') > matchScore('price low to high', 'Price, high to low') + 0.1);
  const select = element(1, 'Sort by', 'combobox', { options: ['Newest', 'Price, low to high', 'Price, high to low'] });
  assert.deepEqual(interpret('choose price low to high', context(select)),
    { type: 'select-option', targetId: 1, optionIndex: 1, optionName: 'Price, low to high' });
  const options = interpret('select price', context(select));
  assert.equal(options.type, 'clarify', 'a partial name does not silently pick an option');
  assert.deepEqual(options.candidates.map(candidate => candidate.label), ['Price, low to high', 'Price, high to low']);
  assert.deepEqual(options.choose(2), { type: 'select-option', targetId: 1, optionIndex: 2, optionName: 'Price, high to low' });
});

test('deictic words use the element under the circle center, otherwise ask', () => {
  const page = context(element(1, 'Save', 'button'), element(2, 'Share', 'button'));
  assert.deepEqual(interpret('click that', page), { type: 'activate', targetId: 1 });
  const nothingTouching = context({ ...element(1, 'Save', 'button'), distance: 5 }, element(2, 'Share', 'button'));
  assert.equal(interpret('click this', nothingTouching).type, 'clarify');
});

test('dictation keeps wording and targets a named, focused, or touched field', () => {
  const page = context(element(1, 'Name', 'textbox', { editable: true }), element(2, 'Message', 'textbox', { editable: true }));
  assert.deepEqual(interpret('Type Ada Lovelace', page), { type: 'edit', targetId: 1, edit: { kind: 'append', text: 'Ada Lovelace' } });
  assert.deepEqual(interpret('type Meet me in the park', page).edit, { kind: 'append', text: 'Meet me in the park' }, 'unquoted "in" is dictation');
  assert.deepEqual(interpret('type hello there into message', page), { type: 'edit', targetId: 2, edit: { kind: 'append', text: 'hello there' } });
  assert.deepEqual(interpret('write "Hi, Sam!" in the message field', page), { type: 'edit', targetId: 2, edit: { kind: 'append', text: 'Hi, Sam!' } });
  assert.equal(interpret('type hi', { ...page, focusedId: 2 }).targetId, 2);
  assert.match(interpret('type hi', context(element(1, 'Go', 'button'))).message, /No text field/);
});

test('corrections map to explicit edit operations', () => {
  const page = { ...context(element(1, 'Message', 'textbox', { editable: true })), focusedId: 1 };
  assert.deepEqual(interpret('delete last word', page).edit, { kind: 'delete-word' });
  assert.deepEqual(interpret('clear it', page).edit, { kind: 'clear' });
  assert.deepEqual(interpret('clear the message field', page).edit, { kind: 'clear' });
  assert.deepEqual(interpret('replace Tuesday with Friday', page).edit, { kind: 'replace', find: 'Tuesday', text: 'Friday' });
  assert.deepEqual(interpret('change it to Thanks!', page).edit, { kind: 'replace-all', text: 'Thanks!' });
  assert.deepEqual(interpret('new line', page).edit, { kind: 'append', text: '\n', raw: true });
  assert.deepEqual(interpret('undo', page).edit, { kind: 'undo' });
});

test('search prefers a nearby search field, then the page search field', () => {
  const pageSearch = element(0, 'Search books', 'searchbox', { editable: true });
  assert.deepEqual(interpret('search for river songs', { elements: [element(1, 'Home', 'link')], pageSearch }),
    { type: 'search', targetId: 0, text: 'river songs' });
  const nearby = element(1, 'Search catalog', 'searchbox', { editable: true });
  assert.equal(interpret('search for maps', { elements: [nearby], pageSearch }).targetId, 1);
});

test('scrolling takes direction and size', () => {
  assert.deepEqual(interpret('scroll down', context()), { type: 'scroll', direction: 'down', amount: 'page' });
  assert.deepEqual(interpret('scroll up a bit', context()), { type: 'scroll', direction: 'up', amount: 'small' });
  assert.deepEqual(interpret('scroll the list right', context()), { type: 'scroll', direction: 'right', amount: 'page', kind: 'list' });
  // Named kinds of region can be found away from the gaze; the page and generic names stay as they were.
  assert.equal(interpret('scroll the side bar down', context()).kind, 'sidebar');
  assert.equal(interpret('scroll the navigation down a bit', context()).kind, 'menu');
  assert.equal(interpret('scroll the messages up', context()).kind, 'chat');
  assert.equal(interpret('scroll the comments down', context()).kind, 'comments');
  assert.deepEqual(interpret('scroll the page down', context()), { type: 'scroll', direction: 'down', amount: 'page', scope: 'page' });
  assert.deepEqual(interpret('scroll the area down', context()), { type: 'scroll', direction: 'down', amount: 'page' });
  assert.deepEqual(interpret('scroll to the top', context()), { type: 'scroll', direction: 'top', amount: 'page' });
  assert.deepEqual(interpret('page down', context()), { type: 'scroll', direction: 'down', amount: 'page' });
});

test('submit targets the focused field or the only form control near gaze', () => {
  const page = context(element(1, 'Send', 'button', { submits: true }), element(2, 'Home', 'link'));
  assert.deepEqual(interpret('submit', page), { type: 'submit', targetId: 1 });
});

test('applyEdit implements corrections and reports impossible ones as null', () => {
  assert.equal(applyEdit('', { kind: 'append', text: 'Hi' }), 'Hi');
  assert.equal(applyEdit('Hi', { kind: 'append', text: 'there' }), 'Hi there');
  assert.equal(applyEdit('Hi ', { kind: 'append', text: 'there' }), 'Hi there');
  assert.equal(applyEdit('Hi', { kind: 'append', text: '\n', raw: true }), 'Hi\n');
  assert.equal(applyEdit('one two three', { kind: 'delete-word' }), 'one two');
  assert.equal(applyEdit('one', { kind: 'delete-word' }), '');
  assert.equal(applyEdit('see you Tuesday', { kind: 'replace', find: 'tuesday', text: 'Friday' }), 'see you Friday');
  assert.equal(applyEdit('see you', { kind: 'replace', find: 'Monday', text: 'Friday' }), null);
  assert.equal(applyEdit('new', { kind: 'undo' }, ['old']), 'old');
  assert.equal(applyEdit('new', { kind: 'undo' }, []), null);
  assert.equal(applyEdit('anything', { kind: 'clear' }), '');
});

test('tracking and calibration commands are recognized without colliding with cancel or pause', () => {
  for (const said of ['use camera', 'Start eye tracking', 'switch to the webcam', 'camera mode']) {
    assert.deepEqual(interpret(said, context()), { type: 'tracking', source: 'camera' }, said);
  }
  for (const said of ['use pointer', 'switch to mouse', 'stop camera', 'turn off the webcam']) {
    assert.deepEqual(interpret(said, context()), { type: 'tracking', source: 'pointer' }, said);
  }
  assert.deepEqual(interpret('recalibrate', context()), { type: 'calibrate' });
  assert.deepEqual(interpret('calibrate camera', context()), { type: 'calibrate' });
  assert.equal(interpret('stop', context()).type, 'cancel');
  assert.equal(interpret('stop listening', context()).type, 'pause');
});

test('"next page" follows a pagination link in or near the circle; without one only "previous page" uses history', () => {
  const results = context(element(1, 'Next page : 2 of 628', 'link'), element(2, 'Previous page : 1 of 628', 'link'), element(3, 'Passports', 'link'));
  assert.deepEqual(interpret('next page', results), { type: 'activate', targetId: 1 });
  assert.deepEqual(interpret('go to the next page', results), { type: 'activate', targetId: 1 });
  assert.deepEqual(interpret('previous page', results), { type: 'activate', targetId: 2 });
  assert.deepEqual(interpret('next page', context(element(4, '»', 'link'))), { type: 'activate', targetId: 4 });
  assert.deepEqual(interpret('next page', context(element(5, 'Go to next page', 'button'))), { type: 'activate', targetId: 5 });
  // A "Next steps" heading link is not pagination, and no pager means history.
  assert.equal(interpret('next page', context(element(6, 'Nextcloud', 'link'))).type, 'unknown');
  assert.equal(interpret('next page', context(element(7, 'Next steps', 'heading'))).type, 'unknown');
  assert.equal(interpret('previous page', context()).type, 'back');
  assert.equal(interpret('next page', context()).type, 'unknown');
  assert.equal(interpret('go forward', context()).type, 'forward');
  assert.deepEqual(interpret('next page', { elements: [], nearby: [element(101, 'Next', 'link')] }), { type: 'activate', targetId: 101, outside: true });
  const two = interpret('next page', { elements: [], nearby: [element(101, 'Next', 'link'), element(102, 'Next ›', 'button')] });
  assert.deepEqual([two.type, two.candidates.map(candidate => candidate.number)], ['clarify', [1, 2]]);
});

test('"close" closes an open toggle or uses a Close control; otherwise the words name a control as usual', () => {
  const menu = element(1, 'Hide navigation menu', 'button', { expanded: true });
  assert.deepEqual(interpret('close the menu', context(menu, element(2, 'Menu help', 'link'))), { type: 'activate', targetId: 1 });
  assert.deepEqual(interpret('close it', context(menu)), { type: 'activate', targetId: 1 });
  assert.deepEqual(interpret('hide the filters', context(element(3, 'Filter and sort', 'button', { expanded: true }))), { type: 'activate', targetId: 3 });
  assert.equal(interpret('hide the cart', context(element(3, 'Filter and sort', 'button', { expanded: true }))).type, 'unknown',
    'a name that does not match the open toggle is not guessed');
  assert.deepEqual(interpret('close', context(element(4, '×', 'button'), element(5, 'Subscribe', 'button'))), { type: 'activate', targetId: 4 });
  assert.deepEqual(interpret('dismiss the banner', context(element(6, 'Dismiss banner', 'button'))), { type: 'activate', targetId: 6 });
  assert.deepEqual(interpret('collapse cabinet office', context(element(7, 'Cabinet Office', 'button', { expanded: true }))), { type: 'disclosure', targetId: 7, expanded: false });
  // A closed toggle is not "closed" again, and "close account" stays an ordinary (consequential) control name.
  assert.equal(interpret('close the menu', context(element(8, 'Show navigation menu', 'button', { expanded: false }))).type, 'unknown');
  assert.deepEqual(interpret('close account', context(element(9, 'Close account', 'button', { consequential: true }))), { type: 'activate', targetId: 9 });
});

test('a name qualified in brackets right after the spoken words ranks below the unqualified one', () => {
  const suggestions = context(element(1, 'Ada Lovelace English mathematician (1815–1852)', 'option'), element(2, 'Ada Lovelace (microarchitecture) GPU microarchitecture by Nvidia', 'option'));
  assert.deepEqual(interpret('choose Ada Lovelace', suggestions), { type: 'activate', targetId: 1 });
  assert.ok(matchScore('ada lovelace', 'Ada Lovelace (microarchitecture)') < matchScore('ada lovelace', 'Ada Lovelace English mathematician'));
  // Asking for the qualified one still finds it.
  assert.deepEqual(interpret('choose Ada Lovelace microarchitecture', suggestions), { type: 'activate', targetId: 2 });
});


test('spoken selection and explicit insertion preserve wording and ordinary dictation', () => {
  const page = { elements: [element(1, 'Message', 'textbox', { editable: true })], focusedId: 1 };
  for (const [said, position] of [['select all text', 'all'], ['move cursor to the start', 'start'], ['move the cursor to end', 'end']]) {
    assert.deepEqual(interpret(said, page), { type: 'select-text', targetId: 1, position });
  }
  assert.deepEqual(interpret('insert Hi, Sam! at the cursor', page).edit, { kind: 'insert-selection', text: 'Hi, Sam!', requireSelection: false });
  assert.deepEqual(interpret('replace selected text with Friday!', page).edit, { kind: 'insert-selection', text: 'Friday!', requireSelection: true });
  assert.deepEqual(interpret('insert hello', page).edit, { kind: 'append', text: 'hello' });
  const ambiguous = interpret('select all text', { elements: [element(1, 'Name', 'textbox', { editable: true, distance: 5 }), element(2, 'Message', 'textbox', { editable: true })] });
  assert.equal(ambiguous.type, 'clarify');
  assert.deepEqual(ambiguous.choose(2), { type: 'select-text', targetId: 2, position: 'all' });
});


test('selection commands retain a focused read-only field instead of redirecting to its neighbor', () => {
  const page = { elements: [element(1, 'Locked message', 'textbox'), element(2, 'Other message', 'textbox', { editable: true })], focusedId: 1 };
  assert.equal(interpret('insert hello at the cursor', page).targetId, 1);
  assert.equal(interpret('select all text', page).targetId, 1);
  assert.equal(interpret('move cursor to end', page).targetId, 1);
  assert.equal(interpret('replace selected text with hello', page).targetId, 1);
});

test('terminal speech punctuation does not turn explicit insertion into append', () => {
  const page = { elements: [element(1, 'Message', 'textbox', { editable: true })], focusedId: 1 };
  for (const suffix of ['.', '!', '?', '…']) {
    assert.deepEqual(interpret('insert "Hi, Sam!" at the cursor' + suffix, page).edit,
      { kind: 'insert-selection', text: 'Hi, Sam!', requireSelection: false });
  }
});


test('ordinary text commands retain focused noneditable text fields instead of editing neighbors', () => {
  const page = { elements: [element(1, 'Locked message', 'textbox'), element(2, 'Other message', 'textbox', { editable: true })], focusedId: 1 };
  for (const said of ['type hello', 'clear it', 'replace Tuesday with Friday', 'change it to Hello', 'delete last word', 'new line', 'undo']) {
    assert.equal(interpret(said, page).targetId, 1, said);
  }
  assert.equal(interpret('type hello into other message', page).targetId, 2);
  assert.equal(interpret('type hello in the locked message field', page).targetId, 1);
  assert.equal(interpret('change locked message to Hello', page).targetId, 1);
});

test('named readonly fields participate in target resolution without redirecting fuzzy matches', () => {
  const page = { elements: [element(1, 'Message', 'textbox'), element(2, 'Message notes', 'textbox', { editable: true })], focusedId: 2 };
  assert.equal(interpret('type hello into message', page).targetId, 1);
  assert.equal(interpret('clear the message field', page).targetId, 1);
  assert.equal(interpret('change message to Hello', page).targetId, 1);
  assert.equal(interpret('type hello into message notes', page).targetId, 2);
});

test('phrase selection preserves literal text and explicitly numbers repeated occurrences', () => {
  const page = { elements: [element(1, 'Message', 'textbox', { editable: true })], focusedId: 1 };
  for (const [said, text, occurrence] of [
    ['select text Tuesday', 'Tuesday', null],
    ['select text "a+b [x]".', 'a+b [x]', null],
    ['select text " next "', ' next ', null],
    ['select the second occurrence of Tuesday', 'Tuesday', 2],
    ['select 12th occurrence of "Hi!"', 'Hi!', 12],
    ['select last occurrence of café', 'café', 'last'],
  ]) assert.deepEqual(interpret(said, page), { type: 'select-text', targetId: 1, position: 'phrase', text, occurrence }, said);
  assert.deepEqual(interpret('select all text', page), { type: 'select-text', targetId: 1, position: 'all' });
});

test('phrase selection retains readonly identity and ordinary field clarification', () => {
  const fields = [element(1, 'Locked message', 'textbox', { distance: 5 }), element(2, 'Other message', 'textbox', { editable: true, distance: 5 })];
  assert.equal(interpret('select text Tuesday', { elements: fields, focusedId: 1 }).targetId, 1);
  const asked = interpret('select second occurrence of Tuesday', { elements: fields });
  assert.equal(asked.type, 'clarify');
  assert.deepEqual(asked.choose(2), { type: 'select-text', targetId: 2, position: 'phrase', text: 'Tuesday', occurrence: 2 });
});


test('literal phrase selection keeps trailing words that resemble polite command filler', () => {
  const page = { elements: [element(1, 'Message', 'textbox', { editable: true })], focusedId: 1 };
  for (const suffix of ['please', 'for me']) {
    assert.equal(interpret('select text next ' + suffix, page).text, 'next ' + suffix);
    assert.equal(interpret('select second occurrence of next ' + suffix, page).text, 'next ' + suffix);
  }
});

test('explicit slider values preserve signed decimals and never become text dictation', () => {
  const page = context(element(1, 'Volume', 'slider'), element(2, 'Message', 'textbox', { editable: true }));
  assert.deepEqual(interpret('set Volume slider to 40', page), { type: 'range', targetId: 1, value: 40 });
  assert.deepEqual(interpret('please set the slider to -0.25', page), { type: 'range', targetId: 1, value: -0.25 });
  assert.deepEqual(interpret('undo Volume slider', page), { type: 'range', targetId: 1, undo: true });
  assert.deepEqual(interpret('undo slider', page), { type: 'range', targetId: 1, undo: true });
  for (const value of ['NaN', 'loud', '1e3', 'infinity']) assert.equal(interpret(`set slider to ${value}`, page).type, 'unknown');
  assert.equal(interpret('set slider to 40', context(element(1, 'Message', 'textbox', { editable: true }))).type, 'unknown');
  assert.deepEqual(interpret('set message to 40', page), { type: 'edit', targetId: 2, edit: { kind: 'replace-all', text: '40' } });
});

test('explicit slider ambiguity carries the exact value or Undo until deliberate choice', () => {
  const page = context({ ...element(1, 'Volume', 'slider'), distance: 20 }, element(2, 'Volume', 'slider'));
  const question = interpret('set Volume slider to 40', page);
  assert.equal(question.type, 'clarify');assert.deepEqual(question.choose(2), { type: 'range', targetId: 2, value: 40 });
  assert.deepEqual(interpret('undo Volume slider', page).choose(1), { type: 'range', targetId: 1, undo: true });
});

test('explicit checkbox state survives interpretation and does not become a generic click', () => {
  const page=context(element(1,'Newsletter','checkbox'),element(2,'Check balance','button'));
  for (const word of ['check','tick']) assert.deepEqual(interpret(`${word} Newsletter`,page),{type:'check',targetId:1,checked:true});
  for (const word of ['uncheck','untick']) assert.deepEqual(interpret(`${word} that checkbox`,page),{type:'check',targetId:1,checked:false});
  assert.deepEqual(interpret('click Newsletter',page),{type:'activate',targetId:1});
  assert.equal(interpret('check balance',page).type,'unknown');
});

test('checkbox state preserves reading-order ordinal requests', () => {
  const page=context(element(1,'Newsletter','checkbox'),element(2,'Offers','checkbox'));
  assert.deepEqual(interpret('check second checkbox',page),{type:'check',targetId:2,checked:true});
  assert.deepEqual(interpret('uncheck first checkbox',page),{type:'check',targetId:1,checked:false});
});

test('the established checkout phrase retains ordinary consequential activation', () => {
  const page=context(element(1,'Check out now','button',{consequential:true}));
  assert.deepEqual(interpret('check out now',page),{type:'activate',targetId:1});
});

test('explicit disclosure requests retain state and preserve unsupported intended targets', () => {
  const page = context(element(1, 'FAQ', 'button'), element(2, 'FAQ details', 'button', { expanded: false }));
  for (const said of ['expand FAQ', 'expand that', 'expand first panel']) assert.deepEqual(interpret(said, page), {type:'disclosure', targetId:1, expanded:true}, said);
  assert.deepEqual(interpret('collapse FAQ details', page), {type:'disclosure', targetId:2, expanded:false});
  assert.deepEqual(interpret('expand second panel', page), {type:'disclosure', targetId:2, expanded:true});
  const ask = interpret('expand FAQ', context(element(1, 'FAQ', 'button'),element(2, 'FAQ', 'button', {expanded:false})));
  assert.equal(ask.type, 'clarify'); assert.deepEqual(ask.choose(2), {type:'disclosure',targetId:2,expanded:true});
  assert.equal(interpret('expand missing', page).type, 'unknown');
  assert.equal(interpret('expand missing', page).targetQuery, undefined);
  assert.deepEqual(interpret('click FAQ',page), {type:'activate',targetId:1});
});

test('explicit selected-text deletion stays typed and preserves unavailable intended fields',()=>{
 const page=context(element(1,'Message','textbox',{editable:true}));for(const text of ['delete selected text','remove the selected text','erase highlighted text','delete selected text from Message'])assert.deepEqual(interpret(text,page),{type:'delete-selection',targetId:1});
 const blocked=element(13,'Locked message','textbox');assert.deepEqual(interpret('delete selected text',{...page,disclosureElements:[blocked,...page.elements],selectionFocusedId:13}),{type:'delete-selection',targetId:13});
 const unknown=interpret('delete selected text from Missing',page);assert.equal(unknown.type,'unknown');assert.equal(unknown.unparsed,undefined);assert.equal(unknown.targetQuery,undefined);
});

test('explicit page scrolling retains page scope while ordinary region scrolling stays contextual', () => {
  for (const [said, direction] of [['scroll the page down', 'down'], ['scroll page right a bit', 'right'], ['go to the bottom of the page', 'bottom']]) {
    const action = interpret(said, context());
    assert.equal(action.type, 'scroll');
    assert.equal(action.scope, 'page');
    assert.equal(action.direction, direction);
  }
  assert.equal(interpret('scroll the list down', context()).scope, undefined);
  assert.equal(interpret('scroll down', context()).scope, undefined);
});
