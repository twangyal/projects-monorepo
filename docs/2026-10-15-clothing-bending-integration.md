# Clothing controlled bending comparison — #267

## Delivered unit

Body & drape offers an independent static cantilever comparison: choose coupon dimensions, a small transverse end force,0°/90°grain and8/16 cubic beam elements; inspect two explicitly illustrative profiles on the same physical scale and export complete numerical JSON. Material bending rigidity D (N·m) and strip flexural rigidity EI=D*width (N·m²) are separate quantities. The clamped displacement/rotation solve reports mass, displacement, rotation, energy, signed support reactions, explicit reaction magnitudes and separate force/moment residuals. The rendered cubic curves retain the solved nodal slopes. Worker cancellation, input invalidation, failure/retry and late-reply retirement preserve garment drafts, complete backups and actual pending artwork ownership.

Final source: `77ce3749c00a3ae26534702cbfd4bb57060605d6`; local/published tree `32d7a44deb0e7dec496867d94c7d85c06cbae24c`. Initial source `cb42c6ae6f0b4cbb4d3733d6c42bc2d2975ab73f` was superseded for an exact-boundary roundoff repair; its [CI](https://github.com/twangyal/projects-monorepo/actions/runs/38829542946) was cancelled and is not acceptance evidence. No dependency, saved-project schema, garment solver, paid service, PR or infrastructure change.

## Numerical and native evidence

The exact #266 base passed121 units and146 browser cases. Final local check passes127 units, ESLint, TypeScript and production build. Five focused native cases pass desktop1440/phone390 downloaded JSON and cubic curve endpoints, current-input-only export, raw garment drafts/navigation, actual held-worker cancel/input/controlled-pagehide retirement, failed-worker retry, complete backup parity and held actual artwork decode across experiment controls. Final full-suite evidence below covers the subsequent test-only real-garment seed in the backup fixture. Desktop and phone screenshots were inspected: labels/results wrap within the phone viewport and the desktop experiment stays within its scrollable contextual panel.

A separate arithmetic sweep uses lengths/widths5,20,50cm; forces0,.00001,.0001,.001,.003,.01,.1N; both axes and8/16 resolutions on both pinned profiles.79 paired input combinations are admitted and47 refused outside the small-bending range. Maximum analytic tip error4.67993699349023e-14m, rotation error3.7309044742528386e-13rad, free force residual1.9326207301162412e-13N, free moment residual1.6077417175353048e-14N·m and8/16 tip difference4.1380093795950756e-14m. These are implementation/beam arithmetic checks, not measured fabric or dynamic convergence evidence.

| Local evidence | SHA-256 |
| --- | --- |
|127-unit/lint/types/build | `f3476ebe377268defda88f63c401ec22b30ea782d96e980cff6e0a9d0b128983` |
| Five focused native cases | `7c2b22789cc7d37116d5d92e297a3bfdb3c5adeb553ad32db4409536e4d96330` |
| Cubic curve RED | `55dabc5ddf90ec398b1dfb1d3c3d7dbbb81d0917b6563e6f0ae3fc8d41afcbce` |
| Reaction convention RED | `19aab649aca118c9f39930df365615309856c7150ffa8f690ce565b830c66fde` |
| Complete151-case native suite | `08b5b942a3b9edc30edd8a9d08ff990186b3b1d5a801be5542728dcaafeb3dd3` |
| Exact-boundary RED | `7242398cf836c3980ae27d483b78572b01e945e6a0fee9d788cb8e4e1bc8a082` |

## Retained outcomes and limits

The first kernel probe fails to import the absent module; the first native UI probe fails on the missing bending control before implementation. Independent read-only review identifies the polyline's missing cubic slopes and ambiguous reaction signs. Actual RED assertions precede the Bezier and signed-support/explicit-magnitude repairs. No remaining Critical/Important kernel/lifecycle finding was identified. A nominal3mN exact-boundary probe also fails before an8*Number.EPSILON relative allowance repairs floating-point equality;0.003001N remains refused. This allowance is machine roundoff, not an extra physical deformation margin. Existing assertions, deadlines and security controls are preserved.

The initial local full suite is interrupted after30 passing cases for the boundary repair and is partial evidence only. The initial CI is cancelled by the superseding source. An initial plan/test write used repository paths from the app directory and failed before writing; the corrected invocation supplies the actual missing-module RED. The final local runtime uses a freshly extracted portable Chromium143.0.7499.0; the earlier truncated cached executable is not reused.

This completes the independent bending foundation in #256, not the full material-physics request. Repository-authored illustrative coefficients are not measured specimens. Membrane shear/coupling, transverse beam shear, nonlinear deformation, dynamics, gravity, body/layer/self contact, real material conditioning/fitting and held-out physical validation remain absent. The current approximate garment drape is unchanged. Clothing remains ACTIVE; project8 stays skipped and owner-deferred applications stay excluded.

## Final software gates

The final complete local151-case suite passes (6.2m), exit0. [Final source CI](https://github.com/twangyal/projects-monorepo/actions/runs/38829728384), job116745706377, passes127 units,151 native browser cases (4.1m), ESLint, TypeScript and build; completed logs were fetched and inspected. Hosted Chrome/Headless Shell is153.0.8010.12. An expected-head lease advances main from97f93b4628034d708cbdcd3c7c19e3cdd2dd2ad8 to the exact verified source77ce3749c00a3ae26534702cbfd4bb57060605d6. [Integrated main CI](https://github.com/twangyal/projects-monorepo/actions/runs/38830304880), job116747320655, also passes127 units and151 native cases (4.0m), ESLint, TypeScript and build. Its completed logs were fetched and inspected, including the same hosted Chrome153.0.8010.12. This root-only receipt leaves the verified app source unchanged. Issue267 is complete to available software evidence; real material and intended-user/physical-device validation remain unestablished.
