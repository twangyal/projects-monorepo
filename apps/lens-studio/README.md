# Lens Studio

A private, in-browser photo workspace for exploring focal framing and depth-aware perspective. Import a photo, declare source and target focal lengths, assign pixels to near, subject and far planes (by hand or from a locally run depth model), compare the original with the simulated result, and export a PNG or an editable project. Photos never leave the device. Results are a simulation, not a recreation of a real camera.

**Status:** DEFERRED (2026-10-25) — paused while the portfolio focuses on Gaze Navigator, Clothing Studio and Karaoke Studio. Direction: [docs/PRODUCT_DIRECTION.md](../../docs/PRODUCT_DIRECTION.md)

## What works today

- Comparison-first workspace with focused sections: Open, Compare, Depth, Mask exchange, Project & export, Help (or **Expand workspace** to see everything at once).
- **Fixed camera** mode: changing focal length crops in or shrinks the frame around the center, with X/Y framing shift.
- **Manual perspective** mode: a three-plane model where focal length and camera distance change together to keep the subject the same size; near/far planes scale accordingly and uncovered areas stay transparent.
- Depth authoring tools: brush, rectangle, polygon outline, connected color (with tolerance), fill plane, plus source zoom (Fit/2×/4×) and pan.
- **Estimate depth**: Depth Anything V2 Small runs locally in a worker via onnxruntime-web and proposes a near/subject/far mask you review, adjust and apply as one undoable edit.
- Depth-mask exchange: download the label mask as PNG, edit it in another image editor, and re-import it after review.
- Undo/Redo, PNG export (lossless, computed off the main thread) and project JSON backup/import.
- IndexedDB autosave that refuses to overwrite a study changed in another tab and offers explicit reload/replace recovery.
- An authored three-plane demo illustration.

## Known gaps

- Perspective is a three-plane approximation; there is no continuous depth or true 3D reconstruction.
- Newly uncovered regions are left transparent; nothing generates or fills disoccluded content.
- No optical blur, lens distortion, camera rotation or lighting change. Results are not compared against calibrated real captures.
- Estimated depth is relative with unknown scale; edges, glass, reflections, sky and thin structures are often wrong. Correction effort and held-out quality are not measured with real users.
- Focal lengths are user declarations; camera metadata is not read.

## Run locally

Requires Node.js 22.18 or newer (CI uses Node 24) and a current desktop Chromium-based browser. No backend, account or API key.

```sh
cd apps/lens-studio
npm ci
npm run dev                 # http://localhost:4260
```

Production build and preview:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 4260 --strictPort
```

Estimated depth needs the model once:

```sh
npm run fetch-depth-model                 # downloads and verifies into public/models/ (git-ignored)
npm run fetch-depth-model -- --from FILE  # install a copy you already have
```

The ~99 MB file is checked against a pinned size and SHA-256 before use. If the app cannot find it, it asks you to choose the file. Multithreaded inference needs cross-origin isolation: `npm run dev` and `npm run preview` send the `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers; other static hosts must add them, otherwise inference is single-threaded and slower.

Browser storage is tied to the exact origin; use **Download project** before changing host/port or clearing browser data.

## Verify

```sh
npm run check            # unit tests + ESLint + typecheck + production build
npx playwright install chromium
npm run test:browser     # Playwright against the production build
```

Individual steps: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build`.

Environment variables for browser tests: `CHROMIUM_PATH` (use an existing Chromium), `LENS_TEST_PORT` (default 4261). Test builds set `LENS_STUDIO_TEST_HARNESS=1`, which adds image/storage/job harness pages and serves a tiny fixture depth model (`tests/fixtures/fixture-depth.onnx`, regenerated with `scripts/make-fixture-depth-model.py`) so browser tests run real onnxruntime-web inference without the full model.

CI: `.github/workflows/lens-studio.yml`.

## Project layout

- `src/main.ts`, `src/workspace-view.ts` — UI and focused-section navigation.
- `src/model.ts`, `src/types.ts` — study schema, settings and validation.
- `src/render.ts`, `src/render.worker.ts`, `src/jobs.ts` — projection renderer and cancellable worker jobs.
- `src/depth-mask.ts`, `src/regions.ts`, `src/color-regions.ts` — depth labels and region/color selection.
- `src/depth-estimate.ts`, `src/depth-estimate.worker.ts`, `src/depth-model.ts`, `src/depth-panel.ts`, `src/depth-job.ts` — local learned-depth proposal.
- `src/mask-png.ts`, `src/depth-mask-job.ts`, `src/depth-mask.worker.ts` — mask PNG import/export.
- `src/images.ts`, `src/photo-header.ts`, `src/png.ts` — photo validation/normalization and lossless PNG encoding.
- `src/storage.ts`, `src/history.ts` — IndexedDB autosave and Undo/Redo.
- `src/demo.ts` — authored demo.
- `scripts/fetch-depth-model.mjs` — model download/verification; `scripts/smoke_saved_copy_conflicts.mjs` — optional capacity smoke test.
- `tests/*.test.ts` (including an independent scalar oracle in `tests/oracle/`) — unit tests; `tests/browser/` — Playwright specs.

## Data & privacy

All processing, including depth inference, runs in the browser. Imported photos are normalized to a metadata-free PNG (longest edge at most 1,280 px). Project backups contain the normalized photo, settings and depth mask only. Browser storage is not a backup or sync.

## Third-party models and libraries

- [Depth Anything V2 Small](https://github.com/DepthAnything/Depth-Anything-V2) — Apache-2.0. The larger variants are non-commercial and are not used. The ONNX export is from [Depth-Anything-ONNX v2.0.0](https://github.com/fabio-sim/Depth-Anything-ONNX) and is downloaded on demand, not committed.
- [onnxruntime-web](https://github.com/microsoft/onnxruntime) — MIT.
