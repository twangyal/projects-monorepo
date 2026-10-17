# Static triangle contact admission — #281

This is the next bounded native question after #279, not shipping-app integration: does pinned PPF CPU contact stop a falling sheet on a genuine static triangle mesh? The original cloth/cloth case remains unchanged and its archive is preserved. Its old static-refusal comment conflicts with current driver/source support; this experiment measures the actual path.

## Frozen protocol before first execution

Pin upstream `6b30976f86e6b94d68d459e5237d59704c7d1384`. A 5×5 square lower grid spans ±0.20m at y=1m, with 32 triangles facing +Y. Fully pin it without motion operations, then require the actual scene to promote it to static. Compare the actual repacked world triangles with the oracle plane, and require just 25 free upper vertices in every saved output (static vertices must be outside the solved namespace).

The upper 5×5 sheet has half-span0.12m, rotates45° and starts at y=1.03m. Use the original case's explicit Young modulus2000/bend20 authoring parameters, dt=1/120s, fps60, gravity−9.8m/s² and12 simulated frames plus rest frame0 (0.2 simulated seconds). Run identical contact-enabled and disabled controls. This is a new derived fixture: lower static promotion and positive-Y winding differ from #279, and the plane oracle replaces dynamic-sheet intersections. Coefficients are not measured fabric calibration.

An independent plane-height oracle checks all 325 vertex-frames per case, not solver-reported contact. Every coordinate must be finite; exact frames0–12/25 vertices must exist; every projected upper vertex must stay within the finite plane footprint. Reject loss of coverage. At saved states the enabled case must have zero vertices below y=1m beyond1µm tolerance, move more than25% of its30mm initial gap and descend less than60% of the theoretical0.196m free fall. The disabled control must have wrong-side vertex frames and descend more than80% of that free fall. These criteria refuse a frozen scene or a control that never reached the collider. Saved states do not establish continuous-time nonpenetration.

## Runner and evidence

`clothing-ppf-static.yml` uses the same locked CPU build, pinned dependency recipe, public Ubuntu host and bounded Linux supervisor as #279. `static_probe.py` captures its own/oracle source hashes, original input geometry/parameters, actual static admission and numerical results. Both explicit mesh and session storage stay under an empty synthetic root. Complete stdout/error logs, output frames, build/fixture resource receipts, dependency versions, Cargo.lock/license and revision are collected even after failure. Collection recognizes a distinct `passed_static_fixture` status; it does not label this new experiment the unchanged upstream fixture. Exact per-case frame sets remain mandatory.

Reproduce with the #279 build/dependencies, replacing `probe.py` with `static_probe.py` in the supervised local commands; keep the separate always-run collector and original exit code. No user garments, remote user uploads, GPU purchase or paid services are involved.

Eleven local harness cases pass. The new collector-status regression first fails because a failed execution gate leaves a static pass; it passes after treating either native experiment's pass status consistently. Analytic plane cases independently check the positive control, frozen scene, missing data, invalid initial height, nonfinite values and lost footprint coverage. Python compilation passes. The first native execution passed on 2026-10-17; build success alone was not used as contact acceptance.

## First accepted native execution — 2026-10-17

[CI39035825816](https://github.com/twangyal/projects-monorepo/actions/runs/39035825816), job117405270652, passed at source `7d26f1afa856da18dea694c56a579fb655780014`. The locked native CPU build, all eleven harness tests, both frozen controls, supervisor and always-run collector passed. The [original archive](results/static-first.zip) is retained unchanged alongside its [receipt and native-file manifest](results/static-first.json) and [raw-frame audit](results/static-first-audit.json).

| Saved-state measurement | Contact enabled | Contact disabled |
| --- | ---: | ---: |
| Wrong-side vertex-frames | 0 | 200 |
| First wrong-side frame | None | 5 |
| Minimum clearance (m) | 0.000826716423034668 | −0.17241400480270386 |
| Mean descent (m) | 0.029042639732360875 | 0.20241397619247437 |
| Covered vertex-frames | 325 | 325 |

Both actual scenes contain25 static vertices/32 static triangles and only25 solved upper vertices. Audit verified every one of238 native files against recorded byte counts/SHA-256, exact26 frames and all1950 finite float32 coordinates, then independently recomputed every oracle measurement from the binary frames. A separate read-only review repeated archive/frame/metric checks with no actionable findings. Supervisor exit0 and zero remaining children were retained.

Artifact12102526189 is161459 bytes, SHA-256 `66cbdd7f00486400eee60f9999927c61818c3dabdd6ac86d14eaddbeede78e1a`. Fixture source SHA-256 is `3f63b785cec4a3480dc8fb80e137df950ab6f2090a05519c422f3001fd3545cf`; oracle source is `94f2725a641c90b260c7a0cea10fbbc3096dc1bbdf2e4aa2bb07d82e780da3f2`. The pristine archive retains full logs, environment, geometry, native input/output, resources and license/revision evidence; the external receipt adds CI provenance without rewriting the archive.

Observed locked build wall time421.91s; fixture wall time2.912050625s includes frontend preparation, both native cases and output analysis, not just solving. Per-process peak RSS was1425292KiB for build and72384KiB for fixture/supervisor (not aggregate process-tree memory). Supervisor wall including cleanup was3.036166067s against300s. Host: Ubuntu24.04 x86_64,4 logical CPUs, Rust/Cargo1.99.1, Python3.12.15, g++13.3.0. These costs describe one tiny synthetic test, not garment performance.

This pass admits only this planar static contact case at one tiny mesh/timestep. Curved/anatomical bodies, folds/layers, seams, garment-scale latency, convergence and material-to-SI mapping/independent physical references remain next gates. Clothing remains ACTIVE and no new engine is selected.
