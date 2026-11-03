// Interpretation stage: maps one instruction plus a described gaze context to one typed action.
// Deterministic rules form the baseline; a model interpreter can implement the same contract.
import { spokenDate, spokenMonth, spokenNumber, spokenSliderValue, spokenTime, spokenWeek } from './spoken-values.js';
import { relatedWords } from './topics.js';

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const STOPWORDS = new Set(['the', 'a', 'an', 'on', 'to', 'please', 'my', 'this', 'that', 'link', 'button', 'tab', 'field', 'box', 'checkbox', 'menu', 'option', 'page', 'item', 'input']);
const ROLE_HINTS = { link: ['link'], button: ['button'], tab: ['tab'], checkbox: ['checkbox', 'switch'], box: ['checkbox', 'textbox', 'searchbox'], field: ['textbox', 'searchbox', 'combobox'], menu: ['combobox', 'menuitem'], option: ['option', 'combobox', 'radio'] };
// Scores closer than this are treated as equally plausible and trigger a question.
const MARGIN = 0.05;
// A match below this shares only some of the words said; a control named this well just outside the circle wins.
const STRONG = 0.8;
const DEICTIC = /^(this|that|it|here|there|this one|that one)$/;
const ACTIVATE_VERB = /^(?:click|tap|press|push|hit|open up|open|follow|select|choose|pick|activate|check|uncheck|tick|untick|toggle|expand|collapse|go to|navigate to|take me to|show me|bring up|show|view|visit|see|load|go)\s+(?:on\s+)?/;
// Politeness and lead-ins that carry no instruction; dictated text keeps everything after its verb.
const LEADING_FILLER = /^(?:(?:please|ok|okay|now|hey|so|um|uh)\s+|(?:can|could|would|will) you(?: please)?\s+|(?:i(?:'d| would) like to|i want to|i need to|let's|let me|go ahead and)\s+)+/i;
// "Thanks" is not stripped: it is often the content ("change it to Thanks").
const TRAILING_FILLER = /(?:\s+(?:please|for me))+$/i;
const ORDINAL = /^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d{1,2}(?:st|nd|rd|th))\s+(.+)$/;
// Common equivalent names for the same control.
const SYNONYMS = [['log in', 'sign in'], ['login', 'sign in'], ['log on', 'sign in'], ['log out', 'sign out'], ['logout', 'sign out'], ['log off', 'sign out'],
  ['sign up', 'register'], ['create account', 'register'], ['basket', 'cart'], ['bag', 'cart'], ['shopping cart', 'cart'],
  ['home page', 'home'], ['homepage', 'home'], ['main page', 'home'], ['start page', 'home'],
  ['past versions', 'history'], ['previous versions', 'history'], ['old versions', 'history'], ['revisions', 'history'], ['revision history', 'history'],
  ['version history', 'history'], ['edit history', 'history'],
  ['preferences', 'settings'], ['options', 'settings'], ['frequently asked questions', 'faq'],
  ['get in touch', 'contact'], ['contact us', 'contact'], ['my account', 'account'], ['profile', 'account'],
  ['navigation', 'menu'], ['nav', 'menu'], ['dark theme', 'dark mode'], ['alerts', 'notifications'], ['inbox', 'messages']];
// "The stuff about cars", "information on visas": the topic is what names the control, not the lead-in.
const TOPIC_LEAD = /^(?:(?:the|some|any|more|all the)\s+)?(?:stuff|things?|bits?|parts?|sections?|pages?|areas?|info|information|details|something|anything|everything|articles?|guidance|advice)\s+(?:about|on|for|regarding|related to|to do with|around|concerning)\s+(.+)$/;
// Words that carry no topic: what is left of a lead-in, and joining words.
const TOPIC_FILLER = new Set(['stuff', 'thing', 'info', 'information', 'detail', 'section', 'part', 'bit', 'area', 'about', 'regarding', 'related', 'and', 'or', 'of', 'for', 'with', 'in', 'my', 'some', 'any', 'all']);
// A word for the same topic as a word on a control ("cars" for "Driving") counts this much of a word the control says.
const RELATED_CREDIT = 0.75;
// "Of this page", "on this site": the scope a person adds is not part of a control's name.
const SCOPE_SUFFIX = / (?:of|on|for|in|from) (?:this|the|that) (?:page|site|website|article|screen)$/;

export const normalize = text => text.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}'\s]+/gu, ' ').replace(/\s+/g, ' ').trim();

function tokens(text) {
  return normalize(text).split(' ').filter(token => token && !STOPWORDS.has(token))
    .map(token => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token));
}

export function parseNumber(text) {
  const word = normalize(text).replace(/^the\s+/, '').replace(/^(?:number|option|choice|item)\s+/, '').replace(/\s+one$/, '');
  if (/^\d{1,2}$/.test(word)) return Number(word);
  const index = Math.max(NUMBERS.indexOf(word), ORDINALS.indexOf(word));
  return index > 0 ? index : null;
}

// 1 for an exact name, high for a contained phrase, otherwise weighted token overlap.
export function matchScore(query, name) {
  const q = normalize(query);
  const n = normalize(name);
  if (!q || !n) return 0;
  if (q === n) return 1;
  const qTokens = tokens(query);
  const nTokens = tokens(name);
  if (!qTokens.length || !nTokens.length) return 0;
  if (` ${n} `.includes(` ${q} `)) {
    // "Ada Lovelace (microarchitecture)" is a more specific thing than the "Ada Lovelace" that was asked for.
    const raw = name.toLowerCase(), at = raw.indexOf(query.toLowerCase().trim());
    return at >= 0 && /^\s*\(/.test(raw.slice(at + query.trim().length)) ? 0.84 : 0.9;
  }
  const shared = qTokens.filter(token => nTokens.includes(token)).length;
  // Word overlap stays below a contained phrase, so reordered words ("high to low") never tie an exact name.
  return 0.7 * (shared / qTokens.length) + 0.1 * (shared / nTokens.length);
}

// How well a topic request fits a control's name when some of its words are only related to the name's words
// ("cars" and "Driving and transport"); 0 when no related word helps, which plain word matching already covers.
export function topicScore(query, name) {
  const asked = tokens(query).filter(token => !TOPIC_FILLER.has(token)), named = tokens(name);
  if (!asked.length || !named.length) return 0;
  let credit = 0, related = false;
  const covered = new Set();
  for (const word of asked) {
    if (named.includes(word)) { credit += 1; covered.add(word); continue; }
    const near = relatedWords(word), found = named.filter(other => near.has(other));
    if (!found.length) continue;
    credit += RELATED_CREDIT; related = true;
    for (const other of found) covered.add(other);
  }
  return related ? 0.7 * (credit / asked.length) + 0.1 * (covered.size / new Set(named).size) : 0;
}

// Synonyms apply both ways: a site may label its control "Log in" or "Sign in" whichever the user says. Each variant
// has a weight: a synonym or a dropped scope counts a little less than the words actually said, so "options"
// prefers Options to Settings. A topic lead-in ("the stuff about cars") is dropped at full weight.
function variants(query) {
  const scoped = normalize(query), unscoped = scoped.replace(SCOPE_SUFFIX, ''), topic = TOPIC_LEAD.exec(unscoped)?.[1];
  const found = [{ text: query, weight: 1 }];
  if (unscoped !== scoped) found.push({ text: unscoped, weight: 0.85 });
  if (topic) found.push({ text: topic, weight: 1 });
  for (const base of [unscoped, ...(topic ? [topic] : [])]) {
    const normalized = ` ${base} `;
    for (const [a, b] of SYNONYMS) {
      for (const [phrase, replacement] of [[a, b], [b, a]]) {
        if (normalized.includes(` ${phrase} `)) found.push({ text: normalized.replace(` ${phrase} `, ` ${replacement} `).trim(), weight: 0.85 });
      }
    }
  }
  return found;
}

// With `topics`, words for the same topic count too ("cars" finds "Driving and transport"); `related` marks a
// control found only that way.
function rank(query, elements, roles, topics = false) {
  const queries = variants(query);
  return elements
    .map(element => {
      let score = Math.max(...queries.map(({ text, weight }) => matchScore(text, element.name) * weight)), related = false;
      const topical = topics ? Math.max(...queries.map(({ text, weight }) => topicScore(text, element.name ?? '') * weight)) : 0;
      if (topical > score) { score = topical; related = true; }
      if (roles && !roles.includes(element.role)) score *= 0.6;
      return { element, score, related };
    })
    .filter(entry => entry.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.element.distance - b.element.distance);
}

// Names compared by sound: lower case letters and digits, a few spellings of the same sound merged, doubled letters
// once. "Sign in" and "signing" are then one letter apart, and so are "Cart" and "card", or "Submit" and "summit".
function soundKey(text) {
  return (text ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '')
    .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/qu/g, 'kw').replace(/x/g, 'ks').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
    .replace(/z/g, 's').replace(/(.)\1+/g, '$1');
}
function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
// The one control whose name (or the start of it) sounds like `query`: within one letter for short names, two for
// long ones. None when the name is very short or two controls are equally close.
function soundsAlike(query, elements) {
  const heard = soundKey(query);
  if (heard.length < 4) return null;
  const allowed = heard.length <= 7 ? 1 : heard.length <= 12 ? 2 : 3;
  let best = null, tie = false;
  for (const element of elements) {
    const words = (element.name ?? '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let distance = Infinity;
    for (let end = 1; end <= words.length; end++) distance = Math.min(distance, editDistance(heard, soundKey(words.slice(0, end).join(' '))));
    if (distance > allowed) continue;
    if (!best || distance < best.distance || (distance === best.distance && element.distance < best.element.distance)) { tie = best?.distance === distance; best = { element, distance }; }
    else if (distance === best.distance) tie = true;
  }
  return best && !tie ? best.element : null;
}

// A unique strong match acts; similarly strong matches become a numbered question.
function resolve(query, elements, roles, act, noun = 'control', topics = false) {
  const ranked = rank(query, elements, roles, topics);
  if (!ranked.length) {
    // Speech recognition often mishears a name ("signing" for Sign in): a control whose name sounds alike is kept
    // with the answer, to be offered as a question only if nothing else is found (see `alike`).
    const like = soundsAlike(query, elements);
    return { type: 'unknown', missing: true, message: `No ${noun} called "${query}" is inside the gaze circle. Look at it and try again.`,
      ...(like ? { alike: { ...act(like), heardName: query } } : {}) };
  }
  const close = ranked.filter(entry => entry.score >= ranked[0].score - MARGIN);
  if (close.length > 1) return { ...clarify(close.map(entry => entry.element), act), ...(ranked[0].score < STRONG ? { weak: true } : {}) };
  const action = act(ranked[0].element);
  return { ...action, ...(ranked[0].related ? { related: true } : {}), ...(ranked[0].score < STRONG ? { weak: true } : {}) };
}

// Candidates carry the number to say, a label, and the page element to outline when there is one.
function question(candidates, choose) {
  return {
    type: 'clarify', candidates, choose,
    message: `Which one? ${candidates.map(candidate => `${candidate.number}: ${candidate.label}`).join('; ')}. Say a number or cancel.`,
  };
}

function clarify(elements, act) {
  return question(
    elements.map(element => ({ number: element.id, label: element.name || element.role, elementId: element.id })),
    number => act(elements.find(element => element.id === number)),
  );
}

// "It" refers back to the control just used ("tick lettuce", then "untick it"), while "this" and "that" point where the
// person is looking. The controller supplies that control as `context.previous` while it is recent and on the page.
function previous(context, subject, roles = null) {
  const prior = context.previous;
  return subject === 'it' && prior && (!roles || roles.includes(prior.role)) ? prior : null;
}

function deictic(elements, act, noun = 'control') {
  if (!elements.length) return { type: 'unknown', message: `No ${noun} is inside the gaze circle.` };
  const touching = elements.filter(element => element.distance === 0);
  if (elements.length === 1 || touching.length === 1) return act(touching[0] ?? elements[0]);
  return clarify(touching.length ? touching : elements, act);
}

// Keep nonwritable text targets in intent resolution: filtering them out can redirect
// an edit into a different field. Execution checks current DOM writability.
function textField(element) {
  return element.editable || ['textbox', 'searchbox'].includes(element.role) ||
    element.element?.tagName === 'TEXTAREA' ||
    (element.element?.tagName === 'INPUT' && element.element.readOnly);
}

// The field being typed in when the gaze has drifted off it: a correction of words it contains is about that field.
// A password field's text is never read, so it is never chosen this way.
function typingIn(context, find) {
  const field = context.focusedField;
  return field && textField(field) && !field.sensitive && find && normalize(field.value ?? '').includes(normalize(find)) ? field : null;
}

// Explicit continuation names the focused field, independently of gaze. Never recover a sensitive field.
function continuingIn(context) {
  const field = context.elements.find(element => element.id === context.focusedId && textField(element)) ?? context.focusedField;
  return field && textField(field) && !field.sensitive ? field : null;
}

// `recover`: new text for an unnamed field may go to a field just outside the circle (see typingElsewhere).
// Dictated text that is clearly an email address, a phone number, a postcode or a street address. Speech often
// spells an address out ("jo at example dot com"); an email field takes it as written.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const asEmail = text => text.trim().replace(/\s+at\s+/gi, '@').replace(/\s+dot\s+/gi, '.').replace(/\s+/g, '');
function textKind(text) {
  const said = text.trim();
  if (EMAIL.test(said) || (/\sat\s/i.test(said) && EMAIL.test(asEmail(said)))) return 'email';
  // A phone number has 10 to 13 digits (fewer is likely a code or an amount, more a card number), and is not a date.
  const digits = (said.match(/\d/g) ?? []).length;
  if (/^\+?[\d\s().-]+$/.test(said) && digits >= 10 && digits <= 13 && !/^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}$/.test(said)) return 'tel';
  // A UK postcode, or a ZIP+4 code; five digits alone could be any number.
  if (/^[a-z]{1,2}\d[a-z\d]? ?\d[a-z]{2}$/i.test(said) || /^\d{5}-\d{4}$/.test(said)) return 'postal-code';
  // A house number, a name of up to four words, and a street word: "12 High Street", "221B Baker St", but not
  // "5 apples on the way".
  const street = said.match(STREET)?.[1].toLowerCase().split(/\s+/);
  if (street && street.length <= 4 && !street.some(word => NOT_STREET_NAMES.has(word))) return 'street';
  return null;
}
const STREET = /^\d+[a-z]?,?\s+(.+?)\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|way|close|court|ct|place|pl|boulevard|blvd|terrace|crescent|grove|square|row|hill|parade|gardens|mews)\.?$/i;
const NOT_STREET_NAMES = new Set(['the', 'a', 'an', 'on', 'in', 'of', 'to', 'up', 'at', 'for', 'with', 'by', 'from', 'my', 'our', 'your', 'his', 'her', 'their', 'times', 'and', 'or', 'is', 'was']);
// Text written into a field: an email field takes a spelled-out address as an address.
const writing = (kind, text) => element => edit(kind, { text: element.holds === 'email' && EMAIL.test(asEmail(text)) && !EMAIL.test(text.trim()) ? asEmail(text) : text })(element);

// A spoken date typed into one of a Day, Month and Year group of boxes fills all three; other text is typed as said.
function intoDateBoxes(text, act, now = new Date()) {
  const date = spokenDate(text, now), whole = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const into = element => (whole && element.dateParts ? { type: 'date-parts', targetId: element.id, value: whole } : act(element));
  // Any box of one date group takes the whole date, so its boxes never need telling apart.
  into.sameDate = whole ? fields => fields.length > 1 && fields.every(field => field.dateParts && field.dateParts.day === fields[0].dateParts.day) : null;
  return into;
}

function chooseField(fieldName, context, act, { recover = false, kind = null } = {}) {
  let fields = context.elements.filter(textField);
  if (fieldName) return resolve(fieldName, fields, null, act, 'text field');
  if (recover && !fields.length) return { type: 'unknown', message: 'No text field is inside the gaze circle.', fieldMiss: true };
  if (act.sameDate?.(fields)) fields = [fields.reduce((a, b) => (b.distance < a.distance ? b : a))];
  // Text of a clear kind (an email address, "12 High Street") goes to the one field asking for it among several, and
  // a field just outside the circle that asks for it is offered when the gaze rests on a field asking for another.
  // The field being typed in keeps text of its own kind, and a box for free text keeps everything said into it; a
  // one-line field just filled (a city) gives way to the field asking for the next thing said (the street).
  const focused = fields.find(element => element.id === context.focusedId);
  if (kind && (!focused || (focused.holds !== kind && focused.holds !== 'text'))) {
    const fitting = fields.filter(element => element.holds === kind);
    if (fields.length > 1 && fitting.length === 1) return act(fitting[0]);
    const near = (context.nearby ?? []).filter(element => textField(element) && element.holds === kind);
    if (fields.length && fields.every(element => element.holds && element.holds !== kind) && near.length === 1) return { ...act(near[0]), far: true };
  }
  if (focused) return act(focused);
  return deictic(fields, act, 'text field');
}

// A focused field that cannot be edited must fail at execution, never silently
// redirect a selection command into a different writable field nearby.
function chooseSelectionField(context, act) {
  const focused = context.elements.find(element => element.id === context.focusedId &&
    (element.editable || ['textbox', 'searchbox'].includes(element.role) || ['INPUT', 'TEXTAREA'].includes(element.element?.tagName)));
  return focused ? act(focused) : chooseField(null, context, act);
}

// Top-to-bottom, left-to-right; described contexts without rectangles keep their numbering.
function readingOrder(elements) {
  return [...elements].sort((a, b) => {
    if (a.rect && b.rect && Math.abs(a.rect.top - b.rect.top) > 8) return a.rect.top - b.rect.top;
    if (a.rect && b.rect && a.rect.left !== b.rect.left) return a.rect.left - b.rect.left;
    return a.id - b.id;
  });
}

// "The second link", "the last Remove": counts in reading order among a role or a repeated name.
function ordinal(word, rest, elements, act) {
  const roles = ROLE_HINTS[rest] ?? (rest === 'item' || rest === 'control' ? null : undefined);
  let pool;
  if (roles !== undefined) pool = roles ? elements.filter(element => roles.includes(element.role)) : elements;
  else {
    const ranked = rank(rest, elements);
    pool = ranked.filter(entry => entry.score >= ranked[0].score - MARGIN).map(entry => entry.element);
  }
  if (!pool.length) return { type: 'unknown', message: `No ${rest} is inside the gaze circle.` };
  const ordered = readingOrder(pool);
  const index = word === 'last' ? ordered.length : parseNumber(word) ?? Number.parseInt(word, 10);
  if (!(index >= 1 && index <= ordered.length)) {
    return { type: 'unknown', message: `There ${ordered.length === 1 ? 'is only one' : `are only ${ordered.length}`} ${rest} in the gaze circle.` };
  }
  return act(ordered[index - 1]);
}

function namedOption(query, selects) {
  for (const select of selects) {
    const name = normalize(select.name ?? '').replace(/[:?]+$/, '');
    if (!name || !query.startsWith(`${name} `)) continue;
    const choice = selectOption(query.slice(name.length + 1).replace(/^(?:to|as|is)\s+/, ''), [select]);
    if (choice) return choice;
  }
  return null;
}

// A value from a dropdown in the circle: unique strong option names act, close ones ask.
function selectOption(optionQuery, selects, selected) {
  const options = selects.flatMap(element => element.options.map((name, optionIndex) => ({ ...element, name, optionIndex, selectId: element.id })));
  const ranked = rank(optionQuery, options);
  if (!ranked.length) return null;
  const pick = option => ({ type: 'select-option', targetId: option.selectId, optionIndex: option.optionIndex, optionName: option.name, ...(typeof selected === 'boolean' ? { selected } : {}) });
  const close = ranked.filter(entry => entry.score >= ranked[0].score - MARGIN).map(entry => entry.element);
  if (close.length === 1 && ranked[0].score >= 0.9) return pick(close[0]);
  if (close.length > 1) {
    return question(close.map((option, index) => ({ number: index + 1, label: option.name, elementId: option.selectId })),
      number => pick(close[number - 1]));
  }
  return null;
}

const edit = (kind, extra = {}) => element => ({ type: 'edit', targetId: element.id, edit: { kind, ...extra } });
const chooseFrom = optionName => element => ({ type: 'choose-option', targetId: element.id, optionName });

function unquote(text) {
  const match = /^["“](.*)["”]$/.exec(text.trim());
  return match ? match[1] : text.trim();
}

// A website address as said: "bbc dot co dot uk slash news" or "wikipedia.org"; null unless it is one. It must end in
// a country code or a common ending, so a file ("report.pdf") or a name with a dot ("Node.js") is not taken for one.
const ENDINGS = new Set('com org net edu gov mil int info biz app dev shop store online site blog news tech xyz art page wiki museum travel jobs pro name mobi asia cloud'.split(' '));
const NOT_COUNTRIES = new Set('js ts md py rb sh go cs gz rs db'.split(' '));
export function spokenAddress(said) {
  const text = said.trim().toLowerCase().replace(/^(?:the\s+)?(?:website\s+|site\s+)?/, '').replace(/\s+dot\s+/g, '.').replace(/\s+slash\s+/g, '/').replace(/\s+/g, '');
  const match = /^(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,24}))(\/[\w\-./?=&%#~+]*)?$/.exec(text);
  if (!match || !(match[2].length === 2 ? !NOT_COUNTRIES.has(match[2]) : ENDINGS.has(match[2]))) return null;
  return `https://${match[1]}${match[3] ?? '/'}`;
}
function browserCommand(command, context) {
  const said = command.trim().toLowerCase().replace(/[.!?]+$/, '');
  // A control on the page named like the address ("Example.com" in a footer) is opened instead.
  const compact = text => (text ?? '').toLowerCase().replace(/[\s/]+/g, '').replace(/^https?:/, '');
  const named = target => [...(context.elements ?? []), ...(context.nearby ?? [])].some(element => compact(element.name) === compact(target.replace(/\s+dot\s+/g, '.')));
  if (/^(?:reload|refresh)(?: (?:the|this) page)?$/.test(said)) return { type: 'reload' };
  let match;
  if ((match = /^(?:open|go to|visit)\s+(.+?)\s+in (?:a )?new tab$/.exec(said))) {
    const url = spokenAddress(match[1]);
    if (url) return { type: 'tab', move: 'new', url };
  }
  if (/^(?:open (?:a )?)?new tab$/.test(said)) return { type: 'unknown', message: 'Say which website to open, for example “open wikipedia dot org in a new tab”. An empty new tab cannot be controlled by the navigator.' };
  if ((match = /^(?:go to|open|visit|navigate to|take me to)\s+(.+)$/.exec(said)) && !named(match[1])) {
    const url = spokenAddress(match[1]);
    if (url) return { type: 'visit', url };
  }
  if ((match = /^(?:go to |go back to |switch to )?(?:the )?(next|previous) tab$/.exec(said))) return { type: 'tab', move: match[1] };
  if (/^close (?:this |the |current )?tab$/.test(said)) return { type: 'tab', move: 'close' };
  if (/^zoom in$|^make (?:the page|the text|everything|this page) (?:bigger|larger)$/.test(said)) return { type: 'zoom', step: 'in' };
  if (/^zoom out$|^make (?:the page|the text|everything|this page) smaller$/.test(said)) return { type: 'zoom', step: 'out' };
  if (/^(?:reset|normal) zoom$|^reset the zoom$|^zoom (?:to )?(?:normal|100 ?(?:%|percent))$|^actual size$/.test(said)) return { type: 'zoom', step: 'reset' };
  if (/^(?:go to )?(?:the )?top of the page$/.test(said)) return { type: 'scroll', direction: 'top', amount: 'page', scope: 'page' };
  if (/^(?:go to )?(?:the )?bottom of the page$/.test(said)) return { type: 'scroll', direction: 'bottom', amount: 'page', scope: 'page' };
  if (/^scroll all the way (up|down)$/.test(said)) return { type: 'scroll', direction: said.endsWith('up') ? 'top' : 'bottom', amount: 'page' };
  return null;
}

// Spoken punctuation in dictation, as dictation software takes it: "hello comma how are you question mark" is
// typed as "hello, how are you?", and the word after a full stop, question mark or exclamation mark, or a new line,
// starts with a capital. A quoted phrase keeps its words ("type “a comma splice”").
const SPOKEN_MARKS = [
  [/\bnew paragraph\b/gi, '\u0000P'], [/\b(?:new line|next line|line break)\b/gi, '\u0000L'],
  [/\b(?:full stop|period)\b/gi, '.'], [/\bquestion mark\b/gi, '?'], [/\bexclamation (?:mark|point)\b/gi, '!'],
  [/\bcomma\b/gi, ','], [/\bsemicolon\b/gi, ';'], [/\bcolon\b/gi, ':'], [/\b(?:ellipsis|dot dot dot)\b/gi, '…'],
  [/\bopen (?:bracket|parenthesis|paren)\b/gi, '\u0000('], [/\bclose (?:bracket|parenthesis|paren)\b/gi, ')'],
  [/\bopen quote\b/gi, '\u0000“'], [/\b(?:close quote|end quote|unquote)\b/gi, '”'],
];
export function punctuate(text) {
  let said = text;
  for (const [words, mark] of SPOKEN_MARKS) said = said.replace(words, mark);
  if (said === text) return text;
  return said
    .replace(/\s+([.,;:?!…)”])/g, '$1') // marks join the word before them
    .replace(/\u0000([(“])\s*/g, ' $1') // opening marks join the word after them
    .replace(/\s*\u0000P\s*/g, '\n\n').replace(/\s*\u0000L\s*/g, '\n')
    .replace(/([.,;:?!…])(?=[^\s.,;:?!…)”\n])/g, '$1 ') // and are followed by a space
    .replace(/(^|[.?!]\s+|\n)(\p{Ll})/gu, (whole, before, letter) => (before ? before + letter.toUpperCase() : whole))
    .replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '');
}
// The words of a dictation as typed: quoted words exactly, others with their spoken punctuation.
const dictated = text => (/^["“](.*)["”]$/.test(text.trim()) ? unquote(text) : punctuate(text.trim()));

// Native value fields that "set <name> to <value>" can reach by name or kind, with what to say.
const TYPED_FIELDS = [
  { matches: element => element.nativeDate === true, type: 'date', noun: 'date', parse: spokenDate, example: '“November first”, “tomorrow” or 2026-11-01' },
  { matches: element => element.nativeTime === true, type: 'time', noun: 'time', parse: spokenTime, example: '“2:30 pm”, “half past nine” or 14:30' },
  { matches: element => element.nativeMonth === true, type: 'month', noun: 'month', parse: spokenMonth, example: '“November 2026”, “next month” or 2026-11' },
  { matches: element => element.nativeWeek === true, type: 'week', noun: 'week', parse: spokenWeek, example: '“week 43”, “next week” or 2026-W43' },
  { matches: element => element.nativeNumber === true, type: 'number', noun: 'number', parse: spokenNumber, example: '“three”, “forty two” or 2.5' },
  { matches: element => element.role === 'slider', type: 'range', noun: 'slider', parse: spokenSliderValue, example: '“forty”, “forty percent” or 40', number: true },
  { matches: element => element.role === 'spinbutton' && element.customRange === true, type: 'range', noun: 'number', parse: spokenNumber, example: '“three”, “forty two” or 2.5', number: true },
];

function typedSet(target, value, context, now) {
  for (const kind of TYPED_FIELDS) {
    const fields = context.elements.filter(kind.matches);
    if (!fields.length) continue;
    // "departure date" names the Departure field by its kind; "the date" or "this date" means the one in view.
    const name = target.replace(new RegExp(`\\s*\\b${kind.noun}$`, 'i'), '').trim();
    const saidKind = name !== target.trim();
    const named = fields.filter(element => matchScore(target, element.name) >= 0.5 || (name && matchScore(name, element.name) >= 0.5));
    if (!named.length && !(saidKind && (!name || DEICTIC.test(normalize(name))))) continue;
    const parsed = kind.parse(value, now);
    if (parsed === null) return { type: 'unknown', message: `“${value}” is not a ${kind.noun} value. Say something like ${kind.example}.` };
    const act = element => ({ type: kind.type, targetId: element.id, value: kind.number ? Number(parsed) : parsed });
    return named.length ? resolve(name || target, named, null, act, `${kind.noun} field`) : deictic(fields, act, `${kind.noun} field`);
  }
  return null;
}

// A control named but not inside the circle is looked for just outside it (context.nearby), where webcam
// gaze error usually leaves it, and then anywhere on screen (context.onScreen), where a unique match is only
// offered for confirmation and two or three become a question. Only named misses (and bare names that were not
// understood) are retried: "open this" never reaches outside the circle.
const FAR_CHOICES = 3;
// Command words speech recognition commonly mishears, tried only when an instruction is not understood as heard.
const MISHEARD = [
  [/^(?:quick|clique|flick|klick|kick|lick|clicked|clicks)\b/, 'click'],
  [/^(?:school|scrawl|skull|squirrel|stroll|scrolled|scrolls)\b/, 'scroll'],
  [/^(scroll|school|scrawl|skull) (?:town|dawn|done)\b/, 'scroll down'],
  [/^go (?:bag|black|buck|pack|bach)$/, 'go back'],
  [/^(?:tight|typed|types|tie|thai)\b/, 'type'],
  [/^(?:chews|shoes|chose)\b/, 'choose'],
  [/^(?:dress|pressed|presses)\b/, 'press'],
  [/^(?:clothes|clothe)\b/, 'close'],
  [/^(?:and|on) check\b/, 'uncheck'],
  [/^(?:and do|undue|on do)$/, 'undo'],
  [/^expend\b/, 'expand'],
  [/^(?:cancer|council)$/, 'cancel'],
];
// A corrected instruction that only scrolls, cancels or pauses is done; anything else is asked first.
const HARMLESS = new Set(['scroll', 'cancel', 'pause']);

export function interpret(utterance, context = { elements: [] }) {
  const action = interpretHeard(utterance, context);
  if (action.type !== 'unknown' || action.alike) return action;
  // Not understood as heard: a commonly misheard command word, corrected, may make sense. Only the command word
  // changes; dictated words keep their capitals and punctuation.
  const heard = (utterance ?? '').trim(), plain = heard.replace(/[.!?,]+$/, '');
  for (const [pattern, word] of MISHEARD) {
    const match = pattern.exec(plain.toLowerCase());
    if (!match) continue;
    const said = word + plain.slice(match[0].length) + heard.slice(plain.length);
    const corrected = interpretHeard(said, context);
    if (corrected.type === 'unknown') continue;
    if (HARMLESS.has(corrected.type) || corrected.type === 'clarify') return corrected;
    return { ...action, alike: { ...corrected, heardAs: said } };
  }
  return action;
}

function interpretHeard(utterance, context) {
  const { weak, ...action } = interpretWithin(utterance, context);
  // A control inside the circle that shares only some of the words said gives way to one just outside it that is
  // named closely ("lose my permit" against "I have a permit"): webcam error often leaves the gaze beside the target.
  if (weak && action.targetId != null) {
    const elsewhere = elements => ({ ...context, elements, nearby: [], disclosureElements: undefined, pageSearch: null, focusedId: null, selectionFocusedId: null });
    const near = context.nearby?.length ? beyond(utterance, elsewhere(context.nearby), 'outside', 'Not inside the gaze circle, but nearby') : null;
    if (near && !near.weak && near.type !== 'clarify' && near.targetId !== action.targetId) { const { weak: _, ...closer } = near; return closer; }
    // Further away, a closely named control is not used without asking, and neither is the loose match: "open
    // actions" should not follow "Action Menu Button Example" when an "Actions" button is elsewhere on screen.
    const screen = context.onScreen?.() ?? [];
    const far = screen.length ? beyond(utterance, elsewhere(screen), 'far', 'Not near your gaze', FAR_CHOICES) : null;
    if (far && !far.weak && far.type !== 'clarify' && far.targetId !== action.targetId) {
      const { far: _far, weak: _weak, ...chosen } = far;
      const here = [...context.elements, ...(context.nearby ?? [])].find(element => element.id === action.targetId), there = screen.find(element => element.id === far.targetId);
      return question([
        { number: 1, label: here?.name || here?.role || 'The control you are looking at', elementId: action.targetId },
        { number: 2, label: there?.name || there?.role || 'The control elsewhere', elementId: far.targetId },
      ], number => (number === 1 ? action : chosen));
    }
  }
  return action;
}

function interpretWithin(utterance, context) {
  const action = interpretInCircle(utterance, context);
  if (action.fieldMiss) { const { fieldMiss: _, ...missed } = action; return typingElsewhere(utterance, context) ?? missed; }
  if (!action.missing && !action.unparsed) return action;
  const elsewhere = { ...context, nearby: [], disclosureElements: undefined, pageSearch: null, focusedId: null, selectionFocusedId: null };
  const near = context.nearby?.length ? beyond(utterance, { ...elsewhere, elements: context.nearby }, 'outside', 'Not inside the gaze circle, but nearby') : null;
  if (near) return near;
  const screen = context.onScreen?.() ?? [];
  return (screen.length && beyond(utterance, { ...elsewhere, elements: screen }, 'far', 'Not near your gaze', FAR_CHOICES)) || action;
}

// The instruction tried on controls outside the circle; null when it names none of them (or too many).
// Typing into an unnamed field when none is inside the circle, as after a large gaze miss: the nearest few text fields
// just outside the circle, or else the only few on screen, are offered and never used without a yes.
function typingElsewhere(utterance, context) {
  const nearest = list => list.filter(textField).sort((a, b) => a.distance - b.distance);
  const near = nearest(context.nearby ?? []).slice(0, FAR_CHOICES);
  const screen = near.length ? [] : nearest(context.onScreen?.() ?? []);
  const fields = near.length ? near : screen.length <= FAR_CHOICES ? screen : [];
  if (!fields.length) return null;
  const elsewhere = { ...context, elements: fields, nearby: [], disclosureElements: undefined, pageSearch: null, focusedId: null, selectionFocusedId: null };
  return beyond(utterance, elsewhere, 'far', 'No text field is inside the gaze circle. Type into');
}

function beyond(utterance, context, flag, where, most = Infinity) {
  const result = interpretInCircle(utterance, context);
  const ids = new Set(context.elements.map(element => element.id));
  if (result.type === 'clarify') {
    if (result.candidates.length > most || !result.candidates.every(candidate => ids.has(candidate.elementId))) return null;
    // Controls outside the circle have ids from 101; ask with small numbers that are easy to say.
    const candidates = result.candidates.map((candidate, index) => ({ ...candidate, number: index + 1 }));
    return { ...question(candidates, number => result.choose(result.candidates[number - 1].number)), [flag]: true,
      message: `${where}: ${candidates.map(candidate => `${candidate.number}: ${candidate.label}`).join('; ')}. Say a number or cancel.` };
  }
  if (!ids.has(result.targetId)) return null;
  // A control that only shares the topic of what was asked is offered, not used, when it is outside the circle.
  return result.related ? { ...result, far: true } : { ...result, [flag]: true };
}

// Keys said aloud: "press escape", "press shift tab", "press page down", "press control enter", "press the home key".
const KEY_NAMES = new Map([['escape', 'Escape'], ['esc', 'Escape'], ['tab', 'Tab'], ['enter', 'Enter'], ['return', 'Enter'], ['space', ' '], ['spacebar', ' '],
  ['space bar', ' '], ['backspace', 'Backspace'], ['back space', 'Backspace'], ['delete', 'Delete'], ['home', 'Home'], ['end', 'End'], ['page up', 'PageUp'],
  ['page down', 'PageDown'], ['up', 'ArrowUp'], ['down', 'ArrowDown'], ['left', 'ArrowLeft'], ['right', 'ArrowRight']]);
for (const direction of ['up', 'down', 'left', 'right']) {
  KEY_NAMES.set(`${direction} arrow`, KEY_NAMES.get(direction));
  KEY_NAMES.set(`arrow ${direction}`, KEY_NAMES.get(direction));
}
// Key names that are also everyday names of controls ("press home" may mean the Home link).
const WORD_KEYS = new Set(['home', 'end', 'delete', 'up', 'down', 'left', 'right', 'space', 'enter', 'return', 'tab', 'escape', 'backspace']);
const MODIFIER_WORDS = { control: 'ctrl', ctrl: 'ctrl', command: 'meta', cmd: 'meta', meta: 'meta', alt: 'alt', option: 'alt', shift: 'shift' };
export function keyCombo(phrase) {
  let words = phrase.toLowerCase().replace(/\+|\bplus\b/g, ' ').split(/\s+/).filter(Boolean);
  const named = /^keys?$/.test(words.at(-1) ?? '');
  if (named) words = words.slice(0, -1);
  const modifiers = { ctrl: false, alt: false, shift: false, meta: false };
  while (words.length > 1 && MODIFIER_WORDS[words[0]]) { modifiers[MODIFIER_WORDS[words[0]]] = true; words.shift(); }
  const name = words.join(' '), modified = Object.values(modifiers).some(Boolean);
  const key = KEY_NAMES.get(name) ?? (/^f(?:[1-9]|1[0-2])$/.test(name) ? name.toUpperCase() : /^[a-z0-9]$/.test(name) && (modified || named) ? name : null);
  return key ? { key, ...modifiers, named, word: WORD_KEYS.has(name) && !modified && !named } : null;
}

function interpretInCircle(utterance, context) {
  const now = context.now ?? new Date();
  const heard = (utterance ?? '').trim();
  // Dictation keeps its own words; commands also drop trailing politeness.
  const raw = heard.replace(LEADING_FILLER, '') || heard;
  const command = raw.replace(TRAILING_FILLER, '') || raw;
  const text = normalize(command);
  if (!text) return { type: 'unknown', message: 'No instruction was heard.' };

  if (/^(cancel|stop|never ?mind|forget it)(?: (?:that|it|this))?$/.test(text)) return { type: 'cancel' };
  if (/^(pause|pause listening|stop listening|pause navigator|hold on|wait|wait a (?:second|moment|minute)|one moment)$/.test(text)) return { type: 'pause' };
  if (/^(resume|continue|unpause|start listening)$/.test(text)) return { type: 'resume' };
  // The browser itself: reload, go to a website, tabs and zoom. A website is named by its address ("go to bbc dot co
  // dot uk"), so "open settings" still opens a control.
  const browser = browserCommand(command, context);
  if (browser) return browser;
  if (/^(?:again|(?:do|try) (?:that|it|this) again|(?:do (?:that|it) )?once more|one more time|same again|repeat(?: that| it| the last (?:one|action))?)$/.test(text)) return { type: 'again' };
  if (/^(?:use|start|switch to|turn on) (?:the )?(?:camera|webcam|eye tracking|gaze tracking|my eyes)(?: mode| tracking)?$|^camera mode$/.test(text)) {
    return { type: 'tracking', source: 'camera' };
  }
  if (/^(?:use|switch to) (?:the )?(?:pointer|mouse)(?: mode)?$|^(?:stop|turn off) (?:the )?(?:camera|webcam|eye tracking)$|^pointer mode$/.test(text)) {
    return { type: 'tracking', source: 'pointer' };
  }
  if (/^(?:re)?calibrate(?: (?:the )?camera)?$/.test(text)) return { type: 'calibrate' };
  const circleSize = /^(?:use|set|switch to) (?:a |the )?(small|medium|large) (?:gaze )?circle$/.exec(text)
    ?? /^(?:set|make) (?:the )?(?:gaze )?circle (?:size )?(?:to )?(small|medium|large)$/.exec(text);
  if (circleSize) return { type: 'circle-size', size: circleSize[1] };
  const circleStep = /^make (?:the )?(?:gaze )?circle (bigger|larger|smaller)$/.exec(text);
  if (circleStep) return { type: 'circle-size', size: circleStep[1] === 'smaller' ? 'smaller' : 'larger' };
  // The navigator's own panel: hidden to a status line, shown again, or moved to another corner of the screen.
  const navigator = '(?:the )?(?:gaze )?navigator(?: panel)?';
  if (new RegExp(`^(?:hide|minimi[sz]e|shrink|collapse) ${navigator}$`).test(text)) return { type: 'panel', change: 'collapse' };
  if (new RegExp(`^(?:show|expand|restore|maximi[sz]e) ${navigator}$`).test(text)) return { type: 'panel', change: 'expand' };
  if (new RegExp(`^(?:place|position|move) ${navigator} automatically$|^let ${navigator} (?:move|place) itself$`).test(text)) return { type: 'panel', change: 'auto' };
  const corner = new RegExp(`^(?:move|put|place) ${navigator} (?:to |into |in )?(?:the )?(?:(top|bottom|upper|lower)[ -]?)?(left|right)(?: corner| side)?$`).exec(text);
  if (corner) return { type: 'panel', change: 'move', left: corner[2] === 'left', top: corner[1] ? /top|upper/.test(corner[1]) : null };
  const nudge = new RegExp(`^move ${navigator} (up|down)$`).exec(text);
  if (nudge) return { type: 'panel', change: 'move', left: null, top: nudge[1] === 'up' };
  // Words on the page, found and scrolled to ("find gift cards"), then the next or previous place they appear.
  if (/^(?:find next|next match|next result|find (?:it |that )?again)$/.test(text)) return { type: 'find', move: 'next' };
  if (/^(?:find previous|previous match|previous result)$/.test(text)) return { type: 'find', move: 'previous' };
  if (/^(?:stop finding|clear (?:the )?(?:search|find|highlight|matches)|hide (?:the )?(?:matches|highlight))$/.test(text)) return { type: 'find', clear: true };
  // "Find" and "look for" alone search with the site's own search box; the page itself is named.
  const finding = /^(?:(?:find|look for)\s+(?:the (?:words?|text|phrase)\s+)?(.+?)\s+on (?:the|this) page|(?:find|look) on (?:the|this) page (?:for )?(.+?)|search (?:the|this) page for\s+(.+?))[.!?]*$/i.exec(command.trim());
  const phrase = finding && (finding[1] ?? finding[2] ?? finding[3]);
  if (phrase && !/^(?:next|previous|it|that)$/i.test(phrase)) return { type: 'find', text: unquote(phrase) };
  // Numbers on every control on screen, said instead of looking at one ("show numbers", then "click 12").
  if (/^(?:show|display|turn on|put up) (?:the )?(?:control )?numbers(?: on (?:the )?(?:page|screen|controls))?$|^number (?:everything|the controls|all (?:the )?controls|the page)$|^numbers on$/.test(text)) return { type: 'numbers', on: true };
  if (/^(?:hide|remove|clear|turn off|take away|stop showing) (?:the )?(?:control )?numbers$|^numbers off$|^no more numbers$/.test(text)) return { type: 'numbers', on: false };
  if (/^(yes|confirm|do it|go ahead|ok|okay|yes please)$/.test(text)) return { type: 'confirm' };
  if (/^(no|no thanks|don't|do not)$/.test(text)) return { type: 'deny' };
  const choice = /^(?:number|option|choice|item|choose|pick|select|click|press|open)?\s*(.+)$/.exec(text);
  // Shown numbers go past twelve, said as digits or words ("click 23", "one hundred and four").
  const shownNumber = text => { const value = spokenNumber(text.replace(/^(?:the\s+)?(?:number|option|choice|item)\s+/, '')); return value !== null && /^[1-9]\d{0,2}$/.test(value) ? Number(value) : null; };
  const chosen = choice && (parseNumber(choice[1]) ?? shownNumber(choice[1]));
  // A number on its own ("two") only answers a question; it is marked so a stray number in conversation
  // never activates a control.
  if (chosen) return /^(?:number|option|choice|item|choose|pick|select|click|press|open)\b/.test(text) ? { type: 'choose', index: chosen } : { type: 'choose', index: chosen, bare: true };

  // "Next page" and "previous page" follow a pagination link or button inside the circle (as on search results),
  // or just outside it. With none near, "previous page" goes back; "next page" explains rather than moving
  // forward through history, which is usually empty and would look like nothing happened.
  const paging = /^(?:go to |show )?(?:the )?(next|previous|prev) page(?: of results)?$/.exec(text);
  if (paging) {
    const pattern = paging[1] === 'next' ? /^(?:next\b|[›»→])|\bnext page\b/i : /^(?:prev(?:ious)?\b|[‹«←])|\bprevious page\b/i;
    const pager = element => (element.role === 'link' || element.role === 'button') && pattern.test((element.name ?? '').trim());
    const activate = element => ({ type: 'activate', targetId: element.id });
    const pagers = context.elements.filter(pager);
    if (pagers.length) return deictic(pagers, activate, 'page link');
    // A pager just outside the circle goes through the same near-miss retry as other named controls.
    if ((context.nearby ?? []).some(pager)) return { type: 'unknown', missing: true, message: 'No page link is inside the gaze circle. Look at it and try again.' };
    if (paging[1] === 'next') return { type: 'unknown', message: 'No next-page link is near the gaze circle. Look at it and try again, or say “go forward” to use the browser’s Forward button.' };
  }
  if (/^(?:go |take me )?back(?: a page| to the previous page)?$|^(?:go|return) (?:back )?to the previous page$|^previous page$/.test(text)) return { type: 'back' };
  if (/^(go )?forward( a page)?$/.test(text)) return { type: 'forward' };
  if (/^(page down|next screen)$/.test(text)) return { type: 'scroll', direction: 'down', amount: 'page' };
  if (/^page up$/.test(text)) return { type: 'scroll', direction: 'up', amount: 'page' };
  const scroll = /^scroll(?: (?:the )?(?:page|area|region|list|side ?bar|menu|navigation|comments|chat|messages|results|table))?(?: (up|down|left|right))?(?: (a bit|a little|slightly|more|a lot))?$/.exec(text) ??
    /^(?:go|move) (up|down)(?: (a bit|a little|slightly|more|a lot))?$/.exec(text) ??
    /^(?:scroll|go|jump) to (?:the )?(top|bottom)(?: of the page)?$/.exec(text);
  if (scroll) {
    // A named kind of region ("the list", "the sidebar") can be found away from the gaze when the gaze is not on one.
    const named = /^scroll (?:the )?(list|side ?bar|menu|navigation|comments|chat|messages|results|table)\b/.exec(text)?.[1];
    const kind = named && ({ 'side bar': 'sidebar', navigation: 'menu', messages: 'chat' }[named] ?? named);
    return { type: 'scroll', direction: scroll[1] ?? 'down', amount: /bit|little|slightly/.test(scroll[2] ?? '') ? 'small' : 'page',
      ...(/\bpage\b/.test(text) ? { scope: 'page' } : {}), ...(kind ? { kind } : {}) };
  }

  // Explicit add/remove never replaces the other choices in a native multi-select.
  const multiple = /^(add|remove) option\s+("[^"]+"|“[^”]+”|.+?)(?:\s+(to|from)\s+(?:the\s+)?(.+))?$/i.exec(command);
  if (multiple) {
    const [, verb, option, preposition, name] = multiple;
    if (preposition && preposition.toLowerCase() !== (verb.toLowerCase() === 'add' ? 'to' : 'from')) {
      return { type: 'unknown', message: 'Say “add option” with “to”, or “remove option” with “from”.' };
    }
    let lists = context.elements.filter(element => element.options?.length && element.selectSnapshot?.multiple === true);
    if (name) {
      const ranked = rank(unquote(name), lists);
      lists = ranked.filter(entry => entry.score >= ranked[0].score - MARGIN).map(entry => entry.element);
    }
    return selectOption(unquote(option), lists, verb.toLowerCase() === 'add') ??
      { type: 'unknown', message: 'No matching option in a native multiple-selection list is inside the gaze circle.' };
  }

  // Text editing keeps the user's original wording, capitalization and punctuation.
  let match;
  if (/^select all(?: text)?$/.test(text)) {
    return chooseSelectionField(context, element => ({ type: 'select-text', targetId: element.id, position: 'all' }));
  }
  if ((match = /^select (?:the )?(?:(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|last|\d{1,2}(?:st|nd|rd|th)?) occurrence of|text)\s+(.+)$/i.exec(raw))) {
    const occurrence = !match[1] ? null : match[1].toLowerCase() === 'last' ? 'last' : parseNumber(match[1]) ?? Number.parseInt(match[1], 10);
    // Speech may put command punctuation after a closing quote; punctuation
    // inside quotes, and unquoted literal text, remain part of the phrase.
    const phrase = unquote(match[2].replace(/(["”])[.!?…]+$/, '$1'));
    return chooseSelectionField(context, element => ({ type: 'select-text', targetId: element.id, position: 'phrase', text: phrase, occurrence }));
  }
  if ((match = /^move (?:the )?(?:cursor|caret) to (?:the )?(start|end)$/.exec(text))) {
    const position = match[1];
    return chooseSelectionField(context, element => ({ type: 'select-text', targetId: element.id, position }));
  }
  if ((match = /^insert\s+(.+)\s+at (?:the )?(?:cursor|caret)[.!?…]*$/i.exec(command))) {
    return chooseSelectionField(context, edit('insert-selection', { text: unquote(match[1]), requireSelection: false }));
  }
  if ((match = /^replace (?:the )?selected text with\s+(.+)$/i.exec(command))) {
    return chooseSelectionField(context, edit('insert-selection', { text: unquote(match[1]), requireSelection: true }));
  }
  const deletion = /^(?:delete|remove|erase) (?:the )?(?:selected|highlighted) text(?: (?:in|from) (?:the )?(.+))?$/.exec(text);
  if (deletion) {
    const fields = { ...context, elements: context.disclosureElements ?? context.elements, focusedId: context.selectionFocusedId ?? context.focusedId };
    const act = element => ({ type: 'delete-selection', targetId: element.id });
    return deletion[1] ? chooseField(deletion[1], fields, act) : chooseSelectionField(fields, act);
  }
  // Explicit website-tab selection never falls back to another control role.
  // People also say "show the tab for Ida", "open the tab called Billing" or "switch to the Billing tab".
  const tabFor = /^(?:select|choose|pick|open|show(?: me)?|go to|switch to|view) (?:the )?tab (?:for|called|named|labell?ed|of|with) (.+)$/.exec(text)
    ?? /^switch to (?:the )?(.+?) tab$/.exec(text);
  const tab = tabFor ? [text, tabFor[1]] : /^(?:select|choose|pick) (?:the )?(?:tab(?: (.+))?|(.+?) tab)$/.exec(text);
  if (tab) {
    const subject = tab[1] ?? tab[2];
    const candidates = context.elements.filter(element => element.role === 'tab');
    const act = element => ({ type: 'select-tab', targetId: element.id });
    const counted = subject && ORDINAL.exec(`${subject} control`);
    if (counted?.[2] === 'control') return ordinal(counted[1], 'control', candidates, act);
    return !subject || DEICTIC.test(subject) ? deictic(candidates, act, 'website tab')
      : resolve(subject, candidates, null, act, 'website tab');
  }
  // Explicit radio intent cannot fall back to activating a similarly named button.
  const radio = /^(?:select|choose|pick) (?:the )?(?:radio(?: button)?(?: (.+))?|(.+?) radio(?: button)?)$/.exec(text);
  if (radio) {
    const subject = radio[1] ?? radio[2];
    const candidates = context.elements.filter(element => element.role === 'radio');
    const act = element => ({ type: 'select-radio', targetId: element.id });
    const counted = subject && ORDINAL.exec(`${subject} control`);
    if (counted?.[2] === 'control') return ordinal(counted[1], 'control', candidates, act);
    return !subject || DEICTIC.test(subject) ? deictic(candidates, act, 'radio button')
      : resolve(subject, candidates, null, act, 'radio button');
  }
  // Switches (and checkboxes) are also turned on and off: "turn on notifications", "switch dark mode off",
  // "enable alerts". Camera and pointer commands were read above.
  const onFirst = /^(?:turn|switch)\s+(on|off)(?:\s+(.+))?$/.exec(text), onLast = /^(?:turn|switch)\s+(.+?)\s+(on|off)$/.exec(text);
  const enabled = /^(enable|disable)(?:\s+(.+))?$/.exec(text);
  const turned = onFirst ? [onFirst[1], onFirst[2]] : onLast ? [onLast[2], onLast[1]] : enabled ? [enabled[1], enabled[2]] : null;
  const checkboxState = turned ? [text, ['on', 'enable'].includes(turned[0]) ? 'check' : 'uncheck', turned[1]] : /^(check|uncheck|tick|untick)(?:\s+(.+))?$/.exec(text);
  if (checkboxState && !/^check out(?: now)?$/.test(text)) {
    const candidates = context.elements.filter(element => ['checkbox', 'switch'].includes(element.role));
    const subject = checkboxState[2]?.replace(/^the\s+/, '');
    const act = element => ({ type: 'check', targetId: element.id, checked: ['check', 'tick'].includes(checkboxState[1]) });
    const prior = previous(context, subject, ['checkbox', 'switch']);
    if (prior) return act(prior);
    const counted = subject && ORDINAL.exec(subject);
    if (counted) return ordinal(counted[1], counted[2], candidates, act);
    return !subject || DEICTIC.test(subject) || /^(?:(?:this|that) )?(?:checkbox|switch|box)$/.test(subject)
      ? deictic(candidates, act, 'checkbox') : resolve(subject, candidates, null, act, 'checkbox');
  }
  // Reserve explicit period intent before generic text editing, activation or model fallback.
  // Do not mistake a generic field's replacement payload ("... field to month field") for intent.
  const periodPrefix = /^(?:set|change|undo)\s+(?:the\s+)?(?:(.*?)\s+)?(month|week)\s+field\b/i.exec(command);
  if (periodPrefix && !/\bfield\s+to\b/i.test(periodPrefix[1] ?? '')) {
    const periodSet = /^(?:set|change)\s+(?:the\s+)?(?:(.*?)\s+)?(month|week)\s+field\s+to\s+(.+)$/i.exec(command);
    const periodUndo = /^undo\s+(?:the\s+)?(?:(.*?)\s+)?(month|week)\s+field[.!?,;:]*$/i.exec(command);
    const kind = periodPrefix[2].toLowerCase(), name = (periodSet ?? periodUndo)?.[1];
    const value = periodSet ? ((kind === 'month' ? spokenMonth : spokenWeek)(periodSet[3], now) ?? periodSet[3]) : undefined;
    const format = kind === 'month' ? /^\d{4}-(?:0[1-9]|1[0-2])$/ : /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;
    if ((!periodSet && !periodUndo) || (periodSet && !format.test(value))) return { type: 'unknown', message: `Say a ${kind} such as ${kind === 'month' ? '“November 2026”, “next month” or 2026-11' : '“week 43”, “next week” or 2026-W43'}: “set Reporting ${kind} field to ${kind === 'month' ? 'November 2026' : 'week 43'}”, or “undo Reporting ${kind} field”.` };
    const fields = context.elements.filter(element => element[kind === 'month' ? 'nativeMonth' : 'nativeWeek'] === true);
    const act = element => ({ type: kind, targetId: element.id, ...(periodUndo ? { undo: true } : { value }) });
    return !name || DEICTIC.test(normalize(name)) ? deictic(fields, act, `${kind} field`) : resolve(name, fields, null, act, `${kind} field`);
  }
  const timeSet = /^(?:set|change) (?:the )?(?:(.*?) )?time field to (.+)$/i.exec(command);
  const timeUndo = /^undo (?:the )?(?:(.*?) )?time field$/i.exec(command);
  if (timeSet || timeUndo) {
    const name = (timeSet ?? timeUndo)[1], value = timeSet ? spokenTime(timeSet[2]) ?? timeSet[2] : undefined;
    if (timeSet && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return { type: 'unknown', message: 'Say a time such as “set Appointment time field to 2:30 pm”, “half past nine” or 14:30.' };
    const fields = context.elements.filter(element => element.nativeTime === true);
    const act = element => ({ type: 'time', targetId: element.id, ...(timeUndo ? { undo: true } : { value }) });
    return !name || DEICTIC.test(normalize(name)) ? deictic(fields, act, 'time field') : resolve(name, fields, null, act, 'time field');
  }
  const dateSet = /^(?:set|change) (?:the )?(?:(.*?) )?date field to (.+)$/i.exec(command);
  const dateUndo = /^undo (?:the )?(?:(.*?) )?date field$/i.exec(command);
  if (dateSet || dateUndo) {
    const name = (dateSet ?? dateUndo)[1], value = dateSet ? spokenDate(dateSet[2], now) ?? dateSet[2] : undefined;
    if (dateSet && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { type: 'unknown', message: 'Say a date such as “set Departure date field to November first”, “tomorrow” or 2026-11-01.' };
    const fields = context.elements.filter(element => element.nativeDate === true);
    const act = element => ({ type: 'date', targetId: element.id, ...(dateUndo ? { undo: true } : { value }) });
    return !name || DEICTIC.test(normalize(name)) ? deictic(fields, act, 'date field') : resolve(name, fields, null, act, 'date field');
  }
  // Explicit numeric-field intent does not change ordinary text or slider commands.
  const numberSet = /^(?:set|change) (?:the )?(?:(.*?) )?number field to (.+)$/i.exec(command);
  const numberUndo = /^undo (?:the )?(?:(.*?) )?number field$/i.exec(command);
  if (numberSet || numberUndo) {
    const name = (numberSet ?? numberUndo)[1];
    const value = numberSet ? spokenNumber(numberSet[2]) : undefined;
    if (numberSet && (value === null || !Number.isFinite(Number(value)))) {
      return { type: 'unknown', message: 'Say a number such as “set Quantity number field to three” or “2.5”, in the field’s own units.' };
    }
    const fields = context.elements.filter(element => element.nativeNumber === true);
    const act = element => ({ type: 'number', targetId: element.id, ...(numberUndo ? { undo: true } : { value }) });
    return !name || DEICTIC.test(normalize(name)) ? deictic(fields, act, 'number field') : resolve(name, fields, null, act, 'number field');
  }
  // Explicit slider intent stays separate from ordinary text/option commands.
  const sliderSet = /^(?:set|change) (?:the )?(?:(.*?) )?slider to (.+)$/i.exec(command);
  const sliderUndo = /^undo (?:the )?(?:(.*?) )?slider$/i.exec(command);
  if (sliderSet || sliderUndo) {
    const name = (sliderSet ?? sliderUndo)[1];
    const number = sliderSet ? spokenSliderValue(sliderSet[2]) : undefined;
    if (sliderSet && (number === null || !Number.isFinite(Number(number)))) {
      return { type: 'unknown', message: 'Say a slider value such as “set Volume slider to forty” or “40 percent”, in the slider’s own units.' };
    }
    const sliders = context.elements.filter(element => element.role === 'slider');
    const act = element => ({ type: 'range', targetId: element.id, ...(sliderUndo ? { undo: true } : { value: Number(number) }) });
    return name ? resolve(name, sliders, null, act, 'slider') : deictic(sliders, act, 'slider');
  }
  if ((match = /^(?:search(?: for)?|look up|look for|find)\s+(.+)$/i.exec(command))) {
    const query = unquote(match[1]);
    const act = element => ({ type: 'search', targetId: element.id, text: query });
    const nearby = context.elements.filter(element => element.editable && (element.role === 'searchbox' || /search/i.test(element.name)));
    if (nearby.length) return deictic(nearby, act, 'search field');
    if (context.pageSearch) return act(context.pageSearch);
    return chooseField(null, context, act, { recover: true });
  }
  if ((match = /^(?:continue|keep)\s+(?:typing|writing|dictating)(?:\s+(.+))?$/i.exec(raw))) {
    if (!match[1]?.trim()) return { type: 'unknown', message: 'Say “continue typing” followed by the words to add to the focused field.' };
    const field = continuingIn(context);
    return field ? { ...edit('append', { text: dictated(match[1]) })(field), requireFocus: true }
      : { type: 'unknown', message: 'First focus a regular text field, then say “continue typing” and the words. No field was changed.' };
  }
  if ((match = /^(?:type|write|enter|dictate|insert)\s+(.+)$/i.exec(raw))) {
    // Ordinary "in" stays literal ("meet in the park"); "into", a quoted phrase or an explicit field suffix names a target.
    const quoted = /^["“](.*?)["”](?:\s+(?:into|in)\s+(?:the\s+)?(.+))?$/i.exec(match[1]);
    const into = /^(.+)\s+into\s+(?:the\s+)?(.+)$/i.exec(match[1]);
    // An explicit field/box/input suffix names a target even when gaze misses it. A missing target must not
    // turn the instruction into literal text in a neighbour. Quote the whole phrase to dictate such words.
    const named = /^(.+)\s+in\s+(?:the\s+)?(.+?)\s+(?:field|box|input)\p{P}*(?:\s+(?:please|for me)\p{P}*)*$/iu.exec(match[1]);
    const [said, field] = quoted ? [quoted[1], quoted[2]] : into ? [into[1], into[2]] : named ? [named[1], named[2]] : [match[1], null];
    const content = quoted ? said : punctuate(said);
    return chooseField(field?.replace(/\s+(field|box|input)$/i, ''), context, intoDateBoxes(content, writing('append', content), context.now), { recover: true, kind: textKind(content) });
  }
  if ((match = /^(?:set|change|replace)(?: (?:it|that|the text|everything|all))? (?:to|with)\s+(.+)$/i.exec(command))) {
    const content = dictated(match[1]);
    return chooseField(null, context, intoDateBoxes(content, writing('replace-all', content), context.now), { kind: textKind(content) });
  }
  if ((match = /^replace\s+(.+?)\s+with\s+(.+)$/i.exec(command))) {
    const act = edit('replace', { find: unquote(match[1]), text: unquote(match[2]) });
    const typing = context.elements.some(textField) ? null : typingIn(context, unquote(match[1]));
    return typing ? act(typing) : chooseField(null, context, act);
  }
  // "Set topic to order problem" picks an option; "change message to hi" rewrites a named field;
  // otherwise "change Tuesday to Friday" corrects a word in the current field.
  if ((match = /^(?:set|change|switch)\s+(?:the\s+)?(.+?)\s+to\s+(.+)$/i.exec(command))) {
    const [, target, value] = match;
    const selects = context.elements.filter(element => element.options?.length && matchScore(target, element.name) >= 0.5);
    if (selects.length) {
      return selectOption(value, selects) ?? { type: 'unknown', message: `"${value}" is not one of the choices in ${selects[0].name}.` };
    }
    // A custom combobox's options may exist only once it is open, so the choice is found when acting.
    const lists = context.elements.filter(element => element.customList && matchScore(target, element.name) >= 0.5);
    if (lists.length) return resolve(target, lists, null, chooseFrom(unquote(value)), 'list');
    const typed = typedSet(target, value, context, now);
    if (typed) return typed;
    const fields = context.elements.filter(element => textField(element) && matchScore(target, element.name) >= 0.5);
    if (fields.length) return resolve(target, fields, null, edit('replace-all', { text: unquote(value) }), 'text field');
    // Correcting words inside a field needs that field to be focused; a merely gazed field is a guess.
    const focused = context.elements.find(element => textField(element) && element.id === context.focusedId) ?? typingIn(context, unquote(target));
    if (!focused) return { type: 'unknown', missing: true, message: `Nothing called "${target}" is inside the gaze circle. To correct words, first select the text field.` };
    return edit('replace', { find: unquote(target), text: unquote(value) })(focused);
  }
  if ((match = /^(?:clear|empty|erase)(?: (?:the )?(.+?))?$/.exec(text))) {
    const name = match[1] && !/^(it|that|this|text|field|box|everything|all)$/.test(match[1]) ? match[1].replace(/ (field|box)$/, '') : null;
    return chooseField(name, context, edit('clear'));
  }
  if (/^(delete|remove|erase) (the )?(last|previous) word$|^backspace word$/.test(text)) return chooseField(null, context, edit('delete-word'));
  if (/^(new line|newline|next line)$/.test(text)) return chooseField(null, context, edit('append', { text: '\n', raw: true }));
  if (/^undo( that| typing)?$/.test(text)) {
    const field = text === 'undo typing' && !context.elements.some(textField) ? continuingIn(context) : null;
    return field ? { ...edit('undo')(field), requireFocus: true } : chooseField(null, context, edit('undo'));
  }
  if (/^(submit|press enter|hit enter|press return|hit return|send it|submit (the )?form)$/.test(text)) {
    const act = element => ({ type: 'submit', targetId: element.id });
    // The field being typed in submits even when the gaze has drifted away from it.
    const focused = context.elements.find(element => element.id === context.focusedId && element.editable) ??
      (context.focusedField?.editable ? context.focusedField : null);
    return focused ? act(focused) : deictic(context.elements.filter(element => element.editable || element.submits), act, 'form control');
  }

  // A key said aloud. A key whose name is also a control's ("press home") is the control when one nearby has that
  // name, unless said as a key ("the home key"). Enter alone submits, above.
  const pressing = /^(?:press|hit|tap|push)\s+(?:the\s+)?(.+)$/.exec(text), combo = pressing && keyCombo(pressing[1]);
  if (combo && !(combo.word && [...context.elements, ...(context.nearby ?? [])].some(element => matchScore(pressing[1], element.name ?? '') >= 0.9))) {
    const { named, word, ...keys } = combo;
    return { type: 'key', ...keys };
  }

  // Choosing a value from a dropdown inside the circle.
  const choose = /^(?:choose|select|pick|set)\s+(.+?)(?:\s+(?:from|in|for)\s+(?:the\s+)?(.+))?$/.exec(text);
  if (choose) {
    const selects = context.elements.filter(element => element.options?.length &&
      (!choose[2] || matchScore(choose[2], element.name) >= 0.5));
    const picked = selectOption(choose[1], selects);
    if (picked) return picked;
    const lists = choose[2] ? context.elements.filter(element => element.customList && matchScore(choose[2], element.name) >= 0.5) : [];
    if (lists.length) return resolve(choose[2], lists, null, chooseFrom(choose[1]), 'list');
  }

  // Resolve before eligibility; unsupported intent must refuse, never redirect.
  const disclosure = /^(expand|collapse)(?:\s+(.+))?$/.exec(text);
  if (disclosure) {
    const candidates = context.disclosureElements ?? context.elements;
    const subject = disclosure[2]?.replace(/^the\s+/, '');
    const act = element => ({ type: 'disclosure', targetId: element.id, expanded: disclosure[1] === 'expand' });
    const prior = previous(context, subject);
    if (prior?.disclosureSnapshot) return act(prior);
    const counted = subject && ORDINAL.exec(subject);
    if (counted) return ordinal(counted[1], /^(panel|section|disclosure|summary)$/.test(counted[2]) ? 'control' : counted[2], candidates, act);
    return !subject || DEICTIC.test(subject) || /^(?:(?:this|that) )?(?:panel|section|disclosure|summary|menu)$/.test(subject)
      ? deictic(candidates, act, 'disclosure') : resolve(subject, candidates, null, act, 'disclosure');
  }

  // Closing something: a toggle that is open ("close the menu" when its button now reads "Hide navigation menu"),
  // or a Close/Hide/Collapse/Dismiss control. With neither in the circle, the words are an ordinary control name
  // ("close account"), which keeps its usual handling and confirmation.
  const closing = /^(?:close|hide|collapse|dismiss|shut)(?:\s+(?:the\s+)?(.+))?$/.exec(text);
  if (closing) {
    const subject = closing[1] && !DEICTIC.test(closing[1]) ? closing[1] : null;
    const act = element => ({ type: 'activate', targetId: element.id });
    const closers = context.elements.filter(element => element.expanded === true ||
      ((element.role === 'button' || element.role === 'link') && /^(?:close|hide|collapse|dismiss)\b|^[×✕✖]$/i.test((element.name ?? '').trim())));
    if (closers.length) {
      if (!subject) return deictic(closers, act);
      // "the menu" is only a role word: prefer closers whose name says it, else ask among them all.
      if (!tokens(subject).length) {
        const word = normalize(subject);
        const saying = closers.filter(element => ` ${normalize(element.name ?? '')} `.includes(` ${word} `));
        return deictic(saying.length ? saying : closers, act);
      }
      const named = rank(subject, closers, null);
      if (named.length) return resolve(subject, closers, null, act);
    }
  }

  let verbless = text.replace(ACTIVATE_VERB, '');
  // "The link to pricing", "the button for checkout": the kind of control comes first and names a role hint.
  const prefixed = /^(?:the\s+)?(link|button|checkbox|box|field|menu|option)\s+(?:for|to|called|named|labell?ed)\s+(.+)$/.exec(verbless);
  if (prefixed && verbless !== text) verbless = `${prefixed[2]} ${prefixed[1]}`;
  const hint = /\s(link|button|tab|checkbox|box|field|menu|option)$/.exec(verbless)?.[1];
  const query = verbless.replace(/^the\s+/, '').replace(/\s(link|button|checkbox|box|field|menu|option)$/, hint && prefixed ? '' : '$&').trim();
  const act = element => ({ type: 'activate', targetId: element.id });
  const prior = previous(context, query);
  if (prior) return act(prior);
  if (DEICTIC.test(query)) return deictic(context.elements, act);
  if (!query) return { type: 'unknown', message: 'Say what to open or select.' };
  const counted = ORDINAL.exec(query);
  if (counted) return ordinal(counted[1], counted[2], context.elements, act);
  let resolved = resolve(query, context.elements, hint ? ROLE_HINTS[hint] : null, act, 'control', true);
  // A bare option name ("large print") selects it when no control has that name, and so does a dropdown's own name
  // followed by the choice, as its label reads ("sort by most views", "country to France").
  if (resolved.type === 'unknown') {
    const selects = context.elements.filter(element => element.options?.length);
    resolved = selectOption(query, selects) ?? namedOption(query, selects) ?? resolved;
  }
  // Unknown results say why, so an assisting model can be asked only about naming a target:
  // `targetQuery` when an activation was requested but no control matched, `unparsed` otherwise.
  if (resolved.type === 'unknown' && verbless === text && !hint) {
    return { type: 'unknown', unparsed: true, message: `"${raw}" was not understood. Try "open" or "click" and a name, "type", "scroll down", "go back" or "cancel".` };
  }
  // Only a spoken activation verb ("open …", "click …") makes this a request to name a control.
  if (resolved.type === 'unknown') return verbless !== text ? { ...resolved, targetQuery: query } : { ...resolved, unparsed: true };
  return resolved;
}

// Pure text corrections applied to a field value.
export function applyEdit(value, edit, history = []) {
  switch (edit.kind) {
    case 'append': {
      if (edit.raw || !value || /\s$/.test(value)) return value + edit.text;
      return `${value} ${edit.text}`;
    }
    case 'replace-all': return edit.text;
    case 'clear': return '';
    case 'delete-word': return value.replace(/\s*\S+\s*$/, '');
    case 'replace': {
      const index = value.toLowerCase().lastIndexOf(edit.find.toLowerCase());
      if (index < 0 || !edit.find) return null;
      return value.slice(0, index) + edit.text + value.slice(index + edit.find.length);
    }
    case 'undo': return history.length ? history.at(-1) : null;
    default: return null;
  }
}
