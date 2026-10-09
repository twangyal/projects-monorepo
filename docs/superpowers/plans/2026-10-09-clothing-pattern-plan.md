# Measured Skirt Pattern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Create editable physical-scale skirt patterns while retaining complete legacy concepts.
**Architecture:** A small construction model/geometry module owns strict settings, annular net math and safe SVG. Project validation preserves optional settings; a retained-input UI controller integrates existing history/save/import ownership.
**Tech Stack:** Existing TypeScript, SVG, native browser and Node tests; no dependencies.
**Spec:** docs/superpowers/specs/2026-10-09-clothing-pattern-design.md

## Global Constraints

- Waist50–150, hem70–300, slant20–120cm; hem>=waist+5 and radial increase<slant.
- Legacy field absence remains exact; preserve photo/marks/placement/note.
- No cloth, body-fit, allowance, closure or production validation claims.
- Main canonical; no PR; #8 skipped; no service charges.

## Review Focus

- Invalid imported settings never replace work: domain/native malformed backup tests.
- Pending imports cannot overwrite new pattern intent: native held File result regression.
- Unsent other fields survive button-before-blur: native pointer and keyboard tests.
- Large valid nets remain bounded and physical scale: domain parameter extrema plus native SVG unit checks.
- No-op/failed edits keep Redo and legacy files exact: domain history and native backups.

### Task 1: Complete measured pattern workflow (#166)

Files: new apps/clothing-studio/src/construction.ts and construction-view.ts; modify model.ts/main.ts/style.css; new tests/construction.test.ts and construction.spec.ts; README/PROJECT_IDEAS/evidence.
Interfaces: `SkirtDraft`, `validateConstruction(unknown):SkirtDraft`, `patternGeometry(SkirtDraft):PatternGeometry`, `patternSvg(SkirtDraft):string`; view consumes current Project, commit/edit-intent/guard/download callbacks.
- [x] Write/run missing-module tests: 80/140/60 arc lengths40/70, seams60; independent net bounds, strict settings, field-absent legacy/history.
- [x] Implement strict model, annular net and two-panel physical SVG; run domain tests.
- [x] Integrate optional Project field, raw Apply/Discard and committed export with ownership/gesture/draft guards.
- [x] Native exact full backup/history/reload/physical SVG and invalid/raw/held import/390px tests.
- [x] Run full check/native gate, review diff, update docs, publish issue-linked commit via expected main lease; close only verified.

### Next independent milestone

Create its tracking issue before implementation. Generate a 32-segment frustum mesh from the exact committed waist/hem/slant, project sorted surface faces into an SVG 3D viewer, expose reversible session camera yaw and matching side seams. Independently verify radii, slant/height, mesh seam identity and native linkage; no cloth or body model. Deliver only after #166 is durable.
