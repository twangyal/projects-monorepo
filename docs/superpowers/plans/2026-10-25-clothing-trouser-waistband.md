# Linked trouser waistband height implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make finished shorts/trouser waistband height editable throughout linked garment design.
**Architecture:** Optional LegMeasurements.waistbandHeight resolves to legacy4cm. Strict parser preserves absent fields, derived trouserDimensions owns the resolved value, and existing leg measurement drafts/Apply/history consume it. Pattern strip is twice finished height; mesh band rises from unchanged leg waist seam. Tech-pack/outseam/consumption use that dimension.
**Tech Stack:** Existing TypeScript DOM/Three app, Node/Playwright/Python preflight.
**Spec:** Issue#331; product direction5.

## Global constraints

4–10cm; default4; existing3cm elastic convention unchanged. Existing leg panels/rise/inseam/style remain. No bottom draping, engineering/manufacturing/fit acceptance, paid service or PR. ClothingACTIVE/#290open/#8skip.

## Review focus

- Legacy absent/default geometry stays exact; optional undefined/accessors/unsupported top keys refuse.
- Failed raw edits preserve design/history; pending drafts survive navigation and block history/replacement.
- Band mesh/seam/UV, folded strip, outseam/J/consumption and captured exports agree.
- Changing another measurement must not insert a default override; restoring4 removes the optional override in UI.
- Phone/history/backups/reload retain committed height and exact unrelated design data.

### Task1: Complete linked construction vertical slice

Files: src/product.ts,product-view.ts,techpack.ts; new trouser-waistband unit/native tests, README/docs/roadmap.
Interface: LegMeasurements.waistbandHeight?:number; trouserDimensions returns resolved waistbandHeight:number.
- [x] Observe183unit baseline and new validation/native missing-control RED.
- [x] Implement optional strict measurement and existing UI group, derived geometry and tech-pack dimensions.
- [x] Units/static/build, native desktop/phone/GLB/pattern/history and complete app/preflight gates.
- [x] Fresh readonly review; one Critical/Important RED→GREEN fix pass, no rereview.
- [x] Commit connected GitHub, record actual CI/limitations and close only on acceptance.

## Ledger

Ruling: 4–10cm retains the existing3cm elastic convention; narrower bands would require a separately designed elastic-width/construction change. Cost: narrower waistband construction remains unavailable. Reuse leg measurements rather than top-only Fit; existing draft/history/export ownership applies. Cost: Apply measurements commits the whole group. Native inline execution under autonomous authorization, one final independent review. Preflight: one cohesive task with consistent shared measurement name.
Baseline183units;3newcases RED unsupportedfield. Corrected one history-endpoint fixture mistake;186units/static/build pass. Native first1pass/1timeout before export; unchanged2/2rerunpass44.2s at same30s timeout. Review noCritical/Important,1Minorcoverage deferred (UV/ring, another-measurementdefault, pendingUndo/replacement assertions). Ruling: review-excluded H/J diagram inconsistency is Important for newly editableheight; wrong outseam origin can mislead design. Cost if unfixed: numeric/visual disagreement. One analyticSVGRED→GREEN repair, final187units pass; remaining gates pending. No rereview. All review exclusions/rulings/limits in app checkpoint.
Ruling: native full acceptance must follow actual gates;7e incompleteediting, physicalfit/elastic/manufacturing/bottomdrape/nativeadoption remain unverified. Cost: existing browser-native editing conventions and real-world usefulness cannot be inferred from numeric tests.

Task1: complete at537a38d; canonical187units/229browser/163preflight and static/build/source/geometry/reproduction pass. Stopped local fullrun39pass/6fail retained; no complete local acceptance. Final record docs/2026-10-25-clothing-waistband-acceptance.md. Deferred Minor assertions remain listed.
