# Melody focused workspace implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make composing, capturing, editing and exporting discoverable without showing unrelated forms.
**Architecture:** A small view controller hides existing mounted sections. Navigation owns presentation only; the composition, persistent import/reference/library hosts and audio ownership remain with existing controllers. An actual expanded product view preserves advanced single-page workflows.
**Tech Stack:** Existing TypeScript, DOM, CSS, Vite and Playwright; no added dependencies.
**Spec:** `docs/PRODUCT_DIRECTION.md` section 3; issue #261.

## Global constraints

Preserve notes, reference bytes, raw drafts, selection, history and recovery. Navigation does not implicitly commit fields, cancel owned operations or start playback. Keep Stop/Cancel available. Melody stays ACTIVE toward the full DAW destination; project #8 remains skipped.

## Review focus

- Valid text drafts losing focus during pointer/keyboard navigation must stay unapplied.
- Pending imports/library work must not be retired by navigation.
- Existing renders must retain the selected view and focus a visible control.
- Recording/render cancellation must remain reachable after switching views.
- Narrow layouts must expose every tool without horizontal page overflow.

## Task 1: Focused workspace

Files: create `src/workspace-view.ts` and `tests/workspace.spec.ts` within Melody; modify `src/main.ts` and `src/style.css`.

- [x] Write and run native failing coverage for composing defaults, every section, expanded mode, raw valid/invalid drafts and Escape/back.
- [x] Implement `createWorkspaceView(root, {canNavigate, captureActive, saveState, stopAudio})` with `sync`, `select`, `focus`, `expanded`, `view`, `navigating`; no model mutations or DOM reparenting.
- [x] Integrate render synchronization, note selection and blur-safe navigation with explicit Enter field application.
- [x] Test retained audio/reference bytes, selection/history, real export/reload and cancellation in focused desktop/phone flows.
- [x] Run targeted browser gates, check, then full legacy browser suite through the actual expanded product view.
- [x] Review, fix findings, document verification and commit #261.

## Task 2: Integration and durable evidence

- [x] Update README and portfolio roadmap with actual delivered scope and limitations.
- [x] Publish via connected GitHub tools with leased refs; verify source/main CI where available.
- [x] Update issue with exact evidence; close only when completion criteria are met. Source and integrated main CI passed428 unit and247 browser tests; retained local/main first-attempt failures are recorded in the integration receipt.
