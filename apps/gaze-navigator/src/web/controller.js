// Coordinates interpretation, clarification, confirmation and execution for one page.
// Tracking and speech supply contexts and instructions; this module owns what happens next.
import { applyEdit, interpret as interpretRules } from './interpreter.js';
import * as pageActions from './page-actions.js';
import { composedContains, isConsequentialName } from './page-context.js';

const CONFIRM_MS = 15000;
const CLARIFY_MS = 30000;
const HISTORY_LIMIT = 20;

function targetOf(context, id) {
  return context.elements.find(element => element.id === id) ?? context.disclosureElements?.find(element => element.id === id) ??
    context.nearby?.find(element => element.id === id) ?? (context.pageSearch?.id === id ? context.pageSearch : null) ??
    (context.focusedField?.id === id ? context.focusedField : null) ?? (id > 200 ? context.onScreen?.().find(element => element.id === id) ?? null : null);
}

// `commands` handles navigator-level actions (tracking source, calibration) outside the page.
// `assistant` (optional, see assisted-interpreter.js) may improve rule answers that named no control;
// its answer arrives later as `followUp` and is dropped if any newer instruction came first.
export function createController({ window, actions = pageActions, interpret = interpretRules, commands = {}, assistant = null, now = () => Date.now(), confirmMs = CONFIRM_MS }) {
  let paused = false;
  let pending = null;
  let turn = 0;
  const history = new WeakMap();
  const rangeHistory = new WeakMap();
  const numberHistory = new WeakMap();
  const numberRevision = new WeakMap();
  const dateHistory = new WeakMap();
  const dateRevision = new WeakMap();
  const timeHistory = new WeakMap();
  const timeRevision = new WeakMap();
  const monthHistory = new WeakMap();
  const monthRevision = new WeakMap();
  const weekHistory = new WeakMap();
  const weekRevision = new WeakMap();

  const reply = (message, tone = 'info', extra = {}) => ({ message, tone, pending: pending && { kind: pending.kind, candidates: pending.candidates ?? null }, ...extra });

  function confirmable(action, element) {
    if (['activate', 'check', 'select-radio', 'select-tab', 'disclosure', 'number', 'date', 'time', 'month', 'week'].includes(action.type)) return element.consequential;
    if (action.type === 'select-option') return element.consequential || element.consequentialOptions?.[action.optionIndex];
    if (action.type === 'choose-option') return element.consequential || isConsequentialName(action.optionName);
    if (action.type === 'submit' || action.type === 'search') return element.role !== 'searchbox' && !/search/i.test(element.name);
    return false;
  }

  function writingProblem(action, element) {
    // A control in an embedded frame is checked by the frame's own controller.
    if (element?.remote) return null;
    if (['edit', 'search'].includes(action.type) && actions.canWrite?.(element) === false) {
      return reply('That field is not writable or does not support text editing. Look at a writable field and try again.', 'error');
    }
    return null;
  }

  function perform(action, context) {
    if (['activate', 'submit', 'edit', 'search', 'select-option', 'select-text', 'delete-selection', 'range', 'choose-option', 'check', 'select-radio', 'select-tab', 'disclosure', 'number', 'date', 'time', 'month', 'week'].includes(action.type)) {
      const target = targetOf(context, action.targetId);
      if (!target?.element?.isConnected) return reply('That control is no longer on the page. Look at it again.', 'error');
      const problem = writingProblem(action, target.element);
      if (problem) return problem;
      // A control named far from the gaze is used only once the user agrees it is the one they meant.
      if (action.far) {
        pending = { kind: 'confirm', action: { ...action, far: false }, context, farTarget: target, expiresAt: now() + confirmMs };
        const risk = confirmable(action, target) ? ' and may have consequences' : '';
        return reply(`"${target.name || target.role}" is not near your gaze${risk}; it is outlined on the page. Say confirm to use it, or cancel.`, 'question');
      }
      if (confirmable(action, target)) {
        pending = { kind: 'confirm', action, context, expiresAt: now() + confirmMs };
        const label = action.type === 'choose-option' ? `${action.optionName} in ${target.name || target.role}` : action.type === 'select-option' ? `${action.selected === true ? 'Add ' : action.selected === false ? 'Remove ' : ''}${action.optionName} ${action.selected === true ? 'to' : 'from'} ${target.name || target.role}` : target.name || target.role;
        return reply(`"${label}" may have consequences. Say confirm to continue, or cancel.`, 'question');
      }
    }
    return execute(action, context);
  }

  function execute(action, context) {
    const executionTurn = turn;
    pending = null;
    const target = targetOf(context, action.targetId);
    const element = target?.element;
    // A control in an embedded frame from another site: its frame's controller performs the confirmed action.
    if (element?.remote) {
      const followUp = Promise.resolve(element.remote.run({ ...action, targetId: element.remote.id }))
        .catch(() => ({ ok: false, message: 'The embedded page could not be reached. Look at it again.' }))
        .then(later => executionTurn === turn && !paused ? reply(later.message, later.ok ? 'success' : 'error', { performed: later.ok ? action.type : null }) : null);
      return reply('Working in the embedded page…', 'info', { performed: null, followUp });
    }
    if (['activate', 'submit', 'edit', 'search', 'select-option', 'select-text', 'delete-selection', 'range', 'choose-option', 'check', 'select-radio', 'select-tab', 'disclosure', 'number', 'date', 'time', 'month', 'week'].includes(action.type) && !element?.isConnected) {
      return reply('That control is no longer on the page. Look at it again.', 'error');
    }
    // Repeat after clarification/confirmation: page scripts may have locked the
    // original field since capture. Refusal must precede history, events or submit.
    const problem = writingProblem(action, element);
    if (problem) return problem;
    let result;
    switch (action.type) {
      case 'disclosure': result = actions.setExpanded(element, action.expanded, target.disclosureSnapshot, { isCurrent: () => turn === executionTurn && !paused }); break;
      case 'select-radio': result = actions.selectRadio(element, target.radioSnapshot); break;
      case 'select-tab': result = actions.selectTab(element, target.tabSnapshot, { isCurrent: () => turn === executionTurn && !paused }); break;
      case 'check': result = actions.setChecked(element, action.checked); break;
      case 'activate': result = actions.activate(element, target.name, { preserveFocus: Boolean(context.preserveFocus) }); break;
      case 'submit': result = actions.submit(element); break;
      case 'delete-selection': result = actions.deleteSelection(element, target.textSelectionSnapshot, { isCurrent: () => turn === executionTurn && !paused, onWrite: before => remember(element, before) }); break;
      case 'select-text': result = actions.selectText(element, action.position, { text: action.text, occurrence: action.occurrence }); break;
      case 'select-option': result = typeof action.selected === 'boolean'
        ? actions.setMultipleOption(element, action.optionIndex, action.selected, target.selectSnapshot)
        : actions.selectOption(element, action.optionIndex, target.selectSnapshot); break;
      case 'search': {
        remember(element);
        actions.writeValue(element, action.text);
        result = actions.submit(element);
        if (result.ok) result = { ok: true, message: `Searching for "${action.text}".` };
        break;
      }
      case 'edit': result = edit(element, target.name, action.edit, Boolean(target.sensitive || actions.isSensitive?.(element))); break;
      case 'month':
      case 'week':
      case 'time':
      case 'date':
      case 'number': {
        const [histories, revisions, setter, snapshot] = {
          number: [numberHistory, numberRevision, 'setNumberValue', 'numberSnapshot'],
          date: [dateHistory, dateRevision, 'setDateValue', 'dateSnapshot'],
          time: [timeHistory, timeRevision, 'setTimeValue', 'timeSnapshot'],
          month: [monthHistory, monthRevision, 'setMonthValue', 'monthSnapshot'],
          week: [weekHistory, weekRevision, 'setWeekValue', 'weekSnapshot'],
        }[action.type];
        const values = histories.get(element) ?? [];
        const entry = values.at(-1);
        if (action.undo && !entry) { result = { ok: false, message: `Nothing to undo in this ${action.type} field.` }; break; }
        result = actions[setter](element, action.undo ? entry.value : action.value, target[snapshot], { restore: Boolean(action.undo) });
        if (result.wrote || result.ok) {
          const revision = (revisions.get(element) ?? 0) + 1;
          revisions.set(element, revision);
          if (action.undo) {
            // Consume an applied Undo now, before another native-value command can
            // capture its result. Reinstate only an unsuperseded site refusal.
            values.pop();
            if (result.followUp) result.followUp = result.followUp.then(later => {
              if (!later.ok && revisions.get(element) === revision) values.push(entry);
              return later;
            });
          } else if (result.wrote) {
            values.push({ value: result.before }); if (values.length > HISTORY_LIMIT) values.shift();
          }
          histories.set(element, values);
        }
        break;
      }
      case 'range': {
        const values = rangeHistory.get(element) ?? [];
        if (action.undo && !values.length) { result = { ok: false, message: 'Nothing to undo in this slider.' }; break; }
        result = actions.setRangeValue(element, action.undo ? Number(values.at(-1)) : action.value, { isCurrent: () => turn === executionTurn && !paused });
        // A custom slider settles after key presses, so its history is kept when it has.
        const record = outcome => {
          if (outcome.changed) {
            if (action.undo) { if (outcome.ok) values.pop(); }
            else { values.push(outcome.before); if (values.length > HISTORY_LIMIT) values.shift(); }
            rangeHistory.set(element, values);
          }
          return outcome;
        };
        if (result.followUp) result.followUp = Promise.resolve(result.followUp).then(record); else record(result);
        break;
      }
      case 'choose-option': result = actions.chooseListOption(element, action.optionName, { isCurrent: () => turn === executionTurn && !paused }); break;
      case 'scroll': {
        let region = action.scope === 'page' ? null : context.region;
        let recovered = false;
        if (action.scope !== 'page' && region === context.pageRegion && context.scrollRegions?.length) {
          const axis = ['left', 'right'].includes(action.direction) ? 'horizontal' : 'vertical';
          const candidates = context.scrollRegions.filter(candidate => candidate[axis]);
          // Nested scroll containers describe one place; retain its innermost region.
          const inner = candidates.filter(candidate => !candidates.some(other => other !== candidate &&
            composedContains(candidate.element, other.element)));
          if (inner.length > 1) return reply('More than one scrolling region touches the gaze circle. Look further inside the one you mean, or say “scroll the page down”.', 'error', { performed: null });
          if (inner.length === 1) { region = inner[0].element; recovered = true; }
        }
        result = actions.scroll(region, action.direction, action.amount, window);
        if (recovered && result.ok) result.message += ' Found at the edge of the gaze circle.';
        break;
      }
      case 'back':
      case 'forward': result = actions.navigate(window, action.type); break;
      default: return reply('That action is not supported yet.', 'error');
    }
    if (result.followUp) {
      const followUp = Promise.resolve(result.followUp)
        .catch(() => ({ ok: false, message: 'The website state could not be checked. Check the control before continuing.' }))
        .then(later => executionTurn === turn && !paused
          ? reply(later.message, later.ok ? 'success' : 'error', { performed: later.ok ? action.type : null }) : null);
      return reply(result.message, 'info', { performed: null, followUp });
    }
    return reply(result.message, result.ok ? 'success' : 'error', { performed: result.ok ? action.type : null });
  }

  function remember(element, before = actions.readValue(element)) {
    const values = history.get(element) ?? [];
    values.push(before);
    if (values.length > HISTORY_LIMIT) values.shift();
    history.set(element, values);
  }

  function edit(element, name, change, sensitive = false) {
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
    // A sensitive field's text is never echoed: the message is shown, announced and may be spoken aloud.
    if (sensitive) return { ok: true, message: after ? `${label} updated. Its text is hidden.` : `${label} cleared.` };
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
    // Navigator settings stay available while paused; changing scope retires old targets.
    if (['tracking', 'calibrate', 'circle-size'].includes(action.type)) {
      pending = null;
      const handler = action.type === 'circle-size' ? commands.circleSize : action.type === 'tracking' ? commands.tracking : commands.calibrate;
      if (!handler) return reply(action.type === 'circle-size' ? 'Circle size adjustment is not available here.' : 'Camera tracking is not available here.', 'error');
      const result = handler(action.type === 'circle-size' ? action.size : action.source);
      return reply(result.message, result.ok ? 'success' : 'error');
    }
    if (paused) return reply('Paused. Say resume to continue, or cancel.', 'info');

    // A number answers only the current question. Noise never extends its deadline;
    // a fresh instruction after expiry can still start a new action normally.
    if (pending?.kind === 'clarify' && now() >= pending.expiresAt) {
      pending = null;
      if (action.type === 'choose' || (action.type === 'unknown' && action.unparsed)) {
        return reply('That question expired. Give the instruction again.', 'error');
      }
    }

    // Speech that could not be understood at all (noise, a cough, side conversation) leaves a pending
    // confirmation or question waiting; a new instruction, even one that fails, replaces it.
    if (pending && action.type === 'unknown' && action.unparsed) {
      const waiting = pending.kind === 'confirm'
        ? 'Still waiting: say confirm to continue, or cancel.'
        : `Still waiting: say one of ${pending.candidates.map(candidate => candidate.number).join(', ')}, or cancel.`;
      return reply(`"${utterance.trim()}" was not understood. ${waiting}`, 'question');
    }
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
        if (action.bare) return reply(`To use control ${action.index}, say "click ${action.index}". A number on its own only answers a question.`, 'info');
        const target = context.elements.find(element => element.id === action.index);
        if (!target) return reply(`There is no number ${action.index} in the gaze circle.`, 'error');
        return perform({ type: 'activate', targetId: target.id }, context);
      }
      case 'clarify':
      case 'unknown':
        if (assistant?.needs(utterance, context, action)) {
          const followUp = assistant.improve(utterance, context, action).catch(() => action)
            // A newer instruction (including cancel or pause) makes this answer stale.
            .then(improved => {
              if (current !== turn || paused) return null;
              const response = respond(improved, context);
              return response.followUp ?? response;
            });
          return reply('Working out which control you mean…', 'info', { assisting: true, followUp });
        }
        return respond(action, context);
      default: return respond(action, context);
    }
  }

  function respond(action, context) {
    switch (action.type) {
      case 'clarify':
        pending = { kind: 'clarify', candidates: action.candidates, choose: action.choose, context, expiresAt: now() + CLARIFY_MS };
        return reply(action.message, 'question');
      case 'unknown': return reply(action.message, 'error');
      default: {
        const response = perform(action, context);
        // A control found just outside the circle: say so, so the user knows where the action happened.
        if (action.outside && response.tone === 'success') response.message = `${response.message} It was just outside the gaze circle.`;
        else if (action.outside && response.tone === 'question') response.message = `Just outside the gaze circle: ${response.message}`;
        return response;
      }
    }
  }

  return {
    handle,
    // Performs an already interpreted and confirmed action (used by an embedded frame for the top navigator).
    run: (action, context) => execute(action, context),
    get paused() { return paused; },
    get pending() { return pending && { kind: pending.kind, candidates: pending.candidates ?? null, farTarget: pending.farTarget ?? null }; },
    cancel() { return handle('cancel', { elements: [] }); },
  };
}
