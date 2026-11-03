// Coordinates interpretation, clarification, confirmation and execution for one page.
// Tracking and speech supply contexts and instructions; this module owns what happens next.
import { applyEdit, interpret as interpretRules } from './interpreter.js';
import * as pageActions from './page-actions.js';
import { keyLabel } from './page-actions.js';
import { NUMBERED_FIRST_ID, composedContains, distanceToRect, isConsequentialName, regionIs } from './page-context.js';

const CONFIRM_MS = 15000;
// "It" can refer back to the control last used for this long, while it is still on the page.
const PREVIOUS_MS = 30000;
// Commands for the browser rather than the page.
const BROWSER = new Set(['reload', 'visit', 'tab', 'zoom']);
const hostOf = url => { try { return new URL(url).host; } catch { return 'the website'; } };
// "Again" repeats an action from up to two minutes ago.
const AGAIN_MS = 120000;
const PREVIOUS_ID = 199;
const CLARIFY_MS = 30000;
const HISTORY_LIMIT = 20;

// Actions on a control the user looks at to choose it (not typing into a field they may have looked away from).
const POINTING = new Set(['activate', 'submit', 'check', 'select-radio', 'select-tab', 'disclosure', 'select-option', 'choose-option']);

function targetOf(context, id) {
  if (id >= NUMBERED_FIRST_ID) return context.numbered?.find(element => element.id === id) ?? null;
  return context.elements.find(element => element.id === id) ?? context.disclosureElements?.find(element => element.id === id) ??
    context.nearby?.find(element => element.id === id) ?? (context.pageSearch?.id === id ? context.pageSearch : null) ??
    (context.focusedField?.id === id ? context.focusedField : null) ?? (context.previous?.id === id ? context.previous : null) ?? (id > 200 ? context.onScreen?.().find(element => element.id === id) ?? null : null);
}

// `commands` handles navigator-level actions (tracking source, calibration) outside the page.
// `assistant` (optional, see assisted-interpreter.js) may improve rule answers that named no control;
// its answer arrives later as `followUp` and is dropped if any newer instruction came first.
export function createController({ window, actions = pageActions, interpret = interpretRules, commands = {}, assistant = null, now = () => Date.now(), confirmMs = CONFIRM_MS }) {
  let paused = false;
  let pending = null;
  let turn = 0;
  // The control the last page action used, which "it" can refer back to.
  let previous = null;
  // The last scroll, back or forward, zoom step or press of an ordinary control, which "again" repeats in the same place.
  let last = null;
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

  function writingProblem(action, element, context) {
    // A control in an embedded frame is checked by the frame's own controller.
    if (element?.remote) return null;
    if (action.requireFocus && (actions.isSensitive?.(element) ||
      !(context.focusIsCurrent ? context.focusIsCurrent(element) : actions.ownsFocus?.(element)))) {
      return reply('The focused field changed or is protected. Focus the text field again before continuing. No text was changed.', 'error');
    }
    if (['edit', 'search'].includes(action.type) && actions.canWrite?.(element) === false) {
      return reply('That field is not writable or does not support text editing. Look at a writable field and try again.', 'error');
    }
    return null;
  }

  function perform(action, context) {
    if (['activate', 'submit', 'edit', 'date-parts', 'search', 'select-option', 'select-text', 'delete-selection', 'range', 'choose-option', 'check', 'select-radio', 'select-tab', 'disclosure', 'number', 'date', 'time', 'month', 'week'].includes(action.type)) {
      const target = targetOf(context, action.targetId);
      if (!target?.element?.isConnected) return reply('That control is no longer on the page. Look at it again.', 'error');
      const problem = writingProblem(action, target.element, context);
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

  function runBrowser(action) {
    const followUp = Promise.resolve(commands.browser(action))
      .then(result => {
        // "Again" zooms another step.
        if (result?.ok && action.type === 'zoom' && action.step !== 'reset') last = { action, context: {}, at: now() };
        return reply(result?.message ?? 'Done.', result?.ok ? 'success' : 'error');
      })
      .catch(() => reply('The browser did not respond. Nothing else was changed.', 'error'));
    const working = { reload: 'Reloading the page…', visit: `Opening ${hostOf(action.url)}…`, tab: 'Switching tabs…', zoom: 'Zooming…' };
    return reply(working[action.type], 'info', { followUp });
  }

  function runKeys(action) {
    const result = commands.keys(action);
    return reply(result.message, result.ok ? 'success' : 'error');
  }

  function execute(action, context) {
    const executionTurn = turn;
    pending = null;
    if (BROWSER.has(action.type)) return runBrowser(action);
    if (action.type === 'key') return runKeys(action);
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
    const problem = writingProblem(action, element, context);
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
      case 'date-parts': {
        const parts = target.dateParts, [year, month, day] = action.value.split('-');
        const fields = [[parts?.day, String(Number(day))], [parts?.month, String(Number(month))], [parts?.year, year]];
        if (fields.some(([field]) => !field?.isConnected || actions.canWrite?.(field) === false)) {
          result = { ok: false, message: 'The date boxes changed or cannot be written. Look at them again. No date was entered.' };
          break;
        }
        for (const [field, value] of fields) { remember(field); actions.writeValue(field, value); }
        const spoken = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
        result = { ok: true, message: `${parts.legend || target.name || 'Date'}: ${spoken} (day ${Number(day)}, month ${Number(month)}, year ${year}).` };
        break;
      }
      case 'edit': {
        if (action.requireFocus) {
          // Leaving the navigator's command UI restores page focus and can run site handlers. Recheck before
          // reading the edit's new value or consuming history; a handler may lock, replace or redirect the field.
          const beforeFocus = actions.readValue(element);
          element.focus({ preventScroll: true });
          const problem = writingProblem(action, element, context);
          if (problem) return problem;
          if (!element.isConnected || !actions.ownsFocus?.(element) || actions.readValue(element) !== beforeFocus) {
            return reply('The field changed while focusing it. Focus it again before continuing. No text was changed.', 'error');
          }
        }
        result = edit(element, target.name, action.edit, Boolean(target.sensitive || actions.isSensitive?.(element)));
        break;
      }
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
        // A named region ("scroll the list down") the gaze is not on: the nearest such region on screen. Scrolling
        // changes nothing on the page, so it needs no confirmation; the reply says which region moved.
        let away = false;
        if (action.kind && region === context.pageRegion && context.screenRegions) {
          const axis = ['left', 'right'].includes(action.direction) ? 'horizontal' : 'vertical';
          const matching = context.screenRegions().filter(candidate => candidate[axis] && regionIs(candidate.element, action.kind));
          const inner = matching.filter(candidate => !matching.some(other => other !== candidate && composedContains(candidate.element, other.element)));
          const nearest = inner.sort((a, b) => distanceToRect(context.x, context.y, a.rect) - distanceToRect(context.x, context.y, b.rect))[0];
          if (nearest) { region = nearest.element; away = true; }
        }
        result = actions.scroll(region, action.direction, action.amount, window);
        if (recovered && result.ok) result.message += ' Found at the edge of the gaze circle.';
        if (away && result.ok) result.message += ` It was the ${action.kind} away from the gaze circle.`;
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
    if (result.ok && target) previous = { target, at: now() };
    if (result.ok && (['scroll', 'back', 'forward'].includes(action.type) || (action.type === 'activate' && target && !confirmable(action, target)))) last = { action, context, at: now() };
    // A control the user named inside the gaze circle and used: where they were looking, for self-calibration.
    const aimed = result.ok && POINTING.has(action.type) && context.elements.includes(target) ? target : null;
    return reply(result.message, result.ok ? 'success' : 'error', { performed: result.ok ? action.type : null, aimed });
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
      return { ok: false, message: 'Insertion commands need a writable text field. This field does not support them.' };
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

  function handle(utterance, context, { alternatives = [] } = {}) {
    const current = ++turn;
    const recent = previous && now() - previous.at <= PREVIOUS_MS && previous.target.element?.isConnected !== false ? { ...previous.target, id: PREVIOUS_ID } : null;
    if (recent) context = { ...context, previous: recent };
    let action = interpret(utterance, context), heardAs = null;
    // The recogniser's other readings of the same speech ("click sign in" behind "click signing"): when the first is
    // not understood, the first that is, or else the first that names something which can be offered by sound.
    if (action.type === 'unknown' && alternatives.length) {
      const readings = alternatives.map(text => ({ text, action: interpret(text, context) }));
      const chosen = readings.find(reading => reading.action.type !== 'unknown') ?? (action.alike ? undefined : readings.find(reading => reading.action.alike));
      if (chosen) ({ text: heardAs, action } = chosen);
    }
    const response = decide(heardAs ?? utterance, context, action, current);
    if (!heardAs || !response) return response;
    // Say which reading was used, also in the website's later answer when its state is checked afterwards.
    const noted = answer => (answer?.message ? { ...answer, message: `Heard "${heardAs}". ${answer.message}` } : answer);
    if (response.followUp && !response.assisting) response.followUp = Promise.resolve(response.followUp).then(noted);
    return response.assisting ? response : noted(response);
  }

  function decide(utterance, context, action, current) {
    if (action.type === 'cancel') {
      const had = pending;
      pending = null;
      // "Cancel" always stops the navigator and never presses anything; with nothing to stop and the website's own
      // Cancel button in view, say how to press it.
      const button = !had && context.elements?.find(element => /^cancel$/i.test((element.name ?? '').trim()) && ['button', 'link'].includes(element.role));
      return reply(had ? 'Cancelled. Nothing was changed.' : button ? 'Nothing to cancel. To press the website\'s Cancel button, say "click cancel".' : 'Cancelled.', 'info', { cancelled: true });
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
    if (action.type === 'panel') {
      // Moving or hiding the panel keeps any question open: it is still answered the same way.
      if (!commands.panel) return reply('The navigator panel cannot be changed here.', 'error');
      const result = commands.panel(action);
      return reply(result.message, result.ok ? 'success' : 'error', { keepPrompt: true });
    }
    if (['tracking', 'calibrate', 'circle-size'].includes(action.type)) {
      pending = null;
      const handler = action.type === 'circle-size' ? commands.circleSize : action.type === 'tracking' ? commands.tracking : commands.calibrate;
      if (!handler) return reply(action.type === 'circle-size' ? 'Circle size adjustment is not available here.' : 'Camera tracking is not available here.', 'error');
      const result = handler(action.type === 'circle-size' ? action.size : action.source);
      return reply(result.message, result.ok ? 'success' : 'error');
    }
    // Numbers on every control: shown or hidden like the circle's size, and, while shown, a number said (on its own
    // too) uses the control with that number wherever it is, even when the gaze cannot be tracked.
    if (action.type === 'numbers') {
      if (!commands.numbers) return reply('Numbers on controls are not available here.', 'error');
      pending = null;
      const result = commands.numbers(action.on);
      return reply(result.message, result.ok ? 'success' : 'error');
    }
    // Words found on the page need no gaze; a match inside a control makes it the one "it" means.
    if (action.type === 'find') {
      if (paused) return reply('Paused. Say resume to continue, or cancel.', 'info');
      if (!commands.find) return reply('Finding words on the page is not available here.', 'error');
      pending = null;
      const result = commands.find(action);
      if (result.control) previous = { target: result.control, at: now() };
      return reply(result.message, result.ok ? 'info' : 'error');
    }
    // A key said aloud goes to the page's focused element and needs no gaze. Control or Command with Enter often sends
    // a message or a form, so it is asked first.
    if (action.type === 'key') {
      if (paused) return reply('Paused. Say resume to continue, or cancel.', 'info');
      if (!commands.keys) return reply('Pressing keys is not available here.', 'error');
      if (action.key === 'Enter' && (action.ctrl || action.meta || action.alt || action.shift)) {
        pending = { kind: 'confirm', action, context, expiresAt: now() + confirmMs };
        return reply(`${keyLabel(action)} often sends a message or a form. Say confirm to press it, or cancel.`, 'question');
      }
      pending = null;
      return runKeys(action);
    }
    // A "Which one?" question still takes its own numbers.
    if (action.type === 'choose' && context.numbered && context.trackingUnavailable !== 'calibration' && pending?.kind !== 'clarify') {
      if (paused) return reply('Paused. Say resume to continue, or cancel.', 'info');
      const target = context.numbered.find(element => element.number === action.index);
      if (!target) return reply(`There is no number ${action.index} on the screen.${context.numbered.length ? ` The numbers go up to ${Math.max(...context.numbered.map(element => element.number))}.` : ''}`, 'error');
      return perform({ type: 'activate', targetId: target.id }, context);
    }
    // The browser itself (reload, websites, tabs, zoom) needs no gaze; closing a tab is asked first.
    if (BROWSER.has(action.type)) {
      if (paused) return reply('Paused. Say resume to continue, or cancel.', 'info');
      if (!commands.browser) return reply('Browser commands are not available here.', 'error');
      if (action.type === 'tab' && action.move === 'close') {
        pending = { kind: 'confirm', action, context, expiresAt: now() + confirmMs };
        return reply('Close this tab? Anything typed here and not sent is lost. Say confirm to close it, or cancel.', 'question');
      }
      return runBrowser(action);
    }
    if (context.trackingUnavailable) {
      pending = null;
      return reply(context.trackingUnavailable === 'calibration'
        ? 'Camera calibration is not ready. Say recalibrate and finish the dots, or say use pointer. Nothing was changed.'
        : 'Camera tracking is lost. Look at the page again when your face is visible, or say use pointer. Nothing was changed.', 'error');
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

    if (action.type === 'again') {
      if (!last || now() - last.at > AGAIN_MS) return reply('There is nothing to do again. Say the instruction itself.', 'info');
      const { action: repeated, context: where } = last;
      const gone = repeated.targetId != null ? !targetOf(where, repeated.targetId)?.element?.isConnected : repeated.type === 'scroll' && where.region?.isConnected === false;
      if (gone) { last = null; return reply('What was used last is no longer on the page. Look at it and say what to do.', 'error'); }
      return perform(repeated, where);
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

  // Speech recognition can mishear a name ("signing" for Sign in) or a command word ("quick submit"): what was
  // probably meant is offered, outlined, and done only after a yes.
  function offer(action, context) {
    const { heardAs, heardName: _heard, ...offered } = action.alike;
    const target = offered.targetId != null ? targetOf(context, offered.targetId) : null;
    if (offered.targetId != null) {
      if (!target?.element?.isConnected) return reply(action.message, 'error');
      const problem = writingProblem(offered, target.element, context);
      if (problem) return problem;
    }
    const risk = target && confirmable(offered, target) ? ' It may have consequences.' : '';
    pending = { kind: 'confirm', action: offered, context, ...(target ? { farTarget: target } : {}), expiresAt: now() + confirmMs };
    return reply(`Did you mean "${heardAs ?? (target.name || target.role)}"?${risk} Say confirm to do it, or cancel.`, 'question');
  }

  function respond(action, context) {
    switch (action.type) {
      case 'clarify':
        pending = { kind: 'clarify', candidates: action.candidates, choose: action.choose, context, expiresAt: now() + CLARIFY_MS };
        return reply(action.message, 'question');
      case 'unknown': return action.alike ? offer(action, context) : reply(action.message, 'error');
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
