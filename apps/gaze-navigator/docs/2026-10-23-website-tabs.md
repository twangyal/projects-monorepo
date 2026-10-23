# Explicit website tab selection — #312

The extension's shared speech/typed runtime now supports explicit named, gazed and ordinal selection of website tabs. The site owns focus handlers, state and clicks. Selected targets are no-ops. A controller-owned task boundary lets automatic focus activation finish before deciding whether one click is needed; Cancel/Pause/new instructions retire that click as well as feedback. Live availability and captured target/group/member identity are rechecked throughout.

The [W3C APG tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) describes selected-state semantics and manual/automatic activation. This implementation supports binary single-select ancestor tablists; multi-select, aria-owns and missing/invalid states refuse. Panel rendering/loading is not inferred from selected state. No permission, dependency, persistence format or model prompt change.

## Verification checkpoint

- Two interpreter tests initially failed because explicit commands still returned generic activate. The first native test independently failed on that same missing selection action before implementation.
- All205 Node tests, syntax and test-extension build pass. The frozen instruction evaluator remains120/120, with zero unsafe results; unchanged held-out sets remain34/50 and18/50 with zero unsafe results. Frozen fixtures were not edited; those scores do not evaluate new tab instructions or physical speech.
- First native focus passes40/40 across four viewports: manual and synchronous/nested-microtask automatic activation, no-op, malformed/unsafe/locked/hidden groups, focus/identity/member/form changes, post-click reversion/removal, deferred-click cancellation/pause/new command, clarification/confirmation and frame/shadow ownership. A nested-parenthesis syntax error in the first expanded test draft was corrected before execution; no product workaround or relaxed assertion.
- Fresh independent review found no implementation correctness blocker and flagged absent new MV3 injection coverage. A strict-CSP third-party extension case is now included for canonical CI. Optional target-matching verification was added without changing model prompt data.
- The added optional-matcher fixture first used one exact name and one partial name, so rules correctly selected without asking the model (40/44 passed). It now uses two equally matched distinct names to actually exercise assisted clarification; no production matcher threshold or expectation was relaxed.
- Final focused native rerun passes all44 cases across four viewports, including the corrected optional-matcher path.
- Evaluator integrity follow-up found that wrong select-radio/select-tab actions were not in the page-action classifier and could be scored as abstentions. Extended synchronous/asynchronous scorer regression failed unsafe0 versus expected1; adding only those action types repairs classification. No frozen case, expected answer or threshold changed. The full project/evaluator rerun and canonical complete-browser gate are recorded below when available.

## Local execution and limits

Available serverless Chromium143 cannot initialize MV3 service workers, as retained by #308. This run uses its actual browser for focused native runtime tests and requires canonical full Chromium for injection and full-suite acceptance; no local complete-suite pass is claimed. The previous full local #308 attempt also retained a maximum-draft timeout, so those older failures remain visible in its receipt.

Observation drains focus/click microtasks at task boundaries; it does not await arbitrary future site work or prove panel content correctness. The action is website-tab selection, not browser chrome navigation. Physical camera/speech, broad framework usability and intended-user effort remain unverified in#132. Gaze stays ACTIVE; project#8 stays skipped.
