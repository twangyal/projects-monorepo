# Style Studio

A local style and wardrobe notebook that runs entirely in the browser. You pick pictured outfits you like or pass on, add pieces you own with tags you choose, and a small preference model fitted from your own labels ranks and suggests looks. Photos are optional references: the app does not recognize garments, judge fit or search a shopping catalog, and its score reflects alignment with your labels, not objective style.

**Status:** DEFERRED (2026-10-25) — paused while the portfolio focuses on Gaze Navigator, Clothing Studio and Karaoke Studio. Direction: [docs/PRODUCT_DIRECTION.md](../../docs/PRODUCT_DIRECTION.md)

## What works today

- Guided picture onboarding: Like, Pass or Skip twelve original outfit illustrations, then see up to three inspiration outfits without typing anything.
- No-typing wardrobe intake: **Start with top / bottom / shoes** adds a piece with editable starter tags and an optional photo.
- Taste learning: label examples Like or Pass; once there are at least eight (three of each), an in-browser logistic-regression model scores outfits and shows which tags drove the score.
- **Build a look** from chosen owned pieces, or **Suggest looks** in Match or Explore mode, filtered by occasion (any, casual, smart, formal).
- Saved looks keep snapshots of their pieces and photos, can be rated, and carry a wear diary (date, occasion, notes). **Avoid previously worn outfits** excludes combinations recorded in the diary.
- Local photo color reading: up to three main colors per piece, a suggested palette tag you can apply, and a contrast/hue summary for a chosen outfit.
- Export an outfit board as PNG and the full profile (including photos) as a JSON backup; import it elsewhere.
- IndexedDB autosave with protection against corrupt records and against another tab overwriting newer data; session Undo/Redo.
- A sample profile with clearly labeled sample preferences.

## Known gaps

- Taste is learned from tags you supply; there is no image recognition, so photos do not inform suggestions.
- The picture set is a small built-in catalog of illustrations. A larger curated or licensed image set (the direction mentions evaluating Pinterest or similar) has not been chosen.
- Suggestions are not explained in plain language beyond tag contributions, and there is no occasion planning or calendar.
- Scores are not calibrated and have not been validated with real users. Fit and real-world taste relevance are untested.
- Data lives in one browser profile; there is no sync or account.

## Run locally

Requires Node.js 22.18 or newer (CI uses Node 24). No backend, API keys or model downloads.

```sh
cd apps/style-studio
npm ci
npm run dev -- --host 127.0.0.1
```

Production build and preview:

```sh
npm run build
npm run preview -- --host 127.0.0.1
```

Browser storage is tied to the exact origin, so changing host or port starts with an empty profile.

## Verify

```sh
npm run check            # unit tests + ESLint + typecheck + production build
npx playwright install chromium
npm run test:browser     # Playwright against the production build
```

Individual steps: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build`.

Environment variables for browser tests: `CHROMIUM_PATH` (use an existing Chromium), `STYLE_TEST_PORT` (default 4240). The test build sets `STYLE_STUDIO_TEST_HARNESS=1` to include storage and image test harness pages; normal builds omit them.

CI: `.github/workflows/style-studio.yml`.

## Project layout

- `src/main.ts` — UI and app wiring.
- `src/style-journey.ts` — guided onboarding screens and navigation.
- `src/inspiration.ts` — built-in illustrated outfit catalog and inspiration ranking.
- `src/quick-wardrobe.ts` — no-typing wardrobe intake.
- `src/model.ts`, `src/features.ts` — preference model and tag feature vectors.
- `src/color-read.ts` — local photo color extraction and palette rules.
- `src/images.ts`, `src/photo-header.ts` — photo validation, normalization and PNG boards.
- `src/domain.ts`, `src/types.ts` — profile schema, limits and validation.
- `src/storage.ts`, `src/history.ts` — IndexedDB autosave and Undo/Redo.
- `src/demo.ts` — sample profile.
- `tests/*.test.ts` — Node unit tests; `tests/browser/` — Playwright specs.
- `scripts/smoke_saved_copy_conflicts.mjs` — optional maximum-capacity conflict smoke test (needs Python 3 with Pillow and a served build).

## Data & privacy

Everything stays in the browser: no network inference, external image requests or accounts. Uploaded photos (JPEG, PNG or WebP) are re-encoded to a 720 × 720 JPEG thumbnail, which strips source metadata. Browser storage is not a backup; use **Export profile**.

## Visual sources

The pictured outfits and sample wardrobe are original SVG/procedural illustrations created in this repository. No Pinterest or other third-party images are bundled or downloaded.
