# Matched garment fabric comparison — #270

The intended outcome is choosing a fabric by comparing the current top on the same entered body without repeatedly restyling the actual design. The current material-dependent XPBD preview is approximate; independent swatch laws are not yet integrated. This milestone adds a usable design-exploration flow, not a new material law or physical-fit acceptance.

## Approach

Reuse the actual garment worker and snapshot renderer in a focused Body & drape details panel. A pure comparison module clones the committed Product into two candidates, replacing material on non-rib parts only. Colors, prints, artwork, options, measurements, rib trims and saved colorways remain intact. Two distinct existing library fabrics are required. Use the same resolved chest/waist/hip, 240 frames, 10 substeps, rest mesh, front/back camera and lighting. Candidate snapshots omit the body exactly like existing exports. Alternative live dual scenes would spend more GPU resources; mutating the main editor during comparison would break deliberate history. Sequential worker solves and sequential disposable snapshots preserve responsiveness and isolate the design.

## Ownership and integration

A view module owns its generation, at most one worker, captured Product/body, completed results and image URLs. Compare refuses unapplied product drafts, captures committed values once, then solves/renders both candidates. Candidate controls are independent experiments: they preserve pending artwork/import owners. Explicit Use fabric is a normal editing intent: invalidate pending assets/imports and commit only non-rib material changes as one undoable edit. Recheck current capture identity and pending drafts first.

Sync from product render invalidates on a changed product reference or resolved body dimensions; passive navigation/selection retains results. Reset and pagehide retire all work. Input change and Cancel clear export/apply immediately. Worker/result/render callbacks check generation and current capture; stale completion cannot publish cards, download or apply. Revoke old URLs, dispose temporary scenes through the existing snapshot API, and permit explicit retry after construction/postMessage/worker/render errors. Existing garment drape ownership stays separate.

## Results and limits

Show two cards with matched front/back actual draped images, material identity/GSM, maximum structural edge extension, final speed, minimum body clearance and contact share. Explicitly flag >100% extension, speed>10cm/s and clearance<0.34cm. Show the captured body and immutable-input scope. A JSON receipt includes schema/solver/settings/units, captured source product/body, both candidate products/material assignments and all actual result positions/body/metrics. Local downloads may contain the user's artwork, as existing project exports do. No automatic external upload.

No saved schema/dependency/paid-service/PR change. Assumptions include heuristic isotropic stretch/bend, carried pockets, no cloth self/layer contact, approximate anatomy and contact; imagery differences do not validate fit. Clothing stays ACTIVE; project8 skipped; owner-deferred apps excluded.

## Acceptance

Domain tests prove isolated variants, rib/artwork/print/colorway preservation, strict material admission, and a complete serializable receipt of actual finite solver results. Browser tests on desktop1440 and phone390 exercise actual two-worker results, decoded front/back images, unchanged full backup before Use, exact Undo/Redo after Use, captured-body diagnostics/export, and viewport containment. Additional actual-boundary tests cover pending drafts, changed input/design/body, held old results/render completion, cancellation/pagehide, genuine retry, and retained pending artwork/import ownership. Run full project checks/browser suite and source/main CI, review the whole branch independently and retain failures/limits in the integration receipt.
