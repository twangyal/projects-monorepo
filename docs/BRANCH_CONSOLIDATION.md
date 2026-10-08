# Branch consolidation — 2026-10-08

The owner requested one canonical development branch. `main` combines the current portfolio, the revised product visions and the useful outstanding Gaze stabilization work. No pull request was created.

## Integration decisions

- Merge `Astra` into `main`, retaining the complete portfolio and its current progress/evidence. The first merge tree exactly matched Astra `2541b1a16773f2ad4d91ce6ef995ef06b1493823`; conflicts were branch-specific catalog/README descriptions.
- Merge the Gaze stabilization branch normally, preserving both its camera smoothing/nearby-target assistance and the newer portable draft workflow.
- Preserve the four older regression branches as merge parents while retaining their superseding integrated test suites. Port the two missing Clothing raw-field regression variants. No older production implementation replaces current code.
- Retain the alternative Shot sequence editor and early MediaPipe gaze application as exact archive tags. The Shot implementation was explicitly superseded by the stable-identity editor; the early gaze branch is a separate competing prototype. Their code is not installed as a second live product.
- Fix only Melody’s native-download test fixture to respect Chromium’s download rate limit discovered during consolidation verification; retain real downloads, assertions and the original timeout. Melody production code is unchanged.
- Make main canonical in the agent instructions. Gaze verification now runs on changed task-branch pushes and supports manual dispatch, using the same tests as before.

## Original branch tips

Archive tag naming: `archive/2026-10-08/<branch>`, with `main-before-consolidation` used for the previous main tip. Tags preserve original commits even when branch names are retired. No force overwrite of an archive tag is permitted.

| Original branch | Original tip | Disposition |
| --- | --- | --- |
| `Astra` | `2541b1a16773f2ad4d91ce6ef995ef06b1493823` | Included in consolidated ancestry; archive branch tip |
| `claude/ecstatic-thompson-su2s2r` | `77daa902c731c3c72384c8ec3beeea34a6c173b3` | Included in consolidated ancestry; archive branch tip |
| `codex/ci-superseded-runs` | `2c6cd94139ae65ade27d4a58fc5c096262a322c7` | Included in consolidated ancestry; archive branch tip |
| `codex/clothing-import-ownership` | `72057674ddb7883489a5228c42980983f6af4df0` | Included in consolidated ancestry; archive branch tip |
| `codex/clothing-startup-recovery` | `c5d50d2cfdb7b71e71bb8cc9708b181ce84f4304` | Included in consolidated ancestry; archive branch tip |
| `codex/clothing-storage-deadline` | `570a8f0ce87cbe824c153ed33122ede845ab500e` | Included in consolidated ancestry; archive branch tip |
| `codex/clothing-vector-export` | `fc5de6a42de39279fb56ffc25807eb72f1adda1b` | Included in consolidated ancestry; archive branch tip |
| `codex/color-context-core-oracles` | `7c06dac0685cf3ce5e7de4e6b0af8f79b98338b2` | Included in consolidated ancestry; archive branch tip |
| `codex/composure-cached-return` | `9666b16dc125bc48e1f9e1bda5f780d7f0f1a131` | Included in consolidated ancestry; archive branch tip |
| `codex/composure-mvp` | `c3926388c83995ccddbda302b9428cf60ed27f44` | Included in consolidated ancestry; archive branch tip |
| `codex/friendly-header-deadline` | `fb9cde234dfd19f4677a927d4593d9a9772ed0f9` | Included in consolidated ancestry; archive branch tip |
| `codex/git-history-discovery` | `543efa5687e96e2ec31f45ca0040e0a361cafb10` | Included in consolidated ancestry; archive branch tip |
| `codex/karaoke-lyric-history` | `ae23ede44d93ecfd362c8ede15958e88ddd5131d` | Included in consolidated ancestry; archive branch tip |
| `codex/karaoke-storage-ownership` | `0d11d9686751335b7a6146dbc5e08fa93fc2587c` | Included in consolidated ancestry; archive branch tip |
| `codex/melody-save-conflicts` | `b6b99ede6b166a8371e5fddd6721a753af15b82e` | Included in consolidated ancestry; archive branch tip |
| `codex/motion-draft-recovery` | `ec85571b88c2e1be481a976e24e1a0814b086f96` | Included in consolidated ancestry; archive branch tip |
| `codex/motion-raw-recovery` | `90915dee3ccb38d9bca7e37c6bae429e55c1a33f` | Included in consolidated ancestry; archive branch tip |
| `codex/motion-startup-recovery` | `383e3a5aff7bd3fe75ed1758715bbb2906a7a89b` | Included in consolidated ancestry; archive branch tip |
| `codex/motion-tween-core` | `5fd9a723b4f0dd274a8e24b4c211c9183d155536` | Included in consolidated ancestry; archive branch tip |
| `codex/sequence-duration-admission` | `d6bbbaf710a39cafb213ebe5f20fcc6e2807acec` | Included in consolidated ancestry; archive branch tip |
| `codex/shot-draft-recovery` | `7c3b1308328b44f4f49c1c4f5a64eb1cdcdcddce` | Included in consolidated ancestry; archive branch tip |
| `codex/shot-sequence-ui` | `d03ff3bfd6ba30625de92fba7803c4e3dd95511f` | Superseded alternative; preserve exact archive without adding its implementation |
| `codex/shot-xr-cancellation` | `9141fd80c6f2ae435f657bcd618dffbfa7de90b2` | Included in consolidated ancestry; archive branch tip |
| `codex/stock-exclusion-audit` | `c9a9d15b8503a126ddd770b448376dc6bc6df2df` | Included in consolidated ancestry; archive branch tip |
| `codex/stock-paraphrase-experiment` | `adb1fabdd45f00a36950b034c61b256219211096` | Included in consolidated ancestry; archive branch tip |
| `codex/stock-raw-recovery` | `1847c9f092b23d0e4989919b15a220461262c162` | Included in consolidated ancestry; archive branch tip |
| `codex/stock-transaction-timeout` | `ba0a7a883acb38923bed35774d15c3caa26c2ab5` | Included in consolidated ancestry; archive branch tip |
| `codex/studio-storage-setup` | `de06b8a9a008b6364dbd26dd82328c503ad6fd4e` | Included in consolidated ancestry; archive branch tip |
| `feat/eye-detector` | `63bfbffa15b9f28c543d68b0c5358c8f9bc773a7` | Superseded alternative; preserve exact archive without adding its implementation |
| `main` | `6b114cf8ab1979c0a1934716219724d7dabd5727` | Previous canonical tip; retained in ancestry and archive |

## Verification scope

The initial combined revision was `e547378f3c0e3ac947740b7ece8efaae02ba1769`. Independent review found no actionable correctness regressions in the Gaze merge, the preserved draft workflow, the Clothing regression additions or canonical-branch guidance. Local Gaze verification passed 83 unit tests and syntax checks. Hosted Gaze verification passed all 96 browser tests; Clothing passed all 48 browser tests, including the two restored raw-field cases.

All fourteen application workflows ran on the temporary `consolidate/portfolio-main` branch. Thirteen passed initially. Melody’s initial run passed 174 browser tests but timed out waiting for an eleventh native download requested within one second. The trace retained ten downloads within 859 ms, showed the eleventh save click completing within 948 ms of the first download, and showed the application’s success feedback without another browser download event. The timeout occurred after Redo and before the final reload. Its source, tests and workflow at the failed revision exactly matched the integrated Astra tip.

The correction paces the shared test helper using the last ten native download-event timestamps per page. It preserves every click, real browser download, assertion and the 30-second test timeout. No production behavior, renderer, workload, or timeout is relaxed. This matches Chromium’s [LocalFrame download throttle](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/frame/local_frame.cc), which admits ten downloads per one-second window. The correction is commit `604029b`; 348 local Melody unit tests, lint, TypeScript and the production build passed. All three focused sound-envelope browser cases also passed using the locally available Chromium executable; the full hosted suite remains the authoritative CI check. Final hosted verification results are recorded below.

Shot Studio’s ordinary verification and original full-minute maximum-export job both passed in this run. This single success does not erase the previously recorded intermittent maximum-export failure tracked by #128 or establish broader product completion. The separate browser compatibility experiment is diagnostic evidence, not a replacement for the original maximum gate. Its neutral-download measurement job passed; its post-fix maximum job was cancelled during Ubuntu/FFmpeg package installation after the 10-minute job budget, before any maximum capture ran. This is unavailable diagnostic coverage, not a measured application failure or a passing post-fix maximum result.

## Hosted verification results

These runs validate the combined application trees at `e547378`, followed by the isolated Melody fixture correction at `604029b`. The final reporting commit changes documentation only. The other thirteen application trees are unchanged by the Melody correction.

| Workflow | Revision | Result | Evidence |
| --- | --- | --- | --- |
| Clothing Studio | `e547378` | success | [Run 37831966897](https://github.com/twangyal/projects-monorepo/actions/runs/37831966897) |
| Color Context Lab | `e547378` | success | [Run 37831966924](https://github.com/twangyal/projects-monorepo/actions/runs/37831966924) |
| Composure | `e547378` | success | [Run 37831966893](https://github.com/twangyal/projects-monorepo/actions/runs/37831966893) |
| Duet | `e547378` | success | [Run 37831967046](https://github.com/twangyal/projects-monorepo/actions/runs/37831967046) |
| Friendly Challenges | `e547378` | success | [Run 37831966823](https://github.com/twangyal/projects-monorepo/actions/runs/37831966823) |
| Gaze Navigator checks | `e547378` | success | [Run 37831966824](https://github.com/twangyal/projects-monorepo/actions/runs/37831966824) |
| Git History | `e547378` | success | [Run 37831966836](https://github.com/twangyal/projects-monorepo/actions/runs/37831966836) |
| Karaoke Studio | `e547378` | success | [Run 37831966877](https://github.com/twangyal/projects-monorepo/actions/runs/37831966877) |
| Lens Studio | `e547378` | success | [Run 37831966861](https://github.com/twangyal/projects-monorepo/actions/runs/37831966861) |
| Melody Studio | `e547378` | failure | [Run 37831967038](https://github.com/twangyal/projects-monorepo/actions/runs/37831967038) |
| Motion Studio | `e547378` | success | [Run 37831966960](https://github.com/twangyal/projects-monorepo/actions/runs/37831966960) |
| Shot Studio | `e547378` | success | [Run 37831966870](https://github.com/twangyal/projects-monorepo/actions/runs/37831966870) |
| Shot download compatibility experiment | `e547378` | cancelled | [Run 37831966858](https://github.com/twangyal/projects-monorepo/actions/runs/37831966858) |
| Stock Notebook | `e547378` | success | [Run 37831966983](https://github.com/twangyal/projects-monorepo/actions/runs/37831966983) |
| Style Studio | `e547378` | success | [Run 37831966826](https://github.com/twangyal/projects-monorepo/actions/runs/37831966826) |
| Melody Studio (corrected fixture) | `604029b` | success | [Run 37833348672](https://github.com/twangyal/projects-monorepo/actions/runs/37833348672) |

All fourteen application workflows have passing evidence for the consolidated code, with the isolated Melody fixture correction verified separately. The optional Shot compatibility experiment remains partially unverified as described above.

## Publication and recovery

The publication operation verifies all original remote branch tips and all thirty peeled archive tags, requires the current main tip to be an ancestor of the consolidated revision, and uses exact expected-ref leases in one atomic push. If another writer changes a branch, publication stops instead of overwriting that work. The retained long-lived branch is `main`; temporary and superseded branch names are retired.

To inspect an original branch, use its archive tag from the naming convention above. To recover work, create a new short-lived branch at that tag and reconcile it with current main and the revised product direction before implementation. Archived prototypes do not supersede the current product visions.
