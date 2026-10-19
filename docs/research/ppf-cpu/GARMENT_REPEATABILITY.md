# Native garment repeatability control — #290

The accepted short and one-second experiments export identical inputs but their shared early trajectories differ by up to 16.961 mm (soft) and 26.706 mm (stiff). That prevents treating the observed two-material pair as a proven repeatable garment-material signal. The next bounded question is whether two fresh sessions with the same garment, initial/rest geometry, body, captured inertia, seams and material reproduce one another under explicitly recorded execution settings.

## Protocol

`garment_native_probe.py --same-material-control` runs independent `first` and `second` sessions, both normalized Young 500. It requires the previously admitted cleared warm pose, browser-inertia mapping, normal stitch forces and 60 intervals/61 saved frames. The ordinary soft/stiff defaults remain unchanged. No contact allowance, pattern-rest change, mass adjustment beyond the existing declared inertia mapping, or physical-material claim is introduced.

All five requested thread variables must consistently specify either `1` or `4`: `RAYON_NUM_THREADS`, `OMP_NUM_THREADS`, `OPENBLAS_NUM_THREADS`, `MKL_NUM_THREADS`, `NUMEXPR_NUM_THREADS`. These are inherited environment requests, not measurements of actual native workers. The new workflow runs the two configurations on separate CI hosts and retains CPU, affinity, compiler, dependencies, source hashes, complete raw sessions and requested settings. Each job keeps the 300-second fixture supervisor and a 25-minute outer bound; ordinary cancellation/outer-runner loss can still prevent collection. A configuration contrast across separate hosts does not establish a causal thread-count effect.

The dedicated branch `autonomous/clothing-ppf-garment-repeatability-290` triggers both matrix jobs. Manual dispatch runs the same fixed protocol. Independent review found no control/workflow blocker; focused RED/GREEN tests verify the case plan, required settings and rejection of changed preparation/mass/duration/stitches. Full source regression and actual native outcomes are recorded as they complete. The original-backend results below measure variation; the harness alone does not establish repeatability.

## Independent evidence requirements

Retain each complete archive with its GitHub digest. Reconstruct the exact preparation and captured inertia, verify the native manifest/source/inputs/session controls, exact 61-frame namespaces/timing, initial float32 frame and completion/cleanup. Compare every native input binary and scene/session metadata between the two cases; require identical Young bytes. Measure every saved vertex difference, maximum/RMS trajectory divergence, exact-frame matches, endpoint edge strain/seam gaps and residual secant motion. Preserve failures and report the measured result without inventing a tolerance after observing it. A bitwise match of one bounded pair is not broad determinism, physical fit or calibrated material acceptance.

```sh
env RAYON_NUM_THREADS=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 \
  python3 docs/research/ppf-cpu/garment_native_probe.py --same-material-control \
  --initialization clear-warm-sewing --frames 60 --mass-convention browser-inertia \
  --upstream /path/to/pinned/upstream --out /new/report --cache /new/empty-cache
python3 -m unittest discover -s docs/research/ppf-cpu -p test_garment_repeatability_controls.py
```

Use the existing external supervisor and always-run collector for a real native attempt, as shown in the workflow and research README. The command above alone does not impose the time/cleanup bound.

## Recorded original-backend result (19 October 2026)

[Run 39203144766](https://github.com/twangyal/projects-monorepo/actions/runs/39203144766), source `650535a031badf8a6ea33f9f0dea8c819b5aeb11`, completed both independent pairs against unchanged upstream `6b30976f86e6b94d68d459e5237d59704c7d1384`. Each archive retains 122 actual frames and 446 checksum-verified native files. The independent replay reconstructs preparation/inertia, verifies the exact exported controls, rejects unexpected session sidecars or altered invocation, verifies completion/timing/cleanup and compares every input binary and scene/session metadata. Inputs also match the prior one-second soft-material reference byte for byte. Session pickles are retained but never loaded.

| Requested environment | Maximum saved-vertex difference | All-saved vertex RMS | Maximum frame RMS | Final-frame RMS | Byte-identical frames |
| --- | ---: | ---: | ---: | ---: | ---: |
| One thread | 17.4446 mm | 1.0780 mm | 3.2760 mm | 0.0270 mm | 1 / 61 |
| Four threads | 26.6953 mm | 2.5521 mm | 7.6048 mm | 0.0633 mm | 1 / 61 |

Only the initial frame matches exactly in either pair. Nonzero same-material variation is established for these bounded observations; broad determinism and a repeatable garment-material response are not established. The small final differences would hide the larger intermediate disagreement. One pair per environment, on separate hosts, cannot identify a causal thread-count effect or define a population tolerance. The scheduler source uses fixed reduction/chunk ordering; ordinary parallel scatter is not assumed to explain this result.

The frozen archives are [one-thread](results/garment-repeatability-one.zip) (6,866,819 bytes, SHA-256 `17f70fb343db69a176c27262e78566d60090fe65ccdb5c62c9b72d253bcc82a8`, artifact 12164672367) and [four-thread](results/garment-repeatability-four.zip) (6,874,683 bytes, SHA-256 `d29bff83e39b5bb5031f15d2a3d0e8beb6f8b61e23f879ae45e8935808180d0d`, artifact 12164054710). Full per-frame metrics, strain/seam diagnostics and final-snapshot/secant checks are retained in the matching `*-audit.json` files. Endpoint threshold counts include sewn neighborhoods and do not reproduce native contact filtering; they are not trajectory or fit acceptance.

```sh
python3 docs/research/ppf-cpu/garment_repeatability_audit.py docs/research/ppf-cpu/results/garment-repeatability-one.zip --profile one
python3 docs/research/ppf-cpu/garment_repeatability_audit.py docs/research/ppf-cpu/results/garment-repeatability-four.zip --profile four
python3 -m unittest discover -s docs/research/ppf-cpu -p 'test_garment_repeatability*.py'
```

A separate [test-only mesh-order diagnostic](GARMENT_MESH_ORDER.md) tests the pinned source's unordered edge/hinge emission. It does not modify these baseline runs, prove their cause or authorize backend adoption. The declared repair experiment below establishes bounded saved-trajectory equality while preserving the original baselines.

## Declared canonical mesh-order experiment

The exact research patch passed the actual Rust RED→GREEN gate: both original ordering assertions fail, then all five repaired ordering/existing semantic tests pass. In [native run 39205289113](https://github.com/twangyal/projects-monorepo/actions/runs/39205289113), source `d56b1d61faa95b557fd61274db51c5d619ca367b`, both patched pairs complete with the same physical inputs/reference bytes and strict controls as the original experiment. The two archives retain another 244 real frames and 892 verified native files. Independent replay requires the exact patch receipt, original/patched source bytes, canonical diff, independently reconstructed upstream diff and recorded executable digest; the original-backend profiles refuse a declared research patch.

| Declared repair environment | Byte-identical paired frames | Maximum saved-vertex difference | All-saved vertex RMS |
| --- | ---: | ---: | ---: |
| Requested one thread | 61 / 61 | 0 mm | 0 mm |
| Requested four threads | 61 / 61 | 0 mm | 0 mm |

All four saved trajectories also match byte for byte across the two hosts, at every saved frame. The [matrix report](results/garment-canonical-matrix-audit.json) records cross-profile coordinate metrics and both recorded executable digests (which match). This is four sessions of one prepared garment/material over one second, not broad determinism, a population tolerance, calibrated material response, sustained settling or physical-fit acceptance. The small final interval speed (0.891 mm/s RMS) and final maximum seam gap (1.422 mm) remain bounded diagnostics. No shipping solver changes or backend adoption follow.

Frozen [canonical-one archive](results/garment-canonical-one.zip): 6,879,485 bytes, SHA-256 `694137f6ba4e64d4ef7412b9a114f41b753ea5c686555aae827b5b5b8ba5c23c`, artifact 12165876515. Frozen [canonical-four archive](results/garment-canonical-four.zip): 6,878,605 bytes, SHA-256 `becd330d2d7945a61f2c33fb680078d140699dc15818327f0480528ee9c7603b`, artifact 12166106392. Both match official GitHub artifact digests. Matching `*-audit.json` reports retain every raw-frame digest and endpoint/strain/seam metrics. Executable hashes are recorded CI digests; replay does not independently rebuild or retain those executables.

```sh
python3 docs/research/ppf-cpu/garment_repeatability_audit.py docs/research/ppf-cpu/results/garment-canonical-one.zip --profile canonical-one
python3 docs/research/ppf-cpu/garment_repeatability_audit.py docs/research/ppf-cpu/results/garment-canonical-four.zip --profile canonical-four
python3 docs/research/ppf-cpu/garment_repeatability_matrix.py
```

The matrix command re-audits both complete archives before comparing all four trajectories. The next gate is a controlled two-material comparison under the declared repair, followed by sustained settling/construction quality, representative garments/bodies and corresponding physical references. The unpatched material observations remain preserved and are not relabeled as patched evidence.
