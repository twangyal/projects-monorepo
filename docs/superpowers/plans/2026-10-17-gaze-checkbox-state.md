# Gaze checkbox state Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make check/uncheck requests retain the requested binary native-checkbox state (#286).
**Architecture:** Interpreter produces a checked-state action; controller preserves clarification/confirmation; executor makes zero or one native click after current DOM/focus guards and verifies the outcome.
**Tech Stack:** Shared vanilla JavaScript MV3 runtime, Node tests and native Playwright browser/extension tests.
**Spec:** `docs/PRODUCT_DIRECTION.md` section 1 and issue #286.

## Global Constraints
- Generic click/toggle unchanged; explicit state commands cannot silently become generic activations.
- Native binary checkboxes only. Custom ARIA and indeterminate states refuse without mutation.
- Preserve consequential confirmation/cancel, pause and detached-context safety.
- No synthetic state setter/events: one native click supplies canceled/default/browser event behavior.

## Review Focus
- Repeated command must dispatch no click/input/change when already correct.
- Focus-time replacement, checked/indeterminate changes, locks and redirects refuse.
- Native preventDefault, synchronous site override and detached replacement must not report false success.
- ARIA/inert ancestors through shadow/frame boundaries stay protected.
- Model-assisted matching must not convert refused explicit-state intent into generic click.

### Task 1: State semantics and execution
**Files:** modify `apps/gaze-navigator/src/web/interpreter.js`, `controller.js`, `page-actions.js`; add `browser-tests/web-checkboxes.spec.js`, extend `tests/web-interpreter.test.js`, `tests/web-controller.test.js`.
**Interfaces:** action `{type:'check',targetId,checked:boolean}`; `setChecked(element,checked)->{ok,message}`.
- [ ] Add parser/controller assertions and native repeated-check/uncheck regression; watch old behavior fail.
- [ ] Implement native-only checked-state dispatch with zero/one click, current availability/focus checks and actual post-click result.
- [ ] Add ambiguity/cancel/confirmation/locks/mixed/custom/event/canceled/replaced tests and real injected extension case; run local focused tests plus full Node/lint/build.

### Task 2: Reviewed canonical acceptance
**Files:** README, overlay help, project evidence and root direction/roadmap.
- [ ] Request read-only review; reproduce/fix important findings.
- [ ] Publish source via connected GitHub tools; inspect complete three-shard hosted gates.
- [ ] Integrate verified source into current main without PR; verify main gates and update/close #286 with exact limits.
