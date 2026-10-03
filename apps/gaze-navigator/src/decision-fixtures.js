export const SUITE_VERSION = 'gaze-targets-v1';

const targets = () => [
  { id: 't1', label: 'Compose', description: 'Start a new practice draft.', disabled: false, rect: { x: 100, y: 100, width: 200, height: 100 } },
  { id: 't2', label: 'Search', description: 'Find matching practice messages.', disabled: false, rect: { x: 340, y: 100, width: 200, height: 100 } },
  { id: 't3', label: 'Pause', description: 'Pause navigation while retaining the current tracking session.', disabled: false, rect: { x: 100, y: 330, width: 200, height: 80 } },
  { id: 't4', label: 'Stop', description: 'Stop tracking and release camera resources.', disabled: false, rect: { x: 340, y: 330, width: 200, height: 80 } },
];
function fixture(id, title, goal, gaze, expected, mutate = () => {}) {
  const choices = targets();
  mutate(choices);
  return { id, title, expected, task: { goal, gaze, viewport: { width: 1000, height: 600 }, targets: choices } };
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
// Labels are author-defined synthetic task expectations, not collected eye-tracking data.
export const CASES = freeze([
  fixture('compose-hit', 'Direct gaze on Compose', 'Start writing a practice message.', { x: 180, y: 150 }, 't1'),
  fixture('search-hit', 'Direct gaze on Search', 'Find the calibration instructions.', { x: 450, y: 150 }, 't2'),
  fixture('compose-near', 'Small gaze error beside Compose', 'Start a new draft.', { x: 90, y: 150 }, 't1'),
  fixture('ambiguous', 'Between controls without a goal', '', { x: 320, y: 150 }, null),
  fixture('compose-context', 'Between controls: compose goal', 'Start writing a new practice message.', { x: 320, y: 150 }, 't1'),
  fixture('search-context', 'Between controls: search goal', 'Find the message about calibration.', { x: 320, y: 150 }, 't2'),
  fixture('off-target', 'Gaze far from all controls', 'Start a new draft.', { x: 900, y: 550 }, null),
  fixture('disabled-target', 'Gaze on a disabled control', 'Start a new draft.', { x: 180, y: 150 }, null, choices => { choices[0].disabled = true; }),
  fixture('missing-gaze', 'No gaze sample available', 'Start a new draft.', null, null),
  fixture('pause-hit', 'Direct gaze on Pause', 'Pause navigation but keep tracking available.', { x: 180, y: 370 }, 't3'),
  fixture('unsupported-goal', 'Nearby controls cannot send', 'Send the completed message now.', { x: 320, y: 150 }, null),
  fixture('stop-context', 'Between safety controls: stop goal', 'Turn off tracking and release the webcam.', { x: 320, y: 370 }, 't4'),
  fixture('swapped-context', 'Labels swapped across nearby controls', 'Start writing a new practice message.', { x: 320, y: 150 }, 't2', choices => {
    [choices[0].label, choices[1].label] = [choices[1].label, choices[0].label];
    [choices[0].description, choices[1].description] = [choices[1].description, choices[0].description];
    choices.reverse();
  }),
  fixture('conflicting-goal', 'Gaze and goal conflict', 'Find the calibration instructions.', { x: 180, y: 150 }, null),
]);
