// Everyday ways of saying the navigator's own commands ("hang on", "yep", "down a bit", "scratch that"), rewritten to
// the wording the interpreter reads. Every pattern covers a whole utterance, so the same words inside a longer
// instruction ("type hang on a minute") are never rewritten.

// "A second", "one moment": an article is needed alone, so a bare "second" stays an answer to "which one?".
const A_MOMENT = '(?:(?:a|one|just a) )?(?:sec|second|moment|minute|min)', ONE_MOMENT = '(?:a|one) (?:sec|second|moment|minute|min)';
const SMALL = '(?:a (?:little|bit|tad)(?: bit)?|slightly|a touch)';
const ORDINAL_WORD = '(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\\d{1,2}(?:st|nd|rd|th))';
const CONFIRMING = new Set(['yes', 'yeah', 'yep', 'yup', 'sure', 'sure thing', 'ok', 'okay', 'absolutely', 'definitely', 'of course', 'affirmative',
  'correct', "that's right", "that's correct", 'please do', 'please', 'do it', 'go ahead', 'go for it', 'confirm', 'confirmed']);
const DECLINING = new Set(['no', 'nope', 'nah', 'no thanks', 'no thank you', 'not that', 'not that one', "don't", 'do not', "don't do it",
  "don't do that", 'no way', 'negative']);

// The utterance as a run of phrases from `phrases` and nothing else ("yeah go ahead", "no not that").
function only(phrases, text) {
  const words = text.split(' ');
  const reach = [true, ...words.map(() => false)];
  for (let start = 0; start < words.length; start++) {
    if (!reach[start]) continue;
    for (let end = start + 1; end <= Math.min(words.length, start + 4); end++) if (phrases.has(words.slice(start, end).join(' '))) reach[end] = true;
  }
  return reach[words.length];
}

// [pattern on the normalized text, replacement] for the navigator's controls, scrolling and editing.
const RULES = [
  [new RegExp(`^(?:abort(?: (?:it|that))?|stop (?:everything|it all|all of (?:it|that)|right now)|cancel (?:everything|it all|all of (?:it|that))|forget about (?:it|that)|never ?mind about (?:it|that))$`), 'cancel'],
  [new RegExp(`^(?:hold (?:it|up|on)(?: ${A_MOMENT})?|hang on(?: ${A_MOMENT})?|wait(?: ${A_MOMENT}| a bit| up)|(?:just |only )?${ONE_MOMENT}(?: please)?|give me ${A_MOMENT}|pause (?:for )?${ONE_MOMENT}|stop listening (?:for )?${ONE_MOMENT}|be right back)$`), 'pause'],
  [/^(?:carry on|keep going|go on|i'm back|i am back|back again|(?:let's|ok(?:ay)? let's|ok(?:ay)?) (?:continue|carry on|keep going|go on)|continue listening|listen again|start listening again|wake up)$/, 'resume'],
  [/^keep scrolling(?: (up|down))?$|^scroll (?:(up|down) )?(?:some )?more$/, match => `scroll ${match[1] ?? match[2] ?? 'down'}`],
  [new RegExp(`^(?:scroll |go |move )?(up|down) ${SMALL}(?: more)?$`), match => `scroll ${match[1]} a bit`],
  [new RegExp(`^(?:scroll |go |move )?${SMALL} (further|more|lower|higher)(?: (up|down))?$`), match => `scroll ${match[2] ?? (match[1] === 'higher' ? 'up' : 'down')} a bit`],
  [/^(?:scroll|go|move) (up|down) (the page|a page|one page|further)$|^(?:scroll|go|move) back (up|down)$/,
    match => (match[2] === 'the page' ? `scroll the page ${match[1]}` : `scroll ${match[1] ?? match[3]}`)],
  [/^(?:(?:scroll|go|jump|take me|bring me|get me|head) )?(?:back )?(?:up |down )?to the (?:very )?(top|bottom)( of (?:the|this) page)?$/,
    match => `scroll to the ${match[1]}${match[2] ? ' of the page' : ''}`],
  [/^(?:scroll |go )?all the way (?:(up|down)|to the (top|bottom))$/, match => `scroll to the ${match[2] ?? (match[1] === 'up' ? 'top' : 'bottom')}`],
  [/^(?:scratch (?:that|it)|take (?:that|it) back|take back (?:that|the last|my last) (?:change|edit)|undo (?:my|the) last (?:change|edit)s?|undo (?:that|this|the) (?:change|edit)|undo what i (?:just )?(?:typed|wrote|said))$/, 'undo'],
  [/^(?:delete|remove|erase|get rid of) (?:that|the) (?:last )?word$/, 'delete the last word'],
  [/^wipe(?: (?:it|that|everything|it all|the text))?$|^(?:delete|erase|clear) (?:everything|it all|all (?:of )?the text|all the words)$/, 'clear it'],
  [/^wipe (?:the )?(.+)$/, match => `clear the ${match[1]}`],
  [/^(?:start a |begin a )?new (?:line|paragraph)$|^line break$|^next paragraph$/, 'new line'],
  [/^(?:log|sign) me (?:in|on)$/, 'sign in'],
  [/^(?:log|sign) me (?:out|off)$/, 'sign out'],
  [/^(?:contact|call|email|ring|phone|message|reach|get hold of|get in touch with) (?:the )?(?:customer (?:service|services|support|care)|support(?: team)?|help ?desk|the team|someone|somebody|you|them|us)$/, 'open contact'],
];

/** The command reworded for the interpreter when it is an everyday way of saying one of the navigator's own. */
export function everydayCommand(command, normalize) {
  const text = normalize(command);
  if (only(CONFIRMING, text) && text !== 'please') return 'yes';
  if (only(DECLINING, text)) return 'no';
  const swap = /^swap\s+(.+?)\s+(?:for|with)\s+(.+)$/i.exec(command.trim());
  if (swap) return `replace ${swap[1]} with ${swap[2]}`;
  for (const [pattern, replacement] of RULES) {
    const match = pattern.exec(text);
    if (match) return typeof replacement === 'function' ? replacement(match) : replacement;
  }
  return command;
}

/**
 * A choice said without "choose": "make it hardcover", "switch to the audiobook", "I want the large print one",
 * "go with the paperback". The interpreter tries it as an option, then as a control.
 */
export function choiceSaid(text) {
  const said = /^(?:make it|make that|switch to|change to|go with|give me|i want|i'd like|i would like|i'll take|i'll have|i prefer|let's go with|let's have)(?: the)? (.+?)(?: one| version| edition| option| format)?$/.exec(text);
  return said && !/^(?:it|that|this|one)$/.test(said[1]) ? said[1] : null;
}

/** "Delete the second one", "read the first one", "open the third article": counted among controls of that kind. */
export function countedSaid(text) {
  const remove = new RegExp(`^(?:delete|remove|get rid of) (?:the )?${ORDINAL_WORD} (?:one|item|entry|row|line)$`).exec(text);
  if (remove) return { word: remove[1], named: /^(?:remove|delete)\b/i };
  const read = new RegExp(`^read (?:the )?${ORDINAL_WORD} (?:one|article|story|post)$`).exec(text);
  if (read) return { word: read[1], named: /^read\b/i, role: 'link' };
  return null;
}

// Kinds of list entry that are links: "the second article" counts the links in the circle.
export const LINK_NOUNS = new Set(['article', 'articles', 'story', 'stories', 'post', 'posts', 'result', 'results', 'entry', 'entries', 'headline', 'headlines']);
