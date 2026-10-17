# Entered chest depth — #276

Users can compare body proxies with different front-to-back chest depth at the same girth, then drape the current garment or compare fabrics on that captured body. This extends entered dimensions; it does not establish anatomical or physical-fit accuracy.

## Geometry and limits

The existing stadium section has half-width w and half-depth d, with circumference c = 4(w − d) + 2πd. For entered full depth D, d = D/2 and w = [c − (π − 2)D]/4. Admission requires 10 ≤ D ≤ 44 cm and D ≤ c/π, preserving nonnegative straight sides. The maximum in validation guidance is rounded down to an admissible two-decimal value. These are model limits, not population sizing recommendations.

Chest depth changes chest width at fixed girth. The resulting d/w ratio also shapes the waist at its own girth. Hip ratio remains 0.74; vertical landmarks, shoulders and limbs remain the existing approximations. Blank depth follows the exact original geometry arithmetic. The result reports actual resolved chestDepth, including the derived default, and comparison receipts reject results with mismatched depth. No stored project schema changes: these settings remain session-only.

## Workflow and validation

The optional field belongs to the existing body draft group. Apply validates all body values before changing any committed setting; Discard restores the whole group. Contextual navigation and part changes preserve raw drafts. Committed depth is included in worker/cache identity and comparison capture; changes retire old owned results and invalidate comparisons. PNG/GLB exports retain the actual draped garment positions without adding a body mesh.

Baseline: 140 unit tests pass. Initial four added Node cases fail against the old fixed-ratio behavior, then the complete suite passes 144. A subsequent validation-guidance case reproduces a rounded-up maximum that itself would fail admission; guidance is corrected without changing the actual bound. Initial five native cases pass, covering desktop/phone worker→GLB data, coupled validation/raw drafts, held-result retirement and captured comparison JSON. Final full local, review and hosted source/main gates remain pending. Local browser is portable Chromium 143; actual verification limits remain explicit.

Approximate XPBD fabric/contact, no cloth self/layer collision, garment-dependent arm assumptions and unvalidated physical fit remain. Gaze, owner-deferred projects and skipped #8 are unchanged.
