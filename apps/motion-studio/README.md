# Motion Studio

A local, account-free browser drawing and animation studio. Draw freehand or shape artwork on layers, hold drawings frame by frame, animate layers with pose keyframes, generate reviewed geometric in-betweens, and export PNG, GIF or a PNG frame sequence. An optional local service can publish immutable private snapshot links.

**Status:** DEFERRED (2026-10-25) — paused while the portfolio focuses on Gaze Navigator, Clothing Studio and Karaoke Studio. Direction: [docs/PRODUCT_DIRECTION.md](../../docs/PRODUCT_DIRECTION.md)

## What works today

- **Stage-first workspace:** the canvas stays prominent; Draw, Layers, Poses, Drawings, Projects, Share, Export and Help open as focused sections, with an expanded all-tools view.
- **Drawing:** freehand, line, rectangle and ellipse tools with ink color and brush width; up to 8 layers (drawing or imported PNG/JPEG/WebP image), reorder, duplicate and delete.
- **Stroke editing:** select, move, recolor, resize width, fill (nonzero polygon fill), duplicate, mirror, scale, rotate 90°, reorder, and edit, insert or delete individual points.
- **Frame-by-frame drawings:** blank or duplicated held drawings (cels) at any frame, movable start frames, and onion-skin guides for the previous and next drawing.
- **Pose animation:** per-layer position, scale, rotation and opacity keyframes with linear, ease or hold interpolation; keyframes can be retimed. 12 fps, 1–8 second timelines, playback with loop.
- **In-betweens:** pick two adjacent drawings, pair their strokes (or let shape-based suggestions pair them), preview and apply editable generated drawings.
- **Projects:** up to 8 projects autosaved in IndexedDB with multi-tab conflict protection and saved-record recovery, Undo/Redo, and portable `.motion.json` backups.
- **Export:** opaque or transparent frame PNG, looping GIF (256-color palette), and a ZIP of full-color PNG frames with a manifest.
- **Private snapshot links (optional):** a local Node service publishes a captured project and returns separate viewing and revocation links; recipients can play, export or copy it into their own browser library.

## Known gaps

- No AI-assisted in-betweening; current in-betweens are deterministic geometry and do not understand what a stroke depicts.
- No eraser or path cutting, no paint-bucket fill, brushes are plain strokes.
- Small fixed canvas (640×360, 12 fps, at most 8 seconds) and tight artwork budgets (100 strokes, 10,000 points per project).
- No audio, no video export, no live collaboration or sync; private links are snapshots, not shared editing.
- Only Chromium is tested. Physical touch devices and the private service across real devices are unverified.

## Run locally

Requires Node.js 24 or newer and npm.

```sh
cd apps/motion-studio
npm ci
npm run dev        # Vite dev server on 127.0.0.1
```

Open the URL Vite prints. No account, API key or environment variables are needed. `npm run build` writes the static site (editor `index.html` and snapshot viewer `view.html`) to `dist/`; `npm run preview` serves it on 127.0.0.1.

### Optional private snapshot service

Needs Linux with `/proc/self/fd`, `flock` (util-linux) and a production build. The setup token authorizes creating snapshots; keep it in a private, mode-0600 file owned by the service user and never commit it.

```sh
npm run build
install -d -m 700 /absolute/private/motion-config
(umask 077; openssl rand -hex 32 > /absolute/private/motion-config/setup-token)
npm run serve -- --data-dir /absolute/private/motion-snapshots --port 8770 \
  --setup-token-file /absolute/private/motion-config/setup-token
```

The service binds to 127.0.0.1 by default (port 8770). To reach it from other devices on a trusted private network, pass `--bind <RFC1918 IPv4>`, `--origin https://...`, `--tls-cert` and `--tls-key` together; only loopback or private IPv4 binds are accepted, and the certificate must already be trusted by each browser. Viewing and revocation links are bearer capabilities: share viewing links only, and keep revocation links private. With the service stopped, `npm run serve -- --data-dir <dir> --inspect` lists stored publications and `--revoke-id <UUID>` revokes one. The store holds at most 8 active publications.

## Verify

```sh
npm run lint
npm run typecheck
npm test                     # Node unit tests, including the private service
npm run build
npm run check                # test + lint + build
npx playwright install chromium
npm run test:browser         # Playwright, builds and serves on port 4210
```

Browser tests build with `MOTION_TEST_HARNESS=1` to include test-only harness pages; set `MOTION_TEST_PORT` or `CHROMIUM_PATH` to override the port or browser. CI: `.github/workflows/motion-studio.yml` (installs `openssl` and `util-linux`, then runs check, typecheck and browser tests).

`scripts/` holds standalone maximum-size smoke probes (`smoke_*.mjs`, `check_tween_limits.mjs`); they are not part of CI.

## Project layout

- `index.html`, `src/main.ts` — editor page and wiring; `view.html`, `src/snapshot-view.ts` — private snapshot viewer.
- `src/workspace-view.ts` — focused workspace sections.
- `src/model.ts`, `src/history.ts`, `src/cel-timing.ts` — project schema, limits, undo and timing edits.
- `src/render.ts`, `src/stroke-paint.ts`, `src/playback.ts`, `src/onion-skin.ts` — rendering and playback.
- `src/stroke-edit*.ts`, `src/shape-draw.ts`, `src/layer-copy.ts`, `src/images.ts` — drawing and editing tools.
- `src/tween*.ts` — in-between pairing, suggestions and preview.
- `src/export.ts`, `src/gif.worker.ts`, `src/png-*.ts` — PNG, GIF and frame ZIP export.
- `src/library-*.ts`, `src/storage.ts` — IndexedDB project library and recovery.
- `src/private-*.ts` — browser client for snapshot links.
- `server/` — optional snapshot service (`main.ts` CLI, HTTPS transport, PNG/project admission, file store).
- `tests/` — `*.test.ts` unit tests and `*.spec.ts` Playwright tests.

## Data & privacy

Editing and export are fully local; projects live in this browser profile's IndexedDB and can be lost if site data is cleared, so download backups. Imported images are re-encoded as embedded PNGs (longest side at most 800 px). Nothing leaves the machine unless you publish to the private service, which stores only the snapshots you publish in its data directory and never lists them over HTTP. Revocation stops future reads but cannot recall copies already downloaded.

## Third-party code

GIF encoding uses [gifenc](https://github.com/mattdesl/gifenc) and the service uses [pngjs](https://github.com/pngjs/pngjs), installed from npm under their own licenses.
