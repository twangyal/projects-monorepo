# Color Context Lab

A local workspace for comparing the same artwork within different surrounding colors. Import a PNG, choose a solid or checker surround, inspect the neutral/result pair, and export lossless PNGs or a complete editable project. The retained artwork rectangle stays byte-identical; only pixels around it change.

This first milestone is tracked in [issue #70](https://github.com/twangyal/projects-monorepo/issues/70). Its separate controlled shape experiment investigates a small classifier's sensitivity to context. It provides no protection score for uploaded artwork and no claim of resistance to generative-model training or preserved human appearance.

## Run

Use Node.js 22.18 or newer; development and CI use Node 24.

```sh
cd apps/color-context-lab
npm ci
npm run dev
```

Open `http://127.0.0.1:4289`. For the normal production build:

```sh
npm run build
npm run preview -- --port 4289 --strictPort
```

There is no backend, account, API key, remote image upload or pretrained model download. Images and edits stay in your browser. Changing host, port or browser profile changes the local saved project; download a project file before moving work or clearing browser data.

## Compare an image

Choose **Import PNG**. Supported files are noninterlaced, 8-bit RGB or RGBA PNGs up to 8 MiB, 8,192 pixels on a side and 16 million pixels overall. Animated, indexed-color, grayscale, high-bit-depth, interlaced or orientation-tagged PNGs are unsupported, as are JPEG, WebP, SVG and GIF. Convert those files to the supported PNG format first.

The browser decodes and, when needed, reduces the longer side to 720 pixels. The resulting sRGB Canvas RGBA raster becomes the **normalized original**. Decoding, color conversion, alpha handling and downsampling can change pixels from the compressed upload. Keep that original file: this project retains the normalized raster, not the uploaded file's compressed bytes or metadata.

Choose **Surround pattern**, width, colors and checker cell size, then **Apply changes**. The left view shows a neutral gray surround; the right shows the selected surround with the same dimensions and artwork placement. **View scale** switches between fitting the view and actual pixel scale. Transparent artwork remains transparent. The checkerboard behind a preview is a display aid and is not included in exports.

Unsent fields remain separate from applied settings. Apply commits one reversible edit. **Undo** and **Redo** retain up to 30 edit states within 128 KiB, sharing one immutable image. They ask you to apply or discard unsent fields first. **Discard unsent changes** requires confirmation. Importing another image or opening a project starts a new history after the applicable replacement confirmation.

Surround width is 0–128 pixels; checker cells are 4–128 pixels. A zero-width surround changes no pixels. Colors are explicit six-digit RGB values. The maximum output is 976 × 976 pixels.

## Read the measurements

**Artwork pixels unchanged** refers to an exact RGBA comparison within the retained image rectangle. It does not mean the entire framed output is unchanged or that people perceive it identically.

Whole-canvas RGB RMSE and maximum channel difference use encoded sRGB byte values relative to the neutral-gray comparison. Mean absolute relative-luminance difference uses the documented sRGB transfer function and linear RGB weights. These are numerical diagnostics, not perceptual thresholds, calibrated image-quality judgments or art-protection measurements. The report retains their full numerical values and transformation parameters.

## Export and recover

**Download normalized original PNG** exports the retained source raster; **Download result PNG** includes its chosen surround. The encoder writes the retained RGBA bytes directly, including low- and zero-alpha RGB, without reading pixels back from the display Canvas.

**Download project** creates a self-contained schema-1 JSON backup with normalized raw RGBA, source labels, title and settings, bounded at 4 MiB. It contains committed work, not unsent fields or session history. **Download comparison report** creates a self-contained HTML file with both exact PNGs, parameters, measurements and a digest computed from the actual retained pixels. No scripts or external resources are required. The digest identifies bytes, not source authenticity. Result/report exports require applied settings; source/project exports clearly use committed work.

Committed projects save locally in a complete IndexedDB transaction. The saved status appears only after that transaction completes. Failed saves retain current memory, Undo and downloads; **Retry saving** is explicit. **Stop** retires active image or export work without replacing current work with a late result.

Startup waits for the actual saved-record result. Failed or invalid restoration protects the durable record and offers **Retry loading**, **Download raw saved record**, and **Continue without saving**. Memory-only editing does not automatically overwrite that record. **Save current project** separately confirms saving the applied state and restores autosave only after success.

**Clear saved project** deletes only the durable copy after confirmation. Current memory, history and unsent fields remain; protection stays enabled so later edits do not silently recreate the cleared copy. **Save current project** explicitly enables saving again. Raw recovery exports only bounded valid-Unicode saved text; unsupported stored values remain protected.

## Controlled shape experiment

The research panel is separate from uploaded artwork. It reports an original procedural four-shape classification task with three training conditions: neutral surrounds, deliberately class-correlated colors, and label-independent colors with identical palette frequencies and RGB squared distortion. Paired images retain exactly the same foreground pixels. Geometry families are assigned to training, development or test before variants are made.

The fixed protocol uses three learner seeds, 18 real fits and 108 declared evaluation conditions. Neutral-development learnability must pass the predeclared gate before any test predictions are evaluated. Counterfactual surrounds, inference-only masking and separately retrained masking test context sensitivity and one obvious preprocessing bypass. Every declared result is retained, including null, negative or inconclusive outcomes. A shortcut in this deliberately constructed task is not evidence about artist styles, diffusion models or prevention of training.

The protocol, generator fingerprint, complete ordered dataset manifest and independent prefit receipt were committed in `b2b782b50341b9279538437aafba7aa7ec387abf` before fitting was released. The first prescribed run completed all 18 fits and 108 evaluations. Its actual result is a **null effect**: every condition reached accuracy and balanced accuracy 1.0, with paired prediction flips and neutral-training baseline differences 0.0. These fixed surrounds did not change any tested predicted labels. This does not demonstrate context sensitivity or artwork protection. The clean-process repeat matched every coefficient hash, prediction, metric and other result field exactly; only measured fit durations differed. Both independently verified reports are retained: the first is the published artifact, and the repeat is in `experiments/results/repeat-report.json`. The runs took 126.99 and 128.63 seconds in the recorded environment. See [the complete evidence](docs/2026-10-04-experiment-verification.json).

Use Python 3.12 in a separate environment for experiment checks:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r experiments/requirements.txt
.venv/bin/python -m unittest discover -s experiments/tests -v
.venv/bin/python experiments/oracle/check_experiment.py \
  --manifest experiments/frozen/manifest.json --producer-api --tiny-learner
```

These checks verify the original mathematical fixtures and use only unrelated tiny data to check learner plumbing. They do not fit the protocol models or evaluate their held-out predictions. The canonical manifest lists every family's actual unrounded parameters, palette assignments, sample IDs and center hashes. `experiments/frozen/receipt.json` binds the exact protocol, generator source and manifest.

To reproduce the fixed experiment separately, use a new output directory:

```sh
.venv/bin/python experiments/run.py --fit \
  --manifest experiments/frozen/manifest.json \
  --receipt experiments/frozen/receipt.json --output /tmp/color-context-run
```

The runner refuses mismatched inputs and existing output directories, fixes numeric libraries to one thread, and supervises a ten-minute/32 MiB output budget. It preserves truthful partial or inconclusive results; it does not change parameters after viewing an outcome. Source changes require a new preregistered experiment rather than reusing the frozen receipt. The frozen artifact can be inspected without rerunning training. Check its complete metrics and identity with:

```sh
.venv/bin/python experiments/oracle/check_experiment.py \
  --results public/experiment-report.json \
  --receipt experiments/frozen/receipt.json --allow-authorized-results
```

This command validates already released results; it does not fit or tune models.

## Verify

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

For system Chromium, use `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`. The browser suite reserves port 4290 and exercises the production build, real files, native workers, IndexedDB and actual downloads. Storage/media harnesses are included only when tests request them. Python experiment verification is separate from the browser workspace and uses its own pinned requirements.

The initial milestone passes 69 TypeScript tests, 12 Python tests and 32 native browser cases. An independent oracle checks the frozen manifest, actual results and numerical invariants without rerunning protocol training. The browser checks include real decoding and worker termination, genuine transaction aborts/timeouts, exact exports, persistent process restart, maximum-size output and usable editing when experiment results are unavailable.

For a separate maximum-size production acceptance run, start the normal production preview on port 4289 and use a new output directory:

```sh
COLOR_CONTEXT_BASE_URL=http://127.0.0.1:4289 \
COLOR_CONTEXT_OUTPUT_DIR=/tmp/color-context-acceptance \
CHROMIUM_PATH=/usr/bin/chromium \
node --experimental-strip-types scripts/smoke_workspace.mjs
```

This imports all 2,073,600 raw bytes of a 720 × 720 image, independently decodes the 976 × 976 exports, checks every metric, and compares the complete JSON/PNG/HTML artifacts byte-for-byte through a full Chromium process restart. It preserves downloaded artifacts, desktop/mobile screenshots and a verification receipt.

The [frozen design](../../docs/superpowers/specs/2026-10-04-color-context-lab-design.md) and [implementation plan](../../docs/superpowers/plans/2026-10-04-color-context-lab.md) define the exact byte, numerical, lifetime and preregistration contracts. Measured experiment evidence is retained in [the experiment record](docs/2026-10-04-experiment-verification.json); the [workspace record](docs/2026-10-04-workspace-verification.json) retains native maximum-size evidence, screenshots, corrections and CI status. Broader artwork protection remains an unproven hypothesis.
