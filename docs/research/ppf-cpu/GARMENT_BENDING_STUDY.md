# Fixed-garment bending-only diagnostic (#290)

## Question and frozen protocol

Does the persistent underarm extension in the existing prepared tee depend strongly on the normalized isotropic bending coefficient? The fresh reference uses the existing20; the explicit diagnostic uses0. Zero bending is an isolation control, not a calibrated fabric, proposed production setting or construction fix.

Both sessions retain the original cleared browser-warm preparation, normalized membrane Young500, original rest geometry and correspondence, captured source-quotient inertia, static body, seams, normal gravity, configured dt1/120,180intervals/181saved frames and requested-four environment. The exact canonical mesh patch is unchanged. Each supervisor retains its300-second limit and process cleanup; all outcomes retain native inputs/logs/available frames.

Only `param/tri-bend.bin` may differ between paired native inputs. All other arrays, scene/session metadata and recorded executable digests must match before interpreting the pair. In particular, do not change directional bend overrides, damping, mass, contact/barrier checks or stitch forces. Keep the prior preparation, gravity, half-step and original failure archives immutable. No new shipping solver or preset is enabled.

The source investigation found both4480cloth friction entries and39144static-body friction entries in the retained preparation reference are already0. A zero-friction study would duplicate that baseline; it is not being launched. `air_friction` in session metadata is a separate control, and session air density remains0.

The pinned [hinge-stiffness kernel](https://github.com/st-tech/ppf-contact-solver/blob/6b30976f86e6b94d68d459e5237d59704c7d1384/crates/ppf-cts-solver/src/kernels/energy/model/shell_bend_stiffness.kernel.cpp) uses the scalar isotropic/directional coefficient in both the elastic block and its stiffness-proportional lagged Rayleigh damping block. With directional overrides already0, setting bend0 removes that shared stiffness scale; it does not independently isolate elastic stiffness from proportional damping. All exported damping controls remain unchanged. This is a normalized constitutive-block sensitivity experiment, not a measured flexural rigidity comparison.

## Admission and reporting

Strict replay will verify official archive digests, complete manifests, pinned source/patch/environment, exact original/prepared blueprints, native parameters, all finite raw frames/times, completion and cleanup. It will report principal strain at saved frames0/1/6/18/60/120/180, final edge strain/seam gaps, saved-motion windows and endpoint surface queries, plus every saved-coordinate difference across the pair. A timeout or admission failure remains incomplete evidence rather than a completed garment experiment.

Different host models or dependencies must be recorded and constrain causal effect-size and runtime claims. One pair cannot establish broad determinism, sustained settling, continuous-time contact, representative garment/body support, physical fabric/fit or engine adoption. Original rest lengths must not be rewritten to conceal strain.

## Actual native outcomes — 2026-10-21

Both jobs in [run39614308606](https://github.com/twangyal/projects-monorepo/actions/runs/39614308606), frozen source `40169bbef9697a36c66a6eee82f725442fed63e5`, complete181frames under unchanged300-second supervisors with no remaining children. Strict independent replay verifies463native files per archive. Of46native input arrays, exactly `param/tri-bend.bin` differs, with4480values20/0; all other physical arrays and scene/session metadata match. Recorded executable digests and Python-dependency hashes match. The fresh reference also matches all181saved frames of both retained duration controls byte for byte.

| Saved observation | Bend20 reference | Bend0 diagnostic |
| --- | --- | --- |
| Initial peak absolute principal strain | 47.891% | 47.891% |
| Final peak principal strain (extension) | 40.885% | 37.665% |
| Final area-weighted95th percentile | 6.438% | 6.351% |
| Final maximum intrinsic-edge strain | 31.196% | 29.056% |
| Final maximum collar stitch gap | 1.422mm | 1.424mm |
| Last saved interval maximum secant speed | 7.506mm/s | 3.782mm/s |
| Supervisor wall time including cleanup | 128.901s | 90.596s |

Both final peaks remain at native triangle3091, source back1173, vertices1639/1640/643. The final shape RMS difference is3.645mm; maximum saved vertex separation is108.798mm and maximum frame RMS difference15.595mm. Only the initial coordinate frame matches. Zero bending changes the observation but does **not** eliminate the persistent underarm extension. This does not establish a physical defect, uniquely identify construction/contact causes, or recommend removing bending in production.

Both endpoints have zero violations in the unchanged3.5mm cloth/body and0.5mm collar/shirt surface queries. These do not verify cloth self-contact, continuous-time contact, sustained settling or physical fit. Reference ran on EPYC7763 and zero on EPYC9V45; separate host models preclude attributing precise effect sizes or timing differences solely to the coefficient. One garment, normalized coefficients and fixed preparation do not establish physical material calibration or representative coverage.

Complete official archives are retained losslessly with exact GitHub digests:

- [Reference](results/garment-bending-reference.zip): artifact12353101645,7321849bytes, SHA256 `c7edb7b9f76d2db02764bc441b383c4d9620aa24ee4cbde3578527afdca1962d`.
- [Zero](results/garment-bending-zero.zip): artifact12351214805,7327424bytes, SHA256 `fce2e99016a84d7e1278296aa5eaa6b0f4a01af08da86f602baa6b83d99bd461`.

[Full comparison receipt](results/garment-bending-comparison.json) retains all saved-coordinate differences, principal-strain checkpoints, per-part construction diagnostics, endpoint/motion windows and host/dependency fingerprints. Reproduce with `python docs/research/ppf-cpu/garment_bending_comparison.py docs/research/ppf-cpu/results/garment-bending-reference.zip docs/research/ppf-cpu/results/garment-bending-zero.zip`. The official retained-pair regression requires exact derived-receipt equality, full frames and cleanup. Prior failures and controls stay immutable.

The next useful construction milestone should use a declared source-construction alternative or distinct contact hypothesis, preserving original references. Further bending/preparation parameter polish alone does not deliver the missing construction or physical-fit experience. #290 stays open; Clothing remains ACTIVE at `apps/clothing-studio`, the shipping solver remains unchanged, and project #8 stays skipped.
