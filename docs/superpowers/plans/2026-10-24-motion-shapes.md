# Retained shape drawing Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. The owner authorized autonomous noninteractive decisions and integration; no approval question or PR.

**Goal:** Draw clean editable lines, rectangles and ellipses in Motion's existing draw-to-animation flow (#319).

**Architecture:** A pure local-coordinate shape builder returns ordinary Stroke points. A captured draw-tool choice drives the existing owned gesture preview and validated whole-project commit. Existing editing, fill, animation and export kernels consume those paths unchanged.

**Tech Stack:** Existing TypeScript/Canvas/Vite/Playwright; no dependency or schema change.

**Spec:** Issue #319 and PRODUCT_DIRECTION.md section11. Autonomous choice: retained paths over new native shape objects (format/render duplication) or SVG/image stamps (not directly editable). Ellipses use64 line segments plus an exact repeated endpoint; rectangles use4 corners plus closure. Shapes align to local drawing axes, not screen axes under rotation. Line endpoints retain drag direction. Area shapes require both dimensions nonzero; identical endpoints produce no edit. No learned generation or intended-user acceptance claim.

## Global Constraints

Existing100 strokes/10,000 total points/1,000 points per stroke/file bounds stay. Existing raw-draft/ownership/cancellation guards apply. Freehand defaults unchanged. No PR; #8 skipped; Motion ACTIVE.

## Review Focus

- Pointerup coordinates must be reflected even without an intervening move event.
- Reversed drags/rotated and scaled layers must use local axes correctly.
- Escape/blur/geometry changes cancel preview without history or saved residue.
- Existing point budgets must refuse whole shapes with no partial artwork.
- Tool changes must not blur-commit raw pose/stroke drafts or mutate an active gesture.

### Task1: retained geometry and owned drawing interaction

Files: create src/shape-draw.ts, tests/shape-draw.test.ts, tests/shape-draw.spec.ts; modify src/main.ts; README/roadmap/checkpoint.

Interface: shapePoints(kind:'line'|'rectangle'|'ellipse',start:Point,end:Point):Point[]. Bounds/finite admission; [] for degenerate shapes. UI selector keeps accepted drawTool separately and captures kind in Gesture; no stored shape metadata.

- [x] RED geometry assertions: closure/bounds/reverse/ellipse equation/degenerate/nonfinite. RED native selector and drag-to-retained-path case. Baseline full units.
- [x] Implement pure builder and use it for pointermove and pointerup; preview remains temporary. Validate shape points against base project budget before preview/commit. Guard selector before blur and on change; disable outside Draw/drawing layers or owned work. Cancel shapes on blur/input alongside retained drags.
- [x] GREEN focused units/browser. Add literal authored-history/reload/export, transformed geometry, cancellation/capacity/draft and phone cases; exercise existing stroke fill/edit on generated paths.
- [ ] Full project units/static/build/browser, fresh code review, coherent source commit via connected GitHub tools.
- [ ] Observe canonical CI, retain actual failures/limits, documentation and issue closure only on observed acceptance. Root-only final receipt avoids duplicate app CI.

## Ledger

Pre-flight: shape helper produces Point[]; gesture consumes exactly that; renderer/model remain unchanged. Already isolated linked worktree. Current main152d0fe. No unresolved source work from previous run; #300 diagnostic remains open with a separate larger-cohort/observer-control research next step. Chosen product work follows policy against repeating peripheral diagnostics indefinitely.

Task1 progress: baseline279passes; missing-module RED,4geometryGREEN, missing-selector nativeRED. Expanded native first3/6 then6/6 after test-only observation/locator corrections (checkpoint records them).283units/lint/build pass. Full native invocation running and fresh read-only review dispatched.
