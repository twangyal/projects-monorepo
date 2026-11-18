// Dropdown choices said the way people say them: "a medium" for M, "the UK" for United Kingdom, "two" for 2, "next
// day" or "tomorrow" for an express delivery, "pick it up in store" for click and collect, or one word of a longer
// option ("in green" for Forest green). Used only after an option's own name gave no strong match, and only an option
// that every meaningful word said belongs to is chosen; two or more such options are asked about, none is no choice.

const SIZES = new Map([
  ['xxs', ['extra extra small', 'double extra small', '2xs']], ['xs', ['extra small', 'x small']], ['s', ['small']],
  ['m', ['medium', 'med']], ['l', ['large']], ['xl', ['extra large', 'x large']], ['xxl', ['extra extra large', 'double extra large', '2xl']],
  ['xxxl', ['triple extra large', '3xl']],
]);
const COUNTRIES = new Map([
  ['united kingdom', ['uk', 'u k', 'britain', 'great britain', 'gb', 'england', 'scotland', 'wales', 'northern ireland']],
  ['united states', ['us', 'u s', 'usa', 'u s a', 'america', 'the states', 'united states of america']],
  ['united arab emirates', ['uae', 'emirates']], ['netherlands', ['holland', 'the netherlands']], ['new zealand', ['nz']],
  ['south korea', ['korea']], ['czech republic', ['czechia']],
]);
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
// What a dropdown is called, as said: its words are dropped from the choice ("size large", "standard shipping").
const FIELD_WORDS = new Map([['delivery', ['delivery', 'shipping', 'postage', 'method']], ['shipping', ['delivery', 'shipping', 'postage', 'method']],
  ['colour', ['colour', 'color']], ['color', ['colour', 'color']], ['quantity', ['quantity', 'qty', 'amount']], ['country', ['country', 'region']]]);
// Words that carry no choice: who, wanting and politeness ("I'll take it in large please").
const FILLER = new Set(('a an the it its them this that these those one ones in on of for to at from with please just only '
  + "i i'll i'd i'm im ill id we we'll we're my me you your do does have has want would like need get take make can could will "
  + 'is be fine ok okay version edition option choice thanks about regarding concerning').split(' '));
// Other words for words in options' names, as people say them: "softback" for Paperback, "the shop" for in store, "a
// complaint" for an Order problem, "an idea" for a Book suggestion.
const SYNONYMS = new Map(Object.entries({
  paperback: ['softback', 'softcover', 'paper'], hardcover: ['hardback', 'hardbound'], hardback: ['hardcover', 'hardbound'],
  audiobook: ['audio'], ebook: ['kindle', 'digital', 'electronic'], store: ['shop'], shop: ['store'],
  problem: ['complaint', 'issue', 'trouble', 'fault'], issue: ['problem', 'complaint', 'trouble', 'fault'], complaint: ['problem', 'issue'],
  suggestion: ['idea', 'proposal', 'recommendation'], question: ['query', 'enquiry', 'inquiry'], enquiry: ['question', 'query', 'inquiry'],
  delivery: ['shipping', 'postage'], collection: ['pickup'],
}));
const withSynonyms = known => new Set([...known, ...[...known].flatMap(word => SYNONYMS.get(word) ?? [])]);

const normalize = text => (text ?? '').toLowerCase().replace(/[’‘]/g, "'").normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
const words = text => normalize(text).split(' ').filter(Boolean).map(word => word === 'gray' ? 'grey' : word);

/** The names in "red, green and blue" (or "red & blue", "red plus blue"); null for one name. */
export function namesIn(said) {
  const names = (said ?? '').split(/\s*,\s*|\s+(?:and|&|plus)\s+/i).map(name => name.replace(/^(?:and|&)\s+/i, '').trim()).filter(Boolean);
  return names.length > 1 ? names : null;
}

/** Names as said in a sentence: "Red", "Red and Blue", "Red, Green and Blue". */
export const sentence = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** Other names for an option: a size's name, a country's short names, a number's word, what a delivery choice does. */
export function optionMeanings(option) {
  const name = normalize(option), found = [];
  if (SIZES.has(name.replace(/ /g, ''))) found.push(...SIZES.get(name.replace(/ /g, '')));
  for (const [country, names] of COUNTRIES) if (name === country || name.startsWith(`${country} `)) found.push(...names);
  if (/^\d+$/.test(name) && Number(name) < NUMBER_WORDS.length) found.push(NUMBER_WORDS[Number(name)]);
  if (/\bnext (?:working |business )?day\b|\bovernight\b/.test(name)) found.push('next day', 'tomorrow', 'overnight', 'express', 'fast');
  if (/\bcollect(?:ion)?\b|\bpick ?up\b|\bin store\b/.test(name)) found.push('pick up', 'pick it up', 'pick up in store', 'pick it up in store', 'collect', 'collect it', 'collection', 'in store', 'store pickup');
  if (/\bstandard\b/.test(name)) found.push('standard', 'regular', 'normal');
  return found;
}

/** The said choice's meaningful words for one dropdown: its own name's words and filler dropped. */
function wanted(said, select) {
  const field = new Set(words(select.name ?? '').flatMap(word => FIELD_WORDS.get(word) ?? [word]));
  const kept = words(said).filter(word => !FILLER.has(word) && !field.has(word));
  // "One" is a filler ("that one") unless it is the whole choice ("just one").
  return kept.length || normalize(said) !== 'one' ? kept : ['one'];
}

/**
 * The options of these dropdowns that the said choice means: `exact`, those it names exactly (by their own name or
 * another one), and `containing`, those all of whose meaningful words were said. Each is { select, optionIndex, name }.
 */
export function choicesMeant(said, selects) {
  const exact = [], containing = [];
  for (const select of selects) {
    const asked = wanted(said, select);
    if (!asked.length) continue;
    const phrase = asked.join(' ');
    select.options.forEach((name, optionIndex) => {
      const meanings = optionMeanings(name), own = words(name);
      if (normalize(name) === phrase || meanings.includes(phrase)) exact.push({ select, optionIndex, name });
      else {
        const known = withSynonyms(new Set([...own, ...meanings.flatMap(words)]));
        if (asked.every(word => known.has(word))) containing.push({ select, optionIndex, name });
      }
    });
  }
  return { exact, containing };
}

/** The options meant: those named exactly if any, otherwise those containing every meaningful word said. */
export function meantOptions(said, selects) {
  const { exact, containing } = choicesMeant(said, selects);
  return exact.length ? exact : containing;
}

/** "Go one size up", "a size smaller": the size next to the current one, or null when that is not what was said. */
export function nextSize(said) {
  const text = normalize(said);
  const match = /^(?:go |try |make it |get )?(?:a |one )?size (up|down|bigger|larger|smaller)$/.exec(text)
    ?? /^(?:go )?(up|down) (?:a|one) size$/.exec(text) ?? /^(?:the )?next size (up|down)$/.exec(text)
    ?? /^(?:a |one )?(bigger|larger|smaller) size$/.exec(text);
  return match ? (/up|bigger|larger/.test(match[1]) ? 1 : -1) : null;
}

// Choices said by where they come among a dropdown's options: "the largest size", "the smallest one", "the cheapest",
// "the most expensive", "the quickest delivery", "the first option", "the last one".
const SIZE_ORDER = ['xxxs', 'xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl'];
const SIZE_WORDS = new Map([...SIZES].flatMap(([size, names]) => [[size, size], ...names.map(name => [name, size])]));
const RANKS = new Map([
  ['largest', ['size', 1]], ['biggest', ['size', 1]], ['smallest', ['size', -1]], ['tiniest', ['size', -1]],
  ['cheapest', ['price', -1]], ['least expensive', ['price', -1]], ['lowest priced', ['price', -1]],
  ['most expensive', ['price', 1]], ['priciest', ['price', 1]], ['dearest', ['price', 1]],
  ['quickest', ['speed', -1]], ['fastest', ['speed', -1]], ['soonest', ['speed', -1]], ['earliest', ['speed', -1]],
  ['first', ['order', -1]], ['last', ['order', 1]],
]);
const RANKED = new RegExp(`^(?:the |a |an )?(${[...RANKS.keys()].join('|')})(?: (?:possible|available))?(?: ([a-z]+(?: [a-z]+)??))??(?: (?:one|option|choice))?$`);

/** A choice said by its rank ("the largest size"): what it is ranked by, which end, and the dropdown named, if any. */
export function rankSaid(said) {
  const text = normalize(said)
    .replace(/^(?:i'd like|i would like|i want|i need|i'll take|ill take|i'll have|give me|go for|choose|select|pick|get|make it|switch to|change to|change it to)\s+/, '')
    .replace(/\s+please$/, '')
    // "The biggest one you have", "the cheapest there is": who has it says nothing about which.
    .replace(/\s+(?:(?:that|which) )?(?:you|they|we)(?: have| have got|'ve got|'ve| sell| stock| do| offer| make)$|\s+(?:there is|there's|available|going|in stock|on offer)$/, '')
    // "The fastest way to get it", "the cheapest way to send it": a way of getting it is its delivery.
    .replace(/\s+(?:way|option|method|service) (?:to|of) (?:get|getting|have|having|receive|receiving|send|sending|ship|shipping|deliver|delivering)(?: (?:it|them|this|that|these|those))?(?: (?:here|to me|to us|delivered|sent|shipped))?$/, ' delivery')
    .replace(/\s+way$/, ' delivery');
  const match = RANKED.exec(text);
  if (!match) return null;
  const [by, end] = RANKS.get(match[1]);
  return { by, end, noun: match[2] ?? null };
}

/** How an option ranks by size (smallest first), price, delivery time in days, or not at all (null). */
export function rankValue(option, by) {
  const name = normalize(option);
  if (by === 'size') {
    const size = SIZE_WORDS.get(name) ?? SIZE_WORDS.get(name.replace(/ /g, ''));
    if (size) return SIZE_ORDER.indexOf(size);
    const number = /^(?:uk |us |eu |size )?(\d+(?:\.\d+)?)$/.exec(name);
    return number ? 100 + Number(number[1]) : null;
  }
  if (by === 'price') {
    if (/\bfree\b/.test(name)) return 0;
    const price = /[£$€¥]\s?(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s?(?:£|€|eur|usd|gbp|dollars?|pounds?|euros?)\b/i.exec(option ?? '');
    return price ? Number((price[1] ?? price[2]).replace(',', '.')) : null;
  }
  if (by === 'speed') {
    if (/\bsame day\b/.test(name)) return 0;
    if (/\bnext (?:working |business )?day\b|\btomorrow\b|\bovernight\b/.test(name)) return 1;
    const range = /\b(\d+)\s*(?:-|to)\s*(\d+)\s*(?:working |business )?days?\b/.exec(name.replace(/(\d) (\d)/, '$1-$2'))
      ?? /\b(\d+) (\d+) (?:working |business )?days?\b/.exec(name);
    if (range) return (Number(range[1]) + Number(range[2])) / 2;
    const days = /\b(\d+) (?:working |business )?days?\b/.exec(name);
    if (days) return Number(days[1]);
    if (/\bexpress\b|\bpriority\b|\bexpedited\b/.test(name)) return 1.5;
    if (/\bstandard\b|\beconomy\b|\bregular\b/.test(name)) return 4;
    return null;
  }
  // In order: every option but a prompt such as "Choose a size".
  return /^(?:choose|select|pick|please)\b|^-+$|^$/.test(name) ? null : 0;
}

/** Dropdown names that say what a rank is about ("the quickest delivery" means the delivery dropdown). */
const RANK_FIELDS = { size: /\bsizes?\b/, speed: /\b(?:delivery|shipping|postage|dispatch|despatch)\b/, price: null, order: null };

/**
 * The option a rank said means among these choice lists (each { name, options }): in the list the rank's noun names,
 * or the one list whose options can be ranked that way (preferring one named for it, "Delivery" for the quickest), its
 * option at that end. Null when no list fits, or when several do and none is named.
 */
export function rankedOption(rank, lists) {
  const field = (list, noun) => {
    const own = words(list.name ?? '').flatMap(word => FIELD_WORDS.get(word) ?? [word]);
    return words(noun).every(word => own.includes(word) || (FIELD_WORDS.get(word) ?? []).some(other => own.includes(other)));
  };
  const named = rank.noun ? lists.filter(list => field(list, rank.noun)) : lists;
  const scored = named.map(list => {
    const values = list.options.map(option => rankValue(option, rank.by));
    return { list, values, known: values.filter(value => value !== null).length };
  }).filter(entry => entry.known >= 2 && (rank.by !== 'size' || entry.known >= entry.values.length - 1));
  let fits = scored;
  if (fits.length > 1 && RANK_FIELDS[rank.by]) fits = fits.filter(entry => RANK_FIELDS[rank.by].test(normalize(entry.list.name)));
  if (fits.length !== 1) return null;
  const { list, values } = fits[0];
  let best = -1;
  values.forEach((value, index) => {
    if (value === null) return;
    const order = rank.by === 'order' ? index : value, current = best < 0 ? null : rank.by === 'order' ? best : values[best];
    if (best < 0 || (rank.end > 0 ? order > current : order < current)) best = index;
  });
  return best < 0 ? null : { list, optionIndex: best, name: list.options[best] };
}
