# Saved cutting allowances — #182

Verified 2026-10-11 against canonical main cb271000 plus this milestone. Node24.19.0, locked npm dependencies, real Chrome for Testing153.0.8010.12.

## Delivered flow

Optional seam/waist0–2.5cm and hem0–5cm settings are saved in the complete concept after explicit Apply. Legacy absence and zero-default measured sheets remain supported. Nonzero settings add solid cutting paths and dashed stitching paths. The rigid shell and measured stitch dimensions remain the original construction geometry. Every relative graded size inherits the same explicit allowance settings.

The cut waist/hem arcs have radii R_inner−seam and R_outer+hem. An outward parallel side line has normal displacement seam. Its circle intersection is t=sqrt(R²−seam²), x=t*sin(half-angle)+seam*cos(half-angle), y=t*cos(half-angle)−seam*sin(half-angle). Independent tests check circle radius and the side-line normal equation rather than merely comparing producer outputs. Expanded arcs can cross180°; SVG large-arc flags and sheet bounds cover that admitted extreme. This mathematics does not establish physical garment fit.

## Verification receipts

- `npm run check`:55 unit cases, lint, TypeScript and production build pass; [complete log](check.log).
- `CHROMIUM_PATH=/tmp/monorepo-browser/chrome-headless-shell-linux64/chrome-headless-shell npm run test:browser`:65 production browser cases pass; [complete log](browser-full.log).
- [Focused browser log](browser-focused.log):3 new cases pass. Real downloaded SVG path lengths independently check the original230cm stitch perimeter and offset cutting perimeter. Five actual graded cutting nets retain the allowances. Complete JSON/artwork survives Undo/Redo, native saved reload and grading. Invalid/empty/intermediate raw fields preserve the graph and Redo; focused placement drafts block Apply before blur. A390px screen has no horizontal overflow. A50/300/40cm skirt with maximum2.5/5cm allowances verifies both >180° arc flags, native106cm bounding-box width and full-sheet containment. New allowance input retires an older held genuine File.text backup read without applying its draft.
- Independent read-only review found no critical/important defects; its fresh3 domain tests passed. No competing review browser/build or production-file edits.

## Retained failures and corrections

[Domain first red](domain-first-red.log) records missing cutGeometry/schema support before implementation. [Native first red](browser-first-red.log) records missing allowance controls before UI implementation. These are expected test-first failures, not passing evidence. [First mobile failure](browser-first-mobile-failure.log) records a test setup that blurred and normalized the existing raw placement field while filling the allowance inputs. The harness now fills placement last, checks it is still empty, and verifies Apply preserves/focuses it; [corrected browser receipt](browser-mobile-correction.log). No production guard was weakened to repair the test.

This is a measured construction milestone. No physical toile, fit, cloth simulation, waistband/closure, standardized grading or production acceptance was performed. Single large sheets still require external printing layout. The professional garment-design project remains ACTIVE.

Captured logs retain failures and diagnostics; trailing whitespace alone is normalized for git diff checks.
