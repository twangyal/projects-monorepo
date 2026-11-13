// Guidance uses the captured control kinds, never field contents or page actions.
export function commandHelp({ context, pending, paused, dictation }) {
  if (paused) return 'The navigator is paused. Say “resume” to continue, or “cancel” to clear a request. Help does not resume navigation.';
  if (pending?.kind === 'confirm') return 'Waiting for confirmation. Say “confirm” to do the requested action, or “cancel”. The confirmation still expires at its original time.';
  if (pending?.kind === 'clarify') return `Waiting for your choice. Say one of these numbers: ${pending.candidates.map(candidate => candidate.number).join(', ')}, or “cancel”. The question still expires at its original time.`;
  if (context.trackingUnavailable === 'calibration') return 'Camera calibration is not ready. Say “recalibrate” and finish the dots, or “use pointer” to work without the camera. Pause and cancel remain available.';
  if (context.trackingUnavailable) return 'Camera tracking is lost. Look at the page with your face visible, say “use pointer”, or say “show numbers” to choose visible controls by number. Pause and cancel remain available.';
  if (dictation) return 'Dictation is active. Speak phrases to append text in the selected field. Say “undo typing” for the last phrase, “stop dictation” for commands, or “pause” or “cancel” to stop. “Help with the navigator” gives this help without typing it.';
  const elements = context.elements ?? [];
  const hints = [];
  if (elements.some(element => element.dateParts)) hints.push('For the date boxes, say “type the twelfth of March twenty nineteen”.');
  else if (elements.some(element => element.dateSnapshot)) hints.push('For a date field, say “set date field to November first”.');
  else if (elements.some(element => element.timeSnapshot)) hints.push('For a time field, say “set time field to 2:30 pm”.');
  else if (elements.some(element => element.monthSnapshot)) hints.push('For a month field, say “set month field to November 2026”.');
  else if (elements.some(element => element.weekSnapshot)) hints.push('For a week field, say “set week field to week 43”.');
  else if (elements.some(element => element.nativeNumber)) hints.push('For a number field, say “set number field to four”. The website’s limits still apply.');
  else if (elements.some(element => element.role === 'spinbutton')) hints.push('For a custom number control, say “set” followed by its name and “to four”. The website’s limits still apply.');
  else if (elements.some(element => element.editable && !element.sensitive)) hints.push('For a text field, say “type hello”, “start dictation”, or “undo typing”.');
  else if (elements.some(element => element.editable && element.sensitive)) hints.push('For a protected field, say “type” followed by the value; its contents stay hidden in feedback. Continuous dictation is unavailable.');
  if (elements.some(element => ['checkbox', 'switch'].includes(element.role))) hints.push('For a checkbox or switch, say “turn on” or “turn off” followed by its name.');
  else if (elements.some(element => element.role === 'combobox')) hints.push('For a dropdown, say “choose” followed by the option name.');
  else if (elements.some(element => element.role === 'slider')) hints.push('For a slider, say “set slider to forty percent”.');
  else if (elements.some(element => element.role === 'radio')) hints.push('For a radio choice, say “select” followed by its name and “radio button”.');
  if (!hints.length) hints.push('Look at a control and say “click this” or name it, such as “open help”.');
  if (context.numbered?.length) hints.push('Say a displayed control number to use it. A question’s own numbers take priority.');
  else hints.push('Say “scroll down”, “go back”, or “show numbers” if pointing is difficult.');
  hints.push('Say “pause” or “cancel” to stop.');
  return hints.join(' ');
}
