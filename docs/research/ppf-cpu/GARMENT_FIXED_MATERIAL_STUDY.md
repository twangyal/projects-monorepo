# Separate fixed-material three-second observation — #290

The requested-one serial pair in [the original duration study](GARMENT_DURATION_STUDY.md) exceeded its unchanged 300-second whole-pair bound after soft181/stiff168 saved frames. That record remains a native failure. This follow-through declares a different execution protocol before native execution: one fixed material per job, with the same 300-second supervisor and complete collection after success or failure.

## Fixed design

Run soft (normalized Young500) and stiff (Young2000) independently under each requested1/4 thread environment. Each session uses180 intervals at the existing saved60Hz cadence (181 frames), the same cleared browser-prepared pose, captured inertia, original pattern rest metric, seams, body, UVs, contact offsets and all other physical controls. The upstream revision and exact three-token canonical mesh-order patch are unchanged. No physical threshold is relaxed and no partial session is called complete. These are requested environment settings, not measured native worker counts or a controlled causal thread experiment.

`garment_native_probe.py --initialization clear-warm-sewing --mass-convention browser-inertia --frames 180 --fixed-material-study soft` selects exactly soft; `stiff` selects exactly stiff. Fixed-material mode refuses the serial relaxation flag, same-material control, unsewn control, other durations/initializations/mass conventions and missing/mixed requested thread variables. Existing serial-pair protocols and frozen source digests remain distinct. The receipt declares `fixed_material_study`, the sole case and coefficient, requested environment, exact source hashes and a separate experiment name.

The dedicated workflow `clothing-ppf-fixed-material-study.yml` builds pinned CPU source on ordinary public Linux runners. Its four matrix jobs each have an independent300-second native bound; the25-minute outer job bound includes source/dependencies/build/tests. This spends up to four separately bounded sessions, not the original pair's single budget. Collection/upload run after failure as well as success. No shipping-app integration or paid compute is introduced.

## Completion and replay plan

Require actual181-frame native completion, finite full raw float32 frames, exact saved timing, complete retained files, manifest/source/patch/provenance and native exported-input admission. Compare every raw frame with the prior completed requested-four material trajectory and the entire available requested-one prefix (soft181/stiff168); retain differences honestly. Preserve official archive hashes and native outcome separately from replay success. Missing data or timeout does not pass completion.

This stage does not establish calibrated fabrics, sustained settling, physical fit, continuous-time contact, broad determinism or engine adoption. Construction quality and representative garments/body settings remain subsequent research work. Project #8 remains skipped.

## Outcome

[Native run39283037590](https://github.com/twangyal/projects-monorepo/actions/runs/39283037590) is queued at exact protocol source `45b1e3f3d7ab594afb04f224a9b5e6d78d5dd540`. Its four jobs are requested4/stiff118161198306, requested1/stiff118161198420, requested4/soft118161198571 and requested1/soft118161198752. The probe SHA256 is `0e4adc0bafe8c3d5894973d164d162cedc68ae7f309526a39e11d7b202d67bd4`; the native exporter and pinned upstream/canonical patch remain those of the prior duration protocol. This source branch is left unchanged while the run is pending, preserving exact execution identity.

No new native result or artifact is available yet. No result is claimed by admission tests, source review or the synthetic replay tests. Local native execution is unavailable because this workspace has neither Cargo nor CMake. A later run must collect the official artifacts and register/replay their actual digests and outcomes; the production registry currently remains empty.

## Independent replay preparation

`garment_fixed_material_audit.py` verifies a sole registered material/session, exact canonical patch and source digests, original/prepared blueprints, native input ABI, all181 finite frames and60Hz saved times, completed native logs/outcome, captured mass and the unchanged300-second supervisor with no remaining children. It reports byte comparisons against the prior full requested-four and available requested-one duration references. A finite trajectory difference remains reportable; the checker does not require identical trajectories to admit completed motion. Completion of a new session never completes the original timed-out serial pair.

No fixed-material archive is registered before official artifacts are retained. The semantic tests construct an explicitly synthetic single-case envelope from the existing real pair and patch its registry only inside the test. That transformed envelope is not retained or described as new native evidence. Re-signed changes to material, pair flags, sources, rest, duration, final frame, timing, nonfinite data, session namespace, invocation, cleanup and timeout are refused. A separately re-signed finite output perturbation is reported as a difference when the test explicitly bypasses the official archive digest; the ordinary digest check refuses it. These tests establish checker behavior only. Pending native run39283037590 at source45b1e3f3d7ab594afb04f224a9b5e6d78d5dd540 remains the actual-execution gate.
