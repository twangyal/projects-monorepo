# Explicit disclosure state implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let an extension user request expand/collapse without accidentally reversing an already-correct panel state.
**Architecture:** Typed disclosure action carries a boolean through existing clarification/confirmation. Resolve intended targets before checking eligibility; capture structural identity and admission, then focus/recheck/one website click and observe retained state. No attribute writes or retries.
**Tech Stack:** Existing JavaScript modules, Node tests, Playwright Chromium.
**Spec:** GitHub issue #329 and docs/PRODUCT_DIRECTION.md section 1.

## Global constraints

Gaze remains ACTIVE; physical input #132 remains open. Project #8 stays skipped. No PR. Explicit expand/collapse only; ordinary open/close/click behavior remains. Missing/mixed ARIA, implicit submit controls and nonprimary summaries refuse. Do not retarget unsupported intended controls.

## Review focus

- Unsupported named/gazed/ordinal target must not redirect to a nearby supported button.
- Form ownership, frame/root, details owner, name/id/controls cannot drift while pending.
- Focus microtasks/cancellation must retire a deferred click.
- Site cancellation/override must report failure without forcing state.
- Shadow/frame ancestor locks and hidden already-correct controls must refuse.

### Task 1: Complete disclosure flow

Files: src/web/{interpreter,page-context,page-actions,controller,instruction-suite,overlay}.js under apps/gaze-navigator; corresponding unit/native/extension tests and documentation.
Interface: {type:'disclosure',targetId,expanded:boolean}; captureDisclosureSnapshot(element); setExpanded(element,expanded,snapshot,{isCurrent}).

- [x] Write and observe interpreter and native repeated-expand failures; include target identity and form-owner regressions.
- [x] Implement typed intent, admission/identity snapshot, website-owned state execution, controller integration and help.
- [x] Run all Node, syntax/build and focused native tests; retain failures honestly.
- [x] Fresh read-only final review; one Important/Critical RED→GREEN fix pass, no rereview.
- [x] Commit through connected GitHub tools; run canonical browser shards, record actual outcome and close only on acceptance.

## Ledger

Baseline 8c39430: 228 Node tests pass. Prior uncommitted #329 work was lost after workspace reset; reconstructing with fresh evidence, not claiming old results.
Ruling: Native inline execution and independent final review selected under noninteractive authorization; no design approval questions. Ordinary generic activation was rejected because it cannot express requested state; directly assigning open/ARIA was rejected because the website owns behavior. Cost: sites without supported semantics refuse.
Pre-flight: one cohesive task; typed action and captured snapshot names match all consumers.

Final review: two Important findings, no Critical/Minor. Fresh disabled-target and href-removal regressions RED→GREEN; final44/44 focused native,230/230 Node and syntax111/build pass. Full browser gates pending. See app checkpoint for every review exclusion/ruling, fixture/setup failures and acceptance limits. One fix pass; no rereview.
Ruling: separate disclosure-only unavailable targets preserve ordinary context compatibility; unoutlined blocked candidates may add clarification. Cost: a user may need a smaller gaze circle. Review exclusions and their costs are recorded in the checkpoint.

Task 1: complete. Gaze source a4bbc79:230units/static/build/all828canonical cases; final732local non-extension cases pass. Acceptance receipt docs/2026-10-25-gaze-disclosure-acceptance.md.
