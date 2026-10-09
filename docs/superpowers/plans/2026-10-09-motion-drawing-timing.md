# Motion drawing timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move a retained drawing's exposure start while keeping its complete artwork.

**Architecture:** A complete-project domain operation changes one cel frame and sorts boundaries. A native frame-entry prompt supplies explicit consent without adding a second raw-form lifecycle. The main handler validates before selecting the moved boundary and uses existing history/autosave.

**Tech Stack:** Existing TypeScript, native browser dialog, Node and Playwright; no schema/dependency changes.

**Spec:** GitHub issue #161, PRODUCT_DIRECTION.md and PROJECT_IDEAS.md project #11.

## Global Constraints

- The first drawing stays at zero; accept displayed integer frames 2..frameCount only.
- Other cel frames and all pose keys remain fixed; moving past another drawing changes exposure order deliberately.
- Empty input, cancellation, occupied target, no-op and complete-file refusal retain state/history/Redo.
- Pointer preblur and keyboard guards preserve other raw drafts. Gesture/loading/export locks apply.
- Canonical main, no PR; ACTIVE and project #8 skipped.

## Review Focus

- No-op while viewing the interior of a held interval must not move the current frame.
- Moving across another boundary must sort without dropping blank or generated artwork.
- Changing one frame digit at the exact JSON cap must refuse atomically.
- Undo after a changed move must retain a Redo branch through canceled/invalid/no-op prompts.
- Another raw pose or stroke draft must prevent the dialog before native blur.

### Task 1: Complete drawing boundary retiming

**Files:** Create apps/motion-studio/src/cel-timing.ts and tests/cel-timing.test.ts/.spec.ts; modify src/main.ts, README and PROJECT_IDEAS; add dated evidence.
**Interfaces:** `retimeDrawingCel(input: Project, layerId: string, celFrame: number, nextFrame: number): Project`; `displayedDrawingFrame(raw: string, frameCount: number): number` returns zero-based frame.

- [x] Write/run RED domain tests: detached full graph, crossing boundaries, invalid targets/frame parsing, first-boundary/occupied rejection, no-op and exact-byte cap.
- [x] Implement domain operation/parser; run domain GREEN.
- [x] Write/run missing-control native RED for prompt apply/cancel/refusal/no-op, full project/PNG timing, history/reload, draft guard and narrow layout.
- [x] Wire Move active drawing start with preblur admission, validated candidate before one commit, and successful new-frame selection. Run focused GREEN.
- [x] Run full check/native suite, inspect narrow screenshot and diff; independent read-only review. Update docs and portfolio, publish coherent commit, record hosted CI and close only completed issue.

## Execution ledger

Ruling: autonomous inline implementation and canonical-main publication follow the user's standing instructions; no interactive design handoff. The native prompt is a temporary focused editing control, not a schema or asset-lifetime change.
Pre-flight: the parser and retiming helper are consumed only by the new main action; current model/history/rendering interfaces stay unchanged.

Task 1: Missing module/control RED -> three domain and five focused native cases GREEN. Parser nonfinite timeline-count refusal is separately RED/GREEN. Native checks cover prompt apply/cancel/invalid/occupied/no-op, PNG timing, history/reload, drafts and reviewed tween preservation.
Final: fixed pending-load admission — held genuine File read RED -> restore/retry/library flags on controls and handlers -> focused 5/5 GREEN. Closely related drawing-copy and guide controls receive the same loading flags.
Review: no other critical/important findings; the minor reviewed-tween coverage gap is now pinned by an actual reviewed-proposal no-op case. Final local gate: lint/typecheck/build, 254 unit tests and all 164 native cases passed. Narrow screenshot and diff reviewed. Publication and exact-head hosted CI are recorded durably in issue #161.
