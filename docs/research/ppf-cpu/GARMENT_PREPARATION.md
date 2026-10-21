# Declared startup-preparation control (#290)

The existing cleared warm pose begins with a 47.891% peak absolute principal strain (compression at front triangle1160). The browser warm stage instead peaks at54.049% extension at front triangle1040. These are saved-face geometric strains, not calibrated tolerances or proof of a construction defect.

A bounded exploratory sweep compared mesh-smoothed outward directions against the original analytic-body-gradient displacement. The frozen native candidate uses **three synchronous self-plus-one-ring-neighbor-average/unit-normal passes, a50/50 original/smoothed unit-direction blend, and the original5mm displacement magnitude**. Stable sorted adjacency makes the reconstruction deterministic. This changes only initial positions; original rest geometry, body, seams and contact controls remain unchanged. Effective densities are recomputed by the existing captured-inertia mapping rather than reusing masses from a different initial area.

After the same detached-collar layout and unchanged6mm float32 triangle/body surface gate, the candidate has no violations. Before native motion, its peak absolute principal strain is42.015% versus47.891%, and its rest-area-weighted95th percentile is15.238% versus16.611%. Selection was exploratory, not preregistered; the parameter family and all static results are retained in [the exploratory receipt](results/garment-preparation-exploration.json). Lower startup distortion is not evidence of improved final native drape.

## Frozen native protocol

Fresh reference and smoothed jobs both use the cleared browser warm start, fixed normalized Young500, requested-four environment, normal gravity `[0,-9.8,0]`, configured dt1/120,180intervals/181frames, original rest/body/seams/contact, captured source-quotient inertia and the exact canonical mesh patch. Each separate supervisor retains its unchanged300-second limit and cleanup. Every outcome retains logs, raw inputs and all available frames. No zero-gravity, unsewn, half-step or serial-pair modes may be combined.

Only the initial-position and effective-density binaries may differ between the pair; metadata/session parameters, topology, rest/body/contact/seam data must match. The candidate's exact arrays must independently reconstruct from the frozen preparation function. Recorded executable digests and host/dependency differences must be checked before interpreting paired results. The executable bytes themselves are not retained.

## Actual native result

Both jobs in [run39574712580](https://github.com/twangyal/projects-monorepo/actions/runs/39574712580), frozen source `319e0f494a4ada59e26101c5def902dab7db8d46`, completed with181frames each and no remaining children. Independent strict replay verifies463native files per archive, unchanged original rest/body/seams/contact/session controls, captured source-quotient inertia, and exact reconstruction of both declared initial preparations. Of46native input arrays, only `vert.bin` and `param/tri-density.bin` differ. Recorded executable digests and Python-dependency hashes match.

| Observation | Reference | Smoothed |
| --- | --- | --- |
| Initial peak absolute principal strain | 47.891% | 42.015% |
| Initial area-weighted95th percentile | 16.611% | 15.238% |
| Final peak principal strain (extension) | 40.885% | 40.849% |
| Final area-weighted95th percentile | 6.438% | 6.440% |
| Final maximum intrinsic-edge strain | 31.196% | 31.148% |
| Final maximum collar stitch gap | 1.422mm | 1.422mm |
| Final saved-interval maximum secant speed | 7.506mm/s | 5.960mm/s |
| Supervisor wall time including cleanup | 83.804s | 131.210s |

Both endpoints have zero violations in the unchanged3.5mm cloth/body and0.5mm collar/shirt threshold queries. These are saved endpoint checks, not trajectory contact, settling or fit acceptance. Final peak remains at native triangle3091, source back1173, vertices1639/1640/643. The final shapes differ by0.043863mm RMS; the largest saved trajectory separation is64.668mm at one vertex and12.473mm frame RMS. Early motion differs, while the final construction observation persists. Lower initial compression in this candidate does **not** resolve the underarm extension. This does not prove all preparation changes ineffective or identify a unique construction/contact cause.

Reference ran on AMD EPYC9V45 and smoothed on EPYC7763. Separate host models preclude attributing timing differences or precise causal effect sizes to preparation. Matching recorded binaries do not independently verify executable bytes or hardware equivalence. Normalized Young500 remains uncalibrated. The shipping solver is unchanged; physical material/fit evaluation and representative garments/bodies remain open. All prior failure archives and gravity controls remain immutable.

[Full comparison and replay](results/garment-preparation-comparison.json) includes every saved-coordinate difference, principal-strain checkpoints, host/dependency fingerprints and manifest-verified source inputs. Official archives are retained losslessly:

- [Reference archive](results/garment-preparation-reference.zip), artifact12334591585, SHA256 `d3fd9bc231e37c28d82c31010d6febeb5ae222c8947fd3d0cf2a6c6662675b51`.
- [Smoothed archive](results/garment-preparation-smoothed.zip), artifact12334488202, SHA256 `f4f57d4305024e982d83eeca87fc0c5d2d5326db570345f35dde8547985aafe8`.

Reproduce the admitted native pair with `python docs/research/ppf-cpu/garment_preparation_comparison.py docs/research/ppf-cpu/results/garment-preparation-reference.zip docs/research/ppf-cpu/results/garment-preparation-smoothed.zip`. The retained pair regression requires exact derived-receipt equality.

## Startup-stage localization

[Reconstructed stage receipt](results/garment-preparation-stages.json) traces all eight geometric snapshots and tracks triangles1040,1160 and3091. The reference float32 handoff matches every coordinate of the retained gravity experiment’s actual frame0. Rest, body, seams and correspondence are unchanged through these stages.

| Stage | Global peak absolute principal strain | Area-weighted95th percentile | Peak location/type |
| --- | --- | --- | --- |
| Captured styling geometry | 547.238% | 226.347% | sleeveRight4246 extension |
| Browser warm endpoint | 54.049% | 6.738% | front1040 extension |
| Reference outward, float32 | 47.891% | 16.611% | front1160 compression |
| Smoothed outward, float32 | 42.015% | 15.238% | front1160 compression |

At triangle1160, compression rises from9.370% at the browser warm endpoint to47.891% after the original outward step; the candidate reduces it to42.015%. The final-underarm triangle3091 already carries40.299% extension at the warm endpoint, then changes to25.462% compression in the reference initial handoff. These distinguish startup-stage effects from later native motion; they do not isolate a final construction defect. The warm-start50% structural-edge guard measures a different quantity and is not a principal face-strain bound.

Reproduce with `python docs/research/ppf-cpu/garment_preparation_diagnostics.py /tmp/stages.json` and `python docs/research/ppf-cpu/garment_preparation_sweep.py /tmp/exploration.json`. The exploratory sweep checks all12 declared candidates after the same collar layout; its selected double-precision input must equal the frozen native helper exactly. The stage and exploratory receipts remain distinct from the actual native replay above.
