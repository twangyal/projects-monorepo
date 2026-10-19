# Native garment repeatability control — #290

The accepted short and one-second experiments export identical inputs but their shared early trajectories differ by up to 16.961 mm (soft) and 26.706 mm (stiff). That prevents treating the observed two-material pair as a proven repeatable garment-material signal. The next bounded question is whether two fresh sessions with the same garment, initial/rest geometry, body, captured inertia, seams and material reproduce one another under explicitly recorded execution settings.

## Protocol

`garment_native_probe.py --same-material-control` runs independent `first` and `second` sessions, both normalized Young 500. It requires the previously admitted cleared warm pose, browser-inertia mapping, normal stitch forces and 60 intervals/61 saved frames. The ordinary soft/stiff defaults remain unchanged. No contact allowance, pattern-rest change, mass adjustment beyond the existing declared inertia mapping, or physical-material claim is introduced.

All five requested thread variables must consistently specify either `1` or `4`: `RAYON_NUM_THREADS`, `OMP_NUM_THREADS`, `OPENBLAS_NUM_THREADS`, `MKL_NUM_THREADS`, `NUMEXPR_NUM_THREADS`. These are inherited environment requests, not measurements of actual native workers. The new workflow runs the two configurations on separate CI hosts and retains CPU, affinity, compiler, dependencies, source hashes, complete raw sessions and requested settings. Each job keeps the 300-second fixture supervisor and a 25-minute outer bound; ordinary cancellation/outer-runner loss can still prevent collection. A configuration contrast across separate hosts does not establish a causal thread-count effect.

The dedicated branch `autonomous/clothing-ppf-garment-repeatability-290` triggers both matrix jobs. Manual dispatch runs the same fixed protocol. Independent review found no control/workflow blocker; focused RED/GREEN tests verify the case plan, required settings and rejection of changed preparation/mass/duration/stitches. Full source regression and actual native outcomes are recorded as they complete. Native results are currently pending; the presence of the harness does not establish repeatability.

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
