# Melody Section Arrangement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Repeat an entire layered section as one reversible edit.

**Architecture:** Pure detached all-track transformation, reusing session beat validation. Main UI guards scratch work before blur and commits through existing complete-project history/autosave. Reference assets are unchanged.

**Tech Stack:** Existing TypeScript, Vite, Web Audio, Node tests and Playwright; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-melody-section-arrangement.md`

## Global Constraints

- One-based start and exclusive end; exact note timing, no frame quantization.
- Refuse crossing boundaries, empty selections, more than 256 notes per track or ends beyond 128 beats.
- All tracks including muted participate; preserve reference bindings/assets and existing IDs.
- New copy IDs only; one Undo/Redo edit; no schema change; ACTIVE and skip #8 preserved.

## Review Focus

- Fractional timing and exact adjacent boundaries must not be clamped or snapped.
- A refusal in the last track must preserve every earlier track.
- Focused unsent fields must not commit through pointer blur.
- References must remain byte-identical after edit, undo, redo and reload.
- Later notes in unselected/muted tracks must shift with the whole arrangement.

### Task 1: Pure arrangement operation

**Files:** Create `apps/melody-studio/src/section-arrangement.ts`; test `apps/melody-studio/tests/section-arrangement.test.ts`.

**Interfaces:** Consumes `Composition`, `SectionRange`, `validateComposition`, `sectionWindow`; produces `duplicateSection(project: Composition, range: SectionRange): Composition`.

- [x] Write tests for contained notes at fractional boundaries, same-pitch overlaps, all-track/muted later notes, fresh IDs, detached frozen input, crossing boundaries, empty range and late-track quota refusal.
- [x] Run `node --experimental-strip-types --test tests/section-arrangement.test.ts`; expect missing-module failure.
- [x] Implement detached validation, whole-operation crossing check, contained-note UUID copies and exact span shift; validate whole result.
- [x] Run the unit file; expect all pass. Review the operation before UI integration.

### Task 2: Guarded editor flow and verification

**Files:** Modify `apps/melody-studio/src/main.ts`, README and PROJECT_IDEAS; create `apps/melody-studio/tests/section-arrangement.spec.ts`.

**Interfaces:** Consumes Task 1 `duplicateSection`, current session bounds and existing `commit/withComposition`; produces labeled Duplicate section action.

- [x] Write native tests for complete reference-backed copy/Undo/Redo/reload and independently parsed exported note timing, crossing refusal preserving backup/redo, and focused scratch-field pointer guard.
- [x] Guard field/note/proposal scratch before pointer default and again for keyboard activation; preserve originals and raw inputs on refusal.
- [x] Wire one complete-project commit and stop old playback on success; explain inserted span/all-track shift and crossing refusal. Keep bounds out of autosave.
- [x] Run `npm run check` and `npm run test:browser -- --workers=1` with available native Chromium; record real outcomes and limitations, fix regressions.
- [x] Request independent read-only review; address important findings. Update docs/roadmap, commit through connected GitHub with #141 reference, comment and close only when verified as available tooling allows.
