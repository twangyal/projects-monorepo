# Hood side width Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Autonomous noninteractive/main integration authorized; no PR.

**Goal:** Refine hoodie front/back projection through a linked editable hood side width (#322).

**Architecture:** Add optional hoodie-only fit.hoodWidth20–34cm, default26. Pattern side width and existing tech-pack POM N use it. Scale the illustrative hood dome z-radius14 by width/26, keeping neck-base row, x/y coordinates and all other parts unchanged. Existing cloth builder consumes modelled hood metric; no solver/rest-law change. Existing fit UI/history/export consumers carry the optional field.

**Tech Stack:** Existing TypeScript/Three/Delaunator/Vite/Playwright; no dependencies/format-version/workflows/deadlines changed.

**Spec:** #322 and PRODUCT_DIRECTION.md section5. Autonomous choice: side-pattern width plus proportional illustrative projection over new hood topology/flattening or a solver migration. Label side width accurately; preserve existing default geometry. Hood remains modelled geometry rather than a fully flattened/physically evaluated pattern. ClothingACTIVE/#290open/#8skip.

## Review Focus

- Explicit26 and omitted field must retain exact pattern/mesh defaults.
- Neck base stays fixed; only hood z above the base changes, including crown, with no x/y or unrelated-part change.
- Modelled cloth rest and exports must consume new geometry without silently rewriting other rest data.
- Hoodie-only visibility/apply/reset must not leak overrides to other garment types; invalid/raw drafts stay protected.
- POM N, pattern width, material usage and real GLB must agree with committed width; no physical-depth precision claim.

### Task1: complete linked width editing

Files: src/product.ts, product-view.ts, techpack.ts; new tests/hood-width.test.ts and .spec.ts; README/checkpoint/roadmap.

- [x] Baseline180units; RED pattern/mesh/POM/default/rest/bounds/incompatibility and native absent-width UI.
- [x] Minimal typed fit, dimension, pattern, z-radius, UI and POM integration; GREEN focused checks.
- [x] Native Apply/Undo/Redo/reload/phone drafts, decoded GLB/pattern/POM plus existing height/trim regressions and drape where practical.
- [ ] Full units/static/build/browser; fresh review; source commit via connected tools.
- [ ] Observe canonical app/preflight gates, root-only acceptance receipt and actual issue closure/state.

## Ledger

Currentmain8a81073; Gaze#321 source complete, final CI running. No local unfinished edits. Existing FitKey controls enumerate from FIT_KEYS; update fitValues and hoodie-only hiding/skipping together. POM N currently reports fixed26; use actual pattern side width with accurate wording. Default dome14 remains exactly14 when width26.

Task1 progress:180baseline;3unit RED unsupportedfield;183unit/static/build GREEN. Native partial-fixture build failed unused helpers before actual absent-field RED. Six focused width/height cases pass31.1s including realGLB/drape. Fresh review no blocker, independently3unit pass and width-only rest checks; committed rest-test combined-input minor is documented. Full browser running with added downloadedSVG sewing-width assertion; canonical pending.
