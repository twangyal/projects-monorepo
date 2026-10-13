# Measured Clothing pattern corrections — #247

Continues guarded integration candidate `2583d637`; this task branch is not canonical Clothing acceptance. The user outcome is edited neck/chest values that agree across the sewing patterns and generated tech pack.

Two new tests failed before implementation: the narrow crew neckline left a 48.64 cm rib where its edited front/back sewing path × 0.85 is 32.847 cm (front drop 10 cm); the flared chest fixture (150 cm chest, 55 cm length, 95 cm half-hem) reported 77 cm instead of the rounded 80 cm measured 2.5 cm below the armhole. The raw outline width is about 80.103 cm.

Neck rib length now sums the exact eight-segment crew/back paths or straight V front used in the flat sewing outlines, with a declared 15% reduction. Tee and sweatshirt trim pieces, consumption/costing and SVG/DXF exports follow that geometry. The construction note explicitly requires confirming the ratio for the chosen rib. This is a modelling assumption, not validated stretch, a physical fit guarantee or exact 3D opening-perimeter equality; the styling shell remains approximate.

Chest POM and diagram endpoints now intersect the actual front sewing outline at the documented height, including taper, flare, curved hems and banded bodies. The tech pack retains 0.5 cm rounding and fixed size increments; these do not establish fitted size grading.

Verification on 2026-10-13: all 90 unit tests, ESLint, TypeScript and ordinary production build pass. A new native Chromium143 case verifies two edited neck widths against actual downloaded 1:1 SVG rib sewing lines and tech-pack text, the flared 80 cm chest, diagram endpoints and saved reload. It passes. The first check exposed a new test's unsupported `findLastIndex` TypeScript library usage; the test now uses a compatible reduction, without changing compiler settings. An independent read-only reviewer found no scoped blockers. Hosted broad CI is recorded in #247 after publication; no unrun hosted/physical checks are claimed here.

Remaining integration blockers: late motif/artwork ownership; aggregate recoverable-backup budget; raw product drafts; immutable tech-pack render export; raster/header/decode admission. Keep #247 open until these are addressed. Project8 stays skipped; Clothing remains ACTIVE.
