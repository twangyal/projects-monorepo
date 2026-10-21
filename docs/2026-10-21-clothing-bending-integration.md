# Fixed-garment bending diagnostic integration — #290

Canonical implementation and complete evidence: `907287003732f9496c7769efa8243afd0af8e92b`, tree `329b578d583f3aed530dd3d7067d44458a711941`.

The native protocol was frozen at `40169bbef9697a36c66a6eee82f725442fed63e5` before outcomes. Source and strict replay were integrated at `9d3eacf5f0dbfd0085c0a825a5c41386b875ba11`. No PR was opened; `main` is canonical.

## Intent and controls

Continue the owner's material-dependent garment-physics investigation with a distinct constitutive-block control. Earlier configured-step, gravity and smoothed-startup observations do not identify a unique cause of persistent underarm extension. This pair compares the existing normalized bend coefficient of 20 with an explicit zero coefficient, preserving the original cleared warm pose, rest geometry, captured source-quotient inertia, membrane Young 500, static body, stitches, gravity, timestep and contact checks. Zero bending is a diagnostic, not a calibrated fabric, production preset or construction fix.

Inspection found that the retained preparation reference already has zero cloth/body friction, so a zero-friction run would duplicate that baseline. The pinned hinge stiffness also scales its proportional lagged Rayleigh block: one bend coefficient changes that coupled block, rather than elastic stiffness independently of proportional damping. Exported damping controls remain unchanged.

## Actual native evidence

[Native run 39614308606](https://github.com/twangyal/projects-monorepo/actions/runs/39614308606) passes both 212-test source gates and both strict native sessions. Each retains 181 frames and 463 verified native files, complete official ZIP bytes matching GitHub size/SHA metadata, and no remaining child processes. Supervisors take 128.901s for the reference and 90.596s for zero bending, both within unchanged 300-second limits.

Strict pair replay permits exactly `param/tri-bend.bin` to differ among 46 arrays. Scene/session metadata, recorded executable digests and Python-dependency fingerprints match. The fresh reference reproduces all 181 frames of both retained duration controls. Final peak principal strains of 40.885% and 37.665% persist at underarm triangle 3091; final shape RMS difference is 3.644778 mm. Maximum saved vertex separation is 108.797747 mm, and maximum frame RMS difference is 15.595289 mm. Every paired-frame metric, principal-strain checkpoint, construction gap and endpoint/motion window remains recorded.

Different reference EPYC 7763 and zero-bending EPYC 9V45 hosts limit causal runtime and effect-size attribution. The zero coefficient changes the coupled hinge block but does not eliminate substantial final extension or establish a physical defect or construction correction.

[Full protocol, official archives and reproduction](research/ppf-cpu/GARMENT_BENDING_STUDY.md), [complete derived receipt](research/ppf-cpu/results/garment-bending-comparison.json).

## Verification

The two new protocol tests first failed because bending guards were absent, then passed. New archive-admission tests exposed missing protocol and legacy-flag rejection; those guards were added. A synthetic source-tamper test initially aliased the expected source map and was repaired to mutate a separate copy. All 7 focused protocol/replay tests then passed in 19.022s. The full frozen-source research suite passed 212 tests in 420.702s.

The official outcome registry remained empty before real retained evidence. The retained-pair regression first refused that unregistered state. After both official archives were registered, all 8 focused tests passed in 31.182s, including exact derived-receipt equality, complete frames and cleanup. Independent review recomputed all 181 paired-coordinate metrics and verified the raw one-array delta, archive checksums, source, result tables, units and coupled-kernel interpretation with no blockers. `git diff --check` passed.

Source/replay CI logs on `9d3eacf5` pass 217 research tests in 354.474s and 160 garment tests in 394.779s, plus complete capture/source/warm/rest/body reproduction: [research 39615231611](https://github.com/twangyal/projects-monorepo/actions/runs/39615231611), [preflight 39615231559](https://github.com/twangyal/projects-monorepo/actions/runs/39615231559).

Final canonical main CI on the complete implementation/evidence commit passes:

| Gate | Actual result | Run |
| --- | --- | --- |
| Research harness | 218 tests, 517.648s | [39617397171](https://github.com/twangyal/projects-monorepo/actions/runs/39617397171) |
| Garment preflight | 161 tests, 500.584s; complete capture/source/warm/rest/body reproduction | [39617396791](https://github.com/twangyal/projects-monorepo/actions/runs/39617396791) |
| Application | 163 unit tests, 209 production browser cases; lint/types/build | [39617396903](https://github.com/twangyal/projects-monorepo/actions/runs/39617396903) |

The expanded local full research suite also passed all 218 tests in 432.986s with exit code 0. No source or evidence changed between that check and this closing record.

This closing record is a root-documentation-only follow-up. The tested implementation and retained evidence remain exactly those at `90728700`.

## Remaining work

#290 remains open. Prefer a declared source-construction alternative or a distinct contact hypothesis over further bending/preparation parameter polishing. Neither the existing source-junction, configured-step, gravity, preparation nor bending observations identify a unique cause or fulfill the intended construction/fit experience. Preserve original rest lengths and all earlier failure archives.

Sustained settling, representative garments/body settings, corresponding physical references and shipping-engine adoption remain unverified. The shipping browser-worker XPBD application is unchanged. Clothing remains ACTIVE at `apps/clothing-studio`. Project #8 remains skipped; owner-deferred projects remain untouched.
