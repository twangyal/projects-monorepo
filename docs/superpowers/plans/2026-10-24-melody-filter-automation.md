# Filter cutoff automation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Noninteractive autonomous main integration authorized; no PR.

**Goal:** Author creative song-time low-pass sweeps in Sound (#323).

**Architecture:** Optional nested filter.curve,20–10000Hz,1–64points, absolute beats0–512 stored/1–513 UI. Existing decimal-safe breakpoint parser/editor and filter Apply/Discard. Moving voices use trapezoidal state-variable low-pass; static/constant voices preserve original Cookbook DF-II/grouping. Original-onset cache identity preserves distinct musical notes and dry-voice echo reuse. Continuation shifts curve.

**Tech Stack:** Existing TypeScript/Vite/Playwright. No dependency/workflow/deadline/format-version changes.

**Spec:** PRODUCT_DIRECTION.md section3/#323. Autonomous choice: existing filter editor over a new effects subsystem; MIDI omits custom DSP. Physical/musician/full-DAW acceptance remains open.

## Review Focus

- Same pitch/duration at different onsets and coincident echoes must retain correct song time.
- Constant/absent curves must preserve exact static PCM, including overlap/grouping order.
- Full64point fractional/tiny decimal beats, bounds and malformed/accessor data must round-trip/refuse atomically.
- Apply/Discard must protect unrelated drafts, per-track text, immediate graph, history/reload and backups.
- Rapid admitted cutoffs/highQ must preserve bounded musical output; drums/release/stem/section/continuation share the policy without new tails/limits.

### Task1: complete editable filter automation

Files: types.ts, breakpoint-curve.ts, filter-curve.ts, sound-filter.ts, audio.ts, continuation.ts, main.ts; filter-curve.test.ts/.spec.ts; README/checkpoint/roadmap.

- [x] Fresh469baseline, unsupported-field RED; reconstruct initial renderer and observe review instability/exact-parity RED.
- [x] Implement typed UI/shared moving filter/onset cache/audition; single repair pass9focused units GREEN.
- [x] Fresh478units/lint/types/build; focused native below, full native/canonical pending observation.
- [x] Source committed19d2601; canonical478units/270browsers passes. Local269/270 with known#300startup failure and separate1case retry pass; exact trace/context committeda981c25. Final root acceptance and issue closure record actual scope.

## Ledger

Initial canonical main41cb25a; no open PR or project-specific AGENTS. First uncommitted worktree vanished; no earlier raw logs/full browser result claimed recovered. Fresh reconstruction uses currentmain and reruns all checks. Prior review found instability and constant grouping failure. Ruling: exact PCM parity is Important compatibility, despite inaudible magnitude; fix in same pass. Ruling: moving cutoff uses stable trapezoidal integrator states rather than changing DF-II coefficients; variable-cutoff transients consequently change from the rejected implementation, while legacy/static paths stay exact. Both review regressions and the stable-oracle test observed RED then GREEN. Reviewer boundaries (physical listening/capture/#8/device performance) remain outside accepted evidence. Melody ACTIVE/#300open/#8skip.
