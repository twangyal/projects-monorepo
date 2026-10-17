# Native CPU normalized tensile response (#285)

This is a synthetic membrane response experiment for the owner-requested PPF investigation. It does not calibrate Clothing Studio's fabric library or select a new shipping engine. The app remains unchanged and ACTIVE.

## Why normalization matters

All source references below are pinned to upstream `6b30976f86e6b94d68d459e5237d59704c7d1384` (Apache-2.0). These are source-derived conclusions, separate from the native measurements.

- [`params.rs`](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-core/src/datamodel/params.rs) defines shell `density` in **kg/m²** and describes `young-mod` as density-normalized. **180GSM =0.180kg/m²**; upstream preset1kg/m² is1000GSM, not1GSM.
- [`scene.rs`](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-solver/src/scene.rs) forms shell face mass as `density * rest_area`. [`builder.rs`](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-solver/src/builder.rs) lumps one third of each face mass into each vertex and converts the wire stiffness `Yhat` and parameter `nu` into `muhat=Yhat/[2(1+nu)]`, `lambdahat=Yhat*nu/[(1+nu)(1−2nu)]`.
- [`baraffwitkin.hpp`](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-solver/src/kernels/energy/model/baraffwitkin.hpp) uses dimensionless deformation-gradient columns `fu,fv` with normalized energy `W_hat=.5*muhat*((|fu|−1)²+(|fv|−1)²)+.5*lambdahat*(fu·fv)²`. The [`face-force path`](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-solver/src/kernels/energy/face_force.kernel.cpp) passes the face mass as the elastic multiplier.
- Therefore the shell membrane energy scales as **rest area × areal density × normalized energy**. Dimensional inference: normalized membrane energy has unitsJ/kg=m²/s², and areal-density times normalized tangent stiffness has unitsN/m. The generic upstream “Pa/rho” wording must not be read as a directly measured shell Young's modulus inPa. A continuum thickness/material model would be needed to relateN/m toPa, and this constitutive law/parameter conversion is not by itself a textile calibration or measured Poisson ratio.
- [`shell_bend_stiffness.kernel.cpp`](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-solver/src/kernels/energy/model/shell_bend_stiffness.kernel.cpp) forms hinge stiffness as `1.28e−5 * directional_bend * edge_length²/(adjacent_rest_area_sum) * areal_density`. Its normalized `bend` number is not an SI flexural rigidity or the browser XPBD compliance.

Changing density alone while leaving normalized coefficients fixed scales inertia, gravity and elastic response together in this isolated no-air/no-contact case. It does **not** independently test heavier fabric at fixed physical membrane rigidity. That would require inversely changing normalized coefficients (including bending) and separately testing the selected constitutive model. Contacts/external loads/air may break this invariance. No coefficient is copied into the shipping solver.

The upstream [tensile calibration](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/calibration/tensile/README.md) motivates hanging strips but uses a different mesh, gravity, strain limiter and CUDA reference results. Its named-fabric percentages are not our native CPU measurements or physical specimens.

## Frozen protocol

`tensile_metrics.py` owns the frozen mesh and controls; `tensile_probe.py` executes them. The explicit strip spans20×3cm,21rows×4columns,84vertices/120triangles. The top row's four vertices are pinned; restgauge is the top-row meanY minus bottom-row meanY, exactly.2m. No static collider is present. No authored UV/material direction is supplied; upstream's per-face tangent basis varies with triangle first-edge orientation. No globally oriented warp/weft result is claimed.

| Case | Normalized young-mod | Areal density kg/m² | Other controls |
| --- | ---: | ---: | --- |
| soft |500|1| shared |
| stiff |2000|1| shared |
| density |500|.18| shared |

Shared: Baraff-Witkin,nu.3,bend1,strain-limit0,deformation-damping.02seconds, no shrink/plasticity/pressure; gravity100m/s²,dt.01seconds,fps100,150simulation frames+rest,block-Jacobi,air-density0,contact disabled. This amplified-gravity material test is not a normal garment-wearing condition. Numerical tolerances and other defaults remain those of the pinned upstream and are retained in native parameters/logs.

**Declared before execution:** exact151finite frames/case; topclamp drift≤1µm; maximum adjacent-frame vertex movement across final20savedframes≤10µm; final gauge extension positive and<15%; soft extension>1.5×stiff; maximum density-only coordinate difference across **all** corresponding saved vertices/frames≤.1mm. No gate will be loosened after observing results. Failure remains evidence and requires a separately described follow-up.

Metrics include final row-mean vertical gauge extension, maximum vertical row-segment strain across all frames (not principal triangle strain), clamp drift, final-window maximum step and extension range. Settling is only at saved-frame resolution, not a continuous equilibrium or convergence proof. One mesh/timestep cannot establish resolution/time-step independence. Damping is explicit and not a measured fabric property.

## Reproduction and evidence

Workflow `.github/workflows/clothing-ppf-tensile.yml` runs only the named short-lived source branch or explicit dispatch. It builds locked real Rust CPU and uses the existing300second process-group supervisor. Collection runs outside the supervisor after success/failure/timeout, and uploads complete raw outputs/logs/inputs with per-fileSHA256 and sizes.

```
python -m unittest discover -s docs/research/ppf-cpu -p 'test_*.py'
python docs/research/ppf-cpu/tensile_audit.py ARCHIVE.zip --sha256 EXPECTED_SHA256
```

The standard-library auditor verifies archive checksum, complete native manifest, revision/source identity, actual float64 rest, ordered uint64 topology/object maps, zero float32 velocities/UVs, exact uint64 top-clamp membership, stationary hard-pin settings, float32 per-face material buffers and session parameters, exact output set, rest permutation and raw float32 frames. It recomputes gates rather than accepting summary metrics and never unpickles retained artifacts.

Native CI [39059244644](https://github.com/twangyal/projects-monorepo/actions/runs/39059244644), job117473677570, passed at corrected source `f065269d136f176c647991d81a5b604298a12a61` on2026-10-17. It executed27 then-current harness tests; the final replay/review suite passes36 locally. [Original archive](results/tensile-first.zip), [complete receipt/manifest](results/tensile-first.json) and [independent audit](results/tensile-first-audit.json) are durable. Archive1118645bytes, SHA256 `95c6daa5028cf099d81e2f7574c148790dfa0b35876abeba11d5808436a71cae`; artifact12110189102.

| Actual metric | soft | stiff | density |
| --- | ---: | ---: | ---: |
| Final gauge extension |5.199842%|1.299966%|5.199842%|
| Largest vertical row-segment strain across saved frames |10.140070%|2.534927%|10.140070%|
| Maximum clamp drift m |2.9990322e−9|2.9990322e−9|2.9990322e−9|
| Final20-frame largest adjacent movement m |3.4927847e−10|4.9778237e−13|4.6566283e−10|

The soft/stiff extension ratio is approximately4.000, with only normalized stiffness changed. The density-only maximum coordinate difference over all151frames is4.5775702e−8m; final gauge extensions match. All declared gates passed without changing their bounds. Independent replay verifies **1146nativefiles,453frames and114156finite float32 coordinates**. An independent reviewer also compared every native input filename/buffer: density versus soft changes only `tri-density.bin`; stiff versus soft changes only `tri-young-mod.bin`; session parameter TOMLs are identical.

Build wall366.86seconds; fixture preparation/three cases/analysis3.826936969seconds, native per-case wall1.1371/1.0527/1.0522seconds. Supervisor including cleanup3.981589689seconds, exit0, zero remaining children. Reported per-process maximum RSS1425260KiB build and77268KiB fixture; these are not aggregate process-tree peaks or garment-runtime benchmarks. Both native error logs and initial upstream working status were empty; no paid compute or app uploads were introduced.

This admits normalized membrane sensitivity and density invariance for one frozen fixture at one numerical configuration. It does not admit physical materials, UV/grain calibration, bending accuracy, resolution/time-step independence or garment performance.

## Verification history

Six analytical metric tests ran against a deliberate stub: five assertion failures, with the zero-rest control passing. Implemented metrics passed all six. Read-only review found a workflow/probe PASS-marker mismatch; an added regression failed against the wrong marker and passed after correction. Initial source CI39059194774 was canceled during dependency installation before native build/physics; it contains no material result. Corrected sourcef065269d136f176c647991d81a5b604298a12a61 runs native CI39059244644. Replay/manifest corruption tests use synthetic evidence and do not count as native measurements.

Review confirms the intended per-face tangent limitation. Physical specimen validation, directional calibration, bending response, garment/seams/body/layers and usable native compute integration remain future work.

Audit review also exposed missing pin membership/velocity validation and triangle-order loss. Retained [actual RED regressions](results/tensile-regression-red.txt) reproduce those omissions and altered material UV acceptance; repaired replay now checks actual pin indices/settings, no operations/pull overrides, zero velocities/UVs and ordered triangles. All36 harness tests pass locally.

Follow-up #287 strengthens the reusable tensile auditor to verify every native rod/shell-classification range/count and alternate-rest flag/frame count. Six real metadata mutations reproduced missing admission checks before repair. The original #285 archive passes the stricter replay unchanged; original native results and physical limits stand. These additional oracle regressions are local verification, not a new native run.
