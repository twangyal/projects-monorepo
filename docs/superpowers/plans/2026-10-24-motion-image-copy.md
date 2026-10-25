# Motion imported-artwork duplication plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reuse imported artwork as independently animated layers through the existing focused Layers flow.
**Architecture:** Extend the pure layer-copy model to both layer kinds, preserving the legacy drawing-only API. For images, decode a separately owned bitmap before synchronous project/history publication; the operation/generation guard retires stale completion. The existing copy button names the selected kind.
**Tech Stack:** Existing TypeScript, Canvas ImageBitmap, Node24 and Playwright; no dependencies, formats, limits or workflows change.
**Spec:** #326 and docs/PRODUCT_DIRECTION.md section11; broader learned animation remains ACTIVE.

## Global Constraints

Maintain4image/8layer/JSON budgets, one Undo edit, independent poses and resource ownership, source bytes, draft/gesture/recovery/library/export guards, existing drawing behavior. NoPR/#8skip. Autonomous authorization selects inline implementation without interactive approval.

## Review Focus

- Independent bitmap survives source deletion, Undo/Redo, reload and PNG/GIF output.
- Deferred decode after pagehide closes only the new bitmap and cannot publish.
- Decode failure preserves source, selection and Redo.
- Raw pose/name drafts refuse pointer-before-blur and keyboard activation.
- Capacity refusal is atomic with exact image/name/pose bytes and source preserved.

## Task1 — reusable image props

- [x] Baseline283; modelRED missing API→4GREEN; nativeRED disabledcopy.
- [x] General model/legacy contract, independent decode/publication, contextual labels.
- [x] Model/native boundary/resource/desktop/phone/animation/export/history checks.
- [x] 287unit/lint/types/build; fresh review Important retention fixed one RED→GREENpass,9focused native pass. Initial214mixed-source full pass; final215full and canonical pending; docs/roadmap/source commit.
- [x] Canonical40158311029 passes287units/check/types/build and215browsers on3811eea; final local215passes2.8min. Accept/close#326.

## Ledger

Base59242d4 clean app source. Existing `duplicateDrawingLayer` intentionally rejects imported images; images require asset preparation because render binds bitmaps by distinct layer IDs and closes them on history/project retirement. Sharing one bitmap would violate ownership, so decode exactly the new copy. Existing detached worktree reused. #300 research is durable and remains open; no production fix was inferred.

Pre-review fixture corrections: first native pass accidentally selected the reversed-list copy instead of source; use exact layer ID. Existing numeric fields commit on ordinary change, so use one changed pose coordinate for a three-step copy/pose/delete Undo oracle, valid raw pointer protection and invalid raw keyboard protection. Pagehide intentionally disables backup; assert no in-memory layer publication plus closed decoded bitmap and unchanged native saved project. Initial image-byte fixture exceeded the per-image bound before reaching project-file capacity; corrected to an admitted1.5MiB image. These are test-assumption corrections, not production fixes or relaxed app behavior.

Review Important fixed: removed bitmap retention — repeated native copy/delete close count0→1RED/GREEN, source pixels/Undo/Redo remain. No Critical/Minor. Review boundaries: final full/canonical gates await observation; broader learned/intended-user acceptance remains unverified. No rereview or unrequested PR.

Task1 complete: final source3811eea; canonical215/215browsers2.1min, local215/2152.8min,287units/static/build. Root integration record supersedes pending app checkpoint; MotionACTIVE/#8skip/noPR.
