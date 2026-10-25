# Gaze selected-text deletion acceptance (#332)

Source: `121d0d37e0f8377fa50362427bbb15163c23f27b` on canonical main. Implementation/checkpoint: [app record](../apps/gaze-navigator/docs/2026-10-25-delete-selection.md), [plan](superpowers/plans/2026-10-25-gaze-delete-selection.md), [issue](https://github.com/twangyal/projects-monorepo/issues/332).

## Product result

Delete/remove/erase selected or highlighted native text, optionally naming a field, removes exactly the captured nonempty range and supports ordinary text Undo. Captured local value/range/identity, actual focus, availability and command ownership are rechecked after focus microtasks. No whole-field clearing, generic activation, model fallback, auto-submit, retry or caret forcing after site events. Passwords, incompatible native types, rich-text and split-surrogate ranges refuse. Values and offsets stay outside model descriptors.

## Verification and review ledger

Baseline230Node tests pass. Typed-intent and native missing-command regressions were RED before implementation. Password selection separately reproduced unsupported secret editing before the explicit refusal. Final source232Node tests, syntax112files and extension-test build pass; all32 focused native cases pass47.8s across4viewports. The expanded pre-password28case run passed45.4s; a setup assuming a light-DOM field existed before shadow/frame creation timed out and was corrected (partial prior run stopped). The post-password28case run passed1.1min. A wrong relative-path repair invocation was stopped and is not final verification. The first full-suite invocation used an unsupported CLI option and exited before cases; corrected invocation plans764non-extension cases.

Fresh readonly final review found one Important defect: a website reflecting the accepted live value into defaultValue suppressed change and reported a false failure. Native regression RED (success expected/error observed), single repair pass then all32cases GREEN. Default-value attribute checks remain before writing; post-write identity excludes mutable default-value state. Same test asserts focus-time attribute changes still refuse without writing. No rereview.

One Minor is explicitly deferred: seed prior history, refuse/cancel a deletion, then assert actual Undo behavior. Existing probes assert unchanged value/events and code inspection supports untouched history, but those probes do not independently establish prior-history preservation. Reviewer independent reentrant input→Undo restored text and retired deletion feedback; post-input removal/read-only returned truthful failure without retry.

## Gate outcomes

Canonical [run40226283219](https://github.com/twangyal/projects-monorepo/actions/runs/40226283219) succeeds on final source121d0d3:232Node units, syntax112files, extension-test build and all864browser cases across3shards. Shard1/3 passes291cases5.6min; shard2/3 passes288cases3.4min; shard3/3 passes285cases3.2min. Installed deletion+Undo through overlay focus passes on desktop/narrow/short/compact-boundary, against the actual injected extension on strict-CSP content. These observed canonical gates accept the software milestone despite the separately retained local failures.

The corrected final local764non-extension run was stopped deliberately withCtrl-C/exit130 after23completed cases:17passes and6failures;741planned cases have no completed result. No full local pass is claimed. Completed failures:

- extension-setup.spec.js:18: Pointer simulation leaves calibration hidden (5s assertion).
- navigation.spec.js:112: confirmation target expected2, observedempty (20s testtimeout).
- navigation.spec.js:288: dirty draft switch/Keep (20s timeout).
- navigation.spec.js:310: maximum20drafts/full refusal (20s timeout while clickingCompose).
- navigation.spec.js:346: saved-draft download/reopen (20s timeout).
- navigation.spec.js:358: imported notebook/invalid backup (20s testtimeout,25.9s wall; calibration dot click).

These existing lab/onboarding cases are outside the new selected-deletion cases, but that separation does not establish a cause. No retries, weakened assertions or increased deadlines were used. Passing focused native coverage and canonical results are separate evidence.

## Scope and remaining acceptance

Synthetic native checks do not establish physical gaze/speech, screen-reader usability, intended-user completion, broad real-site/framework compatibility, packaging/distribution or arbitrarily delayed site changes. Input/change are programmatic untrusted events, consistent with existing edits. Installed-extension acceptance is a separate canonical gate. Gaze remains ACTIVE and physical#132 remains open; project#8 stays skipped. No PR.
