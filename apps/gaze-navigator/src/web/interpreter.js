// Interpretation stage: maps one instruction plus a described gaze context to one typed action.
// Deterministic rules form the baseline; a model interpreter can implement the same contract.

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const STOPWORDS = new Set(['the', 'a', 'an', 'on', 'to', 'please', 'my', 'this', 'that', 'link', 'button', 'tab', 'field', 'box', 'checkbox', 'menu', 'option', 'page', 'item', 'input']);
const ROLE_HINTS = { link: ['link'], button: ['button'], tab: ['tab'], checkbox: ['checkbox', 'switch'], box: ['checkbox', 'textbox', 'searchbox'], field: ['textbox', 'searchbox', 'combobox'], menu: ['combobox', 'menuitem'], option: ['option', 'combobox', 'radio'] };
// Scores closer than this are treated as equally plausible and trigger a question.
const MARGIN = 0.05;
const DEICTIC = /^(this|that|it|here|there|this one|that one)$/;
const ACTIVATE_VERB = /^(?:click|tap|press|push|hit|open up|open|follow|select|choose|pick|activate|check|uncheck|tick|untick|toggle|expand|collapse|go to|navigate to|take me to|show me|bring up|show|view|visit|see|load|go)\s+(?:on\s+)?/;
// Politeness and lead-ins that carry no instruction; dictated text keeps everything after its verb.
const LEADING_FILLER = /^(?:(?:please|ok|okay|now|hey|so|um|uh)\s+|(?:can|could|would|will) you(?: please)?\s+|(?:i(?:'d| would) like to|i want to|i need to|let's|let me|go ahead and)\s+)+/i;
// "Thanks" is not stripped: it is often the content ("change it to Thanks").
const TRAILING_FILLER = /(?:\s+(?:please|for me))+$/i;
const ORDINAL = /^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d{1,2}(?:st|nd|rd|th))\s+(.+)$/;
// Common equivalent names for the same control.
const SYNONYMS = [['log in', 'sign in'], ['login', 'sign in'], ['log on', 'sign in'], ['log out', 'sign out'], ['logout', 'sign out'],
  ['sign up', 'register'], ['basket', 'cart'], ['bag', 'cart'], ['home page', 'home'], ['homepage', 'home'], ['main page', 'home']];

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

// Synonyms apply both ways: a site may label its control "Log in" or "Sign in" whichever the user says.
function variants(query) {
  const normalized = ` ${normalize(query)} `;
  const found = [query];
  for (const [a, b] of SYNONYMS) {
    for (const [phrase, replacement] of [[a, b], [b, a]]) {
      if (normalized.includes(` ${phrase} `)) found.push(normalized.replace(` ${phrase} `, ` ${replacement} `).trim());
    }
  }
  return found;
}

function rank(query, elements, roles) {
  const queries = variants(query);
  return elements
    .map(element => {
      let score = Math.max(...queries.map(variant => matchScore(variant, element.name)));
      if (roles && !roles.includes(element.role)) score *= 0.6;
      return { element, score };
    })
    .filter(entry => entry.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.element.distance - b.element.distance);
}

// A unique strong match acts; similarly strong matches become a numbered question.
function resolve(query, elements, roles, act, noun = 'control') {
  const ranked = rank(query, elements, roles);
  if (!ranked.length) {
    return { type: 'unknown', message: `No ${noun} called "${query}" is inside the gaze circle. Look at it and try again.` };
  }
  const close = ranked.filter(entry => entry.score >= ranked[0].score - MARGIN);
  if (close.length > 1) return clarify(close.map(entry => entry.element), act);
  return act(ranked[0].element);
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

function chooseField(fieldName, context, act) {
  const fields = context.elements.filter(textField);
  if (fieldName) return resolve(fieldName, fields, null, act, 'text field');
  const focused = fields.find(element => element.id === context.focusedId);
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

function unquote(text) {
  const match = /^["“](.*)["”]$/.exec(text.trim());
  return match ? match[1] : text.trim();
}

export function interpret(utterance, context = { elements: [] }) {
  const heard = (utterance ?? '').trim();
  // Dictation keeps its own words; commands also drop trailing politeness.
  const raw = heard.replace(LEADING_FILLER, '') || heard;
  const command = raw.replace(TRAILING_FILLER, '') || raw;
  const text = normalize(command);
  if (!text) return { type: 'unknown', message: 'No instruction was heard.' };

  if (/^(cancel|stop|never ?mind|forget it)(?: (?:that|it|this))?$/.test(text)) return { type: 'cancel' };
  if (/^(pause|pause listening|stop listening|pause navigator|hold on|wait|wait a (?:second|moment|minute)|one moment)$/.test(text)) return { type: 'pause' };
  if (/^(resume|continue|unpause|start listening)$/.test(text)) return { type: 'resume' };
  if (/^(?:use|start|switch to|turn on) (?:the )?(?:camera|webcam|eye tracking|gaze tracking|my eyes)(?: mode| tracking)?$|^camera mode$/.test(text)) {
    return { type: 'tracking', source: 'camera' };
  }
  if (/^(?:use|switch to) (?:the )?(?:pointer|mouse)(?: mode)?$|^(?:stop|turn off) (?:the )?(?:camera|webcam|eye tracking)$|^pointer mode$/.test(text)) {
    return { type: 'tracking', source: 'pointer' };
  }
  if (/^(?:re)?calibrate(?: (?:the )?camera)?$/.test(text)) return { type: 'calibrate' };
  if (/^(yes|confirm|do it|go ahead|ok|okay|yes please)$/.test(text)) return { type: 'confirm' };
  if (/^(no|no thanks|don't|do not)$/.test(text)) return { type: 'deny' };
  const choice = /^(?:number|option|choice|item|choose|pick|select|click|press|open)?\s*(.+)$/.exec(text);
  const chosen = choice && parseNumber(choice[1]);
  if (chosen) return { type: 'choose', index: chosen };

  // "Next page" and "previous page" follow a pagination link or button inside the circle (as on search results);
  // with none there, they move through the browser history.
  const paging = /^(?:go to |show )?(?:the )?(next|previous|prev) page(?: of results)?$/.exec(text);
  if (paging) {
    const pattern = paging[1] === 'next' ? /^(?:next\b|[›»→])|\bnext page\b/i : /^(?:prev(?:ious)?\b|[‹«←])|\bprevious page\b/i;
    const pagers = context.elements.filter(element => (element.role === 'link' || element.role === 'button') && pattern.test((element.name ?? '').trim()));
    if (pagers.length) return deictic(pagers, element => ({ type: 'activate', targetId: element.id }), 'page link');
  }
  if (/^(?:go |take me )?back(?: a page| to the previous page)?$|^(?:go|return) (?:back )?to the previous page$|^previous page$/.test(text)) return { type: 'back' };
  if (/^(go )?forward( a page)?$|^next page$/.test(text)) return { type: 'forward' };
  if (/^(page down|next screen)$/.test(text)) return { type: 'scroll', direction: 'down', amount: 'page' };
  if (/^page up$/.test(text)) return { type: 'scroll', direction: 'up', amount: 'page' };
  const scroll = /^scroll(?: (?:the )?(?:page|list|area|region))?(?: (up|down|left|right))?(?: (a bit|a little|slightly|more|a lot))?$/.exec(text) ??
    /^(?:go|move) (up|down)(?: (a bit|a little|slightly|more|a lot))?$/.exec(text) ??
    /^(?:scroll|go|jump) to (?:the )?(top|bottom)(?: of the page)?$/.exec(text);
  if (scroll) {
    return { type: 'scroll', direction: scroll[1] ?? 'down', amount: /bit|little|slightly/.test(scroll[2] ?? '') ? 'small' : 'page' };
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
  // Explicit website-tab selection never falls back to another control role.
  const tab = /^(?:select|choose|pick) (?:the )?(?:tab(?: (.+))?|(.+?) tab)$/.exec(text);
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
  const checkboxState = /^(check|uncheck|tick|untick)(?:\s+(.+))?$/.exec(text);
  if (checkboxState && !/^check out(?: now)?$/.test(text)) {
    const candidates = context.elements.filter(element => ['checkbox', 'switch'].includes(element.role));
    const subject = checkboxState[2]?.replace(/^the\s+/, '');
    const act = element => ({ type: 'check', targetId: element.id, checked: ['check', 'tick'].includes(checkboxState[1]) });
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
    const kind = periodPrefix[2].toLowerCase(), name = (periodSet ?? periodUndo)?.[1], value = periodSet?.[3];
    const format = kind === 'month' ? /^\d{4}-(?:0[1-9]|1[0-2])$/ : /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;
    if ((!periodSet && !periodUndo) || (periodSet && !format.test(value))) return { type: 'unknown', message: `Say a literal ${kind === 'month' ? 'YYYY-MM month' : 'YYYY-Www ISO week with uppercase W'}, such as “set Reporting ${kind} field to ${kind === 'month' ? '2026-11' : '2026-W43'}”, or “undo Reporting ${kind} field”.` };
    const fields = context.elements.filter(element => element[kind === 'month' ? 'nativeMonth' : 'nativeWeek'] === true);
    const act = element => ({ type: kind, targetId: element.id, ...(periodUndo ? { undo: true } : { value }) });
    return !name || DEICTIC.test(normalize(name)) ? deictic(fields, act, `${kind} field`) : resolve(name, fields, null, act, `${kind} field`);
  }
  const timeSet = /^(?:set|change) (?:the )?(?:(.*?) )?time field to (.+)$/i.exec(command);
  const timeUndo = /^undo (?:the )?(?:(.*?) )?time field$/i.exec(command);
  if (timeSet || timeUndo) {
    const name = (timeSet ?? timeUndo)[1], value = timeSet?.[2];
    if (timeSet && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return { type: 'unknown', message: 'Say a literal 24-hour HH:MM or HH:MM:SS time, such as “set Appointment time field to 14:30”.' };
    const fields = context.elements.filter(element => element.nativeTime === true);
    const act = element => ({ type: 'time', targetId: element.id, ...(timeUndo ? { undo: true } : { value }) });
    return !name || DEICTIC.test(normalize(name)) ? deictic(fields, act, 'time field') : resolve(name, fields, null, act, 'time field');
  }
  const dateSet = /^(?:set|change) (?:the )?(?:(.*?) )?date field to (.+)$/i.exec(command);
  const dateUndo = /^undo (?:the )?(?:(.*?) )?date field$/i.exec(command);
  if (dateSet || dateUndo) {
    const name = (dateSet ?? dateUndo)[1], value = dateSet?.[2];
    if (dateSet && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { type: 'unknown', message: 'Say a literal YYYY-MM-DD date, such as “set Departure date field to 2026-11-01”.' };
    const fields = context.elements.filter(element => element.nativeDate === true);
    const act = element => ({ type: 'date', targetId: element.id, ...(dateUndo ? { undo: true } : { value }) });
    return !name || DEICTIC.test(normalize(name)) ? deictic(fields, act, 'date field') : resolve(name, fields, null, act, 'date field');
  }
  // Explicit numeric-field intent does not change ordinary text or slider commands.
  const numberSet = /^(?:set|change) (?:the )?(?:(.*?) )?number field to (.+)$/i.exec(command);
  const numberUndo = /^undo (?:the )?(?:(.*?) )?number field$/i.exec(command);
  if (numberSet || numberUndo) {
    const name = (numberSet ?? numberUndo)[1];
    const value = numberSet?.[2];
    if (numberSet && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value)))) {
      return { type: 'unknown', message: 'Say an exact numeric value, such as “set Quantity number field to 3”, in the field’s own units.' };
    }
    const fields = context.elements.filter(element => element.nativeNumber === true);
    const act = element => ({ type: 'number', targetId: element.id, ...(numberUndo ? { undo: true } : { value: value.replace(/^\+/, '').replace(/\.$/, '') }) });
    return !name || DEICTIC.test(normalize(name)) ? deictic(fields, act, 'number field') : resolve(name, fields, null, act, 'number field');
  }
  // Explicit slider intent stays separate from ordinary text/option commands.
  const sliderSet = /^(?:set|change) (?:the )?(?:(.*?) )?slider to (.+)$/i.exec(command);
  const sliderUndo = /^undo (?:the )?(?:(.*?) )?slider$/i.exec(command);
  if (sliderSet || sliderUndo) {
    const name = (sliderSet ?? sliderUndo)[1];
    const number = sliderSet?.[2];
    if (sliderSet && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(number) || !Number.isFinite(Number(number)))) {
      return { type: 'unknown', message: 'Say an exact numeric slider value, such as “set Volume slider to 40”. Use the slider’s own units.' };
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
    return chooseField(null, context, act);
  }
  if ((match = /^(?:type|write|enter|dictate|insert)\s+(.+)$/i.exec(raw))) {
    // Unquoted "in" is ordinary dictation ("meet in the park"); only "into" or a quoted phrase names a field.
    const quoted = /^["“](.*?)["”](?:\s+(?:into|in)\s+(?:the\s+)?(.+))?$/i.exec(match[1]);
    const into = /^(.+)\s+into\s+(?:the\s+)?(.+)$/i.exec(match[1]);
    // "in the email field" names a field only when it ends with field/box and matches one.
    const named = /^(.+)\s+in\s+(?:the\s+)?(.+?)\s+(?:field|box)$/i.exec(match[1]);
    const namedField = named && context.elements.some(element => textField(element) && matchScore(named[2], element.name) >= 0.5);
    const [content, field] = quoted ? [quoted[1], quoted[2]] : into ? [into[1], into[2]] : namedField ? [named[1], named[2]] : [match[1], null];
    return chooseField(field?.replace(/\s+(field|box|input)$/i, ''), context, edit('append', { text: content }));
  }
  if ((match = /^(?:set|change|replace)(?: (?:it|that|the text|everything|all))? (?:to|with)\s+(.+)$/i.exec(command))) {
    return chooseField(null, context, edit('replace-all', { text: unquote(match[1]) }));
  }
  if ((match = /^replace\s+(.+?)\s+with\s+(.+)$/i.exec(command))) {
    return chooseField(null, context, edit('replace', { find: unquote(match[1]), text: unquote(match[2]) }));
  }
  // "Set topic to order problem" picks an option; "change message to hi" rewrites a named field;
  // otherwise "change Tuesday to Friday" corrects a word in the current field.
  if ((match = /^(?:set|change|switch)\s+(?:the\s+)?(.+?)\s+to\s+(.+)$/i.exec(command))) {
    const [, target, value] = match;
    const selects = context.elements.filter(element => element.options?.length && matchScore(target, element.name) >= 0.5);
    if (selects.length) {
      return selectOption(value, selects) ?? { type: 'unknown', message: `"${value}" is not one of the choices in ${selects[0].name}.` };
    }
    const fields = context.elements.filter(element => textField(element) && matchScore(target, element.name) >= 0.5);
    if (fields.length) return resolve(target, fields, null, edit('replace-all', { text: unquote(value) }), 'text field');
    // Correcting words inside a field needs that field to be focused; a merely gazed field is a guess.
    const focused = context.elements.find(element => textField(element) && element.id === context.focusedId);
    if (!focused) return { type: 'unknown', message: `Nothing called "${target}" is inside the gaze circle. To correct words, first select the text field.` };
    return edit('replace', { find: unquote(target), text: unquote(value) })(focused);
  }
  if ((match = /^(?:clear|empty|erase)(?: (?:the )?(.+?))?$/.exec(text))) {
    const name = match[1] && !/^(it|that|this|text|field|box|everything|all)$/.test(match[1]) ? match[1].replace(/ (field|box)$/, '') : null;
    return chooseField(name, context, edit('clear'));
  }
  if (/^(delete|remove|erase) (the )?(last|previous) word$|^backspace word$/.test(text)) return chooseField(null, context, edit('delete-word'));
  if (/^(new line|newline|next line)$/.test(text)) return chooseField(null, context, edit('append', { text: '\n', raw: true }));
  if (/^undo( that| typing)?$/.test(text)) return chooseField(null, context, edit('undo'));
  if (/^(submit|press enter|hit enter|press return|hit return|send it|submit (the )?form)$/.test(text)) {
    const act = element => ({ type: 'submit', targetId: element.id });
    const focused = context.elements.find(element => element.id === context.focusedId && element.editable);
    return focused ? act(focused) : deictic(context.elements.filter(element => element.editable || element.submits), act, 'form control');
  }

  // Choosing a value from a dropdown inside the circle.
  const choose = /^(?:choose|select|pick|set)\s+(.+?)(?:\s+(?:from|in|for)\s+(?:the\s+)?(.+))?$/.exec(text);
  if (choose) {
    const selects = context.elements.filter(element => element.options?.length &&
      (!choose[2] || matchScore(choose[2], element.name) >= 0.5));
    const picked = selectOption(choose[1], selects);
    if (picked) return picked;
  }

  // Resolve before eligibility; unsupported intent must refuse, never redirect.
  const disclosure = /^(expand|collapse)(?:\s+(.+))?$/.exec(text);
  if (disclosure) {
    const candidates = context.disclosureElements ?? context.elements;
    const subject = disclosure[2]?.replace(/^the\s+/, '');
    const act = element => ({ type: 'disclosure', targetId: element.id, expanded: disclosure[1] === 'expand' });
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

  const verbless = text.replace(ACTIVATE_VERB, '');
  const hint = /\s(link|button|tab|checkbox|box|field|menu|option)$/.exec(verbless)?.[1];
  const query = verbless.replace(/^the\s+/, '').trim();
  const act = element => ({ type: 'activate', targetId: element.id });
  if (DEICTIC.test(query)) return deictic(context.elements, act);
  if (!query) return { type: 'unknown', message: 'Say what to open or select.' };
  const counted = ORDINAL.exec(query);
  if (counted) return ordinal(counted[1], counted[2], context.elements, act);
  let resolved = resolve(query, context.elements, hint ? ROLE_HINTS[hint] : null, act);
  // A bare option name ("large print") selects it when no control has that name.
  if (resolved.type === 'unknown') {
    resolved = selectOption(query, context.elements.filter(element => element.options?.length)) ?? resolved;
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
