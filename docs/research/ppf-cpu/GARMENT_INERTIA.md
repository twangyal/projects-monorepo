# Captured garment inertia mapping — issue289

The admitted sewing experiment used literal captured GSM in both native material cases. Raw native output reports197.8686g versus151.5794g in the captured browser particles:30.54% higher. Pinned upstream computes mass from initial three-dimensional triangle area; browser flat panels use projected XY area and modeled neckband triangles use three-dimensional area. Intrinsic rest area does not determine native mass. See [actual prior evidence](GARMENT_SEWING.md).

## Preparation

`garment_mass.py` admits the immutable capture and unchanged source correspondence, then derives an effective solver density for every face:

`effective_density = captured_GSM_density * captured_physical_area / prepared_native_initial_area`

The source GSM remains separately recorded as `captured_face_density`; these effective coefficients are not new measured fabric densities. Faces, intrinsic rest, UVs, sewing constraints, body and all other input fields retain their original values. Degenerate/nonfinite geometry or changed source correspondence is refused.

The [preparation receipt](results/garment-mass-preparation.json) predicts0.1515794236341101kg against0.15157942020794368kg captured. Every original source particle's mass is independently reconstructed from face contributions. Maximum relative error is4.642120092990254e-6, below the10ppm admission threshold. A global total-mass rescale would fail this distribution check.

The comparison namespace is the original2331-class seam quotient. The native cut mesh has2353 vertices connected by finite sewing constraints; equal aggregated lumped masses do not imply identical degrees of freedom, mass matrices or dynamics.

## Validation and remaining gate

Three new tests first failed against an unimplemented adapter; [RED evidence](results/garment-mass-red.txt) is retained. Tests reconstruct particle masses from returned solver coefficients and actual prepared geometry, verify source immutability and reject correspondence/degenerate input. The complete research suite passes88 tests in37.022s locally. Independent read-only review found no important issue.

The bounded native workflow now explicitly passes `--initialization sewing --mass-convention browser-inertia`. CLI default `captured-density` preserves the literal-GSM experiment and frozen archives. Both material cases still differ only in normalized Young modulus; current source hashes and the mass mapping receipt are retained in new evidence.

**Native matched-inertia execution is pending.** Issue289 remains open until a fresh strict build/export/two-material run is completed and actual raw mass, frames, limits and full archive are independently replayed. Predicted mass agreement is not a native success receipt. No material calibration, settling, physical fit or engine adoption is accepted. Shipping application code is unchanged.
