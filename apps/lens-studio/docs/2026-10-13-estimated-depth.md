# Estimated depth in the editor — issue #217

## Intended outcome and gap

Lens Studio's perspective mode relies on depth. Before this work, every pixel's plane was assigned by hand. Research in #172 showed that Depth Anything V2 Small runs locally, but it was not admitted to the product. The open items were:
- model acquisition and license disclosure;
- browser inference with progress and cancellation;
- stale-result protection;
- an editable mapping onto the three-plane mask.

## Design

- **Model.** Depth Anything V2 Small (Apache-2.0) uses the dynamic-shape ONNX export from Depth-Anything-ONNX v2.0.0 on GitHub, pinned at 99,092,268 bytes with SHA-256 `46c4e8ee…deed8f`.
  - `npm run fetch-depth-model` installs it into the git-ignored `public/models/`. It verifies the file before publishing it, refuses a wrong file and keeps nothing.
  - The app loads the model from the same origin. Otherwise people choose a local copy, which is verified with `crypto.subtle` before use.
- **Preprocessing** (`src/depth-estimate.ts`, pure and unit-tested):
  - The model input follows the DPT lower-bound rule: keep aspect, shorter side at least 518, both sides multiples of 14. This gives `[1,3,518,686]` for 1280×960, matching the research harness.
  - Resampling uses separable, antialiased linear filtering; pixels are composited over black and normalized with ImageNet mean and standard deviation.
  - The output is resampled to photo size, and its 1st–99th percentiles are mapped to 0 (far) through 1 (near).
- **Worker** (`src/depth-estimate.worker.ts`, `src/depth-job.ts`):
  - It uses onnxruntime-web 1.23.2, the wasm build, with the binary served as a hashed asset.
  - It uses up to 4 threads when the page is cross-origin isolated; Vite dev and preview now send COOP/COEP headers. The runtime's helper thread workers re-load the same script, so the app's message handler is installed only outside those `em-pthread` workers.
  - Each estimate owns one worker. Cancel, the 3-minute deadline and every failure terminate it; replies are validated strictly; results for a different photo are discarded.
- **Panel** (`src/depth-panel.ts`):
  - Default split: the farthest half becomes far, the nearest 5% near, and the rest subject.
  - Clicking the subject sets a ±0.12 band around its estimated depth, and two sliders adjust the limits. Invalid limits (far at or above near) are refused.
  - Apply replaces the whole mask through the normal `commit`, so it is a single undo step, autosaved and exported as before. The project schema is unchanged.

## Verification (local, 2026-10-13)

Node.js 22, Chromium 141 via `CHROMIUM_PATH`.

- `npm run check` passes: 95 unit tests, 4 of them new, plus ESLint and the build. The new tests cover:
  - model input sizes against the research harness shape;
  - antialiasing, alpha handling and per-channel normalization;
  - robust percentile mapping, monotonicity and refusal of constant or invalid output;
  - thresholds, plane shares and a single-undo mask replacement.
- Native Chromium: **all 89 cases pass**, 3 of them new, using the committed 214-byte fixture model (`scripts/make-fixture-depth-model.py`). It has the real model's input and output contract and runs genuine onnxruntime-web inference in the worker. The new cases cover:
  - a cross-origin-isolated page;
  - an estimate that leaves the study unchanged until applied;
  - a subject click splitting a three-band photo into exact near/subject/far labels;
  - Apply as one Undo/Redo step, with autosave and reload keeping the mask;
  - slider limits, and refusal of a far limit at or above the near limit;
  - a new photo retiring the old estimate, and a uniform photo explained as having no depth variation;
  - an unhosted model, where a wrong file is refused and the right file is accepted;
  - a 390 px layout.
- **Real model.** The production build and preview were run with the hosted pinned model on three photos from the Depth Anything V2 repository's examples (runtime evidence only; the photos are not stored here):
  - Inference took **5.2, 4.8 and 4.7 s** on 4 threads (wall time to review: 13–16 s, including model loading). For comparison, #172 measured 22–26 s single-threaded.
  - A UI click during inference completed in 185 ms.
  - Applying the proposal and switching to Manual perspective at 70 mm rendered with 16–22% missing coverage.
  - A second run cancelled during inference was acknowledged in 40–77 ms, with Estimate depth immediately available again.
  - The panels and results were inspected visually.

## Not established

- **Quality.** Depth quality on held-out photos was not re-evaluated. This fp32 export differs from the int8 conversion evaluated in #172, whose ordinal checks and boundary diagnostics remain the only quantitative evidence.
- **Correction effort with people.**
- **Hardware.** Physical-device timings and memory, WebGPU, and hosting without COOP/COEP (single-threaded and slower) were not measured.
- **Worker teardown.** Native worker teardown after termination is controlled by the browser. As #172 observed, termination releases the page immediately, but teardown may complete later.
