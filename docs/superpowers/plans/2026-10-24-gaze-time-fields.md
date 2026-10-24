# Native time form editing Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. The owner authorized autonomous noninteractive decisions/main integration; no PR.

**Goal:** Enter booking/appointment clock times through the existing Gaze extension (#321).

**Architecture:** Add explicit time intent/descriptor/snapshot and independent time history. Factor date's guarded setter into a shared temporal executor with date/time wrappers; preserve date output/guards and reuse the existing revision-safe history algorithm for number/date/time. Context label/help teaches literal24hour syntax. Native clone validity handles min/max/step including overnight ranges.

**Tech Stack:** Existing browser JavaScript/extension/Playwright; no dependencies, schema or workflow changes.

**Spec:** #321, PRODUCT_DIRECTION.md section1. Autonomous choice: exact HH:MM or HH:MM:SS entry for native type=time without an explicit replacement ARIA role, over locale/natural-language conversion or simulated keyboard picker interactions. Existing fractional native values may be restored by Undo. No implicit submit/custom widgets/datetime-local conversion. Gaze remains ACTIVE; physical #132 open; #8 skipped.

## Review Focus

- Midnight valueAsNumber0 must be admitted; overnight min>max ranges rely on native validity.
- Seconds/default step/value-attribute base and fractional historical Undo must remain exact.
- Focus/current constraints/role/identity/ancestor locks and pending site microtasks must be observed.
- Independent revision maps must preserve overlapping Undo/new-write history without changing date/number.
- Context discovery and typed instruction work in visible overlay and injected extension at four viewports.

### Task1: complete time control

Files: src/web/{page-context,page-actions,controller,interpreter,overlay}.js; tests/web-times.test.js; browser-tests/web-times.spec.js and extension.spec.js; README/checkpoint/roadmap.

- [x] RED4interpreter cases and native absent-time action; baseline211units.
- [x] Minimal intent/descriptor/shared executor/time history/label/help; GREEN unit/static/build and native time cases.
- [x] Native minute/second/midnight/overnight/min/max/step/step-base; empty/fractional/no-op/overlapping Undo; stale/focus/locks/customrole/site override; clarification/confirmation/cancel and visible phone overlay. Existing24date/36number cases regress shared code.
- [ ] Fresh review and connected-tools source commit. Observe full canonical browser+unit/static/build gates, including injected extension4viewports.
- [ ] Root final receipt/roadmap and actual issue state. No physical speech/gaze acceptance claim.

## Ledger

Already isolated worktree at currentmainf0c48f1. Previous unfinished #320 accepted/closed at8169fd; #300 separatecohortB complete archive/review committedf0c48f1 with no production fix. No source work left pending. No shared interface conflict: descriptor.timeSnapshot, action.type=time, setter.setTimeValue and separate per-element history maps.

Task1 progress: baseline211pass; first215unit/static/build green and24native time pass11.5s; initial24date/36number regressions pass. Review important deictic gap reproduced with expanded set/Undo test RED; normalize+DEICTIC fix GREEN. Final215units/static/build and all84native targeted cases pass28.3s. Fresh review did not run browsers. Full canonical/injected extension pending.

Ruling: include the identical existing Date/Number deictic targeting bug under #321 rather than create parser-line tickets; this closes the same gaze-value command gap, at the cost of requiring full fresh217unit/84native and canonical regressions. Both new unit regressions show actual unknown-name RED, then GREEN after resolver fixes. One numeric expected-value type was corrected to the existing string contract. Final217unit/static/build and84native cases pass.
