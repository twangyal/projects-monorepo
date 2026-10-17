# Pinned native CPU contact probe — #279

Date: 2026-10-17. Scope: establish whether the real pinned PPF CPU backend builds and executes its original synthetic cloth/cloth contact control on an ordinary Linux CPU runner. This is execution evidence, not a fabric calibration, garment acceptance, or engine selection.

## Provenance and method

- Upstream: [`st-tech/ppf-contact-solver@6b30976f86e6b94d68d459e5237d59704c7d1384`](https://github.com/st-tech/ppf-contact-solver/tree/6b30976f86e6b94d68d459e5237d59704c7d1384), Apache-2.0.
- Original fixture SHA-256: `391304e5b41c52437ff7117d994eb5b1ec9482ac56a12ae2ba6356aba357620e`.
- Locked release build with `--features cpu`; original `tools/cpu_contact_fixture.py` geometry, materials, solver calls and numerical assertions execute unchanged. Only the App data root and mesh cache storage hooks are redirected to an empty isolated synthetic directory, checked before simulation.
- Two crossed 5×5 sheets, 50 vertices/case, 13 saved frames/case, 0.2 simulated seconds, initial 0.03m gap. Compare contact enabled against contact disabled. The lower sheet is dynamic with pinned vertices; upper-sheet descent alone is not a penetration metric.
- Separate Linux subreaper supervisor enforces a 300-second fixture bound and stops detached descendants before the always-run collector copies native logs/frames. Six local harness regressions pass, including real detached-writer termination/reaping and failure/timeout receipts. The first supervisor attempt exposed a namespace/proc mismatch; the regression drove the corrected PPid/NSpid ancestry handling.
- Python dependencies follow the pinned upstream recipe, with resolved versions retained rather than a claim of fully hash-locked Python installation. Actual Rust/compiler/runner versions, Cargo.lock, license, resource receipts and source revision are retained in the evidence archive.

## Evidence history

[First native run 39015923759](https://github.com/twangyal/projects-monorepo/actions/runs/39015923759) built successfully in 331.35 s and passed the original fixture in 5.526847427 s. Contact enabled: zero wrong-side vertex frames. Contact disabled: 125 wrong-side vertex frames beginning at frame 8. However, its initial implicit-cache collector retained zero raw frames and only frontend-truncated native logs. Treat it as preliminary, incomplete evidence. [first-run.json](first-run.json) preserves its measurements; [first-run.zip](first-run.zip) preserves its original archive. Build maximum RSS 1,427,012 KiB and fixture maximum RSS 72,288 KiB are per-process peaks, not aggregate memory.

The first collector was corrected after review: initial receipts survive timeout, collection runs outside the bounded process, complete synthetic native outputs are retained, detached solver children are reaped, and successful physics without the expected 26 raw frames fails collection. Source tracing distinguished App.create(cache_dir), which controls mesh caching, from App.get_data_dirpath, which controls native session outputs. Both are redirected and the resolved session root is checked.

## Final execution

[Final run 39016841320](https://github.com/twangyal/projects-monorepo/actions/runs/39016841320), source `a3707a5b82b455018830319c86f0b5678598f4d5`, is still building as of 2026-10-17 08:25 UTC. The corrected harness has not yet earned complete native acceptance. Keep #279 open until its actual outcome and archive are inspected; record failure rather than promoting the preliminary pass if the corrected run fails.

## Interpretation and next admission gates

A successful tiny CPU contact control establishes native build/execution feasibility for this pinned revision and runner. It does not benchmark interactive garment latency or demonstrate physical fabric accuracy. Wrong-side vertex frames are essential here: contact-disabled motion can tunnel between saved frames while segment/triangle crossing counts remain zero. The enabled lower sheet can sag, so upper-sheet descent greater than the initial gap does not by itself mean interpenetration.

The fixture's older comment about static collision mesh refusal is stale. The pinned driver [`refusal.rs`](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-solver/src/driver/refusal.rs) explicitly states that the static collision mesh is no longer refused; current driver/contact code advertises support. This fixture does **not exercise static body contact**. Do not infer static-body admission from its cloth/cloth result or infer lack of support from the old fixture comment.

Continue outside the shipping app with unit-aware tensile/bending coupons, measured material provenance and explicit parameter mapping, then static-body/seam/contact admission and one fixed garment/body across two materials. Measure convergence with resolution/timestep, failure, strain, penetration and actual garment latency against independent physical references. Preserve UVs, rest geometry, seam identity and owned design/export snapshots before considering a backend. No PPF integration, GPU service, remote user uploads, paid compute or production changes were introduced. Clothing remains ACTIVE.
