// Controls repeated on every row of a list or table (Remove, Delete, Edit, Save for later, a Quantity dropdown), told
// apart by what their row is about: "remove the socks", "edit my work address", "make the mug two". Each captured
// control may carry `row`, the text of the list item, table row or card it sits in. Only rows mentioning every
// meaningful word said are chosen; two such rows are asked about. A remove, save or quantity request naming something
// no row mentions does nothing, while "change" or "edit" falls through to the other rules, which also read them.

const REMOVE = /^(?:remove|delete|bin|trash|discard)\b/i;
const SAVE = /^(?:save for later|save)\b/i;
const EDIT = /^(?:edit|change|update|amend)\b/i;
const QUANTITY = /\b(?:quantity|qty|amount)\b/i;
const PLACE = '(?:the |my |your |our )?(?:basket|cart|bag|trolley|list|order|address book|addresses|saved items)';
const PHRASES = [
  { said: new RegExp(`^(?:remove|delete|bin|discard|drop|clear|throw away|get rid of|take out)\\s+(.+?)(?:\\s+(?:from|out of|off)\\s+${PLACE})?$`), controls: REMOVE, strict: true },
  { said: new RegExp(`^take\\s+(.+?)\\s+(?:out|off)(?:\\s+(?:(?:of|from)\\s+)?${PLACE})?$`), controls: REMOVE, strict: true },
  { said: /^i (?:don't|do not|dont|no longer) (?:want|need)\s+(.+?)(?:\s+any ?more)?$/, controls: REMOVE, strict: true },
  { said: /^(?:save|keep)\s+(.+?)\s+for later$/, controls: SAVE, strict: true },
  { said: /^(?:edit|change|update|amend|correct|fix)\s+(.+)$/, controls: EDIT, strict: false },
];
const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const COUNT = `(\\d{1,2}|${NUMBERS.slice(1).join('|')})`;
// "Make the mug two", "change the socks quantity to 3", "I want three hats", "just one hat", "three hats please". A count
// said with nothing else ("three hats please") is about a row only when one mentions what it names.
const AMOUNTS = [
  [new RegExp(`^(?:make|set)\\s+(.+?)\\s+(?:to\\s+)?${COUNT}$`), 1, 2],
  [new RegExp(`^(?:change|set|make)\\s+(.+?)\\s+(?:quantity|qty|amount)\\s+(?:to\\s+)?${COUNT}$`), 1, 2],
  [new RegExp(`^(?:i (?:want|need|'ll take|will take|'d like|would like)|give me|get me|i'll have)\\s+${COUNT}\\s+(.+)$`), 2, 1],
  [new RegExp(`^(?:just|only)\\s+${COUNT}\\s+(.+)$`), 2, 1],
  [new RegExp(`^(?:make (?:it|that)\\s+)?${COUNT}\\s+(.+?)(?:\\s+please)?$`), 2, 1, true],
];
// Word stems: lower case, possessives and plurals dropped ("mum's" is mum, "hats" hat, "boxes" box, "addresses" address).
const stem = word => word.replace(/'s$|s'$/, '').replace(/sses$/, 'ss').replace(/ies$/, 'y').replace(/(?:xes|ches|shes)$/, m => m.slice(0, -2)).replace(/(?<![su])s$/, '');
const words = text => (text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]+/g, ' ').split(' ').filter(Boolean).map(stem);
// Words that name no row: who, which, and the kind of thing the row is.
const FILLER = new Set(('the a an my your our this that these those one ones of for in on at from to with please item items entry entries row rows '
  + 'line lines thing things product products address addresses task tasks note notes reminder reminders any more it them basket cart bag trolley '
  + 'list order quantity').split(' ').map(stem));
const POSITIONS = /^(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|next|previous|top|bottom|\d{1,2}(?:st|nd|rd|th))$/;

function meaningful(item) {
  const kept = words(item).filter(word => !FILLER.has(word));
  return kept.length && !kept.every(word => POSITIONS.test(word)) ? kept : null;
}

// A control named by the words themselves ("Delete account") is the normal matcher's, not a row's.
const namedDirectly = (said, context) => [...(context.elements ?? []), ...(context.nearby ?? [])]
  .some(element => { const name = new Set(words(element.name)); return said.every(word => name.has(word)); });

/** Controls of this kind whose row mentions every word, from the circle first and then just outside it. */
function inRows(said, controls, context) {
  const pools = [context.elements ?? [], context.nearby ?? []];
  let seen = false;
  for (const pool of pools) {
    const candidates = pool.filter(element => element.row && controls(element));
    if (!candidates.length) continue;
    seen = true;
    const chosen = candidates.filter(element => { const row = new Set(words(element.row)); return said.every(word => row.has(word)); });
    if (chosen.length) return { chosen, seen };
  }
  return { chosen: [], seen };
}

// Choices are named by their row too ("Remove, Bobble hat"): the control's own name alone is the same on every row.
const named = chosen => chosen.map(element => ({ ...element, name: `${element.name}, ${element.row}` }));

/**
 * The action a row-named request means, or null when it is not one (or the page has no rows it could mean). `ask`
 * builds the interpreter's question among controls, given what choosing one does.
 */
export function rowAction(text, context, ask) {
  for (const [pattern, itemAt, countAt, loose] of AMOUNTS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const said = meaningful(match[itemAt]);
    if (!said || namedDirectly(said, context)) continue;
    const raw = match[countAt], count = /^\d+$/.test(raw) ? Number(raw) : NUMBERS.indexOf(raw);
    const { chosen, seen } = inRows(said, element => element.options?.length > 0 && QUANTITY.test(element.name ?? ''), context);
    if (!seen || (loose && !chosen.length)) continue;
    if (!chosen.length) return { type: 'unknown', message: `No row here mentions ${match[itemAt]}.` };
    if (chosen.length > 1) return ask(named(chosen), element => ({ type: 'select-option', targetId: element.id, optionIndex: element.options.findIndex(label => label.trim() === String(count)) }));
    const quantity = chosen[0], optionIndex = quantity.options.findIndex(label => label.trim() === String(count) || label.trim().toLowerCase() === NUMBERS[count]);
    if (optionIndex < 0) return { type: 'unknown', message: `${quantity.name} for ${quantity.row} has no ${count}.` };
    return { type: 'select-option', targetId: quantity.id, optionIndex };
  }
  for (const { said: pattern, controls, strict } of PHRASES) {
    const match = pattern.exec(text);
    if (!match) continue;
    const said = meaningful(match[1]);
    if (!said || namedDirectly(said, context)) continue;
    const { chosen, seen } = inRows(said, element => controls.test((element.name ?? '').trim()), context);
    if (!seen) continue;
    if (!chosen.length) {
      if (strict) return { type: 'unknown', message: `No row here mentions ${match[1]}.` };
      continue;
    }
    return chosen.length > 1 ? ask(named(chosen), element => ({ type: 'activate', targetId: element.id })) : { type: 'activate', targetId: chosen[0].id };
  }
  return null;
}
