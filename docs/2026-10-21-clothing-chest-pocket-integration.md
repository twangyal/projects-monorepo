# Linked chest-pocket construction — issue #297

## Outcome and scope

Tees and sweatshirts now expose contextual finished chest-pocket width, height, signed centre offset and top placement in the existing atomic Fit group. Positive offset is wearer’s left. Shared dimensions drive the actual patch mesh, top-facing pattern, drape input, GLB, material consumption and tech-pack P/Q/R/V. Enabled bounding rectangles must clear the actual front sewing outline by 0.5 cm, including concave neckline/armhole edges. Dormant settings remain when removed; invalid re-enabling is refused. Legacy absent settings retain exact geometry. Hoodie kangaroo pockets are outside this milestone.

This advances editable garment construction. It does not establish physical fit, seam allowances, sleeve engineering, manufacturing readiness or the broader Clothing destination. Clothing remains ACTIVE; project #8 stays skipped and owner-deferred projects remain untouched. Frozen native research evidence is unchanged.

## Review and validation

A read-only independent review found repeated Apply could turn an untouched rounded derived pocket position into authored data. A real-browser regression reproduced the issue before the fix. Pocket fields now preserve exact existing values or omission unless explicitly edited; touched defaults are compared against the newly applied body fit. A separate focused browser failure caught module changes hiding unapplied Fit drafts; module changes now refuse pending Fit drafts and preserve them. Both regressions are covered.

Local `npm run check` passes all 170 unit tests, lint, TypeScript and production build. Final current-source cold and warm captures each match the entire frozen default packet exactly; all current source hashes verify independently. The existing historical envelopes and native evidence remain unchanged. Focused real-browser coverage exercises pattern and GLB bounds, tech-pack values, backup/reload/history, invalid placement/raw drafts, dormant settings, phone drape input and derived-versus-authored placement. Canonical full browser and garment-preflight CI both pass, as recorded below. No physical-garment validation is claimed.

Final focused browser suite: **4/4 passed in 46.9 seconds**, using actual Chromium/WebGL, real exports and the garment worker. The earlier uncheck test call failed because the deliberately refused checkbox retained its checked state; the final test uses a real click and verifies refusal. No application behavior was weakened to satisfy the test.

Rendered desktop (1440×1000) and phone (390×900) controls were visually inspected. A separately styled 10×16 cm pocket at offset −8 cm/top 20 cm visibly appears on the wearer’s right in the actual 3D preview; contextual fields remain readable and the phone test confirms no horizontal overflow. Screenshots were temporary validation artifacts.

## Canonical source identity

Integrated directly into `main` as `f910ea70e07654b009d1c0c2ce7aaeca9f5b18a2`, with tree `6df97ca97993ebeab3bba5ea5f34526d4cb583b4` matching the locally verified tree. The Clothing app subtree is `ea8a3aa7f7aebd17c9ea1612170667057822efc1`. The final receipt update changes only this root documentation file, preserving the tested app/workflow/research source.

## Canonical acceptance

- [Clothing app run 39665381744](https://github.com/twangyal/projects-monorepo/actions/runs/39665381744), job 119448917054: **170 unit tests**, lint, TypeScript, production build and **all 217 browser tests (6.7 minutes)** pass. All required steps finished successfully; failure-artifact upload was correctly skipped.
- [Actual-garment preflight run 39665381629](https://github.com/twangyal/projects-monorepo/actions/runs/39665381629), job 119448916286: **163 tests in 498.062 seconds** pass. Frozen historical cold/warm capture reproduction, original-source provenance/geometry checks, both entire current-source default-packet comparisons, cut-rib rest reproduction and faceted-body reproduction all pass. Both current packet comparisons verify the actual current source hashes while keeping historical provenance separate.

The read-only review finding and two new draft regressions were fixed and verified before integration. No source gate remains pending for this milestone. #297 is complete; #290 remains open because these software gates do not resolve native strain, establish physical fit or validate a separately edited-construction fixture. A follow-up was recorded there describing the new optional pocket inputs and the need for separate evidence. The broader professional garment destination remains unfinished.
