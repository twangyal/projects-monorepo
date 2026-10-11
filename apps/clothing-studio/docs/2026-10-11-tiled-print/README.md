# Home-printer measured pattern tiling — #183

Verified2026-10-11 against canonical main3404235 plus this milestone. Node24.19.0, locked dependencies, real Chrome for Testing153.0.8010.12.

A4(210×297mm) and US Letter(215.9×279.4mm) exports are self-contained HTML. The first page is a calibration/assembly sheet; subsequent sheets are physical SVG viewports into the original committed full-size pattern. Each page uses10mm margins,10mm header/footer bands and1cm graphic overlap. Repeated crosses have fixed coordinates in the original pattern space, so neighboring pages share matching registration points. Row/column labels and trim borders accompany the unchanged measured stitch/cutting lines. Export does not apply drafts or change complete project/history. Private concept titles, notes, photos and sketches are excluded. No scripts or external resources.

## Evidence

- [Final check](check.log):58 unit tests, lint, TypeScript and production build pass. Three printing domain cases independently check physical page sizes, minimal complete coverage, exactly1cm overlap, invalid admission, resource-free documents and admitted extreme combinations within256 tiles/2,000,000 UTF-8 bytes.
- [Full production browser gate](browser-full.log):67 cases pass, including the existing cutting/3D/grading/history/storage/import/export regressions.
- [Focused browser gate](focused-browser.log):2 printing cases pass. Real HTML downloads for both papers are loaded without external requests and printed by native Chromium to actual PDF bytes. Every PDF page has the expected MediaBox dimensions (less than0.5pt rounding error) and the complete DOM sheet count, without blank pagination. SVG calibration geometry remains exactly5cm using native transforms at the original0.01px-scale tolerance. Private titles/notes are absent. Complete JSON and Undo/Redo are unchanged after both exports. Unapplied pattern and focused placement drafts refuse export before blur at390px without horizontal overflow. Calibration-page and mobile screenshots were inspected visually.
- Independent read-only review found no critical/important defects, passed2 initial domain tests and104 dimension/allowance/paper coverage/minimality combinations. No production edits or competing builds/browser jobs.

## Retained failures

[First domain red](first-domain-red.log) records the missing printing module before implementation. [First native scale failure](first-native-scale-failure.log) records Playwright/CDP's stroke-inclusive rectangle bounds: the0.03cm stroke expanded the reported box by about1.13px. The harness now measures actual SVG geometry with getBBox/getScreenCTM at the unchanged tolerance; instructions explicitly say to measure between stroke centres. No scale change or tolerance relaxation was used to make that check pass. Captured log trailing whitespace alone is normalized for git checks.

Native print-to-PDF is tested; no physical printer, paper assembly, toile or garment fit was evaluated. Graded set tiling remains unfinished. These exports advance construction evaluation while Clothing Studio remains ACTIVE against the professional garment-design vision.
