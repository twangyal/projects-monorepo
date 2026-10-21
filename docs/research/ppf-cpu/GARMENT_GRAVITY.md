# Gravity-only native experiment (#290)

Large underarm strain persists without gravity in the frozen cleared warm tee. At three seconds, peak principal strain is **40.885% with normal gravity and 20.759% with zero gravity**, both on back triangle 3091 (vertices 1639/1640/643, original render triangle 1173). Gravity is not necessary for substantial strain in this bounded fixture; this does not identify its cause among construction, bending, body contact and the prepared pose.

## Protocol and provenance

[Native run 39542765732](https://github.com/twangyal/projects-monorepo/actions/runs/39542765732), source commit `5bc1ae3c3658b82449118a4c4e2474a50213c377`, completes two separate sessions: reference gravity `[0,-9.8,0]` and zero gravity `[0,0,0]`. Both retain original rest geometry, captured browser inertia, body and stitches, fixed normalized Young 500, strict contacts, canonical mesh patch, configured dt 1/120, 180 intervals / 181 frames at 60 fps and separate 300-second supervisors. Zero gravity requires an explicit research admission; default and historical replay still refuse it.

Strict replay verifies **362 real frames and 926 native files**. All 46 native input arrays are byte-identical; scene metadata matches exactly and session metadata differs only in gravity. Recorded native executable SHA256 is identical: `1fc9623761c2e18792b8a98554a9332b209fa83b4cd6c0b48ca7f3e1d16257fd`. Replay validates the exact research patch and recorded executable digest, but does not independently rebuild or execute the native binary. Normal gravity matches all 181 frames of both prior duration references.

The two jobs ran on separate 4-vCPU CI hosts: reference AMD EPYC 9V74, zero AMD EPYC 9V45. Python dependency receipts match. Full CPU/environment records are retained, and their digests appear in the comparison receipt. Matching executable records do not establish hardware equivalence or precise causal effect sizes.

| Case | Official artifact | ZIP SHA256 | Native solve | Supervisor incl. cleanup |
| --- | --- | --- | --- | --- |
| Reference | 12320408685 | `e454159aa9cb944a89207779af62f4e1f94daeb345328c50986c6b615e041b56` | 101.080s | 107.167s |
| Zero | 12320089611 | `7e2a9222dd356d9a87f15ab450bd67a00cb0391b0ec43e24e048d69f4b8af381` | 79.063s | 83.985s |

Both ZIP digests match GitHub artifact metadata. Each supervisor completes with exit 0 and no remaining children; neither wall limit was extended. Full official ZIPs, individual replay receipts and [paired comparison](results/garment-gravity-comparison.json) are committed before hosted artifact expiry.

## Saved-frame observations

Principal engineering strain is singular-value stretch minus one relative to each unchanged rest triangle. These are discrete saved-face observations, not continuous-time extrema, stress, physical tolerances or calibrated fabric measurements.

| Saved frame | Time (s) | Reference peak absolute principal strain | Zero-gravity peak absolute principal strain |
| --- | --- | --- | --- |
| 0 | 0.000 | 47.891% | 47.891% |
| 1 | 0.017 | 35.454% | 34.369% |
| 6 | 0.100 | 31.044% | 22.402% |
| 18 | 0.300 | 44.279% | 28.391% |
| 60 | 1.000 | 40.917% | 21.261% |
| 120 | 2.000 | 40.885% | 20.680% |
| 180 | 3.000 | 40.885% | 20.759% |

Both start at the same 47.891% peak before native motion, at triangle 1160; that initial global peak is distinct from the final underarm peak. Zero gravity still ends with 20.759% extension at underarm triangle 3091. This rejects weight as a necessary condition for that remaining strain here, without proving a construction defect or showing gravity has no effect. Rest-area-weighted final 95th-percentile strain is 6.438% / 2.179% (reference /zero).

## Reproduce and test

Run the `Clothing gravity-only paired observation` workflow at the declared source commit. It builds the pinned CPU backend, checks the exact research mesh patch, runs the research suite, and invokes `garment_native_probe.py --initialization clear-warm-sewing --mass-convention browser-inertia --frames 180 --fixed-material-study soft --gravity-study reference|zero` through the 300-second supervisor with five consistent requested-four thread variables. Every outcome retains complete evidence, including failure and timeout.

```sh
python docs/research/ppf-cpu/garment_gravity_comparison.py \
  docs/research/ppf-cpu/results/garment-gravity-reference.zip \
  docs/research/ppf-cpu/results/garment-gravity-zero.zip
python -m unittest discover -s docs/research/ppf-cpu -p 'test_garment_gravity*.py'
```

Replay refuses unregistered, incomplete or changed archives, physical-array drift, altered contacts/material/timestep, and mismatched recorded executables. Synthetic test envelopes only exercise admission rules. The real-artifact regression reproduces the entire derived comparison receipt without unpickling archive state.

The initial tooling integration passes 196 research tests and 139 garment checks on canonical main: [research 39543263310](https://github.com/twangyal/projects-monorepo/actions/runs/39543263310), [preflight 39543263274](https://github.com/twangyal/projects-monorepo/actions/runs/39543263274). The added retained-pair regression passes locally; final expanded-suite/hosted results are recorded in the integration receipt. Research/preflight job budgets increase from 8 to 10 minutes for added raw-archive replay; native solve budgets remain 300 seconds.

## Remaining gates

Issue #290 remains open. The next controlled work must address the rest/contact/pose/construction interaction, preserve original source evidence, and test representative garments and bodies against independent physical references. One pair does not establish sustained settling, a physical strain tolerance, calibrated fabric, physical fit or backend adoption. The shipping solver remains unchanged; Clothing remains ACTIVE and project #8 remains skipped.
