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

[Native run 39016841320](https://github.com/twangyal/projects-monorepo/actions/runs/39016841320), source `a3707a5b82b455018830319c86f0b5678598f4d5`, built and passed the original physics fixture. **Overall CI failed** in the collector: it counted two `session/bin/vert_dmap.bin` index maps as output frames and reported28 instead of26. The archive does retain all26 actual numeric output frames, both complete native stdout/error logs, and220 native files. The supervisor reports exit0 and zero remaining children.

| Measurement | Contact enabled | Contact disabled |
|---|---:|---:|
| Segment/triangle crossings | 0 | 0 |
| Wrong-side vertex frames | 0 | 125 |
| First wrong-side saved frame | none | 8 |
| Upper-sheet mean descent (m) | 0.06555342674255371 | 0.20241397619247437 |

Build wall421.05s; fixture wall6.881764869s (7.046824263s including supervisor cleanup); per-process maximum RSS1427196KiB build /72088KiB fixture. Ubuntu24.04 x86_64,4 logical CPUs; Rust1.99.1, Cargo1.99.1, Python3.12.15, g++13.3.0. These are tiny-fixture observations, not garment performance estimates.

[Pristine native-run.zip](native-run.zip) is166976 bytes, SHA-256 `8d76cb3451f4958cb0dff80a3fbacfe3137f06881c12fd3c2ff3028d3ae60ce7`, matching GitHub's artifact digest. [native-run.json](native-run.json) preserves the original failed-collection status and full manifest with explicit CI/replay annotations. Every one of the220 retained native files was independently checked against its recorded byte count/SHA-256. Original physics exit0 and numerical assertions passed; no original failed receipt was overwritten.

The collector now requires each exact per-case `session/output/vert_<numeric>.bin` set, excluding index maps. A regression reproducing this real failure went RED then GREEN; all7 local harness tests pass, including missing-frame refusal. A derived replay restores the pre-collector success status from the original successful fixture step/exit0 and runs the corrected collector on the pristine extracted native cache: passed,220 native files,26 output frames. This is an evidence-collector replay, **not a new native solver execution or a green CI claim**. Issue #279 remains open pending fresh end-to-end CI of the corrected collector; [fresh run39017488693](https://github.com/twangyal/projects-monorepo/actions/runs/39017488693) tests source `2efc226d56dd3c9874ec74aec9ffeda81c6e5be8`. Read the issue for its latest outcome.

## Interpretation and next admission gates

A successful tiny CPU contact control establishes native build/execution feasibility for this pinned revision and runner. It does not benchmark interactive garment latency or demonstrate physical fabric accuracy. Wrong-side vertex frames are essential here: contact-disabled motion can tunnel between saved frames while segment/triangle crossing counts remain zero. The enabled lower sheet can sag, so upper-sheet descent greater than the initial gap does not by itself mean interpenetration.

The fixture's older comment about static collision mesh refusal is stale. The pinned driver [`refusal.rs`](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-solver/src/driver/refusal.rs) explicitly states that the static collision mesh is no longer refused; current driver/contact code advertises support. This fixture does **not exercise static body contact**. Do not infer static-body admission from its cloth/cloth result or infer lack of support from the old fixture comment.

Continue outside the shipping app with unit-aware tensile/bending coupons, measured material provenance and explicit parameter mapping, then static-body/seam/contact admission and one fixed garment/body across two materials. Measure convergence with resolution/timestep, failure, strain, penetration and actual garment latency against independent physical references. Preserve UVs, rest geometry, seam identity and owned design/export snapshots before considering a backend. No PPF integration, GPU service, remote user uploads, paid compute or production changes were introduced. Clothing remains ACTIVE.
