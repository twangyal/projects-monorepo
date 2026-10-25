# Color Context Lab

A local, in-browser workspace for viewing the same artwork inside different surrounding colors and patterns, plus a small controlled experiment on whether surround color affects what a classifier learns. Only pixels around the artwork change; the artwork rectangle stays byte-identical. Nothing here protects artwork from model training, and the app makes no such claim.

**Status:** DEFERRED (2026-10-25) — paused while the portfolio focuses on Gaze Navigator, Clothing Studio and Karaoke Studio. Direction: [docs/PRODUCT_DIRECTION.md](../../docs/PRODUCT_DIRECTION.md)

## What works today

- Import an 8-bit RGB/RGBA PNG (normalized to at most 720 px on the long side).
- Surround patterns: solid, checker, horizontal stripes and vertical stripes, with width, two colors and pattern size.
- Side-by-side view of a neutral-gray surround and the chosen surround, at fit or actual pixel scale.
- Numerical diagnostics against the neutral version: artwork-unchanged check, RGB RMSE, max channel difference and mean relative-luminance difference.
- Keep up to 12 named surround alternatives, compare any two side by side and download a named comparison report.
- Exports: normalized original PNG, result PNG (lossless, written directly from retained RGBA), self-contained HTML comparison report and a JSON project backup.
- Undo/Redo and IndexedDB autosave, with recovery options when a saved record cannot be loaded.
- A research panel showing the published result of the controlled shape experiment (below).

## Known gaps

- The research question (keep human appearance while disrupting how image models learn) is unanswered. The one controlled experiment found no effect: all conditions reached perfect accuracy and surrounds did not change any predicted label.
- Experiments use a procedural four-shape task and a small classifier, not real artwork, artist styles or generative models.
- No perceptual or human-viewer measurement; diagnostics are numerical only.
- Surrounds are simple geometric patterns; no other color transforms are tried.
- Only a limited PNG subset is accepted (no JPEG, WebP, indexed, grayscale, 16-bit or interlaced files).

## Run locally

Requires Node.js 22.18 or newer (CI uses Node 24). No backend, account, API key or model download.

```sh
cd apps/color-context-lab
npm ci
npm run dev                 # http://127.0.0.1:4289
```

Production build and preview:

```sh
npm run build
npm run preview -- --port 4289 --strictPort
```

Browser storage is tied to the exact origin; download a project file before changing host/port or clearing browser data.

## Verify

```sh
npm run check            # unit tests + ESLint + typecheck + production build
npx playwright install chromium
npm run test:browser     # Playwright against the production build
```

Individual steps: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build`. Environment variables: `CHROMIUM_PATH` (use an existing Chromium), `COLOR_CONTEXT_TEST_PORT` (default 4290). Test builds set `COLOR_CONTEXT_TEST_HARNESS=1` to include storage and media harness pages.

Experiment checks (Python 3.12 in a separate environment; these do not refit the protocol models):

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r experiments/requirements.txt
.venv/bin/python -m unittest discover -s experiments/tests -v
.venv/bin/python experiments/oracle/check_experiment.py \
  --manifest experiments/frozen/manifest.json --producer-api --tiny-learner \
  --results public/experiment-report.json \
  --receipt experiments/frozen/receipt.json --allow-authorized-results
```

Optional extra checks:

- Maximum-size workspace smoke against a running preview: `node --experimental-strip-types scripts/smoke_workspace.mjs` with `COLOR_CONTEXT_BASE_URL`, `COLOR_CONTEXT_OUTPUT_DIR` and `CHROMIUM_PATH`.
- Independent PNG decode check (needs Pillow; writes `/tmp/color-context-*` files): `node --experimental-strip-types scripts/export-core-oracles.ts && python scripts/verify-core-oracles.py`.

CI: `.github/workflows/color-context-lab.yml` (runs the Python experiment checks, then `npm run check` and the browser tests).

## Controlled experiment

`experiments/` holds a preregistered experiment: an original procedurally generated four-shape classification task trained under neutral, class-correlated and label-independent surround colors (three seeds, 18 fits, 108 evaluation conditions). The protocol and dataset manifest are frozen in `experiments/frozen/` before fitting. The published result is `public/experiment-report.json` (shown in the app), and a clean-process repeat is in `experiments/results/repeat-report.json`. Both runs gave the same null result.

To rerun the full fit into a new output directory (takes a few minutes):

```sh
.venv/bin/python experiments/run.py --fit \
  --manifest experiments/frozen/manifest.json \
  --receipt experiments/frozen/receipt.json --output /tmp/color-context-run
```

The runner refuses mismatched inputs or an existing output directory. Changing the experiment means writing a new preregistered protocol, not reusing the frozen receipt.

## Project layout

- `src/main.ts`, `index.html` — UI and app wiring.
- `src/model.ts`, `src/types.ts` — project schema, settings, variants and validation.
- `src/render.ts`, `src/image.worker.ts`, `src/jobs.ts` — surround rendering and cancellable worker jobs.
- `src/images.ts`, `src/png.ts` — PNG import/normalization and lossless encoding.
- `src/report.ts` — HTML comparison reports and diagnostics.
- `src/experiment.ts` — loading and displaying the experiment report.
- `src/storage.ts`, `src/history.ts` — IndexedDB autosave and Undo/Redo.
- `experiments/` — Python generator, runner, report builder, oracle checker, tests and frozen inputs.
- `public/experiment-report.json` — published experiment result.
- `scripts/` — optional smoke and independent oracle checks.
- `tests/*.test.ts` — unit and oracle tests; `tests/browser/` — Playwright specs.

## Data & privacy

Images and edits stay in the browser. Projects store the normalized raster, not the original upload or its metadata, so keep your original file.
