# Melody Song Length Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Develop and export a512-beat arrangement beyond the short sketch ceiling.
**Architecture:** One shared timeline constant governs existing validation/editor/import/arrangement/render paths; an independent frame-allocation budget protects synthesis. No project schema or capture/reference contract migration.
**Tech Stack:** Existing TypeScript/Vite/Node/Playwright; no dependencies.
**Spec:** GitHub issue #142 and `docs/PRODUCT_DIRECTION.md` (Melody full-DAW vision).

## Global Constraints

- Composition end512 beats, original exact note timing,8 tracks,256 notes/track, duration0.25–16.
- Render at most40,000,000 Float32 frames; enforce before allocation. Browser uses22,050 Hz.
- Capture/reference remain20 seconds; existing file/history/library formats and original reference bytes retained.
- Keep old128-beat evidence historical; current UI/docs explain expanded512-beat capability and ACTIVE status.

## Review Focus

- MIDI bit values128/velocity127 and analysis-window512 are unrelated and must stay unchanged.
- Quarter-beat continuation tick ceiling must expand to2048, with existing16-beat extension window retained.
- Comparison solo rendering must admit the expanded song even when cropping a short unchanged reference.
- Exact end512 succeeds and any overflow refuses; raw fields never silently clamp.
- Worst browser tempo40 full512 rendering must succeed within fixed memory budget; excessive public sample-rate allocations refuse before allocating.

### Task 1: Consistent song timeline

**Files:** Create `apps/melody-studio/src/limits.ts`, `tests/song-length.test.ts`, `tests/song-length.spec.ts`; modify model/audio/reference-audio/arrangement/section/continuation/midi-review/main, affected boundary tests, README and PROJECT_IDEAS.
**Interfaces:** Export `MAX_COMPOSITION_BEATS = 512`, `MAX_RENDER_FRAMES = 40_000_000`; reuse existing Composition and render/history/storage APIs.

- [x] Write old-model failing tests for late notes, slow-tempo full render, MIDI full-window review, late continuation/section repeat and allocation refusal.
- [x] Run new unit file, expect old128-beat rejections; implement shared domain constants without replacing protocol/byte/sample-window constants.
- [x] Update existing tests whose refusal boundary intentionally moves; preserve earlier128-beat accepted fixtures and quota/range refusals. Run complete unit/lint/type/build.
- [x] Write native long-song flow retaining original reference bytes, edit late note/undo/redo, actual MIDI/WAV and backup/reload, end-of-song section playback and MIDI review beyond128. Observe old UI/render refusal before wiring.
- [x] Run all native cases serially, with stable dist/test-results. Measure slowest-tempo frame count and refusal above frame budget, request fresh read-only review, fix important defects with tests.
- [x] Record evidence and limits, publish coherent #142 commit with expected-SHA lease, update/close issue according to verified result; no PR creation.
