// Rules first, a calibrated model (WaterSheep) only for choosing which control a request names.
// Verbs, dictated text, numbers and safety words (cancel/pause/confirm) stay deterministic and
// instant. The model is consulted in three narrow cases:
//   - an activation was requested ("open …") but no control's name matched: pick the control;
//   - the rules asked "Which one?" between controls: pick among exactly those candidates, keeping
//     the rules' own action for the pick, so identical names (three "Read more") stay a question;
//   - the instruction was not understood at all: first a yes/no question whether it asks to use a
//     control (so "hang on" or "sure" can never press a link), then the pick.
// Only the instruction and the controls' role, name, checked state and choices are sent; never
// field values, page text or addresses. A confident pick still passes through the controller's
// confirmation of consequential actions; a split answer becomes a numbered question; anything
// else keeps the rule answer.
import { interpret as interpretRules } from './interpreter.js';

export const TARGET_QUESTION = 'Which on-screen control should this spoken instruction act on?';
export const INTENT_QUESTION = 'Does this spoken instruction ask to press, open or select a control on the screen?';
export const NONE_OPTION = 'none of these';
/** Act on the model's pick only at or above this calibrated probability. */
export const ACCEPT = 0.8;
/** Consult the pick for an unparsed instruction only when "uses a control" is at least this likely. */
export const INTENT = 0.8;
/** Ask about the model's top candidates when together they are at least this likely. */
export const SHORTLIST = 0.6;
const CANDIDATE_FLOOR = 0.15;
const MAX_CANDIDATES = 3;

const ROLE_NAMES = { link: 'link', button: 'button', textbox: 'text field', searchbox: 'search field', combobox: 'dropdown', checkbox: 'checkbox',
  radio: 'radio button', tab: 'tab', menuitem: 'menu item', option: 'option', switch: 'switch', Clickable: 'clickable item' };

/** What the model is told about one control: its role, name and state, nothing else. */
export function describeElement(element) {
  const parts = [`${ROLE_NAMES[element.role] ?? element.role} "${element.name || 'unnamed'}"`];
  if (element.checked !== undefined) parts.push(element.checked ? 'checked' : 'not checked');
  if (element.options?.length) parts.push(`choices: ${element.options.join(', ')}`);
  return parts.join(', ');
}

const valid = (probs, length) => Array.isArray(probs) && probs.length === length && probs.every(p => p >= 0 && p <= 1);

/**
 * An async interpreter (rules, then the model when it can help) with `needs(utterance, context,
 * ruleAction)` and `improve(utterance, context, ruleAction)` for callers that run the rules themselves.
 * @param {object} options
 * @param {{decide: Function, yes: Function}} options.model WaterSheep (or any calibrated decider)
 * @param {Function} [options.rules] the deterministic interpreter
 */
export function createAssistedInterpreter({ model, rules = interpretRules, accept = ACCEPT, intent = INTENT, shortlist = SHORTLIST }) {
  // Ask for a pick among `choices` ({element, act}); act, ask, or return null to keep the rule answer.
  async function pick(utterance, choices) {
    const { probs } = await model.decide(utterance, TARGET_QUESTION, [...choices.map(choice => describeElement(choice.element)), NONE_OPTION]);
    if (!valid(probs, choices.length + 1)) return null;
    const ranked = choices.map((choice, i) => ({ ...choice, p: probs[i] })).sort((a, b) => b.p - a.p);
    const assisted = { by: 'watersheep', confidence: Math.round(ranked[0].p * 1000) / 1000 };
    // Asking to choose something never just opens a dropdown: that would look like an answer but change nothing chosen.
    const choosing = /^\s*(?:please\s+)?(?:choose|select|pick|set|switch)\b/i.test(utterance);
    if (ranked[0].p >= accept && !(choosing && ranked[0].element.options?.length)) return { ...ranked[0].act(), assisted };
    const candidates = ranked.filter(entry => entry.p >= CANDIDATE_FLOOR).slice(0, MAX_CANDIDATES);
    if (candidates.length < 2 || candidates.reduce((sum, entry) => sum + entry.p, 0) < shortlist) return null;
    return {
      type: 'clarify', assisted,
      candidates: candidates.map(({ element }) => ({ number: element.id, label: element.name || element.role, elementId: element.id })),
      choose: number => candidates.find(entry => entry.element.id === number)?.act() ?? { type: 'unknown', message: `${number} was not one of the choices.` },
      message: `Did you mean ${candidates.map(({ element }) => `${element.id}: ${element.name || element.role}`).join('; ')}? Say a number or cancel.`,
    };
  }

  // Tie-breaking is possible only among controls the rules proposed that words can tell apart.
  function tieBreakChoices(action, elements) {
    const choices = action.candidates.map(candidate => ({ element: elements.find(element => element.id === candidate.elementId), number: candidate.number }))
      .filter(choice => choice.element);
    // Controls described identically (two "Remove" buttons) cannot be told apart from words: keep the question.
    if (choices.length !== action.candidates.length || new Set(choices.map(choice => choice.element.id)).size !== choices.length
      || new Set(choices.map(choice => describeElement(choice.element))).size !== choices.length) return null;
    return choices;
  }

  /** Whether the model could help with this rule answer at all; everything else stays instant. */
  function needs(utterance, context, action) {
    const elements = context?.elements ?? [];
    if (!(utterance ?? '').trim() || !elements.length) return false;
    if (action.type === 'clarify') return Boolean(tieBreakChoices(action, elements));
    return action.type === 'unknown' && (action.targetQuery !== undefined || Boolean(action.unparsed));
  }

  /** The model-assisted answer for a rule answer that `needs` help; the rule answer when unsure or failing. */
  async function improve(utterance, context, action) {
    if (!needs(utterance, context, action)) return action;
    const elements = context.elements, said = utterance.trim();
    const activate = element => () => ({ type: 'activate', targetId: element.id });
    try {
      if (action.type === 'clarify') {
        const picked = await pick(said, tieBreakChoices(action, elements).map(choice => ({ element: choice.element, act: () => action.choose(choice.number) })));
        return picked?.type === 'clarify' ? action : picked ?? action;
      }
      if (action.unparsed && !(await model.yes(said, INTENT_QUESTION) >= intent)) return action;
      return (await pick(said, elements.map(element => ({ element, act: activate(element) })))) ?? action;
    } catch {
      return action; // The model is optional: any failure keeps the rule answer.
    }
  }

  const interpret = async (utterance, context = { elements: [] }) => improve(utterance, context, rules(utterance, context));
  return Object.assign(interpret, { needs, improve });
}
