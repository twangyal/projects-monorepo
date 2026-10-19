# Triangle-clear warm preparation — #290

The previous warm pose passed nonintersection but failed the CPU barrier on its first advance, even without stitch forces. A conservative full triangle-pair query now checks the actual float32 cloth/body surfaces. Point-to-face, interior edge-to-edge and segment/triangle crossings cover both separated and intersecting surface pairs; coplanar contact is included. A spatial hash only narrows candidates, with expanded cloth AABBs and an exact AABB distance lower bound. It does not establish inside/outside, cloth self-contact or trajectory clearance; the strict upstream gates remain required.

The old warm pose has minimum cloth/body separation1.490489877mm (right-sleeve triangle4190/body triangle2533), below the3.5mm combined contact offset. A declared4mm outward analytic-body-field-gradient preparation improves that to5.325978583mm but leaves256 triangle pairs below a conservative6mm target (3.5mm combined offset + two1mm gap contributions +0.5mm margin), so it was rejected. The retained rejected receipt and failing tests keep that distinction visible.

The5mm candidate shifts only initial coordinates along normalized finite-difference gradients of the original captured analytic body. It preserves rest coordinates, seams, face/UV mapping, body vertices and material provenance. The existing cut-open collar layout runs after the shift; captured-inertia mapping follows and preserves positions. Effective native densities are recomputed by that existing initial-area mass mapping, while source GSM and captured physical masses remain separately inspectable. Full float32 surface admission finds no cloth/body triangle pair closer than6mm (28,915 exact candidate pairs tested). This is a lower-bound admission, not an invented exact minimum. Its [preparation receipt](results/garment-clearance-preparation.json) records31.2682% maximum absolute native intrinsic-edge strain and283.718mm maximum stitch gap. These native triangle-edge diagnostics differ from browser structural-edge metrics; no native motion is represented by the preparation receipt.

The research CLI adds `--initialization clear-warm-sewing`. The dedicated `autonomous/clothing-ppf-garment-clearance-290` branch selects it with normal stitch stiffness1 and strict contacts; existing manual dispatch defaults to the previously proven cold sewing pose. The known unsewn diagnostic cannot be combined with this pose. Nine source hashes cover the added math and analytic body field. Actual pinned CPU execution now passes the bounded two-material motion probe; see the retained evidence below. No shipping solver or preview imports this helper, and no physical material/fit or engine-adoption result is claimed.

Meaningful RED/GREEN tests cover the original false-clear pose, actual candidate preservation/clearance, known triangle crossings/coplanar contact, interior edge-edge minima, negative cell boundaries and empty-mesh refusal. Independent read-only review checked distance math, conservativeness and randomized comparisons against exhaustive queries, plus probe/workflow ordering. Local baseline103 research tests pass; final expanded verification is recorded with the native outcome.

```sh
python3 -m unittest discover -s docs/research/ppf-cpu -p test_garment_clearance.py
python3 docs/research/ppf-cpu/garment_native_probe.py --initialization clear-warm-sewing --mass-convention browser-inertia --upstream /path/to/pinned/upstream --out /new/report --cache /new/empty-cache
```


## Retained strict native motion

Source [1e941a42](https://github.com/twangyal/projects-monorepo/commit/1e941a42cd8154558566f89ca537eca690da9952), [native run39179647279](https://github.com/twangyal/projects-monorepo/actions/runs/39179647279), artifact12155703839. The complete ZIP is retained as [garment-clearance-native.zip](results/garment-clearance-native.zip), SHA256 `b7f56acb8951be51fde54aa734c08ead3555fea83ebb0b6305f052b7cb1b255e`. The pinned CPU backend produced19 genuine saved frames per material, spanning0–0.3 seconds. The supervisor completed in43.324 seconds with no remaining children. Both cases preserve captured physical mass0.151579424kg; the separately reproduced ordered-float32 mass diagnostic is0.151582435kg.

| Saved-frame metric | Soft (Young500) | Stiff (Young2000) |
| --- | ---: | ---: |
| Final RMS movement from initial |41.919mm |39.763mm |
| Maximum vertex movement |300.395mm |289.021mm |
| Final maximum absolute intrinsic-edge strain |34.194% |20.517% |
| Final maximum stitch gap |1.422mm |1.456mm |

The final vertex RMS difference between materials is17.242mm. These diagnostics cover all saved frames and refer to native triangle edges, not browser structural edges. Closing stitch gaps and completing0.3 seconds do not establish settling, trajectory/self-contact correctness, seam quality, calibrated fabric, physical fit or suitability as the shipping engine.

The independent [auditor](garment_clearance_audit.py) reconstructs the full prepared blueprint, checks all nine frozen source hashes and278 native-file manifest entries, byte-verifies rest/initial/body/material/seam exports, checks exact frame namespace/float32 frame0/finite coordinates/timing, validates native completion and cleanup, recomputes mass and motion, and confirms the only differing material binary is `param/tri-young-mod.bin`. [Replayed metrics](results/garment-clearance-native-audit.json) are reproducible without executing the native backend or loading session pickles. Regression tests reject a previous warm archive and re-signed mutations to rest data, frames, timing, extra inputs, source provenance and completion. Independent read-only review reproduced the retained JSON exactly and found no important issues.

```sh
python3 docs/research/ppf-cpu/garment_clearance_audit.py docs/research/ppf-cpu/results/garment-clearance-native.zip
python3 -m unittest discover -s docs/research/ppf-cpu -p test_garment_clearance_audit.py
```


## Rejected nearby collar comparison

An offline comparison applied the existing `separate_rib` after the same warm/outward preparation, omitting the conservative sewing-layout collar translation. Its initial stitch gap drops to6.013mm and cloth/body clearance still passes6mm, but rib/shirt admission finds90 pairs below2.5mm, including an actual intersection. It is rejected before native execution. The [receipt](results/garment-clearance-near-collar-rejected.json) records initial geometry only, not saved motion. A smaller initial seam gap alone is insufficient grounds to replace the admitted layout.
