# Captured garment inertia mapping — issue289

The admitted sewing experiment used literal captured GSM in both native material cases. Raw native output reports197.8686g versus151.5794g in the captured browser particles:30.54% higher. Pinned upstream computes mass from initial three-dimensional triangle area; browser flat panels use projected XY area and modeled neckband triangles use three-dimensional area. Intrinsic rest area does not determine native mass. See [actual prior evidence](GARMENT_SEWING.md).

Pinned primary source: [native initial face areas](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-solver/src/main.rs#L295-L299), [native density-times-area mass](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-solver/src/scene.rs#L2595), and [captured browser area convention](../../../apps/clothing-studio/src/garment-drape.ts#L254-L255). These are implementation conventions, not evidence of calibrated fabric properties.

## Preparation

`garment_mass.py` admits the immutable capture and unchanged source correspondence, then derives an effective solver density for every face:

`effective_density = captured_GSM_density * captured_physical_area / prepared_native_initial_area`

The source GSM remains separately recorded as `captured_face_density`; these effective coefficients are not new measured fabric densities. Faces, intrinsic rest, UVs, sewing constraints, body and all other input fields retain their original values. Degenerate/nonfinite geometry or changed source correspondence is refused.

The [preparation receipt](results/garment-mass-preparation.json) predicts0.1515794236341101kg against0.15157942020794368kg captured. Every original source particle's mass is independently reconstructed from face contributions. Maximum relative error is4.642120092990254e-6, below the10ppm admission threshold. A global total-mass rescale would fail this distribution check.

The comparison namespace is the original2331-class seam quotient. The native cut mesh has2353 vertices connected by finite sewing constraints; equal aggregated lumped masses do not imply identical degrees of freedom, mass matrices or dynamics.

## Validation and remaining gate

Three new tests first failed against an unimplemented adapter; [RED evidence](results/garment-mass-red.txt) is retained. Tests reconstruct particle masses from returned solver coefficients and actual prepared geometry, verify source immutability and reject correspondence/degenerate input. The complete research suite passes88 tests in37.022s locally. Independent read-only review found no important issue.

The bounded native workflow now explicitly passes `--initialization sewing --mass-convention browser-inertia`. CLI default `captured-density` preserves the literal-GSM experiment and frozen archives. Both material cases still differ only in normalized Young modulus; current source hashes and the mass mapping receipt are retained in new evidence.

**Native matched-inertia execution and raw replay passed.** The fresh strict build/export/two-material run and complete raw mass/frame archive have been independently replayed; results follow below. No material calibration, settling, physical fit or engine adoption is accepted. Shipping application code is unchanged.

Canonical preparation commit `a89798b797ff08fed62e5772634ef831984a8a71` has tree `b3c5c8c1712c0be6dc8a18c1492283854d1f5c25`, identical to reviewed local `f26f6c4`. [Main harness39136476113](https://github.com/twangyal/projects-monorepo/actions/runs/39136476113), job117701893353, passes88 tests in33.790s; [main preflight39136476115](https://github.com/twangyal/projects-monorepo/actions/runs/39136476115), job117701892949, passes33 tests in36.016s.

## Actual native result — 2026-10-18

[Native run39136433639](https://github.com/twangyal/projects-monorepo/actions/runs/39136433639), job117701763953, succeeds on exact source `a89798b797ff08fed62e5772634ef831984a8a71`. Both scenes pass strict contact admission and exact exported-input checks. All38 frames/278 native files are retained and independently replayed, including raw timestamps0..0.3s, source hashes, metadata, finite coordinates and control equality. Only the Young-modulus native buffer differs between cases.

The [complete295-entry archive](results/garment-inertia-native.zip) is4,138,649bytes; SHA256 `e6fbf817f58861c8eff5465c0a20ae28e1372ac86c313b39efc46a65f3e0ed66`. [Machine-readable replay](results/garment-inertia-native-audit.json) and `garment_inertia_audit.py` reconstruct all measurements without reading session pickles. Run:

```sh
python3 docs/research/ppf-cpu/garment_inertia_audit.py docs/research/ppf-cpu/results/garment-inertia-native.zip
python3 -m unittest discover -s docs/research/ppf-cpu -p 'test_*.py'
```

| Saved-frame measurement | Soft Young500 | Stiff Young2000 |
|---|---:|---:|
| Maximum displacement |109.072mm|114.059mm|
| Final RMS displacement |54.923mm|58.708mm|
| Maximum absolute edge strain |439.709%|447.767%|
| Final maximum absolute edge strain |29.866%|19.997%|
| Final maximum sewing gap |1.423mm|1.444mm|
| Native case wall time |18.025s|20.022s|

Both begin with430.349% maximum edge strain and50.541mm maximum sewing gap. Final shape RMS difference is15.167mm. This remains a high-prestrain detached assembly experiment, not a calibrated material ranking or fit result. The build takes426.32s/1,427,176KiB peakRSS; the supervised fixture takes42.672s including cleanup (GNUtime42.71s,146,148KiB peakRSS), exits0 and leaves no children.

### Float32 diagnostic reduction is separate from physical mass

An initial raw replay correctly failed its10ppm check on `total_mass.out`; [failure evidence](results/garment-inertia-mass-diagnostic-red.txt) is retained. The pinned [main.rs312–313](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-solver/src/main.rs#L312-L313) sequentially accumulates face masses in float32 for this diagnostic. It does not accurately sum stored physical masses.

The auditor independently reconstructs float32 initial-coordinate differences, cross products, norm, face area and density multiplication from actual raw buffers. Accurately summing those face masses gives **0.15157942444511718kg**, only **0.028ppm** above captured **0.15157942020794368kg**. Sequential float32 accumulation gives **0.15158243477344513kg**, reproducing the printed **0.15158243kg** diagnostic (19.856ppm above capture). Both material cases match exactly.

The physical-mass admission remains10ppm. A separate diagnostic check requires agreement with the pinned ordered float32 calculation within2e-8kg (about one float32ULP plus decimal printing), rather than widening the physical criterion. Raw density bytes, mass receipt, missing frames, changed rest/controls/status, altered timestamps and reuse of the literal-density archive are all rejected by regressions. This matches source-quotient inertia; the cut native system's finite sewing constraints still differ from the welded browser dynamics.

Final local research verification passes92 tests in61.625s. Independent read-only review replays the complete archive, passes all four focused tests and independently aggregates actual raw-bin float32 face masses through the original seam quotient: maximum per-source-particle error5.12ppm. No remaining important findings; actual DOF equivalence and physical fit remain unaccepted.
