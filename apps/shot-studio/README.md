# Shot Studio

A local 3D filmmaking sketchbook in plain browser JavaScript and WebGL. Stage two block performers in a courtyard, block their movement, light the set, compose static or traveling cameras, record takes, assemble scenes into sequences with a soundtrack, and export WebM video. There are no accounts, external assets or services, and projects stay in the browser.

**Status:** DEFERRED by the owner (2026-10-14). Direction: [docs/PRODUCT_DIRECTION.md](../../docs/PRODUCT_DIRECTION.md)

No replacement platform has been chosen.

## What works today

- One courtyard set with two performers: position, costume, looping actions (including walk and wave), or **Authored blocking** with timed position, action and visibility cues.
- Lighting controls and camera presets or numeric camera/target controls; shots can be static or **Linear travel** between start and end camera poses.
- Shot list of 1–20 shots (up to 60 seconds total) with rehearse, scrub and reorder; scene Undo/Redo.
- **Export WebM**: 960 × 540 at an authored 30 fps (VP9/VP8), muxed with the vendored Mediabunny library.
- Take notebook: record up to four takes, each paired with the exact editable film it came from; play, rename, delete, back up and import takes, or reopen a take's film for editing.
- **Scene sequence**: copy up to four scenes, assemble and trim clips (up to 20 clips / 60 seconds), rehearse, and export the sequence as WebM.
- Sequence soundtrack: import a PCM16 WAV (mono/stereo, 44.1/48 kHz, up to 60 s), set in/out/start/gain; included in sequence export.
- Save/open project JSON, sequence archives and take backups; autosave to localStorage/IndexedDB with protection against unreadable drafts and stale tabs.
- Experimental **Enter VR** (WebXR `immersive-vr`): stereo view of the stage, place a performer with a controller, capture a camera endpoint from the headset.

## Known gaps

- The owner deferred the app after review; whether it should remain a browser app is open.
- VR is untested on physical headsets; comfort, tracking and controller accuracy are unknown.
- Long exports can time out in full (headed) Chromium builds; browser tests run headless with software WebGL.
- Only one set, two block performers and hard cuts. No skeletal characters, dialogue, easing, transitions, scene audio or splicing of recorded clips.
- Exported timing and dropped frames depend on the browser and hardware.

## Run locally

Requires Python 3 and a WebGL-capable browser. No install is needed to run the app:

```sh
cd apps/shot-studio
npm run dev        # serves on http://127.0.0.1:4173 (python3 -m http.server)
```

VR needs a secure context (HTTPS or localhost) and supported hardware. Browser storage is tied to the exact origin/port; use **Save project** for portable backups.

## Verify

Requires Node 22+ for tests (CI uses Node 22). Browser tests also need FFmpeg (`ffprobe`).

```sh
npm ci
npm test                 # Node unit tests
npm run check            # syntax check of every source module
npx playwright install --with-deps chromium
npm run test:browser     # Playwright; starts its own server
```

Environment variables: `CHROMIUM_PATH` (use an existing Chromium), `SHOT_TEST_PORT` (default 4173).

CI:
- `.github/workflows/shot-studio.yml` — unit tests, syntax check, browser tests, plus a full-minute soundtrack export and restart check (`scripts/smoke_sequence_soundtrack.mjs`).
- `.github/workflows/shot-download-compatibility.yml` — download-compatibility measurement and export diagnostics in a separately pinned Chromium (`scripts/browser-155/`).

## Project layout

- `index.html`, `style.css`, `src/app.js` — page, styles, DOM state, drafts and imports.
- `src/model.js`, `src/performer.js`, `src/math.js` — scene schema/validation, camera and performer evaluation, transforms.
- `src/renderer.js` — native WebGL renderer; `src/xr.js` — WebXR session and controller input.
- `src/draft.js`, `src/history.js` — draft persistence and scene Undo/Redo.
- `src/export*.js`, `src/timestamped-export.js` — WebM export pipeline and policy.
- `src/take*.js` — take notebook: validation, archive format, storage, video and UI.
- `src/sequence*.js` — sequences: model, storage, archive, audio and UI.
- `vendor/mediabunny/` — vendored WebM muxer (see below).
- `scripts/` — maximum-size smoke tests and export/timing diagnostics used by CI.
- `tests/*.test.js` — unit and oracle tests; `tests/browser/` — Playwright specs.

## Data & privacy

Everything runs locally. Imports never execute code or fetch media. Recording does not use the camera or microphone, and audio comes only from WAV files you import.

## Third-party code

`vendor/mediabunny/` contains the unmodified browser build of [Mediabunny](https://github.com/Vanilagy/mediabunny) 1.61.1 (`mediabunny.min.mjs`), licensed MPL-2.0. Its `LICENSE` and matching upstream source (`source.tar.gz`, commit `922054aaac0bfe5e48545a46205038d6e73dc0d1`) are included alongside, and `tests/export-dependency.test.js` checks the file hashes. It is served locally; no CDN is used. The export adapter relies on a pinned internal close hook, so recheck it before upgrading.
