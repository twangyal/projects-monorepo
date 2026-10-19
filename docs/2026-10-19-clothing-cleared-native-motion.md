# Clothing #290: cleared native garment motion

User outcome: enter strict native garment research from the existing browser growth preparation without rewriting pattern rest lengths. The former warm start failed on its first advance. The declared initial-only 5 mm outward preparation now passes a complete float32 cloth/body triangle-distance threshold query, then actual native motion with contacts and stitches enabled.

## Durable results

- Source [1e941a42](https://github.com/twangyal/projects-monorepo/commit/1e941a42cd8154558566f89ca537eca690da9952), [short native run](https://github.com/twangyal/projects-monorepo/actions/runs/39179647279): both materials complete 19 saved frames (0.3 s). Archive and independent replay integrated in `ca08fade`.
- Source [99eb1e9b](https://github.com/twangyal/projects-monorepo/commit/99eb1e9bdb875484a9eee543ed81fde6a41bf852), [one-second native run](https://github.com/twangyal/projects-monorepo/actions/runs/39181033561): both materials complete 61 saved frames, 122 total; 446 native files retained. GitHub artifact digest matches the downloaded archive SHA256.
- Both archives preserve captured mass and exact original/rest/body/material/seam provenance. The material pair differs only in native Young input. Across durations, all exported native input binaries and scene metadata match; only session `frames` changes.
- [Protocol, raw archives, replay, measurements and limitations](research/ppf-cpu/GARMENT_CLEARANCE.md). Previous failed captures and rejected poses remain retained. Nearby-collar geometry with a smaller seam gap is rejected for intersection.

## Verification evidence

| Check | Observed result |
| --- | --- |
| Initial expanded research suite | 109 tests passed locally |
| Short archive audit and semantic tampering | 3 tests passed, 94.586 s |
| Short evidence complete local regression | 112 tests passed, 322.020 s |
| Main short evidence CI | 112 research tests, 55 garment preflight tests passed |
| One-second controls local suite | 111 tests passed, 248.326 s |
| Combined historical/control local suite | 114 tests passed, 310.491 s |
| Endpoint kinematics/refusal/raw replay | 3 tests passed, 36.520 s |
| Main endpoint CI | 117 research tests, 60 garment preflight tests passed |
| One-second native-source harness | 111 tests passed, 122.225 s; locked backend build and actual solve passed |
| One-second archive semantic checks | 4 tests passed, 53.137 s |
| Application CI on short evidence integration | 161 unit tests, 195 browser cases, lint, TypeScript and build passed |

Independent read-only reviews reproduced both archive audits, original short output, duration input comparison and observed prefix divergence, with no blocking findings. The final combined regression outcome is recorded in issue #290 and CI after evidence integration; do not infer its result from this table.

## Interpretation and remaining work

At one second, seam gaps are 1.422/1.442 mm and final intrinsic-edge strain is 31.165/19.075% (soft/stiff). Last-interval RMS secant speeds are 1.321/0.260 mm/s. Final snapshots have no triangle pairs below the declared 3.5 mm body and 0.5 mm collar/shirt offsets. These are bounded saved-snapshot observations, not continuous collision, sustained settling or fit acceptance.

Identical declared input bytes do not produce matching early trajectories across the two runs: maximum common-prefix vertex differences are 16.961/26.706 mm. The cause is unestablished. Do not interpret the longer run as deterministic continuation, or the observed material pair as a proven repeatable garment-material signal. The next control is same-material repetitions under recorded execution settings. Representative garments/bodies, calibrated fabric and physical fit remain unfinished; #290 and Clothing remain active. Project #8 stays skipped.
