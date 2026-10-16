# Gaze writable-field protection — #274

## Outcome

Ordinary typing, clearing, word correction and text Undo preserve the intended focused/named text field. Noneditable text candidates remain in intent resolution instead of being filtered away in favor of a writable neighbor. Current DOM writability is checked before edit/search confirmation and again before execution, preceding history, input/change events, value mutation or search submission. Explicitly naming another writable destination remains supported.

The shared guard covers native read-only/disabled state, inert and ARIA read-only/disabled restrictions, including enclosing shadow hosts and same-origin frames. Existing native selection restrictions remain. Discovery and the execution guard now traverse the same scope boundaries. This is a correctness repair for the extension-first product, not a claim of intended-user or physical speech/gaze acceptance. Gaze remains ACTIVE.

## Source and verification

Base main: `d69ffc8abab9e28556ceb14d8349fa911de0a12b`. Task branch: `autonomous/gaze-writable-fields-274`. No PR was requested or created.

The local execution environment failed its initialization handshake and no local shell tool was available. No npm, Node test runner, local Chromium or production packaging command is claimed to have run. GitHub remains the durable source; hosted CI supplies the full supported-runtime verification.

Production interpreter/controller source was evaluated in the available orchestration JavaScript runtime after stripping only module import/export syntax and injecting the existing dependencies. Nine focused checks fail against base and pass against the fix: six wrong-field commands, late locking without writes/history consumption, Undo after unlocking, and confirmed-search refusal. All 39 cases from the fetched interpreter/controller test files also pass through a lightweight assertion adapter. This is supplementary source evidence, not the Node test runner or a DOM browser. The unchanged production instruction evaluator scores120/120 tuned,34/50 held-out and18/50 second held-out with zero unsafe results on those authored suites.

Five standard Node cases and four browser cases were added. The browser cases run at the existing four viewports and cover exact retained field/neighbor values, no edit events, retained Undo, explicit alternate-field entry, late native/ARIA/inert restrictions, real shadow/frame DOMs and the actual isolated extension on strict-CSP content. Existing deadlines and assertions are unchanged.

## Review decisions and retained limitations

Self-review found that a light-DOM-only restriction check was insufficient because discovery crosses shadow roots and same-origin frames. Before integration, the guard was extended to check those enclosing scopes, with actual-browser coverage. The initial source run `38967248764` is superseded, not accepted as the final gate.

The controller's injectable action doubles may omit the optional guard; the production default action module always supplies it. This preserves existing test/action injection while protecting actual shared runtime writes. Refused confirmed searches do not submit or add history. Ordinary writable dictation/selection, ambiguity, pause/cancel and consequential confirmation retain their existing paths.

This does not promise atomicity against arbitrary hostile website focus/event callbacks, broad framework compatibility, rich-text editing fidelity, or real microphone/webcam usefulness. Physical camera acceptance remains in #132. No dependency, host permission, billing, paid service or owner-deferred/skipped project is changed.

The first complete source gate [38967436091](https://github.com/twangyal/projects-monorepo/actions/runs/38967436091), job117197765204, passes176 units and292 browser cases but fails8 new-fixture executions (two cases at four viewports). The extension locator matched both Message and Other message; it is corrected to an exact label. The late-lock fixture counted a pending browser change from the earlier successful fill/dictation when focus left. That fixture now settles the earlier native edit before monitoring refused operations and logs the settled event's trusted flag. Its all-event zero-change assertion, retained values and Undo assertions remain unchanged. The extension fixture likewise settles its initial fill before monitoring. No production guard, deadline or expected protection is relaxed.

Corrected source `052cde20ef7520066057a46168f8b6228ca73d2e`, tree `058b28e203ba27bbe790fc50b27d05da45da8e61`, passes [complete hosted CI 38968889449](https://github.com/twangyal/projects-monorepo/actions/runs/38968889449), job `117202086260`: **176 unit and all300 native browser cases**, syntax and test-extension build. The browser suite completes in9.0m. All four diagnostic logs record a prior trusted native change with the unchanged value Keep this, confirming the fixture diagnosis; the retained zero-event assertions then pass. All five added test bodies fail against base in the lightweight adapter and pass with the fix.

The exact source was integrated to main with matching-head protection. Canonical main CI is pending; issue #274 remains open until that result is assessed and this receipt is finalized. Subsequent root-documentation edits do not change the tested application/workflow tree. The next continuation should inspect main CI for this source, record its actual outcome, resolve any regression, and close #274 only when appropriate. No unrelated work was started.
