# Actual garment native admission (#288)

The actual fixed tee, cut-rib rest candidate and closed static-body candidate have now reached the real pinned native frontend. **The original initialization is refused; no garment solver motion is accepted.** Clothing remains ACTIVE and its browser solver is unchanged.

## First strict attempt: 2026-10-18

[Source a9837ad](https://github.com/twangyal/projects-monorepo/commit/a9837ad7b46f517a9738cc021dde4b2dfe5f5366), [native run39114026348](https://github.com/twangyal/projects-monorepo/actions/runs/39114026348), upstream `st-tech/ppf-contact-solver@6b30976f86e6b94d68d459e5237d59704c7d1384` (Apache2).

The locked CPU backend built successfully in424.61s, peak RSS1,424,696KiB. The actual scene builder then refused the unchanged captured initialization with26 triangle intersections and265 too-close element pairs. Fixture wall1.439s; supervised wall including cleanup1.730s; exit1 and zero remaining children. These times measure a refused scene, not garment simulation latency.

All26 intersection pairs are retained and map to14 front/collar,11 back/collar and one collar/collar. The proximity report retains only100 of its265 pairs:98 front/collar and two front/left-sleeve. Those samples do not classify the other165 pairs. Zero solver frames/native-cache files were produced; no native export or two-material comparison ran.

The complete [531,158-byte failure archive](results/garment-strict-first.zip) includes frozen blueprint, full diagnostic, logs, dependency lock, license, environment and resource records. SHA256 `582e4b7593d608f90fb238f631e2492f548cbd3d85b698a03ce537397ffb5a15`. [Independent audit](results/garment-strict-first-audit.json) checks that checksum, exact original inputs, frozen source hashes, failure stage, log corroboration, clean upstream and absence of solver output. It never loads pickle.

```sh
python docs/research/ppf-cpu/garment_native_refusal.py docs/research/ppf-cpu/results/garment-strict-first.zip
python -m unittest discover -s docs/research/ppf-cpu -p 'test_*.py'
```

## Controlled initialization follow-up

[Source5dc38f1](https://github.com/twangyal/projects-monorepo/commit/5dc38f14141b15d562e74851fc85e33768751572), [native run39115026324](https://github.com/twangyal/projects-monorepo/actions/runs/39115026324). **This follow-up also refuses scene construction, before native export or solver execution.**

The original padding places0.0035m offset on the cloth and0 on the body. The control redistributes that to0.00025m cloth/0.00325m body, preserving their combined clearance and keeping contact enabled. First try scene admission with only that change and the original pose. Then move only42 collar initial vertices5mm along outward area-weighted normals, plus±2mm tangentially at the two cut rows; preserve the original rest metric, ordered topology/UVs, captured density, static body and22 stitch correspondences. Every initialized stitch distance is5.000–6.255mm. This is a declared changed initialization, not evidence that the original captured pose works.

All native contact/intersection checks remain enabled. No existing-intersection allowances are introduced. A second review added a pre-execution check of actual exported arrays, including original intrinsic rest vertices, masses/densities, stitch ABI, two object displacement rows, object maps, body geometry, static offsets and effective session controls. The frozen first attempt predates that checker and did not reach native export.

The two normalized Young coefficients500/2000 and bend20 are synthetic comparison controls, not measured fabric values. The attempted18-frame+rest protocol covers0.3s and can establish bounded motion only; settling, seam quality, calibrated material separation, actual fit and native engine adoption remain unaccepted. A refusal or timeout stays a failure even when all local preparation tests pass.

### Observed follow-up result

The padding-only control retains all26 original intersections and reports173 proximity pairs (100 retained samples:82 front/collar and18 back/collar;73 unclassified pairs). The separated initialization reports19 intersections (13 front/collar,6 back/collar) and seven proximity pairs (all seven retained, all front/collar). Removing the collar/collar cut intersection does not admit the remaining collar/panel surface intersections. Reduced counts are not a pass.

The locked CPU build took330.70s, peakRSS1,426,940KiB. Fixture wall1.706s, supervisor wall including cleanup2.075s; exit1,zero remaining children,zero native files/frames. Neither Young coefficient ran. These are failure/admission timings, not solver latency.

The full [1,028,390-byte second archive](results/garment-initialized-first.zip), SHA256 `392171f0f69ba5b06c1f2312b0695770587bea1beb2f2c86a4e6fa780594e379`, retains both original and changed blueprints, both diagnostics and complete build/environment/log/resource evidence. [Independent replay](results/garment-initialized-first-audit.json) reconstructs the exact declared initializer and checks original inputs, controls, frozen source hashes, complete-versus-sampled counts and absence of solver output. Four refusal tests replay both archives and reject altered blueprints, controls, receipts and forged output. The full research suite passes78 tests in18.072s.

```sh
python docs/research/ppf-cpu/garment_native_refusal.py --initialized docs/research/ppf-cpu/results/garment-initialized-first.zip
```

## Remaining admission gate

Keep #288 open. Resolve the actual collar/panel surface compatibility while preserving the authored intrinsic metric, source face provenance and semantic sewing correspondence; a different contact-compatible initialization or explicitly reviewed remeshing must earn strict native admission. The experiments show that padding redistribution alone cannot resolve the26 original intersections, and this normal-offset/cut separation still leaves19 panel intersections. Do not keep increasing arbitrary offsets or disable contact/intersection checks to force a pass. Native rest/stitch byte verification and the two-material motion/strain/settling measurements remain unexecuted. Physical fabric calibration, anatomical fit and engine adoption remain separate unaccepted work.
