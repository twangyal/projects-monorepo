# Spoken control of ordinary web pages — issue #203

## Intended outcome and gap

`docs/PRODUCT_DIRECTION.md` sets the destination: people who find a mouse or
keyboard difficult look at part of a real website and say what to do; the
navigator shows its context, asks when unclear, confirms consequential actions
and performs the browser action. Before this milestone the app could only
dwell-activate controls annotated with `[data-gaze-target]` inside its own
practice inbox. There was no context circle, speech, instruction
interpretation, or action on ordinary page markup.

## What this milestone delivers

A page-agnostic runtime in `src/web/` with separate stages:

| Stage | Module | Responsibility |
| --- | --- | --- |
| Tracking | `overlay.js` | Pointer stand-in for gaze (or `track()` with One Euro smoothing for camera samples); freezes while gaze rests on the panel |
| Context | `page-context.js` | Visible, enabled, unobscured links/buttons/fields/dropdowns/ARIA widgets intersecting the circle; accessible names and roles; scroll region; page search field |
| Speech | `speech-input.js` | Web Speech API, interim transcript, restart after silence, failure messages, immediate interim cancel/stop/pause |
| Interpretation | `interpreter.js` | Deterministic rule baseline: activate, choose option, dictate/append, clear, delete word, replace, undo, new line, submit, search, scroll, back/forward, numbered choices, pause/resume/cancel, confirm/deny |
| Coordination | `controller.js` | Clarification and expiring confirmation state, pause, undo history, stale-element refusal |
| Execution | `page-actions.js` | Click/focus, native value setter with input/change events, option selection, requestSubmit/Enter, page or region scrolling, history navigation; refuses non-web link schemes |

Context is captured when an utterance begins: at `speechstart`, or at the first
interim words of each later utterance, because continuous recognition fires
`speechstart` only once per session. A typed instruction uses the context at the
last page position.

## Verification (2026-10-12, local)

Environment: Node.js 22.22.0, Playwright 1.63.0, preinstalled Chromium 141.0.7390.37.

- `npm test`: 109 passing tests, including 12 interpreter, 9 controller (fake
  actions, controllable clock) and 5 speech-wrapper (fake recognizer) tests.
- `npm run lint` / `npm run build`: the new whole-tree syntax check covers 61 files.
- Native Chromium: all 124 cases pass at 1280×900, 390×740, 390×480 and 390×651.
  Seven new practice-site cases per viewport cover the behaviors above.

Defects found and fixed during this work: wrapped `<label>` text included the
dropdown's option list in its accessible name; reordered option words ("high to
low") tied an exact option name; an exact name tied a longer name containing it;
on short screens the panel covered controls that could not scroll clear; and
later utterances in one recognition session lost speech-start context capture.

## Not established

- Real microphone capture and speech-service recognition quality. The browser
  tests drive a fake recognizer; Chrome's real recognizer sends audio to its
  vendor service.
- Camera gaze in this runtime, and use by intended users (task completion,
  effort, unintended actions). Physical evaluation remains with #132.
- Third-party websites: the runtime is loaded by the practice site itself.
  Extension packaging is the next milestone.
- Jev as the interpreter. The rule baseline is English-only and has a fixed
  vocabulary.
