# Separate fixed-material three-second observation — #290

The requested-one serial pair in [the original duration study](GARMENT_DURATION_STUDY.md) exceeded its unchanged 300-second whole-pair bound after soft181/stiff168 saved frames. That record remains a native failure. This follow-through declares a different execution protocol before native execution: one fixed material per job, with the same 300-second supervisor and complete collection after success or failure.

## Fixed design

Run soft (normalized Young500) and stiff (Young2000) independently under each requested1/4 thread environment. Each session uses180 intervals at the existing saved60Hz cadence (181 frames), the same cleared browser-prepared pose, captured inertia, original pattern rest metric, seams, body, UVs, contact offsets and all other physical controls. The upstream revision and exact three-token canonical mesh-order patch are unchanged. No physical threshold is relaxed and no partial session is called complete. These are requested environment settings, not measured native worker counts or a controlled causal thread experiment.

`garment_native_probe.py --initialization clear-warm-sewing --mass-convention browser-inertia --frames 180 --fixed-material-study soft` selects exactly soft; `stiff` selects exactly stiff. Fixed-material mode refuses the serial relaxation flag, same-material control, unsewn control, other durations/initializations/mass conventions and missing/mixed requested thread variables. Existing serial-pair protocols and frozen source digests remain distinct. The receipt declares `fixed_material_study`, the sole case and coefficient, requested environment, exact source hashes and a separate experiment name.

The dedicated workflow `clothing-ppf-fixed-material-study.yml` builds pinned CPU source on ordinary public Linux runners. Its four matrix jobs each have an independent300-second native bound; the25-minute outer job bound includes source/dependencies/build/tests. This spends up to four separately bounded sessions, not the original pair's single budget. Collection/upload run after failure as well as success. No shipping-app integration or paid compute is introduced.

## Completion and replay plan

Require actual181-frame native completion, finite full raw float32 frames, exact saved timing, complete retained files, manifest/source/patch/provenance and native exported-input admission. Compare every raw frame with the prior completed requested-four material trajectory and the entire available requested-one prefix (soft181/stiff168); retain differences honestly. Preserve official archive hashes and native outcome separately from replay success. Missing data or timeout does not pass completion.

This stage does not establish calibrated fabrics, sustained settling, physical fit, continuous-time contact, broad determinism or engine adoption. Construction quality and representative garments/body settings remain subsequent research work. Project #8 remains skipped.

## Outcome: all four separately bounded sessions complete

[Native run39283037590](https://github.com/twangyal/projects-monorepo/actions/runs/39283037590) passes all four jobs at exact protocol source `45b1e3f3d7ab594afb04f224a9b5e6d78d5dd540`. The probe SHA256 is `0e4adc0bafe8c3d5894973d164d162cedc68ae7f309526a39e11d7b202d67bd4`; native exporter, upstream revision, canonical patch and all physical inputs remain unchanged. Each job retains181 actual saved frames and463 checksum-verified native files:724 new frames /1852 files in total. All native outcomes are completed, exit0, with zero remaining children and the unchanged300-second per-job supervisor.

| Profile | Native job | Official artifact | Original ZIP bytes | Supervisor wall (s) |
| --- | ---: | ---: | ---: | ---: |
| one-soft |118161198752|12203356627|7327400|158.026391|
| one-stiff |118161198420|12202742689|7320722|162.855062|
| four-soft |118161198571|12201778448|7320354|106.108386|
| four-stiff |118161198306|12203270919|7319646|138.719982|

The complete official ZIP archives are retained directly, without repacking:

- [one-soft](results/garment-fixed-one-soft.zip): `17e59a70605c1abcec179be032021ef76431bfacc52240474878969d8a7adc1a`
- [one-stiff](results/garment-fixed-one-stiff.zip): `1ea8c42c24277701aeb88289c5d67c81c4947e53e7926475f9b6fc8ff5c8c5d4`
- [four-soft](results/garment-fixed-four-soft.zip): `fc2c0de508864f468b7a8669de0bcf2309db3c57611c02e6e46a280476a6bf70`
- [four-stiff](results/garment-fixed-four-stiff.zip): `7253736fa219c7b95a92852fb063a0a1d8b131fffa082646c87ad17159eda591`

All181 raw frames of each material match byte for byte across the observed requested environments. Every full prior-four reference matches181/181; prior-one soft matches181/181 and stiff matches its complete available168-frame prefix. Native input binaries and scene/session metadata match the prior duration cases exactly. [Comparison receipt](results/garment-fixed-comparison.json) and per-profile `garment-fixed-*-replay.json` retain complete raw-frame hashes, mass, endpoint, motion-window and source-located construction diagnostics.

This supplies the previously missing requested-one stiff ending under a separately allocated budget. It does **not** make the original serial pair complete, establish faster execution, isolate causal thread effects or prove broad determinism. These four supervisor times are observations on separate hosts, including preparation/cleanup; they are not aggregate service latency or a controlled performance comparison. The source branch remains frozen at the protocol commit.

The completed trajectories reproduce the previous full endpoint: peak absolute intrinsic-edge strain remains31.1955% /19.0122%, localized near the underarm as [already documented](GARMENT_CONSTRUCTION_DIAGNOSTICS.md). Low later saved motion does not resolve construction quality or establish physical fit. Representative garment/body coverage, physical references, sustained settling and engine adoption remain open. Local Cargo/CMake remain unavailable; actual native execution above is hosted, independently replayed evidence.

Reproduce each retained replay (standard library only):

```sh
python3 docs/research/ppf-cpu/garment_fixed_material_audit.py docs/research/ppf-cpu/results/garment-fixed-one-stiff.zip --profile one-stiff
python3 -m unittest discover -s docs/research/ppf-cpu -p 'test_garment_fixed_material*.py'
```

## Independent replay preparation

`garment_fixed_material_audit.py` verifies a sole registered material/session, exact canonical patch and source digests, original/prepared blueprints, native input ABI, all181 finite frames and60Hz saved times, completed native logs/outcome, captured mass and the unchanged300-second supervisor with no remaining children. It reports byte comparisons against the prior full requested-four and available requested-one duration references. A finite trajectory difference remains reportable; the checker does not require identical trajectories to admit completed motion. Completion of a new session never completes the original timed-out serial pair.

The four production profiles now register only the official digests above. The semantic tests construct an explicitly synthetic single-case envelope from the existing real pair and patch its registry only inside the test. That transformed envelope is not retained or described as new native evidence. Re-signed changes to material, pair flags, sources, rest, duration, final frame, timing, nonfinite data, session namespace, invocation, cleanup and timeout are refused. A separately re-signed finite output perturbation is reported as a difference when the test explicitly bypasses the official archive digest; the ordinary digest check refuses it. These tests establish checker behavior only. Actual run39283037590 and its retained official artifacts now supply that execution gate, separately from these semantic tests.
