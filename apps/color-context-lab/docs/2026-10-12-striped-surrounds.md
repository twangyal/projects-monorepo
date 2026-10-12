# Directional striped surrounds — fresh verification

Issue [#199](https://github.com/twangyal/projects-monorepo/issues/199). Initial canonical base: `a11c312f13f76630cb72f5a91c3fe1e2e4f3644f`. Commands and results below are fresh on 2026-10-12; older receipts remain historical.

## User outcome and scope

Artists can compare horizontal and vertical color bands alongside Solid and Checker. Both directions reuse colors A/B and the existing 4–128 pixel size: horizontal bands vary by row, vertical bands by column, starting with A at the complete output canvas origin. Only the surround changes; retained artwork RGBA replaces it byte for byte, including RGB behind zero/low alpha. Width, maximum 976×976 output, complete-project, history, variant and worker limits stay intact.

The existing Apply/Discard → Undo/Redo → autosave/reload → complete project/variant → live comparison → PNG/HTML workflow carries both new modes. Named alternatives show both colors and band size. New reports label Stripe band pixels; legacy solid/checker reports retain their prior labels. Older builds that know only the two legacy patterns will reject striped backups; use an updated build. Numerical diagnostics and an unchanged artwork rectangle do not establish unchanged human perception or resistance to model training. No new protection claim, dependency, service or experimental result is introduced.

## Setup and exact commands

Commands ran from `apps/color-context-lab` in the isolated owned `/workspace/projects-cycle-2026-10-12` worktree. Runtime: Node 24.19.0, npm 11.9.0, Python 3.12.14, Chromium 151.0.7922.173. Network/loopback commands used the supported command-scoped network grant while preserving inherited sandbox, proxy, CA and TLS settings. Port 4392 belonged to the test-owned production preview service; no existing server was reused.

```sh
npm ci --ignore-scripts --cache /tmp/projects-cycle-2026-10-12-npm-cache
python3 -m venv /tmp/projects-cycle-2026-10-12-venv
/tmp/projects-cycle-2026-10-12-venv/bin/python -m pip install -r experiments/requirements.txt --cache-dir /tmp/projects-cycle-2026-10-12-pip-cache
```

Baseline `npm run check` passed **98 TypeScript cases**, lint, types and production build before product changes.

Fresh RED commands:

```sh
node --experimental-strip-types --test tests/stripes.test.ts
COLOR_CONTEXT_TEST_PORT=4392 CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- tests/browser/stripes.spec.ts --grep 'reversible edits'
```

All four domain cases failed because the validator supported only solid/checker. The actual workbench case failed at the absent horizontal-stripes option, after successful production build and source-project load.

Final checks:

```sh
npm run check
COLOR_CONTEXT_TEST_PORT=4392 CHROMIUM_PATH=/usr/bin/chromium npm run test:browser -- tests/browser/stripes.spec.ts
COLOR_CONTEXT_TEST_PORT=4392 CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 /tmp/projects-cycle-2026-10-12-venv/bin/python -m unittest discover -s experiments/tests -v
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 /tmp/projects-cycle-2026-10-12-venv/bin/python experiments/oracle/check_experiment.py --manifest experiments/frozen/manifest.json --producer-api --tiny-learner --results public/experiment-report.json --receipt experiments/frozen/receipt.json --allow-authorized-results
```

- `npm run check`: **102 TypeScript cases**, ESLint, type checking and production build passed.
- New native application flows: **3 passed**. Full native gate: **45 passed**, no skips. Browser runs and builds ran sequentially; tracing/timeouts/assertions were unchanged.
- Python experiment suite: **12 passed**. Frozen oracle: **passed**, independently checked 18 recorded models/108 evaluations and complete producer dataset bytes. **Zero protocol fits or protocol test predictions executed**. The small unrelated learner probe ran; the historical full study was not retrained and its null result is unchanged.

## Reproducible evidence

The new renderer tests use original nonsquare 15×14 row/column strings (`AAAABBBBAAAABB` / `AAAABBBBAAAABBB`) and six supplied RGBA pixels. Expected stripe pixels do not call the production renderer or reproduce its parity expression. Diagnostics are independently recomputed from complete expected bytes. Checks include exact artwork rows, finite supported sizes, rejection of unknown patterns, zero-width source equivalence, neutral-color equivalence, canonical legacy/project/variant round trips, and both stripe directions at 976×976 with 217,088 black surround pixels and 434,176 total surround pixels.

Actual application tests decode downloaded PNGs with pngjs and compare every byte, including hidden and low-alpha artwork. They check regular and named report embedded PNGs, source retention, Undo/Redo, autosave/reload, invalid raw-size refusal, live directional Canvas pixels, unsent-field preservation, named restoration and complete project retention. The mobile keyboard flow uses an original 720×720 synthetic raster, a real maximum 976×976 result download, exact retained artwork rows and all eight visible band starts. The 390px page has no horizontal overflow; its screenshot was inspected.

## Failed attempts and remaining limits

The first three-case native run passed two cases; the named comparison case timed out because the new test incorrectly selected numeric option values. Existing variants select by their names. Correcting the test to the actual control contract produced all three passes, then all 45 full-gate passes. No product failure was hidden and no assertion or timeout weakened.

`gh issue create --repo twangyal/projects-monorepo --title 'Color Context Lab: compare directional striped surrounds' --body-file /tmp/projects-cycle-2026-10-12-issue.md` failed with a GitHub GraphQL execution error. A fresh exhausted all-state query confirmed it had created no duplicate; supported REST `POST repos/twangyal/projects-monorepo/issues --input ...` created #199 successfully.

Full host chat inventory is unavailable. Exhausted all-state issue/PR/branch pagination, current remote heads, concrete comments and the parent's visible activity check supplied overlap evidence. Earlier Melody #197 was monitored through its externally published implementation/local handoff; Motion #196's missing exact-head CI and subsequent Melody #198 work remain separate and are not claimed as this cycle's verification. No competing Color draft/task evidence was found. The frozen historical study does not evaluate the new stripe modes; artist perception and model-training resistance remain unmeasured.

CI conclusions and required-step outcomes are verified for the final pushed head and linked in the draft PR. Local counts above are not inferred CI counts. The owned preview service/browser processes and temporary profiles are cleaned up, while earlier checkouts/resources are preserved.
