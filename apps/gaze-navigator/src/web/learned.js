// Requests the navigator did not understand but whose offer the user confirmed ("Did you mean "Send message"?" —
// "yes"): said the same way again, they act on a control of that name and kind in or just outside the circle without
// asking. Only spoken requests confirmed by voice are learned, since a page cannot speak for the user; a control that
// may have consequences is still confirmed when used. Phrases taught by voice ("when I say basket, I mean open the
// basket") are kept with them: said again, the instruction they stand for is understood afresh where they are said. At
// most MAX_LEARNED are kept, the latest first.

export const MAX_LEARNED = 200;
// A taught phrase is a few words; the instruction it stands for, one instruction.
export const MAX_PHRASE = 60, MAX_INSTRUCTION = 200;
const LEARNABLE = new Set(['activate', 'check', 'select-option', 'select-radio']);
const plain = text => String(text ?? '').toLowerCase().replace(/[’‘]/g, "'").normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** What to remember from a confirmed offer: the words said and the control (and a dropdown's option) chosen, by name. */
export function learnedEntry(said, action, target) {
  const key = plain(said), name = plain(target?.name);
  if (!key || !name || !LEARNABLE.has(action?.type)) return null;
  const entry = { said: key, type: action.type, role: target.role ?? '', name };
  if (action.type !== 'select-option') return entry;
  const option = plain(target.options?.[action.optionIndex]);
  return option ? { ...entry, option } : null;
}

/** A phrase taught to stand for an instruction, or null when either is empty or too long. */
export function taughtEntry(phrase, instruction) {
  const said = plain(phrase), alias = String(instruction ?? '').replace(/\s+/g, ' ').trim();
  return said && said.length <= MAX_PHRASE && alias && alias.length <= MAX_INSTRUCTION ? { said, type: 'alias', alias } : null;
}

/** The list with this entry first, replacing any for the same words. */
export function withLearned(list, entry) {
  return [entry, ...(list ?? []).filter(item => item.said !== entry.said)].slice(0, MAX_LEARNED);
}

/** The list without the phrase `said` (as said, or as plain words). */
export function withoutLearned(list, said) {
  const key = plain(said);
  return (list ?? []).filter(item => item.said !== key);
}

/** Only well-formed entries, from storage the navigator wrote. */
export function validLearned(value) {
  if (!Array.isArray(value)) return [];
  const text = item => typeof item === 'string' && item.length > 0 && item.length <= 300;
  return value.filter(item => item && typeof item === 'object' && text(item.said) && (item.type === 'alias' ? text(item.alias)
    : text(item.name) && typeof item.role === 'string' && LEARNABLE.has(item.type) && (item.type !== 'select-option' || text(item.option)))).slice(0, MAX_LEARNED);
}

/**
 * A learned request said again: the action on the one control of the same name and kind in or just outside the
 * circle (a dropdown's option by its name), or null when there is none, or more than one.
 */
export function learnedAction(list, said, context) {
  const key = plain(said), entry = (list ?? []).find(item => item.said === key);
  if (!entry) return null;
  // A taught phrase: the instruction it stands for, to be understood where it is said.
  if (entry.type === 'alias') return { type: 'alias', instruction: entry.alias, said: entry.said };
  const found = [...(context?.elements ?? []), ...(context?.nearby ?? [])].filter(element => element.role === entry.role && plain(element.name) === entry.name);
  if (found.length !== 1) return null;
  const [element] = found;
  if (entry.type === 'select-option') {
    const optionIndex = (element.options ?? []).findIndex(option => plain(option) === entry.option);
    return optionIndex < 0 ? null : { type: 'select-option', targetId: element.id, optionIndex, optionName: element.options[optionIndex] };
  }
  return entry.type === 'check' ? { type: 'check', targetId: element.id, checked: true } : { type: entry.type, targetId: element.id };
}

/** A few learned requests as said, for a reply: "“fire it off” for send message; “basket” for “open the basket”". */
export function learnedSummary(list, count = 3) {
  return (list ?? []).slice(0, count).map(item => `“${item.said}” for ${item.type === 'alias' ? `“${item.alias}”` : item.option ?? item.name}`).join('; ');
}
