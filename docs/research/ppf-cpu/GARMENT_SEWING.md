# Detached collar sewing initialization — #288

Outcome: move the actual tee/captured-body bridge past initial collision admission into real native export and bounded two-normalized-material execution. Native garment motion, sewn quality and physical fit remain unaccepted until measured. The shipping browser application is unchanged.

## Why a different assembly pose

The actual collar is a separate periodic modeled strip, then welded to an inflated styling shell. The source ring is coarse; the captured welded display pose contains collar/panel intersections. The unchanged pose and the small normal-offset experiment both fail strict native validation (see [retained failures](GARMENT_NATIVE.md)). Padding changes cannot resolve surface intersections.

This experiment uses a detached sewing pose, rather than presenting the original dressed pose as collision free. Open the four vertices on the duplicated closing cut by ±2mm in the horizontal cut tangent. Then translate every collar vertex rigidly upward; no normal-dependent per-vertex deformation is applied. Rest positions, original4480 ordered triangles, UVs, per-face captured density, full static body and22 stitch correspondences are unchanged.

For each collar triangle, examine all4440 other cloth and39144 static-body triangle bounding boxes. Horizontally disjoint pairs need no Y constraint. For every pair within the declared X/Z clearance, require the collar's minimum Y to exceed the obstacle's maximum Y by that clearance. The smallest sufficient shared upward translation, plus1µm numerical margin, is50.5010305mm for this fixed packet. Unlike increasing guessed offsets after failed runs, this value is derived once from complete input geometry. A tall but horizontally irrelevant body triangle does not force the collar above the whole avatar.

Conservative pair clearances sum both1mm gap contributions and offsets:2.5mm collar/cloth,5.5mm collar/static-body; cloth offset0.25mm and body offset3.25mm preserve their original combined3.5mm. The opened cut has4mm endpoint gap. [Prepared certificate](results/garment-sewing-layout.json) records all controls. This only certifies initial collar-to-other-cloth/body bounding-box separation. It does not certify collar self-contact, sewing dynamics or future nonpenetration; the unchanged native checks still decide admission.

## Frozen execution protocol

The existing pinned upstream6b30976 CPU workflow runs `garment_native_probe.py --initialization sewing`, with exact source hashes, original and prepared blueprints, strict frontend validation and pre-execution native byte checks. Original source artifacts and earlier failures remain immutable. The300s supervisor/always-run collector retains actual outputs, refusals or timeouts. The two normalized Young controls500/2000, bend20, captured per-face density, gravity9.8,dt1/120,fps60 and18frames+rest cover0.3s only. They are not physical fabric calibration or a settling protocol.

Two actual failing tests preceded implementation. The new tests independently verify separation against every relevant triangle box, unchanged non-collar/rest/topology/material/body values, rigid shared Y translation, horizontal cut gap, determinism and refusal to let an off-axis tall obstacle dictate the result. The complete local research suite passes80 tests in22.378s. The real pinned native result now passes scene/export admission and bounded motion; see actual evidence below.

## Actual native result — 2026-10-18

[Source c9c43cf](https://github.com/twangyal/projects-monorepo/commit/c9c43cfabd82e579ac1bfdc990c1d6ab26d25970), [native run39134300810](https://github.com/twangyal/projects-monorepo/actions/runs/39134300810), job117695572863, completes with strict scene checks and exact native byte admission in both cases. The full [4,103,405-byte archive](results/garment-sewing-native.zip), SHA256 `c154742f1861730932924378df036ba9e6fd1374be1164a5cfd3731e6c38486d`, retains278 native files including all38 frames (2353 vertices each), actual inputs, clean native completion logs, source/build/lock/environment/resource records and both blueprints. The independent [audit](results/garment-sewing-native-audit.json) hashes every native file, checks the fixed inputs/rest/UV/body/density/stitches, rejects missing/extra frames, and confirms that `param/tri-young-mod.bin` is the only changed native input across controls. No pickle is loaded.

| Saved-frame diagnostic | Soft500 | Stiff2000 |
| --- | ---: | ---: |
| Native case wall (s) |15.0163|18.0180|
| Maximum vertex displacement (mm) |138.687|130.557|
| Final vertex RMS displacement (mm) |55.745|60.112|
| Initial maximum absolute edge strain |430.349%|430.349%|
| Maximum saved absolute edge strain |463.957%|461.424%|
| Final maximum absolute edge strain |20.447%|14.069%|
| Initial maximum sewing gap (mm) |50.541|50.541|
| Final maximum sewing gap (mm) |1.682|1.468|

The final shapes differ by17.308mm vertex RMS. Native frame/time streams run exactly0..18 at0..0.3s. These are transient normalized-coefficient results, not a calibrated material ranking or settling acceptance. The high starting strain already exists in the captured styling shell; the source-edge maximum is430.349% before either initializer. Native reference-metric preservation does not make that shell an equilibrium pose.

CPU build333.60s, peakRSS1,425,256KiB. Whole supervised fixture36.449s including preparation/cleanup, peakRSS143,032KiB; receipt34.992s excludes input preparation. Exit0 and zero surviving children. These are measurements for this fixed synthetic tee/proxy and runner, not desktop/browser latency guarantees.

## Mass convention: measured limitation

Both native cases report0.1978686kg cloth mass (`output/data/total_mass.out`); the captured browser mass is0.1515794202kg (+30.538% native). Pinned [main.rs](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-solver/src/main.rs) computes face areas from initial `mesh.vertex`; [scene.rs](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-solver/src/scene.rs) multiplies density by that area. Alternate intrinsic rest positions do not replace the mass convention. Independently summing prepared3D areas×captured densities gives0.1978672857kg, within6.6ppm of the float32 native sum; audit allows10ppm. Browser code uses projected XY area except modeled rib, and its captured inverse masses give the browser total above.

This corrects the provisional rest-area-mass assumption in the historical cut-rib candidate's limitations; that immutable artifact/reproducer is preserved. Same native mass across these two controls admits their Young-only comparison, but there is **no cross-engine mass matching** or physical-fabric validation. [Issue289](https://github.com/twangyal/projects-monorepo/issues/289) tracks an explicit provenance-preserving per-face inertia adapter and fresh native evidence.

## Reproduction and acceptance boundary

```sh
python docs/research/ppf-cpu/garment_sewing_audit.py docs/research/ppf-cpu/results/garment-sewing-native.zip
python -m unittest discover -s docs/research/ppf-cpu -p 'test_*.py'
```

All85 local research tests pass in31.253s. Independent review replays the actual archive, all five source hashes, geometry certificate, raw motion/strain/seam metrics, Young-only binary comparison and numerical mass guard. Tampered/rest/frame/control/status/mass tests re-sign their native manifests and still refuse, so checksum matching alone cannot admit the wrong experiment. Earlier failed native archives remain unchanged. #288's capture/native bridge and bounded two-coefficient execution are delivered; settled sewn behavior, continuous-time collision checks, matched inertia, physical fabric/body/fit calibration and engine selection remain ACTIVE work. Shipping application bytes are unchanged; project8 remains skipped.
