# Configured-time-step sensitivity — #290

The retained fixed-material sessions complete with configured native `dt=1/120`, saved60Hz observations and180intervals. Triangle principal stretch locates40.885/26.339% peak extension in the two final cases. Before attributing those observations to construction, this study declares one bounded configured-time-step comparison. It does not change rest lengths or tune material stiffness to hide distortion.

## Declared protocol

Execute one softYoung500 and one stiffYoung2000 session with requested-four environment only. Each uses the same cleared warm pose, captured inertia, original rest metric, UVs, welded/stitched topology, body collider, material/bend/damping/contact settings, upstream revision and canonical mesh patch. Saved `fps=60` and180intervals (181frames through3s) remain fixed. **Only configured `dt` changes from1/120 to1/240.** Native stepping may be adaptive; this is sensitivity to a configured parameter, not a claim that every internal step has that exact duration.

Each job retains its own unchanged300-second supervisor, full collection after success/failure/timeout and25-minute outer job bound for build/setup/tests. No failed/partial output counts as completed motion. The prior serial timeout and all fixed-material results remain frozen.

The probe requires `--fixed-material-study soft|stiff --half-step-study --frames 180 --initialization clear-warm-sewing --mass-convention browser-inertia` and consistent requested-four thread variables. It refuses serial/same-material/unsewn combinations, other poses/mass/horizons/materials and requested-one settings. `verify_export` accepts1/240 only with explicit `half_step_study=True`, exact180intervals and all other session controls unchanged. Ordinary export/probe admission remains unchanged by default.

The receipt adds a distinct `half-step-study` experiment suffix, `half_step_study:true`, explicit configured `dt`, source hashes and the sole fixed material. The source branch for this experiment is `autonomous/clothing-half-step-290`; it must remain unchanged while a run is active. Pinned probe SHA256 is `c94a54d879b552587912e1ee469b05a16946a5dacf1123362d9920af27701c8f`; native-export admission SHA256 is `86a552a227f0cf030a57a4ab0bc823a46a7beedecf9de86dae322d73e2081cb9`.

## Completion and comparison

Actual [native run39326031171](https://github.com/twangyal/projects-monorepo/actions/runs/39326031171) at source `773e820c66359f2a69f12394a935a17515a5ef3a` completed both cases. Each archive retains181 actual frames through3s and463 manifest-verified native files, for362frames/926files total. Each supervisor reports completed, exit0, limit300s and zero remaining children. The wall observations are232.622s soft and244.052s stiff, on separate hosts; they are not a controlled speed comparison.

| Material | Job | Artifact | Official ZIP bytes | SHA256 |
| --- | --- | --- | ---: | --- |
| soft500 |118311992493|12223087980|7,411,834|`d7d21b4a32e8c704f984acef63f97565f881da90892d343cf194c77ec1fd5522`|
| stiff2000 |118311992893|12222529007|7,401,546|`03fc96f2c89c7d9fa6de056976ba919b3b2797a47c4cb2759037b04c5f183032`|

Original official ZIP bytes are retained as `results/garment-half-{soft,stiff}.zip`, with full reproduced `-replay.json` reports. They contain raw frames, input ABI binaries, source/patch provenance, native logs, environment and actual outcome/cleanup records. The independent checker pins each official digest and declared source map, verifies all manifest records, frame sizes/finiteness/times, exact captured inertia and session controls. All native physical input binaries and `info.toml` match each prior-duration reference byte-for-byte. Only the one declared `dt` literal may change in `param.toml`; dynamic schedules and other metadata changes refuse.

The coordinate reference is explicitly the complete requested-four archive from run39243425408 (`duration-four`, official SHA256 `af0c6e074e4625bdcb33d9180411ad1a463ba316dd2e96e1e06c1c2c1933289c`). Its181frames/material were already proven byte-identical to the corresponding [fixed-four sessions](GARMENT_FIXED_MATERIAL_STUDY.md). The replay records both original requested-one available prefixes and requested-four full raw-frame comparisons; only initial frame0 matches in each comparison. The old requested-one stiff timeout remains incomplete and is never promoted by this study.

## Observed differences

| Saved diagnostic | soft dt1/120 | soft dt1/240 | stiff dt1/120 | stiff dt1/240 |
| --- | ---: | ---: | ---: | ---: |
| Final peak principal extension |40.884984%|40.912165%|26.338746%|26.334695%|
| Rest-area-weighted absolute principal strain p95 |6.437919%|6.448028%|3.755158%|3.755011%|
| Final peak absolute intrinsic-edge strain |31.195501%|31.222950%|19.012169%|19.118639%|
| Final maximum stitch gap (mm) |1.421833|1.428484|1.442323|1.453007|
| Last saved interval RMS secant speed (mm/s) |0.173945|0.164858|0.028685|0.000354|

Both half-step final principal peaks still occur at native triangle3091, back render triangle1173, vertices[1639,1640,643]. Peak changes are+0.027181 and−0.004051 percentage points. The small endpoint change does not erase the substantial localized extension. No physical strain threshold is inferred.

| Compared against original dt1/120 | soft500 | stiff2000 |
| --- | ---: | ---: |
| Maximum saved vertex difference (mm) |169.970203|150.131879|
| Whole-trajectory vertex RMS difference (mm) |3.794301|3.473330|
| Largest per-frame vertex RMS difference (mm) |22.297251|19.379830|
| Final vertex RMS difference (mm) |0.092288|0.888855|
| Identical raw/coordinate frames |1/181|1/181|

The largest pointwise differences occur at saved frame6 (0.1s) in both cases. These early transient differences matter even though final principal peaks are close. One observation per coefficient/configuration on separate hosts cannot isolate every causal influence or establish numerical convergence.

For1/240, whole-window RMS saved secant speeds for0–1/1–2/2–3s are174.252/0.522/0.097mm/s soft and180.651/0.091/0.001809mm/s stiff. Final threshold triangle-pair queries report zero cloth/body violations against3.5mm and zero collar/shirt violations against0.5mm for both cases. These are endpoint threshold bounds, not exact minimum distances or continuous-time contact/self-collision guarantees. Three seconds of sampled motion does not prove sustained settling.

Reproduce with:

```sh
python3 docs/research/ppf-cpu/garment_fixed_material_audit.py docs/research/ppf-cpu/results/garment-half-soft.zip --protocol half-step --profile four-soft
python3 docs/research/ppf-cpu/garment_fixed_material_audit.py docs/research/ppf-cpu/results/garment-half-stiff.zip --protocol half-step --profile four-stiff
python3 -m unittest discover -s docs/research/ppf-cpu -p 'test_*.py'
```

Synthetic semantic tests re-sign a transformed envelope only under test-scoped registry patches; they are not native evidence. They verify explicit opt-in, source/material/dt tamper rejection and cross-protocol refusal. Separate real-evidence tests reproduce both complete retained reports and freeze actual observed differences without inventing acceptance tolerances. The ordinary fixed-material result schema and all prior evidence stay unchanged.

Next within #290: address garment construction and evaluate representative garments/bodies, with controlled repetition and physical references before adoption. Halving the configured step did not remove the localized endpoint stretch; this observation supports investigating construction while leaving numerical/physical validation open.

A two-point observation does not establish timestep convergence, mesh convergence, continuous-time contact, constitutive stress, a causal construction defect, physical material calibration, physical fit or backend adoption. A successful software/native gate alone does not complete Clothing Studio. Project#8 remains skipped.
