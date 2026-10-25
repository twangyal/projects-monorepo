# Melody Studio

A local browser music sketchbook. Hum or sing a single melody (or import a short audio clip), turn it into editable notes, layer synthesized and drum tracks, shape their sound and mix, and export MIDI or WAV. Everything runs in the browser; there is no account, backend or downloaded model.

**Status:** DEFERRED (2026-10-25) — paused while the portfolio focuses on Gaze Navigator, Clothing Studio and Karaoke Studio. Direction: [docs/PRODUCT_DIRECTION.md](../../docs/PRODUCT_DIRECTION.md)

## What works today

- **Capture:** record from the microphone or import browser-decodable audio (up to 20 seconds, 10 MiB); deterministic single-voice pitch detection transcribes it into notes quantized to quarter beats. A demo melody and a two-track example are built in.
- **Record with backing:** record a new part over the other tracks after a four-beat count-in (needs AudioWorklet; use headphones).
- **Piano roll:** drag to move and resize notes, draw new notes, edit exact pitch/start/duration/velocity, keyboard editing, snap settings, split and join notes, build chords (major, minor, sus2, sus4), roll chord attacks and cycle chord voicings.
- **Tracks:** up to 8 tracks with name, volume, mute, solo and reorder; instruments are three simple waveforms (sine, triangle, sawtooth) or a synthesized General MIDI drum kit with a 16-step pattern grid.
- **Sound design per track:** ADSR envelope, custom harmonic tone (8 partials), resonant low-pass filter with optional song-time cutoff curve, and rhythmic echo.
- **Mix:** stereo pan (static or automated), a shared algorithmic reverb bus, and volume automation (single ramp or multi-point curve).
- **Arrangement:** select a section to play, loop, duplicate, remove, move, quantize starts or durations, transpose, invert, stretch/compress, reverse or shape velocity; whole-track timing review with swing and audition before applying. Songs can span 512 beats.
- **Phrase continuation:** a small local statistical learner proposes 4 or 8 continuation notes from a selected ending; proposals are shown, auditioned and applied or discarded explicitly.
- **Reference takes:** each capture keeps a mono 22,050 Hz copy for comparing the edited notes against what was sung.
- **Projects and export:** IndexedDB autosave with multi-tab conflict recovery, Undo/Redo (50 edits), up to 8 named saved compositions, complete `.melody.json` backups, reviewed MIDI import, MIDI export (optionally with CC11 volume automation), and whole-song, section or per-track WAV export.

## Known gaps

Measured against the full-DAW destination in the product direction:

- Instruments are basic synthesized waveforms and a synthesized kit; no sampled instruments, sample import or kit choice.
- No audio clips: captured audio is a reference only and cannot be edited, arranged or mixed as a track.
- Mixing is limited to pan, one reverb bus and volume/cutoff/pan automation; no insert chains, extra buses, routing or mixer view.
- Capture is limited to 20-second, single-voice phrases. Transcription accuracy on real humming or singing has not been measured.
- Backed recording has no latency correction, and some intermittent native recording failures are unexplained.
- AI assistance is limited to the bounded phrase-continuation learner; no generative arrangement or harmony.
- Only Chromium is tested; Safari, Firefox and mobile recording are unverified.

## Run locally

Requires Node.js 22.18 or newer (CI uses Node 24) and npm.

```sh
cd apps/melody-studio
npm ci
npm run dev        # Vite dev server on 127.0.0.1
```

Open the URL Vite prints. Microphone capture needs a secure context (localhost or HTTPS) and browser permission. `npm run build` writes the static site to `dist/`; `npm run preview` serves it on 127.0.0.1. No environment variables or credentials are needed.

## Verify

```sh
npm run lint
npm run typecheck
npm test                     # Node unit tests (tests/*.test.ts)
npm run build
npm run check                # test + lint + build
npx playwright install chromium
npm run test:browser         # Playwright, builds and serves on port 4174
```

Browser tests build with `MELODY_TEST_HARNESS=1` to include test-only harness pages. Set `MELODY_TEST_PORT` to use another loopback port, or `CHROMIUM_PATH` to use an existing Chromium. CI: `.github/workflows/melody-studio.yml` (runs `npm run check` and `npm run test:browser`).

`scripts/` holds standalone smoke probes (`smoke_*.mjs`) that drive a separately running production preview; they are not part of CI.

## Project layout

- `index.html`, `src/main.ts` — single-page app and editor wiring.
- `src/workspace-view.ts` — focused workspace sections (Compose, Capture, Sound, Notes, Arrange, Reference, Project & export).
- `src/audio.ts`, `src/transcribe.worker.ts`, `src/recorder.ts` — capture, decoding and pitch transcription.
- `src/backed-*.ts`, `src/backing.ts` — record-with-backing (AudioWorklet).
- `src/mix.ts`, `src/track-render.ts`, `src/render.worker.ts`, `src/wav.ts` — synthesis, mixing and WAV rendering.
- `src/sound-*.ts`, `src/*-curve.ts`, `src/volume-ramp.ts`, `src/drums.ts` — sound design, automation and drum kit.
- `src/section*.ts`, `src/quantize.ts`, `src/timing.ts`, `src/note-*.ts`, `src/chord-*.ts` — note and arrangement edits.
- `src/midi.ts`, `src/midi-import.ts`, `src/midi-review.ts` — MIDI export and reviewed import.
- `src/storage.ts`, `src/reference-*.ts`, `src/composition-library.ts`, `src/history.ts` — persistence, backups and undo.
- `src/continuation.ts` — local phrase-continuation learner.
- `tests/` — `*.test.ts` unit tests and `*.spec.ts` Playwright tests.

## Data & privacy

Audio is processed in the browser and nothing is uploaded. The current project, reference takes and saved compositions live in this browser profile's IndexedDB and can be lost if site data is cleared; download `.melody.json` backups to keep work. Backups contain committed notes and normalized reference audio, not the original uploaded file, filename or device details.
