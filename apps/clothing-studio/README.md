# Clothing Studio

A local T-shirt concept workspace: adjust a silhouette, choose colors and visual textures, sketch on the garment, place it over a photo, and export your idea. No account, backend, image model, or paid service is required. Photos and projects stay in your browser.

The **approximate photo overlay** is a visual design aid. It does not estimate measurements, garment fit, fabric drape, depth, or body occlusion. Textures are procedural graphics. The concept note records your idea; it does not generate designs. Realistic try-on, generated concepts, and sewing/manufacturing patterns are future projects.

## Run

Use Node **22.18+** (CI uses Node 24) and npm:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. For a production build:

```sh
npm run build
npm run preview
```

The built `dist/` directory can be served by a static web server. Use a current browser with IndexedDB, SVG, Canvas and `createImageBitmap`; Chromium is automated below. Photo decoding can vary between browsers. No external assets, telemetry, or network requests are needed by the production app. The development server uses its local hot-reload connection.

## Create a concept

1. Name the project and adjust body width, body length, sleeve length, and neckline. Silhouette values are drawing units, not physical measurements.
2. Choose a color and plain/striped/woven visual appearance. Draw with a mouse, pen or touch; strokes are clipped to the garment. Reshaping keeps marks in the same canvas position, revealing/hiding marks at the new outline.
3. Upload a PNG, JPEG or still WebP photo, or use the included silhouette. Drag the preview to place the garment. Labeled fields control position, width, height, rotation and opacity. Focus the preview and use arrow keys to move 1%; Shift + arrow moves 5%.
4. Export a transparent garment PNG, an editable garment SVG, a composed preview PNG, or a complete JSON project backup. Open a backup to restore the photo, sketch, colors, note and placement.

**Export garment SVG** downloads the same 400×440 transparent garment illustration as vector paths: silhouette, plain/striped/woven pattern and clipped sketch strokes. Open it in a vector editor to recolor or continue drawing. The file has no external resources and is bounded at 1 MiB, including the maximum 100 strokes and 12,000 points. Geometry uses the renderer's six-decimal drawing precision; drawing units are not physical measurements. Its escaped title is accessible text. Photos, placement, the sample figure and concept notes remain in the complete JSON backup. SVG is an illustration export; use JSON to reopen editable work in Clothing Studio. Export cancels an unfinished sketch/placement preview and uses committed art without adding a history edit.

Undo/redo keeps the latest **40 edits** in this session. It includes sketch gestures, placement, clear, photo replacement and starting a new concept. Ctrl/⌘ Z and Ctrl/⌘ Shift Z work outside text/number fields; those fields retain native editing shortcuts. A blank concept name becomes “Untitled concept.” New edits after undo discard the redo branch.

## Local saving and image handling

- A single current project autosaves committed edits to IndexedDB after startup successfully restores or confirms no saved concept exists. Failed or superseded startup restoration protects the previous saved concept while current work remains editable in memory. **Replace saved concept** requires confirmation and enables autosave only after its native write succeeds; cancel or failure keeps protection active. Export the current backup before reloading memory-only work. Edits made during replacement are saved afterward; canceled sketch and placement previews are never persisted. Wait for **Locally saved** before closing the page. Undo history is session-only. Multiple tabs share the same local save; the last successful write wins.
- Storage restrictions, quota failures and invalid saved data are reported. The active concept remains available and can be exported as a backup. Browser data can be cleared by the browser or user; keep a backup for work you want to retain.
- Photo import accepts up to **10 MiB**, **16 million pixels**, and **8000 pixels on either edge**. Header bounds are checked before browser decoding. Photos are resized to at most **1200 pixels per edge** and normalized as JPEG, flattening transparency onto white and discarding original metadata. Your original file is not modified.
- Invalid containers, unsupported types, conflicting dimensions and undecodable data are rejected without replacing the active concept. Browsers can recover some damaged JPEGs, so successful decoding does not guarantee that every source pixel was intact; review the resulting preview.
- Backups are capped at **6 MiB**. Embedded photos must be bounded normalized JPEG data with dimensions matching the image. Names/notes, numeric ranges, colors, stroke data and version are validated; imported markup and external image URLs are not accepted.
- Sketches allow **100 strokes**, at most **1000 points per stroke**, and **12,000 total points**. Garment PNGs are 400×440; preview PNGs follow the resized photo dimensions, or 600×800 for the sample. No export exceeds 2048 pixels on an edge.
- Cancelled or superseded imports cannot replace your current work. Startup restore cannot overwrite editing that begins while a saved photo is decoding.

## Verify

```sh
npm run check             # unit tests, ESLint, TypeScript, production build
npx playwright install chromium
npm run test:browser      # starts and tests a production preview automatically
```

To use an existing Chromium binary:

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

Unit tests cover project validation, immutable bounded history, geometry/escaping, clipping, and image-header resource limits. Browser tests exercise the actual create/sketch/photo/backup/export workflow, local restore, invalid data preservation, cancellation/replacement races, storage failure, active-draft restore protection, portrait layout, keyboard controls and a narrow viewport. PNG checks verify dimensions and transparency. Tests generate synthetic photos locally and do not access personal files or services.

The app is independent of other monorepo projects. Source modules separate the validated project model, SVG/PNG graphics, photo processing, persistence and workspace interactions; no shared backend or framework is needed.


Startup recovery (#49) was verified on 2026-10-04 at `593f67aa880b7e84eb646bb26266d0955c2b5746` in [run 37197789513](https://github.com/twangyal/projects-monorepo/actions/runs/37197789513): 36 unit tests, lint/typecheck/build and all 17 production Chromium cases passed. Independent review found and reproduced a pending-replacement gesture race in two native cases before its committed-history correction. See [verification evidence](docs/2026-10-04-startup-recovery-verification.json).

The final presence-boundary correction at `f83e1b6` distinguishes a stored `undefined` from an absent key, keeping invalid records protected until explicit replacement. The added native case failed before this fix, and [run 37198211480](https://github.com/twangyal/projects-monorepo/actions/runs/37198211480) passes all 36 unit and 18 browser cases with lint/typecheck/build.
