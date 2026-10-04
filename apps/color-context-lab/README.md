# Color Context Lab

A local workspace for comparing the same artwork within different surrounding colors. Import a PNG, choose a solid or checker surround, inspect the neutral/result pair, and export lossless PNGs or a complete editable project. The retained artwork rectangle stays byte-identical; only pixels around it change.

This first milestone is being implemented and verified in [issue #70](https://github.com/twangyal/projects-monorepo/issues/70). Its separate controlled shape experiment investigates a small classifier's sensitivity to context. It provides no protection score for uploaded artwork and no claim of resistance to generative-model training or preserved human appearance.

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

The protocol, generator fingerprint and complete ordered dataset manifest are committed before those fits are allowed. No protocol fit has been released yet. The current artifact is explicitly **not run**; it must not be interpreted as a successful experiment. Actual commands, measured results and reproducibility evidence will be documented after verification.

## Verify

```sh
npm run check
npx playwright install chromium
npm run test:browser
```

For system Chromium, use `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`. The browser suite reserves port 4290 and exercises the production build, real files, native workers, IndexedDB and actual downloads. Storage/media harnesses are included only when tests request them. Python experiment verification is separate from the browser workspace and uses its own pinned requirements.

The [frozen design](../../docs/superpowers/specs/2026-10-04-color-context-lab-design.md) and [implementation plan](../../docs/superpowers/plans/2026-10-04-color-context-lab.md) define the exact byte, numerical, lifetime and preregistration contracts. Final verification and measured limitations remain part of the open milestone.
