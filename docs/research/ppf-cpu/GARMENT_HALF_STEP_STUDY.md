# Configured-time-step sensitivity — #290

The retained fixed-material sessions complete with configured native `dt=1/120`, saved60Hz observations and180intervals. Triangle principal stretch locates40.885/26.339% peak extension in the two final cases. Before attributing those observations to construction, this study declares one bounded configured-time-step comparison. It does not change rest lengths or tune material stiffness to hide distortion.

## Declared protocol

Execute one softYoung500 and one stiffYoung2000 session with requested-four environment only. Each uses the same cleared warm pose, captured inertia, original rest metric, UVs, welded/stitched topology, body collider, material/bend/damping/contact settings, upstream revision and canonical mesh patch. Saved `fps=60` and180intervals (181frames through3s) remain fixed. **Only configured `dt` changes from1/120 to1/240.** Native stepping may be adaptive; this is sensitivity to a configured parameter, not a claim that every internal step has that exact duration.

Each job retains its own unchanged300-second supervisor, full collection after success/failure/timeout and25-minute outer job bound for build/setup/tests. No failed/partial output counts as completed motion. The prior serial timeout and all fixed-material results remain frozen.

The probe requires `--fixed-material-study soft|stiff --half-step-study --frames 180 --initialization clear-warm-sewing --mass-convention browser-inertia` and consistent requested-four thread variables. It refuses serial/same-material/unsewn combinations, other poses/mass/horizons/materials and requested-one settings. `verify_export` accepts1/240 only with explicit `half_step_study=True`, exact180intervals and all other session controls unchanged. Ordinary export/probe admission remains unchanged by default.

The receipt adds a distinct `half-step-study` experiment suffix, `half_step_study:true`, explicit configured `dt`, source hashes and the sole fixed material. The source branch for this experiment is `autonomous/clothing-half-step-290`; it must remain unchanged while a run is active. Pinned probe SHA256 is `c94a54d879b552587912e1ee469b05a16946a5dacf1123362d9920af27701c8f`; native-export admission SHA256 is `86a552a227f0cf030a57a4ab0bc823a46a7beedecf9de86dae322d73e2081cb9`.

## Completion and comparison

Actual native execution is pending. Helper tests/source review are not native results. Retain official archives and independently verify their source/patch, sole-case ABI/input bytes, mass, complete finite frames, saved times, successful completion and cleanup. Compare with the corresponding retained requested-four fixed-material reference: every native physical input binary and scene metadata must match; session metadata may differ only in declared `dt`. Report all frame identities/differences, coordinate trajectory/endpoint differences and final principal/edge/seam/saved-motion diagnostics. Preserve runtime/failure outcomes without inventing tolerances.

A two-point observation does not establish timestep convergence, mesh convergence, continuous-time contact, constitutive stress, a causal construction defect, physical material calibration, physical fit or backend adoption. A successful software/native gate alone does not complete Clothing Studio. Project#8 remains skipped.
