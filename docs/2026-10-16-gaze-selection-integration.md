# Gaze native text selection and insertion — #273

## User outcome and scope

The extension and practice site's shared runtime can select all native field text, move the cursor to either end, insert exact text at its caret/selected range, and explicitly replace a nonempty selection. Ordinary dictation retains its existing append behavior. These are intermediate text-correction capabilities toward the extension-first product direction; Gaze remains ACTIVE.

Commands: `select all text`, `move cursor to the start`, `move cursor to the end`, `insert Hello at the cursor`, `replace selected text with Hello`. Quoted insertion text retains intentional spaces. Explicit insertion does not invent spacing. Selection-only operations leave text Undo untouched; insertion is one normal per-field Undo entry. Supported targets are writable native input/textarea controls with selection offsets. Rich-text editors and incompatible input types refuse these selection commands. The focused field must still be in captured gaze context.

## Implementation and review

Base main: `d6ef2c67709fcd268ae4c144009a76ee7df35d19`.

- Initial source: `3639b525af469a38a9011393b108f01fc72aa98d`, tree `38c6227be0ad00efb4819c925b12098756326c11`.
- Reviewed fix source: `eb9031b7d1f2e709d6408f2d32c564bb97754e80`, tree `214ff8641b83e5ee91dc54b6b006453dd8487798`.
- Short-lived source branch: `autonomous/gaze-selection-273`. No PR was requested or created.

A fresh read-only whole-branch review found no Critical issues, one Important wrong-field issue and one Minor punctuation issue. Both findings were accepted and fixed with failing regressions before the fix. The Important case: fresh context filtered a focused read-only field from editable candidates, so a command could mutate a different writable neighbor. Selection commands now retain the focused field's identity and refuse at execution. Accepting the original behavior would have risked changing unrelated user text. The native regression has two nearby fields and verifies both stay exact. The Minor case: terminal punctuation after “at the cursor” formerly fell into ordinary append dictation; terminal punctuation now preserves explicit insertion semantics without changing the inserted text. Accepting it would have appended command words to the user's field.

Review declined selection-only history pollution, existing append regression and a demonstrated new security/CSP regression. Coordinator agreement is limited to the concrete paths and tests: selection bypasses history, ordinary dictation is unchanged, and native setters/events remain shared. A mistake in those judgments would risk lost Undo, altered dictation or website incompatibility; the full existing suites remain required. Ordinary input/change tests do not establish broad framework compatibility. No second review was commissioned.

## Verification and retained failures

- Initial interpreter/controller RED: selection commands were unknown and replacement left the field unchanged. Focused GREEN followed implementation.
- One early fixture expected automatic insertion spacing. It now supplies quoted `"next "` and tests exact intended whitespace; production does not add spacing.
- Reviewed local units: **171 passed**, zero failures. Syntax and test-extension build pass.
- Reviewed focused native checks: **4 passed** on portable Chromium 143, covering actual field values, selection offsets, input/change events, Undo, command-entry focus, pause, empty/unsupported selection, late read-only state and fresh-context wrong-field refusal.
- Existing instruction evaluation: 120/120 tuned, 34/50 held-out and 18/50 second held-out, zero unsafe results (rerun on reviewed source). These authored suites do not establish physical speech quality.
- Local full browser attempt was stopped after existing extension fixtures timed out waiting for their service worker. The portable Chromium 143 extension startup was not successful; this incomplete/failed attempt is not a full-suite pass. Its logs and error contexts were retained in scratch. No product deadline or assertion was weakened. Standard hosted Chromium remains the complete extension gate.

- Reviewed local non-extension suite: **240 passed in 6.9 minutes** across desktop, narrow, short and compact-boundary viewports. This deliberately excludes `extension.spec.js`; it is not described as the complete suite.
- Initial hosted source run [38930311329](https://github.com/twangyal/projects-monorepo/actions/runs/38930311329) was cancelled after publication of the reviewed fix, and is not a pass.

- Reviewed source [CI 38930615699](https://github.com/twangyal/projects-monorepo/actions/runs/38930615699), job `117073582212`: **171 units and all 284 native browser cases pass** (8.9m browser suite), with syntax/test-extension build. The extension's strict-CSP selected-text/Undo flow passes in standard hosted Chromium.
- Main was advanced with expected-head protection from the recorded base to the exact reviewed source. Canonical [main CI 38932137888](https://github.com/twangyal/projects-monorepo/actions/runs/38932137888), job `117078510747`, passes **171 unit and all 284 native browser cases** (8.2m browser suite), with syntax/test-extension build. The test run uses the same reviewed source tree. Subsequent receipt/direction/roadmap commits change only root documentation; application and workflow diffs against the tested source are empty.
- Repository state was reassessed after integration: issue #274 is the next-priority known software defect; physical-input/model/data gates remain separately open. No project status is promoted and the owner's deferred/skipped work is unchanged.

## Remaining acceptance

Read-only triage also reproduced a pre-existing broader wrong-field issue in ordinary append/clear/word-replacement commands: focused read-only ID 1 plus writable neighboring ID 2 produces a target-2 edit. This milestone's explicit selection commands correctly retain ID 1, but do not claim to repair every older text command. Issue #274 records the reproduction and next-priority completion criteria; implementation had not started when recorded.

Real microphone/webcam operation, intended-user effort and broader real-site/framework acceptance remain unverified. Physical held-out camera work remains in #132. No paid service, model download, production infrastructure, permission expansion or change to the owner's skipped/deferred projects is part of this milestone.
