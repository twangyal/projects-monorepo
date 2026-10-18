# Detached collar sewing initialization — #288

Outcome: move the actual tee/captured-body bridge past initial collision admission into real native export and bounded two-normalized-material execution. Native garment motion, sewn quality and physical fit remain unaccepted until measured. The shipping browser application is unchanged.

## Why a different assembly pose

The actual collar is a separate periodic modeled strip, then welded to an inflated styling shell. The source ring is coarse; the captured welded display pose contains collar/panel intersections. The unchanged pose and the small normal-offset experiment both fail strict native validation (see [retained failures](GARMENT_NATIVE.md)). Padding changes cannot resolve surface intersections.

This experiment uses a detached sewing pose, rather than presenting the original dressed pose as collision free. Open the four vertices on the duplicated closing cut by ±2mm in the horizontal cut tangent. Then translate every collar vertex rigidly upward; no normal-dependent per-vertex deformation is applied. Rest positions, original4480 ordered triangles, UVs, per-face captured density, full static body and22 stitch correspondences are unchanged.

For each collar triangle, examine all4440 other cloth and39144 static-body triangle bounding boxes. Horizontally disjoint pairs need no Y constraint. For every pair within the declared X/Z clearance, require the collar's minimum Y to exceed the obstacle's maximum Y by that clearance. The smallest sufficient shared upward translation, plus1µm numerical margin, is50.5010305mm for this fixed packet. Unlike increasing guessed offsets after failed runs, this value is derived once from complete input geometry. A tall but horizontally irrelevant body triangle does not force the collar above the whole avatar.

Conservative pair clearances sum both1mm gap contributions and offsets:2.5mm collar/cloth,5.5mm collar/static-body; cloth offset0.25mm and body offset3.25mm preserve their original combined3.5mm. The opened cut has4mm endpoint gap. [Prepared certificate](results/garment-sewing-layout.json) records all controls. This only certifies initial collar-to-other-cloth/body bounding-box separation. It does not certify collar self-contact, sewing dynamics or future nonpenetration; the unchanged native checks still decide admission.

## Frozen execution protocol

The existing pinned upstream6b30976 CPU workflow runs `garment_native_probe.py --initialization sewing`, with exact source hashes, original and prepared blueprints, strict frontend validation and pre-execution native byte checks. Original source artifacts and earlier failures remain immutable. The300s supervisor/always-run collector retains actual outputs, refusals or timeouts. The two normalized Young controls500/2000, bend20, captured per-face density, gravity9.8,dt1/120,fps60 and18frames+rest cover0.3s only. They are not physical fabric calibration or a settling protocol.

Two actual failing tests preceded implementation. The new tests independently verify separation against every relevant triangle box, unchanged non-collar/rest/topology/material/body values, rigid shared Y translation, horizontal cut gap, determinism and refusal to let an off-axis tall obstacle dictate the result. The complete local research suite passes80 tests in22.378s. Native result is pending; no export or solver success is claimed by these preparation tests.
