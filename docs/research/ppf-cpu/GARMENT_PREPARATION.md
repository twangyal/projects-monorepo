# Declared startup-preparation control (#290)

The existing cleared warm pose begins with a 47.891% peak absolute principal strain (compression at front triangle1160). The browser warm stage instead peaks at54.049% extension at front triangle1040. These are saved-face geometric strains, not calibrated tolerances or proof of a construction defect.

A bounded exploratory sweep compared mesh-smoothed outward directions against the original analytic-body-gradient displacement. The frozen native candidate uses **three synchronous self-plus-one-ring-neighbor-average/unit-normal passes, a50/50 original/smoothed unit-direction blend, and the original5mm displacement magnitude**. Stable sorted adjacency makes the reconstruction deterministic. This changes only initial positions; original rest geometry, body, seams and contact controls remain unchanged. Effective densities are recomputed by the existing captured-inertia mapping rather than reusing masses from a different initial area.

After the same detached-collar layout and unchanged6mm float32 triangle/body surface gate, the candidate has no violations. Before native motion, its peak absolute principal strain is42.015% versus47.891%, and its rest-area-weighted95th percentile is15.238% versus16.611%. Selection was exploratory, not preregistered; the parameter family and all static results are retained in [the exploratory receipt](results/garment-preparation-exploration.json). Lower startup distortion is not evidence of improved final native drape.

## Frozen native protocol

Fresh reference and smoothed jobs both use the cleared browser warm start, fixed normalized Young500, requested-four environment, normal gravity `[0,-9.8,0]`, configured dt1/120,180intervals/181frames, original rest/body/seams/contact, captured source-quotient inertia and the exact canonical mesh patch. Each separate supervisor retains its unchanged300-second limit and cleanup. Every outcome retains logs, raw inputs and all available frames. No zero-gravity, unsewn, half-step or serial-pair modes may be combined.

Only the initial-position and effective-density binaries may differ between the pair; metadata/session parameters, topology, rest/body/contact/seam data must match. The candidate's exact arrays must independently reconstruct from the frozen preparation function. Recorded executable digests and host/dependency differences must be checked before interpreting paired results. The executable bytes themselves are not retained.

Results are pending actual native evidence. Do not promote a partial/failing solve or the static clearance gate into native completion. No shipping solver or physical-fit acceptance is implied. All prior failure archives and gravity controls remain immutable.

## Startup-stage localization

[Reconstructed stage receipt](results/garment-preparation-stages.json) traces all eight geometric snapshots and tracks triangles1040,1160 and3091. The reference float32 handoff matches every coordinate of the retained gravity experiment’s actual frame0. Rest, body, seams and correspondence are unchanged through these stages.

| Stage | Global peak absolute principal strain | Area-weighted95th percentile | Peak location/type |
| --- | --- | --- | --- |
| Captured styling geometry | 547.238% | 226.347% | sleeveRight4246 extension |
| Browser warm endpoint | 54.049% | 6.738% | front1040 extension |
| Reference outward, float32 | 47.891% | 16.611% | front1160 compression |
| Smoothed outward, float32 | 42.015% | 15.238% | front1160 compression |

At triangle1160, compression rises from9.370% at the browser warm endpoint to47.891% after the original outward step; the candidate reduces it to42.015%. The final-underarm triangle3091 already carries40.299% extension at the warm endpoint, then changes to25.462% compression in the reference initial handoff. These distinguish startup-stage effects from later native motion; they do not isolate a final construction defect. The warm-start50% structural-edge guard measures a different quantity and is not a principal face-strain bound.

Reproduce with `python docs/research/ppf-cpu/garment_preparation_diagnostics.py /tmp/stages.json` and `python docs/research/ppf-cpu/garment_preparation_sweep.py /tmp/exploration.json`. The exploratory sweep checks all12 declared candidates after the same collar layout; its selected double-precision input must equal the frozen native helper exactly. Native results remain pending.
