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

Pending actual native execution. No result is claimed by the admission tests or source review.
