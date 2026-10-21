# Clothing startup-preparation integration — #290

Canonical implementation and complete evidence: `8977a446ad2a0991d438bcbbccdfdca915e56a91`, tree `b98919fc50f215faf8d6a2f9b29c8f998337afc9`.

The source protocol was frozen at `319e0f494a4ada59e26101c5def902dab7db8d46` before native outcomes. Reconstruction, localization and paired replay tooling was integrated at `d7c4fabe4cedc10450bf5c20f3f22f062d9959c2`. No PR was opened; `main` is canonical.

## Delivered and measured

- Eight source-derived startup stages localize the initial compression change while preserving original rest geometry, seams, body and correspondence. The reconstructed reference float32 handoff matches every coordinate of a retained actual native frame0.
- Twelve exploratory static controls remain recorded, including worse results. The selected candidate uses three synchronous self-plus-one-ring unit-direction passes, a50/50 blend with the original direction and the existing5mm displacement. It passes the unchanged6mm float32 body-clearance gate. Selection was exploratory, not preregistered.
- [Actual native run39574712580](https://github.com/twangyal/projects-monorepo/actions/runs/39574712580) completes both fixed-soft reference/smoothed sessions under separate unchanged300-second supervisors:362raw frames,926verified native files, no remaining children.
- Complete official ZIPs are retained losslessly and match GitHub's size and SHA256 metadata. Strict replay reconstructs the exact initial poses, density mapping, original rest/body/stitches/contact, source hashes, manifests, all raw frames and session controls. Exactly two of46input arrays differ: initial vertices and effective-density coefficients preserving captured source-quotient inertia. Recorded executable digests and Python-dependency hashes match.
- Startup peak absolute principal strain changes47.891%→42.015%, but final peaks40.885%/40.849% remain at underarm triangle3091. Final shape RMS difference is0.043863mm. Thus this candidate lowers initial compression but does not resolve the persistent final extension in this fixture.
- Reference EPYC9V45 and candidate EPYC7763 hosts differ. Wall times83.804s/131.210s are observations, not causal performance comparisons. Matching recorded binary digests do not independently rebuild or retain executables.

[Full protocol, results, controls and replay commands](research/ppf-cpu/GARMENT_PREPARATION.md) and [derived comparison](research/ppf-cpu/results/garment-preparation-comparison.json).

## Verification

Before official artifact registration, the expanded local research suite passed209tests in349.817s. New helper/protocol/audit tests preserve earlier protocol rejection; the selected numeric helper also has an independent high-precision oracle. Tooling main CI passed209research tests and152garment checks: [research39575918947](https://github.com/twangyal/projects-monorepo/actions/runs/39575918947), [preflight39575918921](https://github.com/twangyal/projects-monorepo/actions/runs/39575918921).

The official retained-pair regression first rejected the missing/unregistered candidate, then passed strict complete replay in18.800s. All13focused preparation tests passed34.453s after both archives and the exact derived receipt were registered. Independent review found no blockers in implementation, exploration, controls, actual results or documentation. `git diff --check` passed.

Final canonical main CI on the complete implementation/evidence commit passes:

| Gate | Actual result | Run |
| --- | --- | --- |
| Research harness | 210tests,493.940s | [39577532733](https://github.com/twangyal/projects-monorepo/actions/runs/39577532733) |
| Garment preflight | 153tests,476.800s; complete capture/source/warm/rest/body reproduction | [39577532677](https://github.com/twangyal/projects-monorepo/actions/runs/39577532677) |
| Application | 163unit tests,209production browser cases; lint/types/build | [39577532763](https://github.com/twangyal/projects-monorepo/actions/runs/39577532763) |

This closing receipt is a root-documentation-only follow-up; the tested implementation and evidence remain exactly those at8977a446. No additional simulation or full local suite beyond the recorded checks is claimed.

## Remaining work

#290 remains open. Prefer a declared source-construction alternative or distinct isolated contact control over more smoothing-parameter polish. Neither persistent zero-gravity strain nor this nearly unchanged final shape identifies a unique construction, bending, contact or pose cause. Preserve frozen rest lengths and every prior failure.

Sustained settling, representative garments/body settings, physical material/fit references and shipping-engine adoption remain unverified. The shipping application still uses its existing browser-worker XPBD solver. Clothing remains ACTIVE at `apps/clothing-studio`. Project #8 remains skipped; owner-deferred projects remain untouched.
