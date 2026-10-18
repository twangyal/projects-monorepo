# Browser growth preparation and native contact diagnosis — #290

Canonical implementation/evidence commit `07c11cc13467ba0c3dc04636f6fa691d255fe39e` preserves the shipping Clothing application tree `63a56e8dce004087a6910c3c04ed1d283c43c49d`. The research module is not imported by the shipping preview/solver. Gaze's separate completed #291 milestone is preserved; see [its verification record](2026-10-18-gaze-aria-state-integration.md).

## Verified software gates

- Local final research suite: 103 tests pass in90.136s; independent review reproduces both failure audit JSON files and finds no important issues.
- [Canonical research harness39160001901](https://github.com/twangyal/projects-monorepo/actions/runs/39160001901):103 tests pass.
- [Canonical garment preflight39160001906](https://github.com/twangyal/projects-monorepo/actions/runs/39160001906):46 garment tests plus complete cold/warm/rest/body capture reproduction pass, matching [source preflight39159835578](https://github.com/twangyal/projects-monorepo/actions/runs/39159835578).
- [Canonical Clothing application39159311520](https://github.com/twangyal/projects-monorepo/actions/runs/39159311520):161 units,195 production browser cases, lint/typecheck/build pass. Its complete application subtree is identical in07c11cc.

## Actual native outcome

Initial430.349% edge strain comes from deliberate styling inflation. A separate provenance-checked capture reuses the existing45-frame browser body-growth endpoint and reduces that measure to43.852%, preserving intrinsic rest/material/body/seam data. It is not settled: residual speed remains nonzero and conservative detached collar assembly starts with295.758mm sewing gap.

Both real pinned locked CPU experiments pass strict initialization and exact export, then fail at their first advance, retaining only initial frame0. The [sewn run39157200184](https://github.com/twangyal/projects-monorepo/actions/runs/39157200184) and [unsewn control39158906691](https://github.com/twangyal/projects-monorepo/actions/runs/39158906691) each retain all82 native files. The [full report, complete ZIPs and independently replayable audits](research/ppf-cpu/GARMENT_WARM_START.md) preserve the failure rather than count initialization as motion.

Paired replay verifies identical native input names, scene/session metadata and all input bytes except `stitch_stiffness.bin` (1→0). Failure persists without stitch forces in this exact experiment. Direct float32-input replay reproduces static body vertex1198 versus right-sleeve triangle4351 at3.268207mm, below the3.5mm contact offset; all three corners are farther than3.5mm from that body vertex. This is one triangle-interior barrier violation, not exhaustive clearance or complete root-cause isolation.

## Remaining work

Issue290 remains open. Produce a barrier-clear initial pose against the actual triangulated cloth/body, retaining intrinsic construction and strict contacts. Re-run sewn motion and both material controls with complete raw frames before interpreting assembly, seam quality or settling. Physical fabric/fit calibration and engine adoption remain unverified. Clothing stays ACTIVE; project8 remains skipped.
