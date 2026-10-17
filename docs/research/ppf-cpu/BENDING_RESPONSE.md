# Native CPU cantilever bending response (#287)

The owner-requested PPF evaluation now tests bending sensitivity separately from the contact experiments and [normalized membrane experiment](TENSILE_RESPONSE.md). This is not physical fabric calibration or a selected shipping backend. The responsive application remains unchanged and ACTIVE.

## Frozen before native execution

Upstream is Apache-2.0 `6b30976f86e6b94d68d459e5237d59704c7d1384`, real locked Rust CPU. `bending_metrics.py` generates a horizontal10×3cm strip inXZ,44vertices/60ordered triangles. The first two crosswise rows (eight vertices) are hard clamped at their rest positions; the outer row is the free tip. Four simulated seconds produce frames0..400, including rest, at100fps/dt.01s.

| Case | Normalized bend | Normalized young-mod | Areal density kg/m² |
| --- | ---: | ---: | ---: |
| soft |1|100000|1|
| stiff |1000|100000|1|

All other controls are shared: Baraff-Witkin,nu.3,strain-limit0,deformation-damping.02seconds,bending-damping.05seconds,gravity9.8m/s²,block-Jacobi,air-density0,contact disabled. No shrink, plasticity or pressure; zero initial velocity and authored UVs. Upstream uses per-face fallback tangent bases; scalar isotropic bending avoids a warp/weft interpretation. The wide coefficient contrast deliberately tests sensitivity; these are not names or calibrated equivalents of library fabrics.

The pinned [bending kernel](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-solver/src/kernels/energy/model/shell_bend_stiffness.kernel.cpp) scales hinge stiffness by `1.28e−5 * directional_bend * edge_length²/(adjacent_rest_area_sum) * areal_density`. Its wire bend number is neither measured flexural rigidity nor browser XPBD compliance. Damping is an explicit numerical choice, not a measured textile property. The membrane coefficient is deliberately high to limit extension, rather than being a calibrated material pairing.

**Gates declared in issue287 before execution:** exact401finite frames/case; clamp drift≤1µm; maximum adjacent-frame vertex movement across final20savedframes≤10µm; maximum tensile native-edge strain across every saved state≤2%; final soft tip descent>.04m and<.11m; stiff descent>0 and<.03m; soft>2×stiff. A failed gate stays failed and must not be loosened after results.

Tip descent is negative meanY of the last four authored vertices relative to the horizontal rest. Edge strain is current3D length/rest length−1 for every unique triangle edge, with maximum taken across every saved frame. It is a tensile-edge bound, not principal strain, an inversion/self-contact test or physical material acceptance. Settling is at saved-frame resolution only; four seconds and one mesh/timestep do not prove continuous equilibrium or numerical convergence.

## Reproduction and independent evidence

```
python -m unittest discover -s docs/research/ppf-cpu -p 'test_*.py'
python docs/research/ppf-cpu/bending_audit.py ARCHIVE.zip --sha256 EXPECTED_SHA256
```

The dedicated `.github/workflows/clothing-ppf-bending.yml` runs only its source branch or explicit dispatch; no native research rerun is imposed on ordinary main pushes. The300second supervisor owns the process group, and collection occurs outside it after success/failure/timeout. Every native input, output, log and raw frame is retained with SHA256/byte manifest. The workflow's inherited fixture-step wording mentions density; this experiment actually has the two bend-only cases above and does not run a density control.

The standard-library audit never unpickles artifacts. It verifies checksum/full manifest, upstream/source identity, actual float64 rest/zero displacement, float32 zero velocities/UVs, ordered uint64 topology/object mapping, exact uint64 eight-vertex clamp and hard stationary pin settings, all material coefficients (including bending damping.05), session parameters and complete raw output namespace. It compares every native input filename/buffer and the entire session TOML across controls: only `tri-bend.bin` may differ. Recomputed raw-frame metrics must equal the receipt and pass the frozen gates.

## Verification history

Five analytical tests first failed against a stub oracle, then passed after measurement implementation. Tests subsequently cover rigid translation preserving edge strain, exact1%affine extension and malformed vertex cardinality. Archive corruption cases cover missing inputs/frames, wrong maps/material/topology, changed triangle order, pin membership/pull/operations/overrides, velocity/UV, undeclared static geometry and manifest corruption. An added cross-control test genuinely failed before the checker existed, then passed when extra changed native buffers were refused.

Source `5c013a9056f1c0a0a3459c3617573c90bae07b61` launches native CI39077437821. All41then-current harness tests pass locally; the completed native evidence and later replay suite will be recorded after execution. Initial source review found no important probe/measurement blocker; its warning about accidentally copying tensile's zero bending-damping override was applied to the audit before native admission.

Bending accuracy against specimens, physical property mapping, directional calibration, continuous contact, garment/seam/layer behavior, native compute UX and runtime scaling remain open.

Audit review reproduced a further important input gap: alternate-rest flags and shell-classification metadata were ignored. Six metadata mutations passed before repair, then refused after exact checks for rod/shell ranges/counts and every alternate-rest flag/frame count. The same regression/fix is applied to the tensile auditor; replay of its original archive still passes with unchanged metrics. Bending control comparison also checks the entire parsed native metadata, ignoring only generated pin-group identities. [Actual RED evidence](results/bending-regression-red.txt) retains the analytical/control/metadata failures.


## Actual native result and independent acceptance

[Native CI39077437821](https://github.com/twangyal/projects-monorepo/actions/runs/39077437821), job117527407602, passed on2026-10-17 at source `5c013a9056f1c0a0a3459c3617573c90bae07b61`, with41then-current harness tests. Final local harness54/54 and both actual tensile/bending archive replays pass. All frozen bending gates passed unchanged.

| Actual metric | soft | stiff |
| --- | ---: | ---: |
| Tip descent mm |89.8187868|9.0553085|
| Maximum tensile edge strain over every saved state |0.166426%|0.031777%|
| Maximum clamp drift m |4.0295176e−10|4.0295176e−10|
| Final20-frame maximum adjacent movement m |5.4048814e−8|0|

The geometric deflection ratio is approximately9.919, not the coefficient ratio1000; nonlinear large deflection is not a calibrated beam test. Independent replay verifies **1764nativefiles,802rawframes and105864finite float32 coordinates**. Independent inspection of all30native input buffers per case confirms only `tri-bend.bin` differs; session TOMLs are byte-identical and metadata differs only in generated pin identity.

Durable evidence: [original archive](results/bending-first.zip), [complete receipt/manifest](results/bending-first.json), [replayed audit](results/bending-first-audit.json). Archive1380774bytes, SHA256 `8df6a44235f9e9fb3b6c02caa011393d36c5e333bd24feba5b47792c31090c6e`; artifact12117546982.

Build411.90seconds; fixture preparation/analysis and two native cases3.164061291seconds, per-case1.28024644/1.101162455seconds; supervisor including cleanup3.287655966seconds, exit0, zero remaining children. Maximum per-process RSS1424736KiBbuild/76960KiBfixture, not aggregate process-tree peak. These small fixtures are not garment-runtime benchmarks. No application/native compute upload path or paid service was introduced.

This admits distinguishable settled normalized bending response at this mesh/timestep/damping configuration. It does not admit physical textile stiffness, directional calibration, numerical convergence, continuous contact, seam/layer behavior or garment accuracy. Next material-physics work should preserve actual pattern rest geometry, UVs, seams and body contact in a fixed garment/two-material comparison with explicit provenance and reference validation; no coefficients are silently copied into browser compliance.
