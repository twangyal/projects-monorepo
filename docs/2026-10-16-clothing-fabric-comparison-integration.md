# Matched actual-garment fabric comparison — #270

## Outcome and scope

Body & drape now compares two library fabrics on the same captured committed top and entered chest/waist/hip. Candidate products preserve colors, prints, artwork, rib trims and saved colorways; only non-rib materials change. Actual garment workers and sequential disposable snapshot scenes produce matched garment-only front/back views. The main design stays unchanged until an explicit Use choice, which performs one normal undoable material edit. Already-used choices are disabled rather than claiming a nonexistent Undo step. Each new run adopts the current committed capture, including after a no-op template commit.

JSON includes captured source/body, both candidate products, material identity/GSM, actual complete positions/body/metrics, solver identity, fixed settings, units and limitations. The receipt is not an importable project backup. It may contain local source artwork and can exceed the single-project backup size; nothing is uploaded. Comparing preserves pending artwork/import owners, while an actual Use retires them. Raw product/body drafts block Compare and Use. Real design/body/input changes, Cancel and pagehide retire work/results; old successes and failures cannot publish or erase a newer generation.

This is a design-exploration workflow using the existing approximate XPBD solver. No material-law/solver/schema/dependency/paid-service/PR change occurs. The independent swatch laws are not integrated. Texture-based isotropic stretch/bend, library weight, proxy anatomy, carried pockets and simplified contact remain explicit assumptions. Imagery or finite numerical differences do not validate a material specimen, anatomical fit or manufacture. Clothing stays ACTIVE; project #8 remains skipped and owner-deferred apps excluded.

## Source and initial verification

Base main `7da2b589e11aad6b6ade06c5fdbd0a97c33c03ab` is clean; fresh baseline project check passes 137 units/lint/types/build. Recent main CI is green 137/161. No open PR or suitable unblocked implementation issue exists;270 was created before implementation. The architectural spec and inline plan are committed under docs/superpowers.

Initial source `98f515211c9ffbf51b531e573c32fe82ccb48eb3`, local tree `93e4e51f582c869a87470509e231d70b13060da5`, passes 140 units/lint/types/build and 9 focused native cases. Initial source CI 38886637621 passes 140 units and170 browser cases with project checks; completed job 116925863737 logs are inspected. Hosted Chrome 153.0.8010.12; local portable Chromium 143.0.7499.0, one native worker. These initial passes precede the independently found no-op issue below and are not final acceptance.

Three domain cases prove isolated candidate data, preserved rib/styling/colorway data, strict distinct/known/top admission, actual default 240-frame finite material-dependent geometry and JSON-safe captured results. Nine initial native flows cover desktop 1440 / phone 390 worker-result position/metrics parity, four decoded images, full backup parity, one-step Use/Undo/Redo, raw draft/body invalidation, held actual worker messages across cancellation/input/confirmed replacement/pagehide, genuine worker/encoding retry and pending actual artwork/import authority. Screenshot inspection checks both layouts; fabric selectors were stacked to retain readable names in the narrow panel.

## Retained failures and repairs

- Domain test initially fails because the comparison module is absent; all 3 cases subsequently pass. The first native case fails on absent comparison controls before UI implementation; desktop/phone then pass.
- A held native PNG encoding completes after Cancel and a newer successful comparison, then delivers an injected null callback. Its old catch clears all 4 newer images. The unchanged expectation passes after generation-gating the error handler. This is a controlled native encoding boundary fault, not a fabricated simulation result.
- One lifecycle fixture initially cannot find the options-bearing select via an exact implicit label. An isolated native probe observes label 0 versus accessible combobox 1 and successfully selects the combobox. Updating the selector retains the same behavior assertions and deadlines. A separate read-only script cannot connect to another exec's server because commands have isolated network namespaces; the probe is rerun with its own server, and the temporary test is removed.
- The next held fixture reaches confirmed-replacement action but Playwright's default dialog dismissal leaves the existing Ringer unchanged. It releases an authoritative first result and starts a second solve, correctly keeping Compare disabled. The fixture now explicitly accepts the existing native confirmation; all 4 retirement actions and retry-enabled assertions pass. Production confirmation and ownership guards are unchanged. The first partial focused run is interrupted after 7 outcomes; the next completes 8 pass / 1 fixture fail, not a green suite.
- Initial full local invocation never starts browser cases: generated temporary command loses npm's argument separator before host/port flags, and webServer times out 60 s. The command is corrected to `npm run preview -- --host 127.0.0.1 --port 4264 --strictPort`. No app source, timeout or existing assertion is weakened. A prior-run temporary browser config was absent and the fresh portable extraction needed its temporary directory created first; both were setup repairs, without product dependency changes.

## Independent review and one fix pass

One fresh read-only whole-branch review covers base 7da2b58 through local a11fe8c. It finds no Critical issue or separate Minor, but one Important no-op choice defect: an unchanged Use reports an Undo step although ProjectHistory suppresses identical edits. Main nevertheless refreshes the project clone without rendering, leaving the comparison's reference stale and making every subsequent run refuse. Following the false Undo advice could reverse an unrelated previous edit.

Two added native regressions reproduce the enabled unchanged choice and stale identity after a confirmed identical template. The fix disables/labels already-used candidate actions and explicitly synchronizes each fresh committed capture before solving. Actual changing choices keep asset/import retirement and one-step history. The unchanged two regressions and all 11 focused native cases pass (1.2 min), along with 140 units/lint/types/build. Final full-suite evidence is recorded below; there is no second review pass.

Reviewer declines physical calibration/anatomy/manufacturing, intended-user/assistive-technology/other-device performance, and final full/CI judgment while those gates are pending. Rulings: physical claims remain unsupported/disclosed (wrong acceptance would misrepresent fit); general user/device usefulness remains unverified (wrong assumption could hide an unusable device flow); the coordinator executes final software gates rather than substituting the review (without them, regressions could ship). No deferred Minor is reported.

## Final gates

Reviewed source `de988ecf0668c380b07dcfb42721457f539b460c`, tree `e2c82efc9ac449e54088c6023014a5b5ce1b1621`, includes the review fix. Local 140-unit/lint/types/build and 11 focused native cases pass. Source CI [38887339298](https://github.com/twangyal/projects-monorepo/actions/runs/38887339298) passes 140 units and 172 native cases; completed job 116928178245 logs are inspected.

The local full suite first completes 170 pass / 2 fail. Both failures are pre-existing motif/artwork “newer upload” poll callbacks dereferencing `saved.product` when the native IndexedDB record is still undefined. Editing success precedes the existing 200 ms autosave debounce. An unchanged focused rerun reproduces one pass / one identical TypeError. The poll now uses `saved?.product`, waiting for the same expected native saved values. No product persistence code, deadline, asset closure assertion or complete-backup comparison changes. The repaired focused pair passes 2/2 (12.7 s); project check passes 140 units/lint/types/build.

Final source `c27d28fd8057ff8a20a5ee8638a56c9b8c7e0508`, local/published tree `f3b83a89fb4ba4b579d3d2ff9b58b24a77a03c37`, adds only this poll repair. Final local verification passes 140 units/lint/types/build and all 172 native cases (6.5 min). Fresh source CI [38888454919](https://github.com/twangyal/projects-monorepo/actions/runs/38888454919) passes the same 140/172 gates (browser 5.2 min); completed job 116931855908 logs are inspected. Main advances from 7da2b58 to this exact source by matching-head lease. Main CI [38889193814](https://github.com/twangyal/projects-monorepo/actions/runs/38889193814) passes 140 units, lint, types, build and all 172 native browser cases; completed job 116934278755 logs are inspected. The canonical checkout fast-forwards to the tested tree and is clean. Final root-only receipt/direction/plan updates preserve the application, workflow and roadmap trees exactly. Issue #270 is complete to this software milestone; physical fabric/fit and intended-user/device acceptance remain unverified, and Clothing stays ACTIVE.

## Retained log identities

| Evidence | SHA-256 |
| --- | --- |
| Initial 140 check | `84e6f90e6e82ac28ea751b2c985ce20a5c75fbafbd1b0104f8f1a4137ac9db6c` |
| Initial 9 native | `715a0afe720dce7bbfb4c823e467dfd5af4e836b94532e018c78da79bb116ee6` |
| Absent domain RED | `2e257ca23c7ca52891f10b1d202fe9926eec1d03d60ea75a4e2810415d1fc821` |
| Absent controls RED | `47a5efd4eedd607cbb0959da8e24553662cf6f31ab1b905f63ef068a1763af9b` |
| Late encoding failure RED | `e7d2893bb935959810cc603653aa565a39b26ace6684afdc8b32d14913b6b1de` |
| Interrupted first expanded native | `3640edf4b8bacc932432787071b39142138e3ae1cfe1adca60785584ecdbccce` |
| 8pass/1fixture-fail | `90cc3313787492220c020a97f90fdf81a2b692335c5135fd0824fce70cea5f53` |
| Native selector probe | `68fb43ce17e9faca16b4f84cd2f1f2bc0a6c9fcb16f9e54186eae207de747755` |
| Confirmed-replacement fixture diagnosis | `f472fcc9e29dd08acd5aa43597139a06e3180ab7649540cf94ea2760ffc240e8` |
| Full harness setup failure | `a35893d56237f7041c0efe6e5b7bb2265bb975305f4d82fadbc86b00119f6498` |
| Two independent-review regressions RED | `7764f25bddf164655774c5b5966ab2112d43bef88c83690af38b1cf5b2f1dc1e` |
| Reviewed 140 check | `e04e302810b9f3305bdf77f5bca89ae9253844238e4718c7e8922016dbf1ffc7` |
| Reviewed 11 native | `396c206d1901f6b966e00ac6452b92cdde9678be6d54b792d86c9e86afcd0252` |
| Reviewed full 170 pass / 2 poll failures | `9fe775e3dab15d4fba32459e6ee9ad41bf6d9ef1742eddf082232fbd47f56d0a` |
| Unchanged focused 1 pass / 1 poll failure | `c3a306aaa8a31ce274d8e3383f3f315995c2a67408135cfa23a5c7524e12f5bc` |
| Repaired poll 2 native passes | `02c97a44110cc84bfd5c4c9d867801001beaa8f901adc5c25aee095c8f9069c4` |
| Final source 140 check | `0c85f072b8c67b5a9dc8362451da961441636319e79fc769c5322025ba5a9d5f` |
| Final full 172 native passes | `2e8525ccc707ab58e4c3fb702549f531064d6787dfb0913050c0c34b80a9c16f` |
