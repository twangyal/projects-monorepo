# Guarded selected-text deletion implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Speak delete/remove/erase selected text, remove only that native range, recover with ordinary Undo.
**Architecture:** Typed delete-selection action; local identity/value/offset snapshot. Preserve unavailable intended fields using the existing disclosure-only extended context and a separate selectionFocusedId. Focus/recheck after microtasks/current-turn guard, write once, collapse caret before site events, record Undo immediately after native write, observe retained value without retry.
**Tech Stack:** Existing JS modules/Node/Playwright/Chrome extension.
**Spec:** Issue#332; PRODUCT_DIRECTION1.

## Global constraints

No whole-field clearing fallback, generic activation/model fallback, auto-submit or secret-value feedback. Native writable text selections only; invalid/collapsed/stale/locked/hidden/half-surrogate selection refuses without history/events. Website handlers own final value/caret. GazeACTIVE/physical#132open/#8skip/noPR.

## Review focus

- Focus handlers change value/selection/identity/locks: refusal before write/history.
- Cancel/pause/new turn retires deferred writes; applied delete remains Undoable immediately.
- Visible disabled/readonly intended fields never redirect to a nearby writable one.
- Site handlers override/remove/lock after input: truthful failure, no retry/forced caret.
- Native shadow/frame ownership, Unicode boundaries and installed overlay capture preserve selected range.

### Task1: Native deletion vertical slice

Files: src/web/{page-context,page-actions,interpreter,controller,overlay,instruction-suite}.js; unit/native/extension tests and docs.
Interface: {type:'delete-selection',targetId}; captureTextSelectionSnapshot; deleteSelection(element,snapshot,{isCurrent,onWrite}). onWrite(before) records shared text Undo synchronously after write/before events.
- [ ] Baseline230units; interpreter/native missing-command RED.
- [ ] Implement typed intent/context/action/controller/help with guarded write and Undo.
- [ ] Units/static/build and focused/native/installed-extension compatibility.
- [ ] Fresh readonly final review; oneImportant/CriticalRED→GREENfixpass/no rereview.
- [ ] Commit via connectedGitHub; full canonical/local gates and actual issue/docs status.

## Ledger

Ruling: use separate typed deletion rather than generic text insertion with empty replacement, because destruction must recheck captured range after focus and report site overrides. Cost: unsupported native/rich-text controls refuse. Preserve existing ordinary typing/Undo APIs; new deletion adds an explicit before-value to shared history. No interface conflicts; one cohesive task. Autonomous inline execution/noquestions/noPR.

Final review: one Important defaultValue reflection bug reproduced natively and repaired in one pass; pre-write value-attribute guard retained, post-write mutable default-value excluded. No rereview. Minor seeded prior-history refusal/cancellation Undo assertion deferred; site/framework/physical/distribution acceptance excluded. See app checkpoint for evidence and canonical gate status.

Source committed main121d0d3. Final232units/static/build and32focused native cases47.8s pass. Final764case local run stopped17pass/6fail/741withoutcompletedresult; no full local pass. Canonical864case run40226283219 pending. Final root acceptance records exact results; do not interpret this source checkpoint as physical#132 acceptance.

Final canonical run40226283219 succeeds on121d0d3:232units/syntax112/build/all864browser cases, including4installed deletion workflows. Software milestone accepted; exact local failures and deferredMinor remain in final rootacceptance. No additional review/fixpass.
