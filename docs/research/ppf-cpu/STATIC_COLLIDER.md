# Static triangle contact admission — #281

This is the next bounded native question after #279, not shipping-app integration: does pinned PPF CPU contact stop a falling sheet on a genuine static triangle mesh? The original cloth/cloth case remains unchanged and its archive is preserved. Its old static-refusal comment conflicts with current driver/source support; this experiment measures the actual path.

## Frozen protocol before first execution

Pin upstream `6b30976f86e6b94d68d459e5237d59704c7d1384`. A 5×5 square lower grid spans ±0.20m at y=1m, with 32 triangles facing +Y. Fully pin it without motion operations, then require the actual scene to promote it to static. Compare the actual repacked world triangles with the oracle plane, and require just 25 free upper vertices in every saved output (static vertices must be outside the solved namespace).

The upper 5×5 sheet has half-span0.12m, rotates45° and starts at y=1.03m. Use the original case's explicit Young modulus2000/bend20 authoring parameters, dt=1/120s, fps60, gravity−9.8m/s² and12 simulated frames plus rest frame0 (0.2 simulated seconds). Run identical contact-enabled and disabled controls. This is a new derived fixture: lower static promotion and positive-Y winding differ from #279, and the plane oracle replaces dynamic-sheet intersections. Coefficients are not measured fabric calibration.

An independent plane-height oracle checks all 325 vertex-frames per case, not solver-reported contact. Every coordinate must be finite; exact frames0–12/25 vertices must exist; every projected upper vertex must stay within the finite plane footprint. Reject loss of coverage. At saved states the enabled case must have zero vertices below y=1m beyond1µm tolerance, move more than25% of its30mm initial gap and descend less than60% of the theoretical0.196m free fall. The disabled control must have wrong-side vertex frames and descend more than80% of that free fall. These criteria refuse a frozen scene or a control that never reached the collider. Saved states do not establish continuous-time nonpenetration.

## Runner and evidence

`clothing-ppf-static.yml` uses the same locked CPU build, pinned dependency recipe, public Ubuntu host and bounded Linux supervisor as #279. `static_probe.py` captures its own/oracle source hashes, original input geometry/parameters, actual static admission and numerical results. Both explicit mesh and session storage stay under an empty synthetic root. Complete stdout/error logs, output frames, build/fixture resource receipts, dependency versions, Cargo.lock/license and revision are collected even after failure. Collection recognizes a distinct `passed_static_fixture` status; it does not label this new experiment the unchanged upstream fixture. Exact per-case frame sets remain mandatory.

Reproduce with the #279 build/dependencies, replacing `probe.py` with `static_probe.py` in the supervised local commands; keep the separate always-run collector and original exit code. No user garments, remote user uploads, GPU purchase or paid services are involved.

Eleven local harness cases pass. The new collector-status regression first fails because a failed execution gate leaves a static pass; it passes after treating either native experiment's pass status consistently. Analytic plane cases independently check the positive control, frozen scene, missing data, invalid initial height, nonfinite values and lost footprint coverage. Python compilation passes. Actual native execution remains pending; build success alone is not contact acceptance.

Even a pass admits only this planar static contact case at one tiny mesh/timestep. Curved/anatomical bodies, folds/layers, seams, garment-scale latency, convergence and material-to-SI mapping/independent physical references remain next gates. Clothing remains ACTIVE and no new engine is selected.
