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
  + 'is be fine ok okay version edition option choice thanks').split(' '));

const normalize = text => (text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
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
        const known = new Set([...own, ...meanings.flatMap(words)]);
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
