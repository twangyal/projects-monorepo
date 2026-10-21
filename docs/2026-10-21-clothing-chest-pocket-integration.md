# Linked chest-pocket construction — issue #297

## Outcome and scope

Tees and sweatshirts now expose contextual finished chest-pocket width, height, signed centre offset and top placement in the existing atomic Fit group. Positive offset is wearer’s left. Shared dimensions drive the actual patch mesh, top-facing pattern, drape input, GLB, material consumption and tech-pack P/Q/R/V. Enabled bounding rectangles must clear the actual front sewing outline by 0.5 cm, including concave neckline/armhole edges. Dormant settings remain when removed; invalid re-enabling is refused. Legacy absent settings retain exact geometry. Hoodie kangaroo pockets are outside this milestone.

This advances editable garment construction. It does not establish physical fit, seam allowances, sleeve engineering, manufacturing readiness or the broader Clothing destination. Clothing remains ACTIVE; project #8 stays skipped and owner-deferred projects remain untouched. Frozen native research evidence is unchanged.

## Review and validation

A read-only independent review found repeated Apply could turn an untouched rounded derived pocket position into authored data. A real-browser regression reproduced the issue before the fix. Pocket fields now preserve exact existing values or omission unless explicitly edited; touched defaults are compared against the newly applied body fit. A separate focused browser failure caught module changes hiding unapplied Fit drafts; module changes now refuse pending Fit drafts and preserve them. Both regressions are covered.

Local `npm run check` passes all 170 unit tests, lint, TypeScript and production build. Final current-source cold and warm captures each match the entire frozen default packet exactly; all current source hashes verify independently. The existing historical envelopes and native evidence remain unchanged. Focused real-browser coverage exercises pattern and GLB bounds, tech-pack values, backup/reload/history, invalid placement/raw drafts, dormant settings, phone drape input and derived-versus-authored placement. Canonical full browser and garment-preflight CI results will be recorded after integration. No physical-garment validation is claimed.

Final focused browser suite: **4/4 passed in 46.9 seconds**, using actual Chromium/WebGL, real exports and the garment worker. The earlier uncheck test call failed because the deliberately refused checkbox retained its checked state; the final test uses a real click and verifies refusal. No application behavior was weakened to satisfy the test.
