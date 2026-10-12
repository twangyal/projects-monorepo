// Interpretation stage: maps one instruction plus a described gaze context to one typed action.
// Deterministic rules form the baseline; a model interpreter can implement the same contract.

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const STOPWORDS = new Set(['the', 'a', 'an', 'on', 'to', 'please', 'my', 'this', 'that', 'link', 'button', 'tab', 'field', 'box', 'checkbox', 'menu', 'option', 'page', 'item', 'input']);
const ROLE_HINTS = { link: ['link'], button: ['button'], tab: ['tab'], checkbox: ['checkbox', 'switch'], box: ['checkbox', 'textbox', 'searchbox'], field: ['textbox', 'searchbox', 'combobox'], menu: ['combobox', 'menuitem'], option: ['option', 'combobox', 'radio'] };
// Scores closer than this are treated as equally plausible and trigger a question.
const MARGIN = 0.05;
const DEICTIC = /^(this|that|it|here|there|this one|that one)$/;
const ACTIVATE_VERB = /^(?:click|tap|press|push|hit|open|follow|select|choose|pick|activate|check|uncheck|tick|untick|toggle|expand|collapse|go to|show|view|visit)\s+(?:on\s+)?/;

export const normalize = text => text.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}'\s]+/gu, ' ').replace(/\s+/g, ' ').trim();

function tokens(text) {
  return normalize(text).split(' ').filter(token => token && !STOPWORDS.has(token))
    .map(token => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token));
}

export function parseNumber(text) {
  const word = normalize(text).replace(/^(?:number|option|choice|item)\s+/, '').replace(/\s+one$/, '');
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
  if (` ${n} `.includes(` ${q} `)) return 0.9;
  const shared = qTokens.filter(token => nTokens.includes(token)).length;
  // Word overlap stays below a contained phrase, so reordered words ("high to low") never tie an exact name.
  return 0.7 * (shared / qTokens.length) + 0.1 * (shared / nTokens.length);
}

function rank(query, elements, roles) {
  return elements
    .map(element => {
      let score = matchScore(query, element.name);
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

function chooseField(fieldName, context, act) {
  const fields = context.elements.filter(element => element.editable);
  if (fieldName) return resolve(fieldName, fields, null, act, 'text field');
  const focused = fields.find(element => element.id === context.focusedId);
  if (focused) return act(focused);
  return deictic(fields, act, 'text field');
}

const edit = (kind, extra = {}) => element => ({ type: 'edit', targetId: element.id, edit: { kind, ...extra } });

function unquote(text) {
  const match = /^["“](.*)["”]$/.exec(text.trim());
  return match ? match[1] : text.trim();
}

export function interpret(utterance, context = { elements: [] }) {
  const raw = (utterance ?? '').trim();
  const text = normalize(raw);
  if (!text) return { type: 'unknown', message: 'No instruction was heard.' };

  if (/^(cancel|stop|never ?mind|forget it)$/.test(text)) return { type: 'cancel' };
  if (/^(pause|pause listening|stop listening|pause navigator|hold on)$/.test(text)) return { type: 'pause' };
  if (/^(resume|continue|unpause|start listening)$/.test(text)) return { type: 'resume' };
  if (/^(yes|confirm|do it|go ahead|ok|okay|yes please)$/.test(text)) return { type: 'confirm' };
  if (/^(no|no thanks|don't|do not)$/.test(text)) return { type: 'deny' };
  const choice = /^(?:number|option|choice|item|choose|pick|select|click|press|open)?\s*(.+)$/.exec(text);
  const chosen = choice && parseNumber(choice[1]);
  if (chosen) return { type: 'choose', index: chosen };

  if (/^(go )?back( a page)?$|^previous page$/.test(text)) return { type: 'back' };
  if (/^(go )?forward( a page)?$|^next page$/.test(text)) return { type: 'forward' };
  if (/^(page down|next screen)$/.test(text)) return { type: 'scroll', direction: 'down', amount: 'page' };
  if (/^page up$/.test(text)) return { type: 'scroll', direction: 'up', amount: 'page' };
  const scroll = /^scroll(?: (?:the )?(?:page|list|area|region))?(?: (up|down|left|right))?(?: (a bit|a little|slightly|more|a lot))?$/.exec(text) ??
    /^scroll to (?:the )?(top|bottom)$/.exec(text);
  if (scroll) {
    return { type: 'scroll', direction: scroll[1] ?? 'down', amount: /bit|little|slightly/.test(scroll[2] ?? '') ? 'small' : 'page' };
  }

  // Text editing keeps the user's original wording, capitalization and punctuation.
  let match;
  if ((match = /^search(?: for)?\s+(.+)$/i.exec(raw))) {
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
    const [content, field] = quoted ? [quoted[1], quoted[2]] : into ? [into[1], into[2]] : [match[1], null];
    return chooseField(field?.replace(/\s+(field|box|input)$/i, ''), context, edit('append', { text: content }));
  }
  if ((match = /^(?:set|change|replace)(?: (?:it|that|the text|everything|all))? (?:to|with)\s+(.+)$/i.exec(raw))) {
    return chooseField(null, context, edit('replace-all', { text: unquote(match[1]) }));
  }
  if ((match = /^replace\s+(.+?)\s+with\s+(.+)$/i.exec(raw))) {
    return chooseField(null, context, edit('replace', { find: unquote(match[1]), text: unquote(match[2]) }));
  }
  if ((match = /^(?:clear|empty|erase)(?: (?:the )?(.+?))?$/.exec(text))) {
    const name = match[1] && !/^(it|that|this|text|field|box|everything|all)$/.test(match[1]) ? match[1].replace(/ (field|box)$/, '') : null;
    return chooseField(name, context, edit('clear'));
  }
  if (/^(delete|remove|erase) (the )?(last|previous) word$|^backspace word$/.test(text)) return chooseField(null, context, edit('delete-word'));
  if (/^(new line|newline|next line)$/.test(text)) return chooseField(null, context, edit('append', { text: '\n', raw: true }));
  if (/^undo( that| typing)?$/.test(text)) return chooseField(null, context, edit('undo'));
  if (/^(submit|press enter|send it|submit (the )?form)$/.test(text)) {
    const act = element => ({ type: 'submit', targetId: element.id });
    const focused = context.elements.find(element => element.id === context.focusedId && element.editable);
    return focused ? act(focused) : deictic(context.elements.filter(element => element.editable || element.submits), act, 'form control');
  }

  // Choosing a value from a dropdown inside the circle.
  const choose = /^(?:choose|select|pick|set)\s+(.+?)(?:\s+(?:from|in|for)\s+(?:the\s+)?(.+))?$/.exec(text);
  if (choose) {
    const selects = context.elements.filter(element => element.options?.length &&
      (!choose[2] || matchScore(choose[2], element.name) >= 0.5));
    const options = selects.flatMap(element => element.options.map((name, optionIndex) => ({ ...element, name, optionIndex, selectId: element.id })));
    const ranked = rank(choose[1], options);
    const pick = option => ({ type: 'select-option', targetId: option.selectId, optionIndex: option.optionIndex, optionName: option.name });
    const close = ranked.filter(entry => entry.score >= ranked[0].score - MARGIN).map(entry => entry.element);
    if (close.length === 1 && ranked[0].score >= 0.9) return pick(close[0]);
    if (close.length > 1) {
      return question(close.map((option, index) => ({ number: index + 1, label: option.name, elementId: option.selectId })),
        number => pick(close[number - 1]));
    }
  }

  const verbless = text.replace(ACTIVATE_VERB, '');
  const hint = /\s(link|button|tab|checkbox|box|field|menu|option)$/.exec(verbless)?.[1];
  const query = verbless.replace(/^the\s+/, '').trim();
  const act = element => ({ type: 'activate', targetId: element.id });
  if (DEICTIC.test(query)) return deictic(context.elements, act);
  if (!query) return { type: 'unknown', message: 'Say what to open or select.' };
  const resolved = resolve(query, context.elements, hint ? ROLE_HINTS[hint] : null, act);
  if (resolved.type === 'unknown' && verbless === text && !hint) {
    return { type: 'unknown', message: `"${raw}" was not understood. Try "open" or "click" and a name, "type", "scroll down", "go back" or "cancel".` };
  }
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
