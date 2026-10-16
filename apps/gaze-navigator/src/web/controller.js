// Coordinates interpretation, clarification, confirmation and execution for one page.
// Tracking and speech supply contexts and instructions; this module owns what happens next.
import { applyEdit, interpret as interpretRules } from './interpreter.js';
import * as pageActions from './page-actions.js';

const CONFIRM_MS = 15000;
const HISTORY_LIMIT = 20;

function targetOf(context, id) {
  return context.elements.find(element => element.id === id) ?? (context.pageSearch?.id === id ? context.pageSearch : null);
}

// `commands` handles navigator-level actions (tracking source, calibration) outside the page.
// `assistant` (optional, see assisted-interpreter.js) may improve rule answers that named no control;
// its answer arrives later as `followUp` and is dropped if any newer instruction came first.
export function createController({ window, actions = pageActions, interpret = interpretRules, commands = {}, assistant = null, now = () => Date.now(), confirmMs = CONFIRM_MS }) {
  let paused = false;
  let pending = null;
  let turn = 0;
  const history = new WeakMap();

  const reply = (message, tone = 'info', extra = {}) => ({ message, tone, pending: pending && { kind: pending.kind, candidates: pending.candidates ?? null }, ...extra });

  function confirmable(action, element) {
    if (action.type === 'activate') return element.consequential;
    if (action.type === 'submit' || action.type === 'search') return element.role !== 'searchbox' && !/search/i.test(element.name);
    return false;
  }

  function perform(action, context) {
    if (['activate', 'submit', 'edit', 'search', 'select-option', 'select-text'].includes(action.type)) {
      const target = targetOf(context, action.targetId);
      if (!target?.element?.isConnected) return reply('That control is no longer on the page. Look at it again.', 'error');
      if (confirmable(action, target)) {
        pending = { kind: 'confirm', action, context, expiresAt: now() + confirmMs };
        const label = target.name || target.role;
        return reply(`"${label}" may have consequences. Say confirm to continue, or cancel.`, 'question');
      }
    }
    return execute(action, context);
  }

  function execute(action, context) {
    pending = null;
    const target = targetOf(context, action.targetId);
    const element = target?.element;
    if (['activate', 'submit', 'edit', 'search', 'select-option', 'select-text'].includes(action.type) && !element?.isConnected) {
      return reply('That control is no longer on the page. Look at it again.', 'error');
    }
    let result;
    switch (action.type) {
      case 'activate': result = actions.activate(element, target.name, { preserveFocus: Boolean(context.preserveFocus) }); break;
      case 'submit': result = actions.submit(element); break;
      case 'select-text': result = actions.selectText(element, action.position); break;
      case 'select-option': result = actions.selectOption(element, action.optionIndex); break;
      case 'search': {
        remember(element);
        actions.writeValue(element, action.text);
        result = actions.submit(element);
        if (result.ok) result = { ok: true, message: `Searching for "${action.text}".` };
        break;
      }
      case 'edit': result = edit(element, target.name, action.edit); break;
      case 'scroll': result = actions.scroll(context.region, action.direction, action.amount, window); break;
      case 'back':
      case 'forward': result = actions.navigate(window, action.type); break;
      default: return reply('That action is not supported yet.', 'error');
    }
    return reply(result.message, result.ok ? 'success' : 'error', { performed: result.ok ? action.type : null });
  }

  function remember(element) {
    const values = history.get(element) ?? [];
    values.push(actions.readValue(element));
    if (values.length > HISTORY_LIMIT) values.shift();
    history.set(element, values);
  }

  function edit(element, name, change) {
    const before = actions.readValue(element) ?? '';
    const values = history.get(element) ?? [];
    const selection = change.kind === 'insert-selection' ? actions.readSelection(element) : null;
    if (change.kind === 'insert-selection' && !selection) {
      return { ok: false, message: 'Insertion commands need a writable native text field. This field does not support them.' };
    }
    if (change.kind === 'insert-selection' && change.requireSelection && selection.start === selection.end) {
      return { ok: false, message: 'No text is selected. Say “select all text” or select the words first.' };
    }
    const after = change.kind === 'insert-selection'
      ? before.slice(0, selection.start) + change.text + before.slice(selection.end)
      : applyEdit(before, change, values);
    const label = name || 'the field';
    if (after === null) {
      return { ok: false, message: change.kind === 'undo' ? `Nothing to undo in ${label}.` : `"${change.find}" was not found in ${label}.` };
    }
    if (change.kind === 'undo') values.pop();
    else remember(element);
    actions.writeValue(element, after, change.kind === 'insert-selection'
      ? { caret: selection.start + change.text.length } : undefined);
    return { ok: true, message: after ? `${label}: ${after}` : `${label} cleared.` };
  }

  function handle(utterance, context) {
    const current = ++turn;
    const action = interpret(utterance, context);
    if (action.type === 'cancel') {
      const had = pending;
      pending = null;
      return reply(had ? 'Cancelled. Nothing was changed.' : 'Cancelled.', 'info', { cancelled: true });
    }
    if (action.type === 'pause') {
      paused = true;
      pending = null;
      return reply('Paused. Say resume to continue.', 'info', { paused: true });
    }
    if (action.type === 'resume') {
      paused = false;
      return reply('Resumed. Look at something and say what to do.', 'info', { paused: false });
    }
    // Switching or stopping the camera stays available while paused.
    if (action.type === 'tracking' || action.type === 'calibrate') {
      pending = null;
      const handler = action.type === 'tracking' ? commands.tracking : commands.calibrate;
      if (!handler) return reply('Camera tracking is not available here.', 'error');
      const result = handler(action.source);
      return reply(result.message, result.ok ? 'success' : 'error');
    }
    if (paused) return reply('Paused. Say resume to continue, or cancel.', 'info');

    if (pending?.kind === 'confirm') {
      const confirmation = pending;
      if (action.type === 'confirm') {
        if (now() > confirmation.expiresAt) {
          pending = null;
          return reply('That confirmation expired. Give the instruction again.', 'error');
        }
        return execute(confirmation.action, confirmation.context);
      }
      pending = null;
      if (action.type === 'deny') return reply('Cancelled. Nothing was changed.', 'info', { cancelled: true });
    }
    if (pending?.kind === 'clarify') {
      const question = pending;
      if (action.type === 'choose') {
        if (!question.candidates.some(candidate => candidate.number === action.index)) {
          return reply(`Say one of ${question.candidates.map(candidate => candidate.number).join(', ')}, or cancel.`, 'question');
        }
        pending = null;
        return perform(question.choose(action.index), question.context);
      }
      pending = null;
      if (action.type === 'deny') return reply('Cancelled. Nothing was changed.', 'info', { cancelled: true });
    }

    switch (action.type) {
      case 'confirm':
      case 'deny': return reply('There is nothing waiting for confirmation.', 'info');
      case 'choose': {
        const target = context.elements.find(element => element.id === action.index);
        if (!target) return reply(`There is no number ${action.index} in the gaze circle.`, 'error');
        return perform({ type: 'activate', targetId: target.id }, context);
      }
      case 'clarify':
      case 'unknown':
        if (assistant?.needs(utterance, context, action)) {
          const followUp = assistant.improve(utterance, context, action).catch(() => action)
            // A newer instruction (including cancel or pause) makes this answer stale.
            .then(improved => (current === turn && !paused ? respond(improved, context) : null));
          return reply('Working out which control you mean…', 'info', { assisting: true, followUp });
        }
        return respond(action, context);
      default: return perform(action, context);
    }
  }

  function respond(action, context) {
    switch (action.type) {
      case 'clarify':
        pending = { kind: 'clarify', candidates: action.candidates, choose: action.choose, context };
        return reply(action.message, 'question');
      case 'unknown': return reply(action.message, 'error');
      default: return perform(action, context);
    }
  }

  return {
    handle,
    get paused() { return paused; },
    get pending() { return pending && { kind: pending.kind, candidates: pending.candidates ?? null }; },
    cancel() { return handle('cancel', { elements: [] }); },
  };
}
