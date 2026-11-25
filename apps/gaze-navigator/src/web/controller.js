// Coordinates interpretation, clarification, confirmation and execution for one page.
// Tracking and speech supply contexts and instructions; this module owns what happens next.
import { applyEdit, dictated, dictationControl, interpret as interpretRules } from './interpreter.js';
import * as pageActions from './page-actions.js';
import { commandHelp } from './command-help.js';
import { learnedAction, learnedEntry, learnedSummary, taughtEntry, withoutLearned } from './learned.js';
import { spokenDuration } from './trial-tasks.js';
import { keyLabel } from './page-actions.js';
import { areaNameScore, captureActivationSnapshot, captureSubmissionSnapshot, captureDatePartsSnapshot, NUMBERED_FIRST_ID, composedContains, distanceToRect, isConsequentialName, regionIs, regionSupportsAxis } from './page-context.js';

const CONFIRM_MS = 15000;
// "It" can refer back to the control last used for this long, while it is still on the page.
const PREVIOUS_MS = 30000;
// Commands for the browser rather than the page.
const BROWSER = new Set(['reload', 'visit', 'tab', 'zoom']);
const hostOf = url => { try { return new URL(url).host; } catch { return 'the website'; } };
// "Again" repeats an action from up to two minutes ago.
const AGAIN_MS = 120000;
// How long after a fill of saved details "undo" takes it back.
const FILL_UNDO_MS = 120000;
// How long after a checkbox, section, dropdown or radio button is changed "undo" puts it back.
const CHANGE_UNDO_MS = 120000;
const UNDO_WORDS = /^(?:undo|undo (?:that|it|this|the last (?:change|one))|take (?:that|it) back|put it back|change it back|scratch that)[.!]*$/i;
const UNDOABLE = new Set(['check', 'disclosure', 'select-option', 'select-radio']);
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
  let dictation = null;
  let pending = null;
  // The words of the instruction being handled when it was spoken, which a yes to an offer learns (see learned.js), and
  // whether the instruction being handled was spoken (a page could type into the panel, but cannot speak).
  let learnFrom = null;
  let spokenNow = false;
  let userInputNow = false;
  let turn = 0;
  // The control the last page action used, which "it" can refer back to.
  let previous = null;
  // The last control change "undo" can put back, and when text was last typed: the more recent of the two is undone.
  let changed = null, editedAt = -Infinity;
  // The control last pointed at to open its menu ("show the Shop menu"), left again by "close the menu".
  let hovered = null;
  // The last scroll, back or forward, zoom step or press of an ordinary control, which "again" repeats in the same place.
  let last = null;
  // The fields a fill of saved details just wrote, which "undo" straight afterwards empties again.
  let filled = null;
  const history = new WeakMap();
  const textRevision = new WeakMap();
  let textSerial = 0, latestTextRevision = null;
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
    if (['activate', 'double-click', 'check', 'select-radio', 'select-tab', 'disclosure', 'number', 'date', 'time', 'month', 'week'].includes(action.type)) return element.consequential;
    if (action.type === 'select-option') return element.consequential || (action.optionIndexes ?? [action.optionIndex]).some(index => element.consequentialOptions?.[index]);
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
    if (['edit', 'search', 'dictation'].includes(action.type) && actions.canWrite?.(element) === false) {
      return reply('That field is not writable or does not support text editing. Look at a writable field and try again.', 'error');
    }
    return null;
  }

  function activationOf(action, target) {
    if (!target?.element || target.element.remote) return null;
    if (action.type === 'submit' || action.type === 'search') return target.submissionSnapshot ?? captureSubmissionSnapshot(target.element);
    return action.type === 'activate' || action.type === 'double-click'
      ? target.activationSnapshot ?? captureActivationSnapshot(target.element) : null;
  }

  function perform(action, context) {
    if (['activate', 'hover', 'double-click', 'context-menu', 'submit', 'dictation', 'edit', 'date-parts', 'search', 'select-option', 'select-text', 'delete-selection', 'range', 'choose-option', 'check', 'select-radio', 'select-tab', 'disclosure', 'number', 'date', 'time', 'month', 'week'].includes(action.type)) {
      const target = targetOf(context, action.targetId);
      if (!target?.element?.isConnected) return reply('That control is no longer on the page. Look at it again.', 'error');
      const problem = writingProblem(action, target.element, context);
      if (problem) return problem;
      // A control named far from the gaze is used only once the user agrees it is the one they meant.
      if (action.far) {
        pending = { kind: 'confirm', action: { ...action, far: false }, context, farTarget: target, activation: activationOf(action, target), expiresAt: now() + confirmMs };
        const risk = confirmable(action, target) ? ' and may have consequences' : '';
        return reply(`"${target.name || target.role}" is not near your gaze${risk}; it is outlined on the page. Say confirm to use it, or cancel.`, 'question');
      }
      if (confirmable(action, target)) {
        pending = { kind: 'confirm', action, context, activation: activationOf(action, target), expiresAt: now() + confirmMs };
        const label = action.type === 'choose-option' ? (action.selected === false ? `Remove ${action.optionName} from ${target.name || target.role}` : `${action.optionName} in ${target.name || target.role}`) : action.type === 'select-option' ? `${action.selected === true ? 'Add ' : action.selected === false ? 'Remove ' : ''}${action.optionName} ${action.selected === true ? 'to' : 'from'} ${target.name || target.role}` : target.name || target.role;
        return reply(`"${label}" may have consequences. Say confirm to continue, or cancel.`, 'question');
      }
    }
    return execute(action, context);
  }

  function runBrowser(action) {
    pending = null;
    const executionTurn = turn;
    const followUp = Promise.resolve(commands.browser(action, { userInput: userInputNow || spokenNow }))
      .then(result => {
        if (executionTurn !== turn || paused) return null;
        if (result?.confirmation?.token) {
          pending = { kind: 'confirm', action: { ...action, selectionToken: result.confirmation.token }, context: {}, expiresAt: now() + confirmMs };
          return reply(result.message, 'question');
        }
        // "Again" zooms another step.
        if (result?.ok && action.type === 'zoom' && action.step !== 'reset') last = { action, context: {}, at: now() };
        return reply(result?.message ?? 'Done.', result?.ok ? 'success' : 'error');
      })
      .catch(() => reply('The browser did not respond. Nothing else was changed.', 'error'));
    const working = { reload: 'Reloading the page…', visit: `Opening ${hostOf(action.url)}…`, tab: 'Switching tabs…', zoom: 'Zooming…' };
    return reply(working[action.type], 'info', { followUp });
  }

  // Playing starts later (the browser may refuse sound); everything else is done at once. "Again" skips, or changes the
  // volume or speed, another step.
  function runMedia(action, context) {
    const result = commands.media(action, context);
    if (typeof result?.then === 'function') {
      const executionTurn = turn;
      const followUp = result.then(later => (executionTurn === turn && !paused ? reply(later.message, later.ok ? 'success' : 'error') : null))
        .catch(() => reply('The video did not respond. Nothing else was changed.', 'error'));
      return reply('Starting…', 'info', { followUp });
    }
    if (result.ok && (action.change === 'skip' || (['volume', 'speed'].includes(action.change) && action.to == null))) last = { action, context, at: now() };
    return reply(result.message, result.ok ? 'success' : 'error');
  }

  function runKeys(action) {
    const result = commands.keys(action);
    return reply(result.message, result.ok ? 'success' : 'error');
  }

  function execute(action, context, activation = null, confirmed = false) {
    const executionTurn = turn;
    pending = null;
    if (BROWSER.has(action.type)) return runBrowser(action);
    if (action.type === 'key') return runKeys(action);
    if (action.type === 'media') return runMedia(action, context);
    if (action.type === 'details') {
      const isCurrent = () => turn === executionTurn && !paused;
      const result = commands.details.fill(action.plan,{isCurrent});
      if (!isCurrent()) return reply('Stopped filling because a newer instruction arrived. Check the form before continuing.','error');
      if (result.filled?.length) filled = { entries: result.filled, at: now() };
      return reply(result.message, result.ok ? 'success' : 'error');
    }
    const target = targetOf(context, action.targetId);
    const element = target?.element;
    // A control in an embedded frame from another site: its frame's controller performs the confirmed action.
    if (element?.remote && action.type === 'dictation') return reply('Continuous dictation is not available in this embedded page. Use “type” followed by the words instead.', 'error');
    if (element?.remote) {
      const followUp = Promise.resolve(element.remote.run({ ...action, targetId: element.remote.id }, { confirmed }))
        .catch(() => ({ ok: false, message: 'The embedded page could not be reached. Look at it again.' }))
        .then(later => executionTurn === turn && !paused ? reply(later.message, later.ok ? 'success' : 'error', { performed: later.ok ? action.type : null }) : null);
      return reply('Working in the embedded page…', 'info', { performed: null, followUp });
    }
    if (action.type === 'unhover') {
      const result = hovered ? actions.unhover(hovered) : { ok: false, message: 'No menu was opened by pointing.' };
      hovered = null;
      return reply(result.message, result.ok ? 'success' : 'error', { performed: result.ok ? 'unhover' : null });
    }
    if (['activate', 'hover', 'double-click', 'context-menu', 'submit', 'dictation', 'edit', 'search', 'select-option', 'select-text', 'delete-selection', 'range', 'choose-option', 'check', 'select-radio', 'select-tab', 'disclosure', 'number', 'date', 'time', 'month', 'week'].includes(action.type) && !element?.isConnected) {
      return reply('That control is no longer on the page. Look at it again.', 'error');
    }
    // Repeat after clarification/confirmation: page scripts may have locked the
    // original field since capture. Refusal must precede history, events or submit.
    const problem = writingProblem(action, element, context);
    if (problem) return problem;
    let result, namedScrollRegion;
    const remembered = UNDOABLE.has(action.type) && actions.rememberChange ? actions.rememberChange(action.type, element) : null;
    const keep = outcome => { if (outcome.ok && remembered) changed = { change: remembered, at: now() }; };
    switch (action.type) {
      case 'dictation': {
        if (target.sensitive || actions.isSensitive?.(element)) return reply('Dictation needs a regular, unprotected text field.', 'error');
        result = actions.selectText(element, 'end');
        if (result.ok && turn === executionTurn && !paused && element.isConnected && !actions.isSensitive?.(element) && actions.canWrite?.(element) !== false && actions.ownsFocus?.(element)) {
          dictation = { ...target, id: 198 };
          result = { ok: true, message: `Dictating into ${target.name || 'the field'}. Speak your words; say “undo typing” to take back a phrase, or “stop dictation” to return to commands.` };
        } else result = { ok: false, message: 'That field could not keep focus for dictation. Focus a writable field and try again.' };
        break;
      }
      case 'disclosure': result = actions.setExpanded(element, action.expanded, target.disclosureSnapshot, { isCurrent: () => turn === executionTurn && !paused }); break;
      case 'select-radio': result = actions.selectRadio(element, target.radioSnapshot); break;
      case 'select-tab': result = actions.selectTab(element, target.tabSnapshot, { isCurrent: () => turn === executionTurn && !paused }); break;
      case 'check': result = actions.setChecked(element, action.checked); break;
      case 'activate': result = actions.activate(element, target.name, { preserveFocus: Boolean(context.preserveFocus), ...(activation ? { confirmation: activation } : {}) }); break;
      case 'hover': result = actions.hover(element, target.name, hovered?.isConnected ? hovered : null); hovered = element; break;
      case 'double-click': result = actions.doubleClick(element, target.name, { confirmation: activation }); break;
      case 'context-menu': result = actions.contextMenu(element, target.name); break;
      case 'submit': result = actions.submit(element, { confirmation: activation }); break;
      case 'delete-selection': result = actions.deleteSelection(element, target.textSelectionSnapshot, { isCurrent: () => turn === executionTurn && !paused, onWrite: before => remember(element, before) }); break;
      case 'select-text': result = actions.selectText(element, action.position, { text: action.text, occurrence: action.occurrence }); break;
      case 'select-option': result = typeof action.selected === 'boolean'
        ? actions.setMultipleOption(element, action.optionIndexes ?? action.optionIndex, action.selected, target.selectSnapshot)
        : actions.selectOption(element, action.optionIndex, target.selectSnapshot); break;
      case 'search': {
        const intended = activation ?? target.submissionSnapshot ?? captureSubmissionSnapshot(element);
        const matches = snapshot => !intended || (snapshot && snapshot.length === intended.length && intended.every((value, index) => value === snapshot[index]));
        if (!matches(captureSubmissionSnapshot(element))) {
          result = { ok: false, message: 'The search form changed. Look at it again. No text was entered. Nothing was submitted.' };
          break;
        }
        remember(element);
        actions.writeValue(element, action.text);
        if (turn !== executionTurn || paused) {
          result = { ok: false, message: 'Search stopped during query entry. Nothing was submitted.' };
          break;
        }
        const afterWrite = captureSubmissionSnapshot(element);
        if (!element.isConnected || !matches(afterWrite) || writingProblem(action, element, context)) {
          result = { ok: false, message: 'The search form changed during query entry. Look at it again. Nothing was submitted.' };
          break;
        }
        result = actions.submit(element, { confirmation: captureSubmissionSnapshot(element) });
        if (result.ok) result = { ok: true, message: `Searching for "${action.text}".` };
        break;
      }
      case 'date-parts': {
        const parts = target.dateParts, [year, month, day] = action.value.split('-');
        const fields = [[parts?.day, String(Number(day))], [parts?.month, String(Number(month))], [parts?.year, year]];
        const expected = fields.map(([field], index) => parts?.values?.[index] ?? (field && actions.readValue(field)));
        let wrote = 0;
        const valid = () => turn === executionTurn && !paused && fields.every(([field], index) =>
          field?.isConnected && actions.canWrite?.(field) !== false && !actions.isSensitive?.(field) && actions.readValue(field) === expected[index]) &&
          (!parts.snapshot || (() => {
            const current = captureDatePartsSnapshot(parts);
            return current.length === parts.snapshot.length && current.every((value, index) => value === parts.snapshot[index]);
          })());
        const stopped = () => ({ ok: false, message: wrote
          ? 'Date entry stopped because the instruction or date boxes changed. Values already entered remain; check the partial date before continuing.'
          : 'The date boxes changed or cannot be written. Look at them again. No date was entered.' });
        if (!valid()) {
          result = stopped();
          break;
        }
        const spoken = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
        result = { message: 'Entering and checking the date…', followUp: (async () => {
          for (const [index, [field, value]] of fields.entries()) {
            if (!valid()) return stopped();
            const written = actions.writeValue(field, value, { isCurrent: valid, onWrite: before => {
              remember(field, before); editedAt = now(); expected[index] = value; wrote++;
            } });
            if (written === false) return stopped();
            // Let the website settle before touching another box or reporting success.
            await new Promise(resolve => window.setTimeout(resolve, 0));
            if (!valid() || actions.readValue(field) !== value) return stopped();
          }
          return { ok: true, message: `${parts.legend || target.name || 'Date'}: ${spoken} (day ${Number(day)}, month ${Number(month)}, year ${year}).` };
        })() };
        break;
      }
      case 'edit': {
        // Ordinary typing also focuses the field. Website focus handlers run before any edit is computed or
        // history consumed, just as for explicit continuation; never overwrite a lock, redirection or new value.
        const beforeFocus = actions.readValue(element), beforeType = element.type;
        const beforeSensitive = Boolean(actions.isSensitive?.(element));
        // Focusing a rich editor can collapse the live selection after command entry used another input.
        // Keep the user's intended offsets; unchanged text and the focus checks below validate their meaning.
        const selection = action.edit.kind === 'insert-selection' ? actions.readSelection?.(element) ?? null : null;
        element.focus?.({ preventScroll: true });
        const problem = writingProblem(action, element, context);
        if (problem) return problem;
        if (turn !== executionTurn || paused || !element.isConnected ||
          (actions.ownsFocus && !actions.ownsFocus(element)) || element.type !== beforeType ||
          Boolean(actions.isSensitive?.(element)) !== beforeSensitive || actions.readValue(element) !== beforeFocus) {
          return reply('The field changed while focusing it. Focus it again before continuing. No text was changed.', 'error');
        }
        result = edit(element, target.name, action.edit, Boolean(target.sensitive || actions.isSensitive?.(element)), selection);
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
      case 'choose-option': result = actions.chooseListOption(element, action.optionName, { isCurrent: () => turn === executionTurn && !paused,
        selected: action.selected !== false, names: action.optionNames ?? null }); break;
      case 'scroll': {
        let region = action.scope === 'page' ? null : context.region;
        const axis = ['left', 'right'].includes(action.direction) ? 'horizontal' : 'vertical';
        // When a command names a region, gaze only breaks ties between places matching that name.
        let namedMatch = null, recovered = false;
        if (action.kind && action.scope !== 'page') {
          const matches = element => regionSupportsAxis(element, axis) && regionIs(element, action.kind);
          const repeatRegion = context.repeatScrollRegion;
          if (repeatRegion && !matches(repeatRegion)) {
            return reply('The last scrolling region changed. Look at it and say what to do.', 'error', { performed: null });
          }
          const onMatch = repeatRegion ?? context.regionsAtGaze?.().find(matches);
          if (onMatch) region = onMatch;
          else {
            const matching = (context.screenRegions?.() ?? []).filter(candidate => candidate[axis] && matches(candidate.element));
            const distance = item => distanceToRect(context.x, context.y, item.rect);
            // Prefer the nearer pane; if nested panes are equally near, use the inner one.
            const nearest = matching.sort((a, b) => distance(a) - distance(b) ||
              (composedContains(a.element, b.element) ? 1 : composedContains(b.element, a.element) ? -1 : 0))[0];
            if (!nearest) return reply(`No visible ${action.kind} can scroll ${action.direction}. Look directly at the area and say “scroll ${action.direction}”, or ask to scroll the page.`, 'error', { performed: null });
            region = nearest.element;
            namedMatch = distance(nearest) > context.radius ? 'away from the gaze circle' : 'near your gaze';
          }
          namedScrollRegion = region;
        } else if (action.name && action.scope !== 'page') {
          // An area named by its label or heading: the one whose label carries most of the name, the nearer of equals.
          const repeatRegion = context.repeatScrollRegion;
          if (repeatRegion && areaNameScore(action.name, repeatRegion) < 0.5) {
            return reply('The last scrolling region changed. Look at it and say what to do.', 'error', { performed: null });
          }
          const distance = item => distanceToRect(context.x, context.y, item.rect);
          // The page itself is "the page"; it holds every heading, so it is not one of the named areas.
          const page = element => element === context.pageRegion || element === element.ownerDocument?.scrollingElement || element === element.ownerDocument?.body;
          const best = repeatRegion ? null : (context.screenRegions?.() ?? []).filter(candidate => candidate[axis] && !page(candidate.element))
            .map(candidate => ({ ...candidate, score: areaNameScore(action.name, candidate.element) })).filter(candidate => candidate.score >= 0.5)
            .sort((a, b) => b.score - a.score || distance(a) - distance(b) || (composedContains(a.element, b.element) ? 1 : composedContains(b.element, a.element) ? -1 : 0))[0];
          if (!repeatRegion && !best) {
            return reply(`No area called “${action.name}” can scroll ${action.direction} on screen. Look directly at it and say “scroll ${action.direction}”, or say “scroll the page ${action.direction}”.`, 'error', { performed: null });
          }
          region = repeatRegion ?? best.element;
          if (best) namedMatch = distance(best) > context.radius ? 'away from the gaze circle' : 'near your gaze';
          namedScrollRegion = region;
        } else if (action.scope !== 'page' && region === context.pageRegion && context.scrollRegions?.length) {
          const candidates = context.scrollRegions.filter(candidate => candidate[axis]);
          // Nested scroll containers describe one place; retain its innermost region.
          const inner = candidates.filter(candidate => !candidates.some(other => other !== candidate &&
            composedContains(candidate.element, other.element)));
          if (inner.length > 1) return reply('More than one scrolling region touches the gaze circle. Look further inside the one you mean, or say “scroll the page down”.', 'error', { performed: null });
          if (inner.length === 1) { region = inner[0].element; recovered = true; }
        }
        result = actions.scroll(region, action.direction, action.amount, window);
        if (recovered && result.ok) result.message += ' Found at the edge of the gaze circle.';
        if (namedMatch && result.ok) result.message += action.name ? ` “${action.name}” was ${namedMatch}.` : ` It was the ${action.kind} ${namedMatch}.`;
        break;
      }
      case 'back':
      case 'forward': result = actions.navigate(window, action.type); break;
      default: return reply('That action is not supported yet.', 'error');
    }
    if (result.followUp) {
      // A change checked afterwards can be undone straight away, unless the check finds it did not happen.
      const mine = remembered ? (changed = { change: remembered, at: now() }) : null;
      const followUp = Promise.resolve(result.followUp)
        .catch(() => ({ ok: false, message: 'The website state could not be checked. Check the control before continuing.' }))
        .then(later => { if (!later.ok && mine && changed === mine) changed = null; return later; })
        .then(later => executionTurn === turn && !paused
          ? reply(later.message, later.ok ? 'success' : 'error', { performed: later.ok ? action.type : null }) : null);
      return reply(result.message, 'info', { performed: null, followUp });
    }
    keep(result);
    if (result.ok && target) previous = { target, at: now() };
    if (result.ok && (['scroll', 'back', 'forward'].includes(action.type) || (action.type === 'activate' && target && !confirmable(action, target)))) {
      last = { action, context: namedScrollRegion ? { ...context, repeatScrollRegion: namedScrollRegion } : context, at: now() };
    }
    // A control the user named and used, inside the gaze circle or just outside it, where webcam gaze often lands:
    // where they were looking, for self-calibration. One used after the gaze was far from it, or by its number, is not.
    const aimed = result.ok && POINTING.has(action.type) && (context.elements.includes(target) || context.nearby?.includes(target)) ? target : null;
    return reply(result.message, result.ok ? 'success' : 'error', { performed: result.ok ? action.type : null, aimed });
  }

  function remember(element, before = actions.readValue(element)) {
    const values = history.get(element) ?? [];
    // A newer edit may observe the baseline of a rejected outer write. Share that snapshot instead of
    // retaining two identical Undo steps (and evicting useful older history twice).
    if (values.at(-1) !== before) values.push(before);
    if (values.length > HISTORY_LIMIT) values.shift();
    history.set(element, values);
    textRevision.set(element, ++textSerial);
    latestTextRevision = textSerial;
  }

  function edit(element, name, change, sensitive = false, selection = null) {
    const before = actions.readValue(element) ?? '';
    const values = history.get(element) ?? [];
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
    const priorHistory = [...values], priorEditedAt = editedAt, executionTurn = turn;
    const priorRevision = textRevision.get(element), priorLatest = latestTextRevision;
    if (change.kind === 'undo') { values.pop(); textRevision.set(element, ++textSerial); latestTextRevision = textSerial; }
    else remember(element);
    const revision = textRevision.get(element), rich = Boolean(element.isContentEditable), beforeType = element.type;
    const beforeSensitive = Boolean(actions.isSensitive?.(element));
    const sameMode = () => element.type === beforeType && Boolean(element.isContentEditable) === rich &&
      Boolean(actions.isSensitive?.(element)) === beforeSensitive;
    const current = () => turn === executionTurn && !paused && element.isConnected && sameMode() &&
      actions.canWrite?.(element) !== false && (!actions.ownsFocus || actions.ownsFocus(element));
    editedAt = now();
    actions.writeValue(element, after, { isCurrent: current,
      ...(change.kind === 'insert-selection' ? { caret: selection.start + change.text.length } : {}) });
    // Website input/change handlers can reject or transform a write, or issue a newer command.
    // Undo history is reconciled only while this operation still owns its field's revision.
    const visible = value => rich && typeof value === 'string' ? value.replace(/\u00a0/g, ' ') : value;
    const actual = actions.readValue(element), retained = visible(actual) === visible(after), succeeded = current() && retained;
    const restoreHistory = change.kind === 'undo' ? !succeeded : visible(actual) === visible(before);
    if (restoreHistory && textRevision.get(element) === revision) {
      history.set(element, priorHistory);
      if (priorRevision === undefined) textRevision.delete(element); else textRevision.set(element, priorRevision);
      if (latestTextRevision === revision) { latestTextRevision = priorLatest; editedAt = priorEditedAt; }
    }
    if (turn !== executionTurn || paused) return { ok: false, message: 'Text entry was interrupted by a newer instruction. Check the field before continuing.' };
    if (!sameMode()) return { ok: false, message: 'The field type or protection changed during text entry. Its text is hidden. Check the field before continuing.' };
    if (!succeeded) return { ok: false, message: 'The website did not retain the requested available text change. Check the field before continuing.' };
    // A sensitive field's text is never echoed: the message is shown, announced and may be spoken aloud.
    if (sensitive || actions.isSensitive?.(element)) return { ok: true, message: after ? `${label} updated. Its text is hidden.` : `${label} cleared.` };
    return { ok: true, message: after ? `${label}: ${after}` : `${label} cleared.` };
  }

  function handle(utterance, context, { alternatives = [], spoken = false, userInput = false } = {}) {
    const current = ++turn;
    if (dictation) {
      const control = dictationControl(utterance);
      if (control) {
        if (control.type !== 'help') dictation = null;
        return decide(utterance, context, control, current);
      }
      const target = dictation, element = target.element;
      if (context.trackingUnavailable || !element.isConnected || actions.isSensitive?.(element) || actions.canWrite?.(element) === false ||
        !(context.focusIsCurrent ? context.focusIsCurrent(element) : actions.ownsFocus?.(element))) {
        dictation = null;
        return reply('Dictation stopped because tracking or the selected field changed. No text was entered. Start dictation again when ready.', 'error');
      }
      const undo = /^undo typing[.!]*$/i.test(utterance.trim());
      const text = dictated(utterance);
      if (!undo && !text) return reply('Dictation is still active. Speak some words, or say “stop dictation”.');
      const response = perform({ type: 'edit', targetId: 198, requireFocus: true,
        edit: undo ? { kind: 'undo' } : { kind: 'append', text, raw: /^[\s.,;:?!…)”]/u.test(text) } }, { ...context, elements: [target] });
      if (response.tone === 'error' && !undo && dictation === target && turn === current) dictation = null;
      return response;
    }

    const recent = previous && now() - previous.at <= PREVIOUS_MS && previous.target.element?.isConnected !== false ? { ...previous.target, id: PREVIOUS_ID } : null;
    if (recent) context = { ...context, previous: recent };
    if (hovered?.isConnected) context = { ...context, hovering: true };
    let action = interpret(utterance, context), heardAs = null;
    // The recogniser's other readings of the same speech ("click sign in" behind "click signing"): when the first is
    // not understood, the first that is, or else the first that names something which can be offered by sound.
    if (action.type === 'unknown' && alternatives.length) {
      const readings = alternatives.map(text => ({ text, action: interpret(text, context) }));
      const chosen = readings.find(reading => reading.action.type !== 'unknown') ?? (action.alike ? undefined : readings.find(reading => reading.action.alike));
      if (chosen) ({ text: heardAs, action } = chosen);
    }
    // A request learned from an earlier yes (see learned.js), said again, acts on the control it named; a phrase taught
    // by voice stands for its instruction, understood here. "Forget basket" forgets one taught or learned.
    let taught = null;
    if (action.type === 'unknown' && !heardAs && commands.learned) {
      const list = commands.learned.list(), forgetting = /^forget\s+["“]?(.+?)["”]?[.!]*$/i.exec(utterance.trim());
      if (forgetting && withoutLearned(list, forgetting[1]).length < list.length) action = { type: 'learned', change: 'forget', phrase: forgetting[1] };
      else {
        const known = learnedAction(list, utterance, context);
        if (known?.type === 'alias') {
          taught = known.instruction;
          action = { ...interpret(taught, context), taught: known.said };
          if (action.type === 'unknown' && !action.alike) return reply(`“${known.said}” stands for “${taught}”, which does not apply here.`, 'error');
        } else if (known) action = { ...known, learned: true };
      }
    }
    spokenNow = spoken;
    userInputNow = userInput === true;
    learnFrom = spoken && !taught ? utterance : null;
    const response = decide(taught ?? heardAs ?? utterance, context, action, current);
    // Text edit and personal-detail replies omit private values; do not reintroduce them through an alternative.
    if (!heardAs || !response || action.type === 'edit' || action.type === 'details') return response;
    // Say which reading was used, also in the website's later answer when its state is checked afterwards.
    const noted = answer => (answer?.message ? { ...answer, message: `Heard "${heardAs}". ${answer.message}` } : answer);
    if (response.followUp && !response.assisting) response.followUp = Promise.resolve(response.followUp).then(noted);
    return response.assisting ? response : noted(response);
  }

  function decide(utterance, context, action, current) {
    // Help is a navigator request, not an answer or a new page action. Keep the task and its original deadline.
    if (action.type === 'help') {
      const expired = pending && now() >= pending.expiresAt;
      if (expired) pending = null;
      const guidance = commandHelp({ context, pending, paused, dictation });
      return reply(`${expired ? 'The previous question expired. Give the instruction again. ' : ''}${guidance}`, 'info', { help: true, keepPrompt: true });
    }
    // "Undo" straight after a fill of saved details takes back the whole fill.
    const fill = filled;
    if (action.type !== 'confirm') filled = null;
    if (fill && /^undo(?: that| it| filling| the fill)?[.!]*$/i.test(String(utterance ?? '').trim()) && now() - fill.at <= FILL_UNDO_MS && commands.details) {
      const isCurrent = () => turn === current && !paused;
      const result = commands.details.restore(fill.entries,{isCurrent});
      if (!isCurrent()) return reply('Stopped restoring saved-detail fields because a newer instruction arrived. Check the form before continuing.','error');
      if (result.remaining?.length) filled = {...fill,entries:result.remaining};
      return reply(result.message,result.ok === false ? 'error' : 'success');
    }
    // "Undo" straight after a checkbox, section, dropdown or radio button changed puts it back, unless text was typed since.
    const change = changed;
    if (change && UNDO_WORDS.test(String(utterance ?? '').trim()) && now() - change.at <= CHANGE_UNDO_MS && change.at > editedAt) {
      changed = null;
      const result = actions.revertChange(change.change), said = outcome => reply(outcome.ok ? `Undone. ${outcome.message}` : outcome.message, outcome.ok ? 'success' : 'error', { performed: outcome.ok ? 'undo' : null });
      if (!result.followUp) return said(result);
      const turnNow = turn;
      return reply('Putting it back…', 'info', { performed: null, followUp: Promise.resolve(result.followUp)
        .catch(() => ({ ok: false, message: 'The website state could not be checked. Check the control before continuing.' }))
        .then(later => (turnNow === turn && !paused ? said(later) : null)) });
    }
    if (action.type === 'stop-dictation') {
      dictation = null; pending = null;
      return reply('Dictation stopped. Look at something and say what to do.');
    }
    if (action.type === 'cancel') {
      dictation = null;
      const had = pending;
      pending = null;
      // "Cancel" always stops the navigator and never presses anything; with nothing to stop and the website's own
      // Cancel button in view, say how to press it.
      const button = !had && context.elements?.find(element => /^cancel$/i.test((element.name ?? '').trim()) && ['button', 'link'].includes(element.role));
      return reply(had ? 'Cancelled. Nothing was changed.' : button ? 'Nothing to cancel. To press the website\'s Cancel button, say "click cancel".' : 'Cancelled.', 'info', { cancelled: true });
    }
    if (action.type === 'pause') {
      paused = true;
      dictation = null;
      pending = null;
      // "Pause" alone pauses the navigator; a video it leaves playing is pointed out.
      const playing = context.media?.().some(item => item.playing);
      return reply(`Paused. Say resume to continue.${playing ? ' A video is still playing: after resume, say "pause the video" to pause it.' : ''}`, 'info', { paused: true });
    }
    if (action.type === 'resume') {
      paused = false;
      return reply('Resumed. Look at something and say what to do.', 'info', { paused: false });
    }
    // Navigator settings stay available while paused; changing scope retires old targets.
    if (action.type === 'speech-prefix') {
      pending = null;
      if (!commands.speechPrefix) return reply('Speech addressing is not available here.', 'error');
      const result = commands.speechPrefix(action.required);
      return reply(result.message, result.ok ? 'success' : 'error');
    }
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
      const result = handler(action.type === 'circle-size' ? action.size : action.type === 'calibrate' ? { refresh: action.refresh === true } : action.source);
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
        pending = { kind: 'confirm', action, context, keyTarget: commands.keyTarget?.(), expiresAt: now() + confirmMs };
        return reply(`${keyLabel(action)} often sends a message or a form. Say confirm to press it, or cancel.`, 'question');
      }
      pending = null;
      return runKeys(action);
    }
    // Requests learned from a yes to an offer, and phrases taught: listed or forgotten at once.
    if (action.type === 'learned') {
      if (!commands.learned) return reply('Learned requests are not available here.', 'error');
      pending = null;
      const list = commands.learned.list();
      if (action.change === 'forget' && action.phrase != null) {
        const left = withoutLearned(list, action.phrase);
        if (left.length === list.length) return reply(`“${action.phrase}” was neither taught nor learned, so there is nothing to forget.`, 'info');
        commands.learned.forget(action.phrase);
        return reply(`Forgot “${action.phrase}”.`, 'success');
      }
      if (action.change === 'forget') { commands.learned.forget(); return reply(list.length ? `Forgot ${list.length === 1 ? 'the one phrase' : `all ${list.length} phrases`} taught or learned.` : 'Nothing was taught or learned, so there is nothing to forget.', 'success'); }
      return reply(list.length ? `${list.length} taught or learned, latest first: ${learnedSummary(list)}. Say "forget" and one of them, or "forget what you learned" to clear them all.`
        : 'Nothing taught or learned yet. Teach a phrase with "when I say …, I mean …", or say yes when I offer what you might mean.', 'info');
    }
    // A trial's tasks (see trial-tasks.js), started from the extension's toolbar popup: the task at hand, said again,
    // done or skipped. Asking which task it is keeps a question waiting, as help does.
    if (action.type === 'trial') {
      if (!commands.trial) return reply('Trial tasks are not available here.', 'error');
      const task = commands.trial.current(), said = next => `Task ${next.number} of ${next.total}: ${next.text}`;
      if (!task) return reply(commands.trial.summary(), 'info', { trial: true, keepPrompt: true });
      if (action.change === 'show') return reply(said(task), 'info', { trial: true, keepPrompt: true });
      pending = null;
      const saved = result => {
        if (!result?.finished || result.ok === false) return reply(result?.message ?? 'The trial changed. No task was moved on. Ask what your task is.', 'error', { trial: true });
        const { finished, next } = result;
        const what = `Task ${finished.number} ${finished.outcome === 'done' ? 'done' : 'skipped'} after ${spokenDuration(finished.seconds)}.`;
        return reply(next ? `${what} ${said(next)}` : `${what} That was the last task, so the trial is finished.`, 'success', { trial: true });
      };
      const failed = () => reply('Could not save the task result. Ask what your task is, then try again.', 'error', { trial: true });
      try {
        const result = commands.trial.finish(action.change === 'done' ? 'done' : 'skipped');
        if (typeof result?.then !== 'function') return saved(result);
        const followUp = Promise.resolve(result).then(saved, failed).then(answer => current === turn && !paused ? answer : null);
        return reply('Saving the task result…', 'info', { trial: true, followUp });
      } catch { return failed(); }
    }
    // A phrase taught by voice to stand for an instruction: "when I say basket, I mean open the basket".
    if (action.type === 'teach') {
      pending = null;
      if (!commands.learned) return reply('Teaching phrases is not available here.', 'error');
      if (!spokenNow) return reply('Say it aloud to teach a phrase: a page could type into this box, but it cannot speak for you.', 'error');
      if (!action.instruction) return reply(action.phrase.includes(' ')
        ? `Say "I mean" between the phrase and what it should do, for example "when I say the usual, I mean open the basket".`
        : `Say what “${action.phrase}” should do, for example "when I say ${action.phrase}, I mean open the basket".`, 'question');
      const own = interpret(action.phrase, context);
      if (own.type !== 'unknown' && own.type !== 'clarify' && own.targetId == null) return reply(`“${action.phrase}” is already one of my commands, so it keeps doing that. Choose other words.`, 'error');
      const meant = interpret(action.instruction, context);
      if (meant.type === 'unknown' || meant.type === 'teach' || meant.type === 'learned') return reply(`“${action.instruction}” is not understood here, so it cannot be taught. Say it on its own first to check it works.`, 'error');
      const entry = taughtEntry(action.phrase, action.instruction);
      if (!entry) return reply('That is too long to teach: keep the phrase to a few words and the instruction to one.', 'error');
      commands.learned.remember(entry);
      return reply(`From now on, “${entry.said}” does “${entry.alias}”. Say “forget ${entry.said}” to undo this.`, 'success');
    }
    // Personal details kept on this device: saved, listed or forgotten at once; filled into the form nearest the gaze
    // only after a yes, and "undo" straight afterwards empties those fields again.
    if (action.type === 'details') {
      if (paused) return reply('Paused. Say resume to continue, or cancel.', 'info');
      if (!commands.details) return reply('Saved details are not available here.', 'error');
      pending = null;
      if (action.change !== 'fill') { const result = commands.details[action.change](action); return reply(result.message, result.ok ? 'success' : 'error'); }
      const plan = commands.details.plan(action, context);
      if (!plan.ok) return reply(plan.message, 'error');
      pending = { kind: 'confirm', action: { ...action, plan: plan.fields }, context, expiresAt: now() + confirmMs };
      return reply(plan.message, 'question');
    }
    // Cookie banners and pop-ups are found wherever they are. Saying which choice to make is the choice, so a consent
    // button ("Accept all") is pressed without the usual question.
    if (action.type === 'popup') {
      if (paused) return reply('Paused. Say resume to continue, or cancel.', 'info');
      if (!commands.popup) return reply('Cookie banners and pop-ups are not available here.', 'error');
      pending = null;
      const found = commands.popup(action);
      if (!found.target) return reply(found.message, 'error');
      const result = execute({ type: 'activate', targetId: found.target.id }, { elements: [found.target] });
      return result.tone === 'success' ? { ...result, message: found.message } : result;
    }
    // Videos and sounds need no particular control: the one the gaze is on, else the one playing, is used.
    if (action.type === 'media') {
      if (paused) return reply('Paused. Say resume to continue, or cancel.', 'info');
      if (!commands.media) return reply('Controlling videos is not available here.', 'error');
      pending = null;
      return runMedia(action, context);
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
        if (confirmation.action.type === 'key' && commands.keyTarget && commands.keyTarget() !== confirmation.keyTarget) {
          pending = null;
          return reply('The focused page target changed. Give the shortcut again. No key was pressed.', 'error');
        }
        const done = execute(confirmation.action, confirmation.context, confirmation.activation, true);
        // Learned only when the yes was spoken too: a page could type one into the panel.
        const entry = confirmation.learn && spokenNow && done?.tone === 'success' ? learnedEntry(confirmation.learn, confirmation.action, targetOf(confirmation.context, confirmation.action.targetId)) : null;
        if (entry) {
          commands.learned.remember(entry);
          done.message = `${done.message} Next time, “${entry.said}” does this without asking.`;
        }
        return done;
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
      const gone = repeated.targetId != null ? !targetOf(where, repeated.targetId)?.element?.isConnected : repeated.type === 'scroll' && (where.repeatScrollRegion ?? where.region)?.isConnected === false;
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
    pending = { kind: 'confirm', action: offered, context, ...(target ? { farTarget: target } : {}), activation: activationOf(offered, target), expiresAt: now() + confirmMs,
      ...(learnFrom && commands.learned ? { learn: learnFrom } : {}) };
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
        // A control found just outside the circle: say so, so the user knows where the action happened. One inside a
        // crowded circle, beyond its nearest controls, was where the user looked.
        const outside = action.outside && !targetOf(context, action.targetId)?.inside;
        if (outside && response.tone === 'success') response.message = `${response.message} It was just outside the gaze circle.`;
        else if (outside && response.tone === 'question') response.message = `Just outside the gaze circle: ${response.message}`;
        if (action.learned && response.tone === 'success') response.message = `${response.message} (Learned from an earlier yes.)`;
        else if (action.taught && response.tone === 'success') response.message = `${response.message} (Taught as “${action.taught}”.)`;
        return response;
      }
    }
  }

  return {
    handle,
    // Performs an already interpreted and confirmed action (used by an embedded frame for the top navigator).
    run: (action, context, { confirmed = false } = {}) => execute(action, context,
      action.type === 'activate' || confirmed ? activationOf(action, targetOf(context, action.targetId)) : null),
    get dictation() { return dictation; },
    endDictation() { dictation = null; },
    get paused() { return paused; },
    get pending() { return pending && { kind: pending.kind, candidates: pending.candidates ?? null, farTarget: pending.farTarget ?? null }; },
    cancel() { return handle('cancel', { elements: [] }); },
  };
}
